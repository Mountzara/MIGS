#!/bin/bash
# One-shot: generate admin password + PBKDF2 hash, set Cloudflare Pages secrets,
# toggle Cloudflare zone security settings, write password to clipboard.

set -euo pipefail
export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
    CLOUDFLARE_API_TOKEN=$(pbpaste)
    export CLOUDFLARE_API_TOKEN
fi

REPO=/Users/beans/Developer/MountZara/MIGS
cd "$REPO"

# 1. Generate random password (24-char url-safe).
PWD_VAL=$(python3 -c 'import secrets; print(secrets.token_urlsafe(24))')

# 2. PBKDF2-SHA-256, 16-byte salt, 200_000 iterations, 32-byte hash.
HASH_LINE=$(python3 - "$PWD_VAL" <<'PYEOF'
import os, hashlib, base64, sys
pw = sys.argv[1].encode()
salt = os.urandom(16)
iters = 100000
h = hashlib.pbkdf2_hmac('sha256', pw, salt, iters, dklen=32)
print(f"pbkdf2${iters}${base64.b64encode(salt).decode()}${base64.b64encode(h).decode()}")
PYEOF
)

echo "==> setting Cloudflare Pages secrets"
echo "chris.mabini@gmail.com" | npx wrangler pages secret put ADMIN_USER --project-name=mountzara 2>&1 | tail -3
echo "$HASH_LINE"            | npx wrangler pages secret put ADMIN_PASS_HASH --project-name=mountzara 2>&1 | tail -3

echo "==> writing PLAINTEXT password to clipboard (paste into 1Password / your manager NOW)"
printf '%s' "$PWD_VAL" | pbcopy
CLIP_LEN=$(pbpaste | wc -c | tr -d ' ')
echo "clipboard length: $CLIP_LEN bytes"

echo "==> looking up zone id for mountzara.com"
ZONE_ID=$(curl -sS 'https://api.cloudflare.com/client/v4/zones?name=mountzara.com' \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("result",[{}])[0].get("id",""))')
if [ -z "$ZONE_ID" ]; then
    echo "WARNING: could not resolve zone id; skipping zone-level toggles"
    exit 0
fi
echo "zone=$ZONE_ID"

zone_setting() {
    local name="$1" value="$2"
    local resp
    resp=$(curl -sS -X PATCH "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/settings/$name" \
        -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
        -H 'Content-Type: application/json' \
        -d "{\"value\":\"$value\"}")
    python3 - "$name" <<PYEOF
import json, sys
name = sys.argv[1]
try:
    d = json.loads('''$resp''')
except Exception as e:
    print(f"  {name}: parse-error ({e})"); raise SystemExit(0)
if d.get("success"):
    print(f"  {name}: ok -> {d.get('result',{}).get('value','?')}")
else:
    msgs = [e.get("message","") for e in (d.get("errors") or [])]
    print(f"  {name}: FAILED ({'; '.join(msgs) or 'unknown'})")
PYEOF
}

echo "==> toggling zone settings (free-tier protections)"
zone_setting bot_fight_mode on
zone_setting email_obfuscation on
zone_setting browser_check on
zone_setting hotlink_protection on
zone_setting security_level high
zone_setting always_use_https on
zone_setting min_tls_version "1.2"

echo "==> done"
