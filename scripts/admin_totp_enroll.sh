#!/usr/bin/env bash
# admin_totp_enroll.sh — provision TOTP MFA for the admin account.
#
# Generates a fresh 20-byte base32 secret, prints a QR code that the
# operator scans with Google Authenticator / 1Password / Authy, generates
# 10 one-time recovery codes, and pushes the resulting secrets to the
# Cloudflare Pages project. After this script runs, every /admin/* request
# requires a TOTP code before it serves the dashboard.
#
# Re-running rotates the TOTP secret (and invalidates all prior recovery
# codes). To DISABLE MFA entirely:
#   npx wrangler pages secret delete ADMIN_TOTP_SECRET --project-name=mountzara

set -euo pipefail

PROJECT="${CF_PAGES_PROJECT:-mountzara}"
ISSUER="${MOUNTZARA_TOTP_ISSUER:-Mount Zara Admin}"
ACCOUNT="${MOUNTZARA_TOTP_ACCOUNT:-admin@mountzara.com}"

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] && [ -f "$HOME/.config/mountzara/cf-creds.env" ]; then
    # shellcheck disable=SC1091
    source "$HOME/.config/mountzara/cf-creds.env"
fi
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] || [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
    echo "ERROR: CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID must be set." >&2
    exit 1
fi

# 1. Generate a 20-byte secret, encode base32 (Google Authenticator format).
SECRET=$(/usr/bin/python3 - <<'PY'
import base64, secrets
print(base64.b32encode(secrets.token_bytes(20)).decode().rstrip("="))
PY
)

# 2. Build the otpauth:// URI that the QR code encodes.
URI="otpauth://totp/$(printf '%s' "$ISSUER" | /usr/bin/python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.stdin.read().strip()),end="")'):$(printf '%s' "$ACCOUNT" | /usr/bin/python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.stdin.read().strip()),end="")')?secret=$SECRET&issuer=$(printf '%s' "$ISSUER" | /usr/bin/python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.stdin.read().strip()),end="")')&algorithm=SHA1&digits=6&period=30"

# 3. Generate 10 recovery codes (xxxx-xxxx, lowercase alnum) + their SHA-256 hashes.
RECOVERY_CODES=()
RECOVERY_HASHES=()
for _ in $(seq 1 10); do
    code=$(/usr/bin/python3 -c 'import secrets,string;a=string.ascii_lowercase+string.digits;print("-".join("".join(secrets.choice(a) for _ in range(4)) for _ in range(2)))')
    sha=$(printf '%s' "$code" | shasum -a 256 | cut -d' ' -f1)
    RECOVERY_CODES+=("$code")
    RECOVERY_HASHES+=("$sha")
done

echo ""
echo "============================================================"
echo "       ADMIN TOTP MFA ENROLLMENT — Mount Zara"
echo "============================================================"
echo ""
echo "Step 1 of 3 — scan this QR with your authenticator app:"
echo ""
if command -v qrencode >/dev/null 2>&1; then
    printf '%s' "$URI" | qrencode -t ANSIUTF8
else
    echo "   (qrencode not installed — use a free online QR encoder, or"
    echo "    type the secret into the app manually.)"
fi
echo ""
echo "If your app prompts for them manually, the parameters are:"
echo ""
echo "   Account:    $ACCOUNT"
echo "   Issuer:     $ISSUER"
echo "   Secret:     $SECRET"
echo "   Type:       Time-based (TOTP), 6 digits, 30 s, SHA-1"
echo ""
read -p "Scanned / entered? Press ENTER to continue: " _

echo ""
echo "Step 2 of 3 — recovery codes."
echo ""
echo "Write these down and seal in a tamper-evident envelope. Each code"
echo "works exactly ONCE if you lose access to your authenticator app."
echo "After all 10 are consumed, re-run this script to provision fresh ones."
echo ""
for c in "${RECOVERY_CODES[@]}"; do
    echo "   $c"
done
echo ""
read -p "Type ESCROWED to confirm the recovery codes are safely backed up: " CONFIRM
if [ "$CONFIRM" != "ESCROWED" ]; then
    echo "Aborted. No secrets were stored on Cloudflare yet — rerun when ready."
    exit 1
fi

# 4. Push secrets to Cloudflare Pages.
echo ""
echo "Step 3 of 3 — pushing secrets to Cloudflare Pages '$PROJECT'..."

# ADMIN_TOTP_SECRET — the shared secret the Worker uses to verify codes.
echo "$SECRET" | npx --yes wrangler@latest pages secret put ADMIN_TOTP_SECRET --project-name="$PROJECT"

# ADMIN_TOTP_RECOVERY_HASHES — newline-separated SHA-256 hashes of recovery codes.
HASHES_STR=$(printf "%s\n" "${RECOVERY_HASHES[@]}")
printf '%s' "$HASHES_STR" | npx --yes wrangler@latest pages secret put ADMIN_TOTP_RECOVERY_HASHES --project-name="$PROJECT"

# ADMIN_MFA_COOKIE_KEY — random 32-byte secret HMAC-signs the mz_admin_mfa cookie.
EXISTING_COOKIE_KEY=$(npx --yes wrangler@latest pages secret list --project-name="$PROJECT" 2>/dev/null | grep -c ADMIN_MFA_COOKIE_KEY || echo 0)
if [ "$EXISTING_COOKIE_KEY" -eq 0 ]; then
    COOKIE_KEY=$(openssl rand -hex 32)
    echo "$COOKIE_KEY" | npx --yes wrangler@latest pages secret put ADMIN_MFA_COOKIE_KEY --project-name="$PROJECT"
    echo "   ✓ Generated and stored fresh ADMIN_MFA_COOKIE_KEY."
else
    echo "   ✓ ADMIN_MFA_COOKIE_KEY already present — keeping existing value (cookie sessions stay valid)."
fi

# Cache the secret + recovery codes locally in Keychain for next-time reference.
security delete-generic-password -a "mountzara-admin-totp-secret" -s "mountzara-admin-totp-secret" 2>/dev/null || true
security add-generic-password -a "mountzara-admin-totp-secret" -s "mountzara-admin-totp-secret" -w "$SECRET"
security delete-generic-password -a "mountzara-admin-totp-recovery" -s "mountzara-admin-totp-recovery" 2>/dev/null || true
security add-generic-password -a "mountzara-admin-totp-recovery" -s "mountzara-admin-totp-recovery" -w "$(printf '%s\n' "${RECOVERY_CODES[@]}")"

echo ""
echo "✅ Admin MFA enrolled."
echo ""
echo "Next time you open https://mountzara.com/admin/, the browser will"
echo "still prompt for username + password, then a Mount Zara-themed"
echo "MFA page will appear asking for your 6-digit authenticator code."
echo "After successful verification, an 8-hour signed cookie keeps you"
echo "logged in for that session."
echo ""
echo "If your authenticator is lost, paste a recovery code (xxxx-xxxx)"
echo "into the same MFA prompt — it works once."
echo ""
echo "To rotate: rerun this script. To disable:"
echo "    npx wrangler pages secret delete ADMIN_TOTP_SECRET --project-name=$PROJECT"
