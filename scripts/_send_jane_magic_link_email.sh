#!/usr/bin/env bash
# Issue a magic-link login token for Jane Doe (chris.mabini@gmail.com) and
# email the redeem URL via Apple Mail. Phase-2 transactional email isn't wired
# yet, so this is the operator-side workaround: admin pulls the dev-return URL
# from the API and forwards it as a real email so the user can click from
# either their Mac or iPhone Mail inbox.

set -euo pipefail

ADMIN_PASS=$(security find-generic-password -s mountzara-admin-password -w)
ADMIN_USER=$(grep -E '^Username:' ~/Desktop/MountZara_Admin_Credentials.txt | sed 's/^Username: *//')
[ -z "$ADMIN_USER" ] && ADMIN_USER="chris.mabini@gmail.com"
EMAIL="chris.mabini@gmail.com"

echo "Issuing magic link for $EMAIL  (admin user: $ADMIN_USER) ..."
RESP=$(curl -sS -X POST "https://mountzara.com/api/v1/auth/magic-link/issue" \
    -u "${ADMIN_USER}:${ADMIN_PASS}" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${EMAIL}\"}")

echo "API response: $RESP"

# Extract _dev_url from the JSON response. Use Python for robust JSON parsing.
URL=$(printf '%s' "$RESP" | /usr/bin/python3 -c 'import json,sys;d=json.load(sys.stdin);print(d.get("_dev_url",""))')

if [ -z "$URL" ]; then
    echo ""
    echo "ERROR: API did not return a _dev_url. Either MAGIC_LINK_DEV_RETURN is not set"
    echo "as a Pages secret, or admin Basic Auth was rejected, or the email is not"
    echo "registered as an active patient. Raw response above."
    exit 1
fi

EXPIRES=$(printf '%s' "$RESP" | /usr/bin/python3 -c 'import json,sys;d=json.load(sys.stdin);print(d.get("_dev_expires_at",""))')

echo "Got redeem URL. Sending via Apple Mail to $EMAIL ..."

# Compose and send via Apple Mail (uses the user's default Mail account).
/usr/bin/osascript <<EOF
tell application "Mail"
    set newMessage to make new outgoing message with properties {subject:"Mount Zara member portal — sign-in link", content:"Hi Chris,

Here's your one-time sign-in link for the Mount Zara member portal (Jane Doe test account):

${URL}

This link expires at ${EXPIRES}.

You'll still see the admin Basic Auth prompt the first time you hit the portal in a browser session — username mountzara, password from the Keychain entry mountzara-admin-password. After that prompt the magic link signs you straight in as Jane.

— Mount Zara member portal", visible:false}
    tell newMessage
        make new to recipient at end of to recipients with properties {address:"${EMAIL}"}
        send
    end tell
end tell
EOF

echo "Done. Email queued/sent to $EMAIL."
echo "Redeem URL (also printed here in case you want to copy/paste):"
echo "  $URL"
echo "Expires: $EXPIRES"
