# Disaster Recovery Plan

Per CLAUDE.md §11 Tier 7 / HIPAA §164.308(a)(7) Contingency Plan Standard. Reviewed annually; restore-from-backup drill quarterly.

## 1. Inventory of recoverable systems

| System | Description | Source of truth | Recovery target |
|---|---|---|---|
| Cloudflare D1 `mountzara-clinical` | Patient registry, intake, triage, appointments, encounters, messages, symptom diary, education assignments, audit log, etc. | Cloudflare D1 (managed). Daily snapshots in R2 `mountzara-backups` bucket. | < 4 h RTO, < 24 h RPO |
| Cloudflare R2 `mountzara-phi` | Envelope-encrypted PHI bodies (message bodies, encounter notes, message attachments, education R2 entries) | Cloudflare R2 (managed; default at-rest encryption). No application-side mirror — Cloudflare's multi-AZ replication is the only copy. | Tier-1 reliance on Cloudflare R2 durability (11 nines). |
| Cloudflare R2 `mountzara-content` | Non-PHI content (Evidence + Trending posts, large education primers, legal PDFs) | Cloudflare R2 + GitHub mirror of post-generation pipeline (MountZaraResearchDigest) | Re-generatable from the pipeline; non-critical. |
| Cloudflare R2 `mountzara-media` | Hero video, RPOC arcuate preview, other static media | Cloudflare R2 + originals on the operator's Mac filesystem | Restorable from the Mac via `/upload/` PUT endpoint. |
| Cloudflare R2 `mountzara-backups` | The D1 snapshot bucket itself | Distinct bucket, distinct prefix, distinct API token scope so an attacker with the deploy token cannot drain it. | Self-protecting — operator manually rotates `mountzara-backups` token annually. |
| Cloudflare Pages secrets | `PHI_MASTER_KEY` (32-byte AES key wrapping all per-record DEKs in mountzara-phi), `ADMIN_PASS_HASH`, magic-link signing key, every `*_SYNC_TOKEN`, `UPLOAD_TOKEN`, `ANTHROPIC_API_KEY` (when set) | Cloudflare Pages dashboard. **Operator MUST also keep a copy of `PHI_MASTER_KEY` in a separate offline location (Keychain + paper safe) — losing PHI_MASTER_KEY means every encrypted PHI body is permanently unreadable.** | Offline copy of `PHI_MASTER_KEY` required. |
| Code (this repo) | Cloudflare Pages serves whatever was last `wrangler pages deploy`-ed. The mountzara/MIGS GitHub repo is the canonical source. | Branch on github.com/Mountzara/MIGS + active Claude Code worktree | Re-deploy from any historical commit via `scripts/deploy-prod.sh`. |
| Macros (Keychain) on operator Mac | Cloudflare deploy token, admin password, per-app sync tokens | Apple Keychain | Re-issue from Cloudflare dashboard if Mac lost; no permanent dependency. |

## 2. Backup mechanisms

- **D1 snapshots:** `scripts/_backup_d1_to_r2.sh` exports the live D1 to `r2://mountzara-backups/d1/<UTC-date>.sql.gz` and prunes to the last 14 snapshots. Operator-runnable today; Phase 7 Round B will migrate this to a Cloudflare Workers cron trigger so the operator's Mac doesn't need to be awake.
- **R2 default durability:** Cloudflare guarantees 99.999999999% (11 nines) annual durability across multi-AZ replication. We do not maintain a second cloud mirror; instead we rely on Cloudflare's stated durability + our envelope-encryption invariant (compromise of one R2 bucket cannot decrypt without `PHI_MASTER_KEY`).
- **R2 object-lock retention** (added 2026-05-16):
  - `mountzara-phi` — lock rule `phi-hipaa-7yr`: every object retained for 2555 days (7 years, HIPAA 6-year minimum + 1-year buffer). Cloudflare blocks DELETE of any object under retention regardless of who issues the request, including from the operator Mac with a full-access API token. This is the load-bearing defense against accidental or malicious bulk-delete of PHI bodies.
  - `mountzara-content` — lock rule `posts-1yr`: 365-day retention on the entire bucket so a misfired pipeline run cannot wipe historical Evidence/Trending posts.
  - `mountzara-backups` — lock rule `d1-snapshot-90d`: 90-day retention on the `d1/` prefix so D1 snapshots cannot be deleted by the retention pruner below the 90-day floor. The `_backup_d1_to_r2.sh` 14-rotation policy still applies for tidy-up; lock just forbids reach-back beyond 90 days.
  - Inspect locks: `wrangler r2 bucket lock list <bucket>`. Add/remove locks: `wrangler r2 bucket lock add|remove`.
