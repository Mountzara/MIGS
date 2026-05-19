# Admin MFA / TOTP

Per CLAUDE.md §11 Tier 7. Second factor on every `/admin/*` request.
Closes the open Phase 7 follow-on for admin two-factor auth.

## What this adds

After Basic Auth succeeds, the admin middleware now consults a signed
`mz_admin_mfa` cookie:

- If the cookie is present + valid + within 8 hours → request passes through.
- Otherwise → server returns a Mount Zara-themed prompt asking for a 6-digit
  TOTP code (or an `xxxx-xxxx` recovery code).
- The prompt's POST handler verifies the code, sets the 8-hour signed cookie,
  and redirects back to whichever `/admin/*` URL the operator was trying to
  reach.

If `ADMIN_TOTP_SECRET` is **not** set on Cloudflare Pages, MFA is silently
disabled — useful as a kill-switch while enrolling for the first time.

## Implementation

| File                                       | Role |
| ------------------------------------------ | ---- |
| `functions/_lib/totp.js`                   | Pure-JS RFC 6238 (HMAC-SHA-1, 6-digit, 30-s window, ±1 step skew). |
| `functions/_lib/mfa_cookie.js`             | HMAC-SHA-256 signed cookie. HttpOnly, Secure, SameSite=Strict, Path=/admin, 8-hour expiry. |
| `functions/admin/_mfa.js`                  | POST endpoint that verifies the code + issues the cookie. Also serves a GET prompt for fallback. |
| `functions/admin/_middleware.js`           | Calls `verifyMfaCookie()` after Basic Auth, serves `mfaPromptHtml()` when missing/expired. |
| `scripts/admin_totp_enroll.sh`             | Operator-side enrollment: generates secret + QR + 10 recovery codes, pushes to Cloudflare Pages secrets, caches locally in Keychain. |

## Cloudflare Pages secrets

| Secret                          | Purpose |
| ------------------------------- | ------- |
| `ADMIN_TOTP_SECRET`             | Base32 shared secret used to verify TOTP codes. Setting this secret turns MFA on. |
| `ADMIN_TOTP_RECOVERY_HASHES`    | Newline-separated SHA-256 hashes of the 10 one-time recovery codes. |
| `ADMIN_MFA_COOKIE_KEY`          | 32 hex bytes used to HMAC-sign the `mz_admin_mfa` cookie. Rotating this immediately invalidates every existing MFA session. |

## Enrollment

```
./scripts/admin_totp_enroll.sh
```

Walks you through:

1. **Scan the QR.** Opens an `otpauth://` URI in your terminal. Compatible
   with Google Authenticator, 1Password, Authy, Microsoft Authenticator,
   Yubico Authenticator, Aegis, and any RFC 6238–compliant app.
2. **Print + seal the 10 recovery codes.** Each code is a one-time
   `xxxx-xxxx` string. Treat them like the PHI master key escrow envelope:
   tamper-evident paper, fireproof safe.
3. **Push secrets to Cloudflare Pages.** The script invokes
   `wrangler pages secret put` for `ADMIN_TOTP_SECRET`,
   `ADMIN_TOTP_RECOVERY_HASHES`, and (if not already set)
   `ADMIN_MFA_COOKIE_KEY`.
4. **Cache locally.** The TOTP secret + recovery codes are saved to macOS
   Keychain (`mountzara-admin-totp-secret`, `mountzara-admin-totp-recovery`)
   so you can re-enroll a replacement device without rotating the shared
   secret.

After step 4 you can sign out of `/admin/`, sign back in, and watch the
MFA prompt appear after the Basic Auth dialog dismisses.

## Recovery scenarios

### Lost / stolen authenticator app

1. Sign in normally — when the MFA prompt appears, use one of the 10
   recovery codes from the sealed envelope. Codes are case-insensitive.
2. Each recovery code works **once**. The system logs
   `admin_mfa_recovery_used` to `audit_log` with a prefix of the hash so
   you can track which envelope code was consumed.
3. Re-run `./scripts/admin_totp_enroll.sh` to rotate the secret + issue
   fresh recovery codes. The previous codes are invalidated when the new
   `ADMIN_TOTP_RECOVERY_HASHES` overwrites the old set.

### All 10 recovery codes consumed

Re-run the enroll script before all codes are used. The script rotates
the TOTP secret (which also forces re-enrollment in the authenticator app)
and pushes a fresh set of 10 recovery codes.

### Suspected compromise

If you suspect the TOTP secret or recovery codes leaked (envelope tampered
with, screenshot of the QR captured, etc.):

1. Re-run `./scripts/admin_totp_enroll.sh` immediately — the rotation is
   the same procedure as a normal re-enrollment.
2. Also rotate `ADMIN_MFA_COOKIE_KEY` if you suspect the leak might
   include an active session cookie:
   ```
   openssl rand -hex 32 | \
     npx wrangler pages secret put ADMIN_MFA_COOKIE_KEY \
       --project-name=mountzara
   ```
   All existing MFA sessions are immediately invalidated; you'll be
   prompted for a fresh TOTP code on the next request.
3. Audit `audit_log` for any `admin_mfa_success` rows that don't match
   your activity windows.

### Operator incapacitation

The operator's attorney has the sealed PHI master key envelope (per
`docs/PHI_MASTER_KEY_ROTATION.md`). They should also hold a sealed copy of
the 10 admin recovery codes, allowing the named clinical successor to
sign in to `/admin/` once and immediately rotate to their own TOTP
enrollment. Update your written escrow instructions if you haven't yet.

## Disabling

```
npx wrangler pages secret delete ADMIN_TOTP_SECRET --project-name=mountzara
```

The middleware silently skips the MFA check the next time
`ADMIN_TOTP_SECRET` is absent. Existing sessions are unaffected; future
admin logins use Basic Auth only.

## Audit trail

Three events go to `audit_log` (via the existing `audit()` helper):

- `admin_mfa_success` — code verified, cookie issued. No PHI in the event.
- `admin_mfa_failure` — code rejected. No PHI in the event.
- `admin_mfa_recovery_used` — recovery code consumed. Carries the first 12
  hex chars of the SHA-256 hash so you can correlate to the envelope ledger.

Review on `/admin/analytics` or via `wrangler d1 execute mountzara-clinical
--remote --command "SELECT * FROM audit_log WHERE action LIKE 'admin_mfa_%' ORDER BY created_at DESC LIMIT 50"`.
