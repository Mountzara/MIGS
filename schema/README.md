# Cloudflare D1 schema — MountZara Clinical

All schema migrations for the **patient portal + clinician workspace + cross-app aggregation** platform live in this directory.

Per CLAUDE.md §11, the website is the single source of truth for `patient_id` and is the aggregation point for every MountZara app (Transcription, Clinical AI, Surgical Workflow, iOS, Research Digest). The D1 database `mountzara-clinical` is the relational backing store for that platform.

---

## File layout

```
schema/
├── README.md                               # this file
├── 0001_phase0_foundation.sql              # Phase 0 — every core table
├── 0002_<future_migration>.sql             # additive only — never alter Phase 0 schema
└── ...
```

**Rule:** migrations are append-only. Once a migration has been applied to the remote D1, it is immutable — never edit a prior migration file. Schema evolution is always a new file. This guarantees the migration history is replayable on a fresh database.

---

## Provisioning the D1 database (one-time)

```bash
export CLOUDFLARE_API_TOKEN=$(/usr/bin/security find-generic-password -s 'mountzara-cloudflare-deploy-token' -w)
npx wrangler d1 create mountzara-clinical
```

Wrangler prints a database id like `database_id = "<uuid>"`. Add it to `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "mountzara-clinical"
database_id = "<uuid-from-wrangler-d1-create>"
```

---

## Applying a migration to the remote D1

```bash
export CLOUDFLARE_API_TOKEN=$(/usr/bin/security find-generic-password -s 'mountzara-cloudflare-deploy-token' -w)
npx wrangler d1 execute mountzara-clinical \
    --remote \
    --file=schema/0001_phase0_foundation.sql
```

Wrangler reports the executed statement count and any errors. If any statement fails the rest still apply (D1 doesn't transact a multi-statement file) — re-run the file; the schema uses `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, and `INSERT OR IGNORE` so re-running is safe.

For local development (against a Miniflare-style D1 emulator):

```bash
npx wrangler d1 execute mountzara-clinical \
    --local \
    --file=schema/0001_phase0_foundation.sql
```

---

## Inspecting the live schema

```bash
npx wrangler d1 execute mountzara-clinical --remote --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
npx wrangler d1 execute mountzara-clinical --remote --command="SELECT sql FROM sqlite_master WHERE type='table' AND name='patients'"
```

---

## Backup + DR

Per CLAUDE.md §11 Tier 7, D1 daily snapshots are exported to a separate R2 bucket. The export command:

```bash
npx wrangler d1 export mountzara-clinical --remote --output=/tmp/mountzara-clinical-$(date +%Y%m%d).sql
```

Schedule that via a Cloudflare cron trigger (Pages Functions cron) and upload the `.sql` to an `mountzara-backups` R2 bucket retained 90 days hot + 7 years cold. The DR drill is performed quarterly — fresh database created, latest export imported, smoke-tested against the application.

---

## Phase 0 — what 0001 creates

| Table | Purpose | Phase that lights it up |
|---|---|---|
| `patients` | Canonical patient record | Phase 1 |
| `clinicians` | Dr. Mabini + future clinicians/staff | Phase 0 (seeded) |
| `auth_sessions` | Active session records (mirrored in KV) | Phase 1 |
| `magic_link_tokens` | Single-use passwordless tokens | Phase 1 |
| `intake_responses` | Top-level intake submission | Phase 1 |
| `intake_section_data` | Per-section JSON for the 19 Thorek sections | Phase 1 |
| `appointment_triage` | §11.7 AI triage decisions | Phase 2.5 |
| `clinician_availability` | Drag-to-set blocks (15-min granularity) | Phase 2 |
| `appointments` | Scheduled appointments | Phase 2 |
| `encounters` | Visit records (note body in R2) | Phase 4 |
| `messages` | Secure messaging (body in R2) | Phase 3 |
| `documents` | Patient uploads + clinician docs | Phase 1 |
| `audit_log` | Append-only HIPAA audit trail | Phase 0 (live from day 1) |
| `billing_invoices` | Stripe invoices | Phase 6 |
| `app_sync_tokens` | Per-app push tokens | Phase 4 |
| `baa_ledger` | Vendor BAA tracking | Phase 0 (seeded w/ Cloudflare) |

---

## PHI handling

Per CLAUDE.md §11 Tier 2 + Tier 7, the D1 tables hold only **non-PHI metadata + R2 pointers** for any field that could exceed row size or carry free-text PHI. Specifically:

| Field | Why R2, not D1 |
|---|---|
| `encounters.note_r2_key` | SOAP note bodies can be many KB of free-text + clinical detail |
| `encounters.note_pdf_r2_key` | Signed PDF exports |
| `documents.r2_key` | Uploaded files (always) |
| `messages.body_r2_key` | Message bodies (PHI risk in free-text) |
| `patients.totp_secret_encrypted` | Envelope-encrypted in D1 (small, always-needed-on-login) |

PHI fields that DO live in D1 (necessary for query/index):
- `patients.email`, `patients.phone`, `patients.first_name`, `patients.last_name`, `patients.dob`, `patients.mrn`
- `intake_section_data.data_json` (Thorek intake — denormalized by section to keep row size bounded)
- `appointments.chief_complaint_summary` (short denormalized)

All D1 access goes through application code that writes to `audit_log` per §4.2. The audit_log entries themselves are non-PHI by construction (record_id is a UUID, not a name).

---

## Master encryption key

The R2 PHI bucket uses Cloudflare's at-rest encryption (default). Additionally, every document stored in R2 may be wrapped with a per-record AES-GCM 256 envelope key (`envelope_dek_wrapped` column). The master key that wraps DEKs lives in a Pages secret named `PHI_MASTER_KEY` (32 random bytes, base64-encoded). Rotate annually:

```bash
# Generate a new key
NEW_KEY=$(openssl rand -base64 32)

# Push to Cloudflare Pages as a secret
echo "$NEW_KEY" | npx wrangler pages secret put PHI_MASTER_KEY --project-name=mountzara

# Then re-wrap existing DEKs by running scripts/rotate-phi-master-key.sh
# (does not re-encrypt the PHI itself — only the DEKs, which is fast)
```
