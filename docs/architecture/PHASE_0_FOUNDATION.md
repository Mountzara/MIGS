# Phase 0 — Foundation Runbook

Status: scaffolding landed; resources provisioned; ready for Phase 1.

Per CLAUDE.md §11 phased plan, Phase 0 lays the persistence + auth + audit + compliance foundation that every subsequent phase builds on. Nothing in Phase 0 is user-visible — Phase 0 is additive scaffolding behind Cloudflare Access and route guards. The first patient-facing surface lights up in Phase 1.

---

## What landed

| File | Purpose |
|---|---|
| `schema/0001_phase0_foundation.sql` | D1 migration: every core table (patients, clinicians, sessions, magic_link_tokens, intake_responses, intake_section_data, appointment_triage, clinician_availability, appointments, encounters, messages, documents, audit_log, billing_invoices, app_sync_tokens, baa_ledger). |
| `schema/README.md` | How to apply migrations, inspect schema, backup + DR. |
| `functions/_lib/auth.js` | Patient + clinician auth: PBKDF2-HMAC-SHA-256 password hash + verify, session create/get/revoke, magic-link issue/redeem, `requireRole()` guard, session cookies. |
| `functions/_lib/audit.js` | `logAudit()` with action allowlist, append-only writes to `audit_log`, never-throws semantics. |
| `functions/_lib/phi.js` | Envelope encryption: per-record AES-GCM 256 DEKs wrapped with `PHI_MASTER_KEY`; `putPhiObject` + `getPhiObject` for the `mountzara-phi` R2 bucket. |
| `functions/_lib/db.js` | Thin D1 helpers: `requireDb`, `getById`, `newId`, `now`. |
| `docs/compliance/BAA-ledger.md` | Vendor BAA tracking source-of-truth. Cloudflare signed; Stripe + Twilio pending; Doxy.me na (their domain); Anthropic na with mitigations. |
| `docs/compliance/audit-policy.md` | Audit log policy — what is/isn't logged, retention, access, append-only enforcement. |
| `wrangler.toml` | New bindings: D1 (`DB`), KV (`MZ_SESSIONS`, `MZ_MAGIC_LINKS`), R2 (`PHI`). Existing `MEDIA` + `CONTENT` retained. |

---

## Cloudflare resources provisioned

| Resource | Identifier | Binding | Notes |
|---|---|---|---|
| D1 database | `mountzara-clinical` | `DB` | UUID from `wrangler d1 create` recorded in `wrangler.toml`. |
| KV namespace | `MZ_SESSIONS` | `MZ_SESSIONS` | Active sessions, fast lookup mirror of D1 `auth_sessions`. |
| KV namespace | `MZ_MAGIC_LINKS` | `MZ_MAGIC_LINKS` | Optional fast-path for magic-link redemption — currently D1 is the only path; this binding is reserved for Phase 1 if needed. |
| R2 bucket | `mountzara-phi` | `PHI` | All PHI bodies. Separate from `mountzara-content` (post drafts) and `mountzara-media` (videos). |
| Pages secret | `PHI_MASTER_KEY` | env | 32 random bytes, base64-encoded. Generated via `openssl rand -base64 32`. Rotate annually. |

---

## How to apply the schema

```bash
export CLOUDFLARE_API_TOKEN=$(/usr/bin/security find-generic-password -s 'mountzara-cloudflare-deploy-token' -w)
cd /Users/beans/Developer/MountZara/MIGS

# One-time only — creates the database. Skip if already exists.
npx wrangler d1 create mountzara-clinical
# Copy the database_id printed to wrangler.toml's [[d1_databases]] block.

# Apply the schema (idempotent — re-running is safe).
npx wrangler d1 execute mountzara-clinical --remote --file=schema/0001_phase0_foundation.sql

# Verify
npx wrangler d1 execute mountzara-clinical --remote --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

## How to provision the KV + R2 + secret

```bash
# KV namespaces
npx wrangler kv namespace create MZ_SESSIONS
npx wrangler kv namespace create MZ_MAGIC_LINKS
# Copy the returned ids into wrangler.toml's [[kv_namespaces]] blocks.

# R2 bucket
npx wrangler r2 bucket create mountzara-phi

