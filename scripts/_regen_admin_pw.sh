#!/bin/bash
# Clean regen of admin password + hash, local Python self-test before upload.
set -euo pipefail
export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin
cd /Users/beans/Developer/MountZara/MIGS

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
    CLOUDFLARE_API_TOKEN=$(pbpaste)
    export CLOUDFLARE_API_TOKEN
fi

# 1. Generate password + hash, run Python self-verify
python3 - > /tmp/_admin_regen.json <<'PYEOF'
import os, hashlib, base64, secrets, json
pw = secrets.token_urlsafe(24)
salt = os.urandom(16)
iters = 100000
h = hashlib.pbkdf2_hmac('sha256', pw.encode(), salt, iters, dklen=32)
hash_line = "pbkdf2$" + str(iters) + "$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(h).decode()

# Self-verify
parts = hash_line.split("$")
recompute = hashlib.pbkdf2_hmac('sha256', pw.encode(),
                                base64.b64decode(parts[2]), int(parts[1]), dklen=32)
ok = (recompute == base64.b64decode(parts[3]))

print(json.dumps({"password": pw, "hash_line": hash_line, "selfcheck": ok}))
PYEOF

PWD_VAL=$(python3 -c 'import json,sys; d=json.load(open("/tmp/_admin_regen.json")); print(d["password"])')
HASH_LINE=$(python3 -c 'import json; d=json.load(open("/tmp/_admin_regen.json")); print(d["hash_line"])')
OK=$(python3 -c 'import json; d=json.load(open("/tmp/_admin_regen.json")); print(d["selfcheck"])')

echo "==> Python self-verify: $OK"
echo "==> password length: ${#PWD_VAL}"
echo "==> hash format: $(echo "$HASH_LINE" | cut -d'$' -f1-2)..."

if [ "$OK" != "True" ]; then
    echo "ABORT: Python self-verify failed"; exit 1
fi

# 2. Set the secrets
echo "==> setting ADMIN_USER + ADMIN_PASS_HASH"
echo "chris.mabini@gmail.com" | npx wrangler pages secret put ADMIN_USER --project-name=mountzara 2>&1 | tail -2
echo "$HASH_LINE"            | npx wrangler pages secret put ADMIN_PASS_HASH --project-name=mountzara 2>&1 | tail -2

# 3. Save password to disk for later (chmod 600) and to clipboard
echo -n "$PWD_VAL" > /tmp/_admin_pw
chmod 600 /tmp/_admin_pw
echo -n "$PWD_VAL" | pbcopy
echo "==> password saved to /tmp/_admin_pw (chmod 600) and clipboard"
echo "==> clipboard length: $(pbpaste | wc -c | tr -d ' ')"

# Cleanup the regen artifact
shred -u /tmp/_admin_regen.json 2>/dev/null || rm /tmp/_admin_regen.json
echo "==> done"