- **Pages deploys:** the Cloudflare Pages dashboard retains every deployment indefinitely; rollback is `wrangler pages deployment alias`.
- **Code:** GitHub `github.com/Mountzara/MIGS` is the source of truth. Local clones on operator Mac + any active Claude session are working copies.
- **Master key escrow:** the operator MUST keep an offline paper or hardware-token copy of `PHI_MASTER_KEY`. Currently held in operator's macOS Keychain only — that is a single point of failure that this plan flags as a known risk pending hardware-token enrollment.

## 3. Recovery procedures

### 3.1 D1 restore from snapshot

1. Fetch the desired snapshot:
   ```bash
   source ~/.config/mountzara/cf-creds.env
   curl -sS "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets/mountzara-backups/objects/d1/2026-05-16.sql.gz" \
     -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
     | gunzip > /tmp/restore.sql
   ```
2. Create a scratch D1 DB (so the live one is not touched during the drill):
   ```bash
   npx wrangler d1 create mountzara-clinical-restore
   ```
3. Apply the SQL:
   ```bash
   npx wrangler d1 execute mountzara-clinical-restore --remote --file=/tmp/restore.sql
   ```
4. Validate row counts per table against the live DB. Pick four key tables (patients, intake_responses, appointment_triage, audit_log) and compare:
   ```bash
   npx wrangler d1 execute mountzara-clinical          --remote --command='SELECT COUNT(*) FROM patients'
   npx wrangler d1 execute mountzara-clinical-restore --remote --command='SELECT COUNT(*) FROM patients'
   ```
5. If restore is for a true incident (not a drill), point the Pages deployment_config DB binding from the live DB to the restored one, redeploy, and verify the patient portal + admin pages load.
6. Drop the scratch DB after validation: `npx wrangler d1 delete mountzara-clinical-restore`.

### 3.2 R2 PHI bucket restore

R2 carries the bytes; D1 carries the wrapped DEKs. After a D1 restore the wrapped DEKs are valid against existing R2 objects as long as `PHI_MASTER_KEY` is unchanged. If R2 objects were deleted by mistake, there is no application-side backup — recovery options:

- Cloudflare R2 versioning + object lifecycle if enabled on the bucket (currently NOT enabled — Phase 7 Round B item to enable lock + versioning on `mountzara-phi`).
- Cloudflare support for cross-region restore from their internal replicas (best-effort, no SLA).

If `PHI_MASTER_KEY` is rotated, every wrapped DEK in the live DB must be re-wrapped under the new master before the old key is revoked. Phase 7 Round B will provide a re-wrap script.

### 3.3 Pages deploy rollback

```bash
# List recent deploys.
source ~/.config/mountzara/cf-creds.env
curl -sS "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/mountzara/deployments?per_page=20" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | python3 -m json.tool
```

Promote any historical deployment to the production alias via the dashboard (Pages → mountzara → Deployments → "Promote to production" on the row). Once promoted, the apex serves that deploy within ~30 seconds.

### 3.4 Master key emergency

If `PHI_MASTER_KEY` is suspected leaked but the bytes are still recoverable:
1. Generate a new `PHI_MASTER_KEY_NEW` (32 random bytes, base64).
2. Provision it as a Pages secret alongside the old one.
3. Run a re-wrap migration (Phase 7 Round B): for every encrypted-PHI row across `messages`, `documents`, `encounter_ai_summaries`, etc., decrypt the wrapped DEK with the old master and re-encrypt it under the new master. Bytes in R2 are untouched.
4. Revoke the old `PHI_MASTER_KEY` from Pages secrets.
5. Audit-log a `master_key_rotation` event with the operator id and the count of records re-wrapped.

If `PHI_MASTER_KEY` is **lost** (not leaked — just missing), every encrypted PHI body is permanently unreadable. This is the single most important key in the system. **Keep an offline backup.**

## 4. Drill schedule

- **Quarterly:** §3.1 D1 restore from snapshot. Operator confirms row counts match within 24 h of live state. Log drill in `audit_log` with action='dr_drill_d1_restore' + drill_date + outcome.
- **Annually:** §3.3 Pages rollback drill (promote a stale deployment, confirm apex serves the older content, then re-promote the latest).
- **Annually:** confirm the offline `PHI_MASTER_KEY` copy is still readable.
- **Annually:** confirm every per-app sync token (TRANSCRIPTION/CLINICAL_AI/SURGICAL_WORKFLOW/IOS/UPLOAD/ANTHROPIC) is rotated. Operator generates new tokens, updates the app side, then deletes the old secret from Pages.

## 5. Known gaps (Phase 7 Round B)

- Workers cron-trigger version of `_backup_d1_to_r2.sh` so the backup doesn't depend on the operator's Mac being on.
- R2 object lock + versioning on `mountzara-phi` and `mountzara-content`.
- Re-wrap migration script for `PHI_MASTER_KEY` rotation.
- Offline `PHI_MASTER_KEY` backup ritual — currently flagged as known-single-point-of-failure.

## 6. Last reviewed

2026-05-16 (Phase 7 Round A initial draft).