# Master key (run once, then store in Cloudflare; future rotation re-runs with new value)
echo "$(openssl rand -base64 32)" | npx wrangler pages secret put PHI_MASTER_KEY --project-name=mountzara
```

---

## How the pieces fit

```
                        ┌───────────────────────────────────────┐
                        │  Cloudflare Pages (mountzara.com)     │
                        └──────────────┬────────────────────────┘
                                       │
                                       ▼
              ┌──────────────────────────────────────────────────┐
              │  Pages Functions   /functions/...                │
              │                                                  │
              │   /admin/* — Basic Auth (existing)               │
              │   /api/posts/* — existing post API               │
              │                                                  │
              │   _lib/auth.js   ← createSession,                │
              │                    getSession,                   │
              │                    requireRole,                  │
              │                    issueMagicLink,               │
              │                    redeemMagicLink               │
              │   _lib/audit.js  ← logAudit                      │
              │   _lib/phi.js    ← encryptPhi / decryptPhi /     │
              │                    putPhiObject / getPhiObject   │
              │   _lib/db.js     ← requireDb, newId, now         │
              └──────────────┬────────────┬───────────┬─────────┘
                             │            │           │
                  ┌──────────▼─────┐ ┌────▼────┐ ┌────▼──────────┐
                  │  D1            │ │   KV    │ │   R2          │
                  │  mountzara-    │ │ MZ_     │ │ mountzara-phi │
                  │  clinical      │ │ SESSIONS│ │ (encrypted)   │
                  └────────────────┘ └─────────┘ └───────────────┘
```

- **D1** holds the relational truth (patients, sessions, appointments, audit_log, etc.). Indexes on every common lookup pattern.
- **KV** is the fast-path session lookup mirror. A session-resolve call reads KV first, falls back to D1. KV entries have the same TTL as the D1 row's `expires_at`.
- **R2** is the blob store for PHI bodies (encounter notes, message bodies, uploaded documents). All PHI in R2 is envelope-encrypted via `_lib/phi.js`. The wrapped DEK lives in the corresponding D1 row (`documents.envelope_dek_wrapped` etc.).
- **Pages secrets** carry the master key + admin password hash + (Phase 1+) sendgrid/twilio API keys.

---

## Security boundary summary

| Layer | Protection |
|---|---|
| Browser → Cloudflare edge | TLS 1.3 (Cloudflare default). HSTS. |
| Cloudflare → D1/KV/R2 | Cloudflare internal network; managed encryption at rest. |
| PHI bodies in R2 | AES-GCM 256 with per-record DEK; DEK wrapped with `PHI_MASTER_KEY` envelope; AAD binds ciphertext to patient_id + record_type. |
| PHI metadata in D1 | Cloudflare-managed at-rest encryption (default). Application code never returns full rows over public APIs without a `requireRole()` check. |
| Auth tokens | Session tokens are 256 random bits; SHA-256 hash compared in constant time. Tokens are HttpOnly Secure SameSite=Lax cookies. |
| Magic links | 192 random bits; raw token mailed; only SHA-256 hash stored; 15-min expiry; single-use. |
| Password storage | PBKDF2-HMAC-SHA-256, 100,000 iterations, per-user 16-byte salt. |
| Audit log | Append-only by discipline; 6-year retention; PHI-free `details_json`. |

---

## What's not in Phase 0 (deferred)

- **Routes** (`/api/v1/auth/*`, `/api/v1/intake/*`, `/api/v1/appointments/*`, `/portal/*` SPA). These light up in Phase 1.
- **Cron triggers** for D1 backup, magic-link cleanup, session cleanup. Deferred to Phase 7 hardening; until then, expired rows are tolerated (the queries always filter on `expires_at`).
- **Cloudflare Queues** for SMS reminders, app sync ingestion, audit batching. Schema is ready; queues are created in Phase 2 / Phase 4 when consumers exist.
- **Anomaly alerting** on login_fail / phi_read / data_export. Phase 7.
- **Real-time GCal sync** of clinician availability. Phase 2.
- **TOTP 2FA enrollment / verification UI.** Schema column exists; UI in Phase 1+.

---

## Verification checklist (run before declaring Phase 0 done)

- [ ] D1 database `mountzara-clinical` exists; `mountzara-clinical/sqlite_master` returns 17 tables.
- [ ] `wrangler.toml` carries `[[d1_databases]]`, `[[kv_namespaces]]` (×2), and `[[r2_buckets]]` for `PHI` in addition to existing `MEDIA` + `CONTENT`.
- [ ] `PHI_MASTER_KEY` Pages secret exists (visible in `wrangler pages secret list --project-name=mountzara`).
- [ ] §3.10 regression-risk audit on the live site: every item passes (the index.html / about / admin pages are unchanged in Phase 0, so any failure means a deploy regressed an unrelated surface).
- [ ] Cloudflare BAA seeded in `baa_ledger` table (`SELECT * FROM baa_ledger`).
- [ ] An audit_log row writes successfully via a one-shot test call.
- [ ] Master key encrypt + decrypt round-trip passes (test fixture in `scripts/test-phi-roundtrip.sh`, Phase 0+).
