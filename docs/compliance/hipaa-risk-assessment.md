# HIPAA Security Rule Risk Assessment

Per HIPAA §164.308(a)(1)(ii)(A) — "Conduct an accurate and thorough assessment of the potential risks and vulnerabilities to the confidentiality, integrity, and availability of electronic protected health information." Performed at least annually plus on every material change to the technology or workflow.

Last assessed: 2026-05-16 · Next due: 2027-05-16 · Performed by: Chris Mabini, DO (operator) with Claude assistance.

## Methodology

Each row is one PHI-touching system or workflow. For each: identify likely threats, evaluate likelihood × impact, document existing safeguards, document residual risk, and assign a remediation owner + due date for any unacceptable residual.

Scoring: likelihood and impact each rated 1 (rare/negligible) – 4 (likely/critical). Risk = likelihood × impact. ≥ 9 is unacceptable and must have a remediation plan with a due date.

## Risk register

| # | Asset / workflow | Threat | Likelihood (1-4) | Impact (1-4) | Risk | Existing safeguards | Residual | Owner | Status |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Cloudflare D1 (`mountzara-clinical`) | Cloudflare service compromise | 1 | 4 | 4 | Cloudflare BAA on file (#1 in BAA ledger). All PHI bodies envelope-encrypted in R2 — D1 only holds wrapped DEKs + minimal metadata. | acceptable | operator | active |
| 2 | Cloudflare R2 `mountzara-phi` | Unauthorized object download | 2 | 4 | 8 | Bucket access restricted to Pages Workers bound to env.PHI. Bodies AES-GCM-256 envelope-encrypted under PHI_MASTER_KEY held in Pages Secrets. customMetadata IVs separate from D1's wrapped_dek. | acceptable | operator | active |
| 3 | `PHI_MASTER_KEY` (Pages Secret) | Key compromise via Cloudflare panel access | 1 | 4 | 4 | Pages Secrets are write-only via dashboard or wrangler API — values are not displayed back. Cloudflare 2FA required on operator account. CF API tokens are scope-limited (`Claude Admin` token for code/data deploys; `mountzara-backups` token cannot read mountzara-phi). | acceptable | operator | active |
| 4 | `PHI_MASTER_KEY` loss (not compromise) | Forgotten / lost without an offline copy | 2 | 4 | 8 | macOS Keychain copy on operator Mac. **Gap: no offline (paper safe / hardware-token) copy yet.** | **HIGH** | operator | open — Phase 7 Round B |
| 5 | Patient password store | Credential stuffing or brute force | 3 | 3 | 9 | PBKDF2-HMAC-SHA-256 100,000 iterations + 16-byte salt per row (§9.8.3). 12-hour session TTL. No password disclosure on login failure. **Gap: no rate-limiting middleware on /api/v1/auth/login yet.** | **HIGH** | operator | open — Phase 7 Round B |
| 6 | Admin Basic Auth | Credential stuffing on /admin/* + preview gate | 2 | 4 | 8 | PBKDF2 100k iterations against ADMIN_PASS_HASH. Per §9.8.3 — 100k cap on Workers. Cloudflare Access optional layer. **Gap: rate-limiting** | medium | operator | open — Phase 7 Round B |
| 6b | Admin Basic Auth | Phishing / shoulder-surf of admin password | 2 | 4 | 8 | TLS 1.3 enforced. Strict HSTS. CSP frame-ancestors none. **Gap: no MFA — TOTP planned but not yet enabled.** | medium | operator | open — Phase 7 Round B |
| 7 | Magic-link token | Token replay or interception | 2 | 3 | 6 | 192-bit random token, SHA-256 hash stored in D1 (raw token only in URL + email), 15-min expiry, single-use, audit-logged on issue + redeem. | acceptable | operator | active |
| 8 | Per-app sync tokens (TRANSCRIPTION / CLINICAL_AI / SURGICAL_WORKFLOW / IOS) | Token leak from a compromised app device | 2 | 3 | 6 | One token per app — compromise of one does not grant the others. Bearer auth, constant-time comparison defeats timing attacks. Audit-logged on auth failure. **Gap: tokens are long-lived (annual rotation only); short-lived tokens or device attestation would be stronger.** | acceptable | operator | active |
| 9 | Audit log integrity | Tampering by attacker with DB write access | 2 | 4 | 8 | audit_log is append-only by convention (no app code DELETES); D1 access requires the Pages Worker context. **Gap: no cryptographic chain (hash-chained log entries) yet.** | medium | operator | open — Phase 7 Round B |
| 10 | DR — D1 loss | Cloudflare D1 data loss | 1 | 4 | 4 | Daily snapshot to `mountzara-backups` R2 bucket via `scripts/_backup_d1_to_r2.sh` (operator-runnable). 14-rotation retention. Quarterly restore drill. **Gap: backup script runs from operator Mac — moves to Workers cron in Round B.** | acceptable | operator | active |
| 11 | DR — R2 PHI bucket loss | R2 object deletion | 2 | 4 | 8 | Cloudflare R2 multi-AZ durability (11 nines). **Gap: object lock + versioning not yet enabled on mountzara-phi.** | medium | operator | open — Phase 7 Round B |
| 12 | Doxy.me telehealth session | Video session compromise | 1 | 3 | 3 | Doxy.me holds its own HIPAA BAA (independent — they are not a Mount Zara BAA party). Sessions are peer-to-peer WebRTC on `dr-mabini.doxy.me`. mountzara.com hosts only the launch button. | acceptable | operator | active |
| 13 | Anthropic Claude API (when ANTHROPIC_API_KEY active) | PHI transmission to non-BAA processor | 2 | 4 | 8 | De-identification per §11.4 BAA-ledger / functions/_lib/intake_triage.js (no name, DOB->decade bucket, no phone/email, MRN replaced with triage row id). Fallback path writes manual_review_required if API key missing. | acceptable until BAA signed; ANTHROPIC BAA is in flight per BAA-ledger §5. | operator | open until BAA executes |
| 14 | Mailer (future Twilio/SendGrid for notifications) | PHI leak in email body | 2 | 3 | 6 | Not yet implemented. When implemented per Phase 3 Round C notifications: email body must be PHI-free ("you have a new message in your portal — click to read"). | not active | operator | blocked on Twilio BAA |
| 15 | Stripe billing (future Phase 6) | Payment data spill | 2 | 4 | 8 | Not yet implemented. When implemented: Stripe-hosted checkout only — payment data never touches mountzara.com. Stripe BAA required before any clinical context attached to invoices. | not active | operator | blocked on Stripe BAA |
| 16 | Operator workstation (Mac) | Lost / stolen laptop with Keychain access | 2 | 4 | 8 | FileVault full-disk encryption. macOS lock screen. Keychain locked when machine sleeps. Touch ID. **Gap: no remote wipe enrollment in MDM.** | acceptable for solo-practice scale; revisit if staff added | operator | active |

## Treatment plan for HIGH residuals

- **Row 4 (PHI_MASTER_KEY offline backup):** before Phase 7 closes, generate a paper printout of the base64 key, sealed in an envelope, stored in a fire-safe + a second copy with a trusted attorney as escrow. Document the location in this register only — never in the digital record itself.
- **Row 5 (patient auth rate-limiting):** Phase 7 Round B will add KV-backed counters keyed by IP + email — soft lockout after 10 failed logins / 15 minutes, hard lockout requires email-based reset.

## Acceptance signature

- Risk register approved by: Chris Mabini, DO — operator signature on file via ` audit_log` action='compliance_attestation' record_type='hipaa_risk_register' details.year=2026.
- Acceptance date: 2026-05-16
- Next review: 2027-05-16

## 6. Last reviewed

2026-05-16 (Phase 7 Round A initial draft).
