#!/usr/bin/env bash
# github_device_flow_auth.sh — OAuth Device Flow for autonomous git push.
#
# Per task #46. Runs GitHub's OAuth 2.0 Device Authorization Grant
# (https://docs.github.com/en/apps/creating-github-apps/writing-code-for-a-github-app/building-a-cli-with-a-github-app#step-1-request-a-user-verification-code),
# caches the resulting access token in macOS Keychain, and configures git
# to use it for HTTPS push.
#
# Why device flow (not a PAT)?
#   - PATs are long-lived and survive operator-laptop compromise indefinitely.
#   - Device-flow tokens can be revoked at https://github.com/settings/applications
#     (per OAuth App) without affecting other tokens.
#   - The flow is interactive but ONLY once; subsequent pushes reuse the
#     cached token until you revoke it.
#
# Prerequisite: one-time GitHub OAuth App registration.
#   1. Visit https://github.com/organizations/Mountzara/settings/applications/new
#      (or https://github.com/settings/applications/new for personal apps).
#   2. Name: "Mount Zara — Autonomous Push" (or similar).
#   3. Homepage URL: https://mountzara.com
#   4. Callback URL: https://mountzara.com (unused for device flow — required field).
#   5. Enable: "Device Flow" checkbox (under the "General" tab after creation).
#   6. Generate / copy the Client ID. Store it via:
#        security add-generic-password \
#            -a mountzara-github-oauth-client-id \
#            -s mountzara-github-oauth-client-id \
#            -w "<the_client_id>"
#   7. (Optional, recommended) Restrict the app to only the Mountzara org and
#      give it `contents: write` access on the MIGS repo.

set -euo pipefail

# -------- preflight --------
CLIENT_ID=$(security find-generic-password -a "mountzara-github-oauth-client-id" -s "mountzara-github-oauth-client-id" -w 2>/dev/null || true)
if [ -z "$CLIENT_ID" ]; then
    cat <<EOF >&2
ERROR: GitHub OAuth Client ID not found in Keychain.

One-time setup:
  1. Create a GitHub OAuth App at https://github.com/settings/applications/new
     (or .../organizations/Mountzara/settings/applications/new for org-scoped).
     Enable the "Device Flow" checkbox.
  2. Copy the Client ID and run:

       security add-generic-password \\
         -a mountzara-github-oauth-client-id \\
         -s mountzara-github-oauth-client-id \\
         -w '<paste_client_id_here>'

  3. Re-run this script.
EOF
    exit 1
fi

REPO="${MZ_GH_REPO:-Mountzara/MIGS}"
SCOPE="${MZ_GH_SCOPE:-repo}"

echo "🔑 GitHub OAuth Device Flow — Mount Zara"
echo "   Client ID: ${CLIENT_ID:0:8}…"
echo "   Repo:      $REPO"
echo "   Scope:     $SCOPE"
echo ""

# -------- step 1: request device + user codes --------
DEVICE_RESP=$(curl -s -X POST "https://github.com/login/device/code" \
    -H "Accept: application/json" \
    -d "client_id=$CLIENT_ID&scope=$SCOPE")

DEVICE_CODE=$(printf '%s' "$DEVICE_RESP" | /usr/bin/python3 -c 'import json,sys;print(json.load(sys.stdin).get("device_code",""))')
USER_CODE=$(  printf '%s' "$DEVICE_RESP" | /usr/bin/python3 -c 'import json,sys;print(json.load(sys.stdin).get("user_code",""))')
VERIF_URI=$(  printf '%s' "$DEVICE_RESP" | /usr/bin/python3 -c 'import json,sys;print(json.load(sys.stdin).get("verification_uri",""))')
INTERVAL=$(   printf '%s' "$DEVICE_RESP" | /usr/bin/python3 -c 'import json,sys;print(json.load(sys.stdin).get("interval",5))')
EXPIRES_IN=$( printf '%s' "$DEVICE_RESP" | /usr/bin/python3 -c 'import json,sys;print(json.load(sys.stdin).get("expires_in",900))')

if [ -z "$DEVICE_CODE" ] || [ -z "$USER_CODE" ]; then
    echo "ERROR: GitHub did not return a device code. Raw response:"
    echo "$DEVICE_RESP" | /usr/bin/python3 -m json.tool 2>/dev/null || echo "$DEVICE_RESP"
    exit 1
