# Audit Log Policy — MountZara Clinical Platform

Per CLAUDE.md §11 Tier 7 and HIPAA §164.312(b) (Audit Controls).

## What is logged

Every event that touches PHI or that affects the security posture of the system writes a row to the D1 `audit_log` table. The full list of permitted action codes lives in `functions/_lib/audit.js`'s `ALLOWED_ACTIONS` set and currently covers:

- **Auth:** `login_success`, `login_fail`, `logout`, `session_create`, `session_revoke`, `magic_link_issue`, `magic_link_redeem`, `password_reset_request`, `password_reset_complete`, `role_check_fail`, `totp_enroll`, `totp_verify_success`, `totp_verify_fail`.
- **Patient lifecycle:** `patient_create`, `patient_update`, `patient_close`.
- **Intake:** `intake_start`, `intake_section_save`, `intake_submit`, `intake_review`.
- **Triage:** `triage_run`, `triage_override`, `triage_release`.
- **Scheduling:** `availability_set`, `availability_update`, `appointment_book`, `appointment_cancel`, `appointment_reschedule`, `appointment_complete`, `appointment_no_show`, `doxy_join`.
- **Messaging:** `message_send`, `message_read`, `message_delete`.
- **Documents:** `document_upload`, `document_download`, `document_delete`.
- **Encounters / clinical:** `encounter_create`, `encounter_update`, `phi_read`, `phi_write`, `phi_delete`.
- **Billing:** `invoice_create`, `invoice_send`, `invoice_paid`, `invoice_void`.
- **App sync:** `app_sync_push`, `app_sync_token_issue`, `app_sync_token_revoke`.
- **Admin / data rights:** `admin_override`, `data_export`, `data_amendment_request`, `data_restriction_request`.

When a new action is needed, add it to `ALLOWED_ACTIONS` in the same commit that introduces the call site.

## Each row carries

| Column | Content |
|---|---|
| `id` | UUIDv4 for the audit row itself. |
| `ts` | Millisecond unix epoch of the event. |
| `user_id` | `patients.id` / `clinicians.id` / NULL for anonymous. |
| `user_role` | `patient` / `clinician` / `staff` / `anonymous` / `app`. |
| `action` | One of the codes above. |
| `record_type` | The kind of record the action targeted (`patient`, `intake`, `appointment`, etc.). |
| `record_id` | The UUID of the targeted record. |
| `ip` | Source IP (from `CF-Connecting-IP` header). |
| `user_agent` | The HTTP user-agent. |
| `success` | 0/1. |
| `details_json` | Action-specific context. **MUST be PHI-free.** Pass record_ids, not names/DOBs/notes. |

## What is NOT logged

PHI never enters `details_json`. The reasoning:

- `audit_log` is queried by the admin dashboard and exported for compliance reviews; treating it as PHI-free makes those flows safe.
- Record IDs are sufficient to reconstruct the event — if more context is needed, the auditor joins back to the PHI tables under their normal access controls.

Concretely, the following NEVER appear in `details_json`:

- Patient name, DOB, address, phone, email body, MRN, SSN.
- Free-text chief complaint or visit notes.
- Document filenames if they could contain PHI (filenames are referenced by `record_id` instead).
- Diagnostic codes when associated with a specific patient (the row's `record_id` carries that link).

## Retention

**Six years** from the date of each event, per HIPAA §164.530(j). The application never deletes from `audit_log`. Quarterly D1 exports go to a separate `mountzara-backups` R2 bucket (cold retention 7 years) to survive a D1 incident.

## Access controls

| Reader | Permitted scope |
|---|---|
| The patient themselves | Their own audit rows via `/portal/profile/activity-log` (Phase 1+). |
| Dr. Mabini (clinician) | Full read access via `/admin/audit` and `/admin/cases/<patient_id>` views. |
| Staff (when added) | Patient-scoped audit rows for patients on their assigned panel. |
| External auditor | Read-only export via `/admin/audit/export` (Phase 7+), requires `clinician` role + an explicit export approval. |

Write access: **none** through any UI. The only writer is `logAudit()` in `functions/_lib/audit.js`, invoked from server-side route handlers.

## Append-only enforcement

D1 doesn't have native append-only table support. The discipline is enforced in application code:

- No `UPDATE audit_log` or `DELETE FROM audit_log` is ever called from Pages Functions. Code review enforces this. A `grep -rn "UPDATE audit_log\|DELETE FROM audit_log" functions/` should always return zero results.
- Schema migrations after Phase 0 are forbidden from altering `audit_log` columns. Adding new action codes is an `ALLOWED_ACTIONS` change, not a schema change.
- Daily off-database backups to R2 give us a recovery path if a future migration accidentally violates this.

## Failure handling

`logAudit()` swallows D1 errors and writes structured `console.error` so the wrangler tail / Cloudflare log still records the event. The user-facing request is never failed because an audit write failed (degraded availability of audit beats failing PHI access entirely). If audit-write reliability becomes a concern, a follow-up phase will introduce a `mz-audit-batch` Queue and a worker that drains it into D1 with retry — but the inline write path remains the primary.

## Anomaly alerts

Phase 7 (Hardening) introduces:

- Alert if `login_fail` count for a single IP exceeds 10 in 5 minutes → block the IP at Cloudflare WAF.
- Alert if `phi_read` count for a single clinician exceeds 200 in 1 hour → operator review.
- Alert if `data_export` event occurs outside business hours → operator review.

Until Phase 7 lands, `audit_log` is the inspection target — no real-time alerting beyond Cloudflare's own ratelimits.
