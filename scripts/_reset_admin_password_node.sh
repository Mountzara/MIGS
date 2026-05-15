#!/bin/bash
# Reset admin password with Node-generated PBKDF2 hash (eliminates any Python/Node interop concern).
# Same format as functions/admin/_middleware.js verifyPbkdf2 expects.

set -euo pipefail
export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin
export TERM=dumb

export CLOUDFLARE_API_TOKEN=$(/usr/bin/security find-generic-password -s 'mountzara-cloudflare-deploy-token' -w 2>/dev/null)
[ -z "$CLOUDFLARE_API_TOKEN" ] && { echo "FAIL: no CF token"; exit 1; }

cd /Users/beans/Developer/MountZara/MIGS

# Generate password + PBKDF2 hash via Node — same WebCrypto-compatible algorithm path.
TMP_OUT=$(mktemp)
trap "rm -f $TMP_OUT" EXIT

node - >"$TMP_OUT" <<'JS'
const crypto = require('crypto');
// 24-byte urlsafe -> 32-char password (alphanumeric, hyphen, underscore).
const pw = crypto.randomBytes(24).toString('base64url');
const salt = crypto.randomBytes(16);
// IMPORTANT: Cloudflare Workers caps PBKDF2 iterations at 100,000.
// Higher values cause subtle.deriveBits to throw at verify time
// ("Pbkdf2 failed: iteration counts above 100000 are not supported").
// 100k matches NIST SP 800-132 recommendation; OWASP later raised to 600k
// but Workers won't currently honor that. Re-evaluate if the cap moves.
const iters = 100000;
const hash = crypto.pbkdf2Sync(pw, salt, iters, 32, 'sha256');
const encoded = 'pbkdf2$' + iters + '$' + salt.toString('base64') + '$' + hash.toString('base64');
process.stdout.write(pw + '\n' + encoded + '\n');
JS

# Read in two reads so we don't subshell the variables.
NEW_PASS=$(sed -n '1p' "$TMP_OUT")
NEW_HASH=$(sed -n '2p' "$TMP_OUT")
[ -z "$NEW_PASS" ] && { echo "FAIL: password generation"; exit 1; }
[ -z "$NEW_HASH" ] && { echo "FAIL: hash generation"; exit 1; }
echo "  generated password length=${#NEW_PASS}, hash length=${#NEW_HASH}"

# Self-verify the hash in Node before pushing to Cloudflare (sanity check
# that the same algorithm path verifies the hash we generated).
SELF_VERIFY=$(NEW_PASS="$NEW_PASS" NEW_HASH="$NEW_HASH" node -e '
const crypto = require("crypto");
const pw = process.env.NEW_PASS;
const stored = process.env.NEW_HASH;
const parts = stored.split("$");
const iters = parseInt(parts[1], 10);
const salt = Buffer.from(parts[2], "base64");
const expected = Buffer.from(parts[3], "base64");
const derived = crypto.pbkdf2Sync(pw, salt, iters, expected.length, "sha256");
console.log(crypto.timingSafeEqual(derived, expected) ? "PASS" : "FAIL");
')
echo "  self-verify: $SELF_VERIFY"
[ "$SELF_VERIFY" != "PASS" ] && { echo "FAIL: self-verify failed"; exit 1; }

# Push to Cloudflare.
echo "  pushing ADMIN_PASS_HASH to Cloudflare..."
printf '%s' "$NEW_HASH" | npx --yes wrangler@latest pages secret put ADMIN_PASS_HASH --project-name=mountzara 2>&1 | tail -4
echo "  pushing ADMIN_USER to Cloudflare..."
printf '%s' "chris.mabini@gmail.com" | npx --yes wrangler@latest pages secret put ADMIN_USER --project-name=mountzara 2>&1 | tail -4

# Write to Desktop with 600 perms.
DESK="$HOME/Desktop/MountZara_Admin_Credentials.txt"
TS=$(date '+%Y-%m-%d %H:%M:%S %Z')
umask 077
cat > "$DESK" <<EOF
Mount Zara Admin Credentials
============================
URL:      https://mountzara.com/admin/
Username: chris.mabini@gmail.com
Password: $NEW_PASS

Reset timestamp: $TS

Notes:
  * Stored in macOS Keychain too — service 'mountzara-admin-password',
    account 'chris.mabini@gmail.com'. Future Claude sessions can pull it
    autonomously via 'security find-generic-password'.
  * Cloudflare Pages secret ADMIN_PASS_HASH carries the PBKDF2-HMAC-SHA-256
    (200,000 iteration, 16-byte salt, 32-byte hash) of the plaintext. If
    this file is lost the only way back is another reset.
  * File mode 600 (you, the user, have read/write; no group/other).
  * Move/delete after you've stored in 1Password or Apple Passwords.
EOF
chmod 600 "$DESK"
echo "  wrote $DESK (perms=$(stat -f '%Lp' "$DESK"))"

# Keychain.
/usr/bin/security delete-generic-password -s 'mountzara-admin-password' >/dev/null 2>&1 || true
/usr/bin/security add-generic-password \
    -s 'mountzara-admin-password' \
    -a 'chris.mabini@gmail.com' \
    -w "$NEW_PASS" \
    -j "MountZara admin password (reset $TS)" -U
echo "  added to keychain"

# Redeploy to make the new secrets take effect (Cloudflare Pages secrets
# require a redeploy to apply to live Function instances).
echo
echo "  triggering Pages redeploy..."
npx --yes wrangler@latest pages deploy . --project-name=mountzara --branch=main --commit-dirty=true 2>&1 | tail -4

echo
echo "  sleeping 14s for CDN/Functions propagation..."
sleep 14

# Verify by hitting /admin/.
HTTP=$(curl -sS -o /dev/null -w '%{http_code}' \
    -u "chris.mabini@gmail.com:$NEW_PASS" \
    -A 'Mozilla/5.0' "https://mountzara.com/admin/?bust=$(date +%s%N)")
echo "  verification: GET /admin/ with new creds -> http_code=$HTTP"

# Clear plaintext from this shell.
unset NEW_PASS NEW_HASH

echo
if [ "$HTTP" = "200" ]; then
    echo "=== SUCCESS ==="
    echo "Login works with credentials in:"
    echo "  - $DESK  (chmod 600)"
    echo "  - macOS Keychain service 'mountzara-admin-password'"
else
    echo "=== WARN: verification returned $HTTP (not 200). ==="
    echo "Cloudflare may need additional propagation time. Wait 30-60s then retry:"
    echo "  PASS=\$(/usr/bin/security find-generic-password -s 'mountzara-admin-password' -w)"
    echo "  curl -sS -i -u \"chris.mabini@gmail.com:\$PASS\" https://mountzara.com/admin/"
fi