fi

echo "============================================================"
echo "       1.  Visit:    $VERIF_URI"
echo "       2.  Enter:    $USER_CODE"
echo "============================================================"
echo ""
echo "Opening browser to $VERIF_URI ..."
open "$VERIF_URI"
echo ""
echo "Waiting for approval (this window expires in ${EXPIRES_IN}s)..."

# -------- step 2: poll for token --------
ACCESS_TOKEN=""
ELAPSED=0
while [ "$ELAPSED" -lt "$EXPIRES_IN" ]; do
    sleep "$INTERVAL"
    ELAPSED=$((ELAPSED + INTERVAL))
    POLL_RESP=$(curl -s -X POST "https://github.com/login/oauth/access_token" \
        -H "Accept: application/json" \
        -d "client_id=$CLIENT_ID&device_code=$DEVICE_CODE&grant_type=urn:ietf:params:oauth:grant-type:device_code")
    ERROR=$(printf '%s' "$POLL_RESP" | /usr/bin/python3 -c 'import json,sys;print(json.load(sys.stdin).get("error",""))')
    case "$ERROR" in
        "")
            ACCESS_TOKEN=$(printf '%s' "$POLL_RESP" | /usr/bin/python3 -c 'import json,sys;print(json.load(sys.stdin).get("access_token",""))')
            if [ -n "$ACCESS_TOKEN" ]; then
                break
            fi
            ;;
        "authorization_pending")
            printf '.'
            ;;
        "slow_down")
            INTERVAL=$((INTERVAL + 5))
            ;;
        "expired_token"|"access_denied"|"unsupported_grant_type"|"incorrect_client_credentials"|"incorrect_device_code"|"device_flow_disabled")
            echo ""
            echo "❌ Device flow failed: $ERROR"
            echo "   Raw response: $POLL_RESP"
            exit 1
            ;;
        *)
            echo ""
            echo "⚠️  Unknown poll response: $POLL_RESP"
            ;;
    esac
done

echo ""
if [ -z "$ACCESS_TOKEN" ]; then
    echo "❌ Token never arrived — device-code window expired."
    exit 1
fi

# -------- step 3: cache token + verify it works --------
echo "🔓 Access token received. Caching in Keychain..."
security delete-generic-password \
    -a "mountzara-github-oauth-token" \
    -s "mountzara-github-oauth-token" 2>/dev/null || true
security add-generic-password \
    -a "mountzara-github-oauth-token" \
    -s "mountzara-github-oauth-token" \
    -w "$ACCESS_TOKEN"

echo "   Verifying token against GitHub API..."
WHO=$(curl -s -H "Authorization: token $ACCESS_TOKEN" https://api.github.com/user | \
    /usr/bin/python3 -c 'import json,sys;d=json.load(sys.stdin);print(d.get("login","?"))')
echo "   ✓ Authenticated as: $WHO"

# -------- step 4: configure git remote for HTTPS push using the token --------
echo ""
echo "🔧 Configuring git remote..."
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Use the macOS Keychain credential helper so future git push commands
# pull the token from Keychain automatically (no token-in-URL).
git config --global credential.helper "osxkeychain"

# Stash the OAuth token under the github.com domain in a form
# osxkeychain recognizes.
printf 'protocol=https\nhost=github.com\nusername=%s\npassword=%s\n\n' \
    "$WHO" "$ACCESS_TOKEN" | \
    git credential-osxkeychain store

# Make sure the remote is HTTPS (device-flow tokens don't work for git+ssh).
git remote set-url origin "https://github.com/${REPO}.git" 2>/dev/null || true

echo "   ✓ git remote: $(git remote get-url origin)"
echo "   ✓ Credential helper: osxkeychain"

echo ""
echo "✅ Done. Future \`git push\` commands from this repo use the cached OAuth token."
echo ""
echo "To revoke this token:"
echo "  - Web:  https://github.com/settings/applications  (revoke the app's access)"
echo "  - CLI:  security delete-generic-password \\"
echo "            -a mountzara-github-oauth-token -s mountzara-github-oauth-token"
echo "          + git credential-osxkeychain erase <<< 'protocol=https\\nhost=github.com\\n\\n'"
