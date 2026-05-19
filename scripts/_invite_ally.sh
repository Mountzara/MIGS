#!/usr/bin/env bash
# =====================================================================
# scripts/_invite_ally.sh — issue Ally O'Flinn's preview invitation
# =====================================================================
# One-shot operator script. Hits POST /api/v1/admin/preview-invite via
# admin Basic Auth (admin password read from macOS Keychain entry
# "mountzara-admin-password" per §10.3), captures the returned grant_url,
# pretty-prints it for the operator to copy into an email to Ally, and
# echoes the live admin debug-sessions URL so the operator can watch
# Ally's flow in real time.
#
# Usage:
#   bash scripts/_invite_ally.sh
#       — uses defaults: aeoflinn@gmail.com, label=ally, ttl=14d, cookie=90d
#
#   EMAIL=other@example.com LABEL=other FULL_NAME="Some Body" bash scripts/_invite_ally.sh
#       — override per-invocation
#
# Prereqs (one-time, manual):
#   1. PREVIEW_INVITE_KEY Pages secret set (≥32 chars random):
#         openssl rand -base64 48 | tr -d '=+/'  | head -c 48
#         wrangler pages secret put PREVIEW_INVITE_KEY --project-name=mountzara
#   2. IP_HASH_SALT Pages secret set (any random string):
#         openssl rand -base64 32
#         wrangler pages secret put IP_HASH_SALT --project-name=mountzara
#   3. Schema migration 0013 applied to the remote D1:
#         wrangler d1 execute mountzara-clinical --remote --file=schema/0013_phase_qa_session_trace.sql
#   4. Code deployed via scripts/deploy-prod.sh (per §9.8.2 merge-first).
# =====================================================================

set -e

EMAIL="${EMAIL:-aeoflinn@gmail.com}"
LABEL="${LABEL:-ally}"
FULL_NAME="${FULL_NAME:-Ally OFlinn}"
TTL_DAYS="${TTL_DAYS:-14}"
COOKIE_DAYS="${COOKIE_DAYS:-90}"
NOTES="${NOTES:-First external test member — full new-member flow walkthrough (signup → intake → scheduling → portal modules) with session_trace pairing per §4.4.}"
BASE_URL="${BASE_URL:-https://mountzara.com}"

# Per CLAUDE.md §10.3 (and scripts/_reset_admin_password_node.sh line 61):
# the ADMIN_USER Pages secret is set to chris.mabini@gmail.com, NOT "admin".
# Hardcoded so no future session re-hits the username-mismatch failure mode.
ADMIN_USER="${ADMIN_USER:-chris.mabini@gmail.com}"

# Resolve admin password with a deterministic fallback chain so the
# "Keychain empty" / "Keychain stale" failure mode can never re-trigger
# the "ask the user for the password" loop the user has explicitly
# flagged as a recurring waste of time:
#   1. macOS Keychain entry 'mountzara-admin-password'
#   2. pbpaste (clipboard — per §9.8.1 ritual for ad-hoc paste)
#   3. ADMIN_PASS env var (CI / explicit override)
# After resolving via 2 or 3, we self-heal Keychain so the next call hits
# the fast path.
ADMIN_PASS="$(security find-generic-password -s mountzara-admin-password -w 2>/dev/null || true)"
ADMIN_PASS_SOURCE="keychain"

if [ -z "$ADMIN_PASS" ]; then
    ADMIN_PASS="$(pbpaste 2>/dev/null || true)"
    ADMIN_PASS_SOURCE="pbpaste"
fi
if [ -z "$ADMIN_PASS" ] && [ -n "${ADMIN_PASS_ENV:-}" ]; then
    ADMIN_PASS="$ADMIN_PASS_ENV"
    ADMIN_PASS_SOURCE="env"
fi
if [ -z "$ADMIN_PASS" ]; then
    echo "ERROR: could not resolve admin password from Keychain, clipboard, or env." >&2
    echo "  Either copy the password to the clipboard and re-run, or:" >&2
    echo "    security add-generic-password -s mountzara-admin-password -a '$ADMIN_USER' -w 'YOUR_PW' -U" >&2
    exit 1
fi

# Quick pre-flight: verify the resolved password actually works against
# the production admin endpoint. If it doesn't, fail loudly with the
# specific diagnostic the user needs, not a 401 from the invite endpoint.
echo "  pre-flight: checking admin auth (source=$ADMIN_PASS_SOURCE, user=$ADMIN_USER)..."
HTTP=$(curl -sS -o /dev/null -u "$ADMIN_USER:$ADMIN_PASS" -w '%{http_code}' \
    "$BASE_URL/api/posts/_admin?kind=blog")
if [ "$HTTP" != "200" ]; then
    echo "ERROR: admin auth failed (HTTP $HTTP) against $BASE_URL/api/posts/_admin" >&2
    echo "  Username: $ADMIN_USER" >&2
    echo "  Password source: $ADMIN_PASS_SOURCE (length ${#ADMIN_PASS})" >&2
    echo "  Likely cause: ADMIN_PASS_HASH on Cloudflare Pages was rotated and neither" >&2
    echo "  Keychain nor clipboard has the current password." >&2
    echo "  Run: bash scripts/_reset_admin_password_node.sh   (mints fresh + syncs all 3 places)" >&2
    exit 2
fi
echo "  ✓ admin auth OK"

# Self-heal: if we got the password from pbpaste or env (not Keychain),
# write it into Keychain now so the next session hits the fast path.
if [ "$ADMIN_PASS_SOURCE" != "keychain" ]; then
    security add-generic-password -s mountzara-admin-password \
        -a "$ADMIN_USER" -w "$ADMIN_PASS" \
        -j "MountZara admin password (auto-cached from $ADMIN_PASS_SOURCE)" -U 2>/dev/null || true
    echo "  ✓ self-healed: cached password into Keychain for future sessions"
fi

echo "==============================================================="
echo "  Mount Zara — Preview Invitation"
echo "==============================================================="
echo "  Recipient label : $LABEL"
echo "  Full name       : $FULL_NAME"
echo "  Email           : ${EMAIL:0:4}***   (full email in response)"
echo "  Grant TTL       : ${TTL_DAYS}d"
echo "  Cookie TTL      : ${COOKIE_DAYS}d"
echo "  Base URL        : $BASE_URL"
echo "==============================================================="
echo ""

JSON=$(cat <<JSON_EOF
{
  "email":      "$EMAIL",
  "label":      "$LABEL",
  "full_name":  "$FULL_NAME",
  "ttl_days":   $TTL_DAYS,
  "cookie_days": $COOKIE_DAYS,
  "notes":      $(printf '%s' "$NOTES" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')
}
JSON_EOF
)

echo "POST $BASE_URL/api/v1/admin/preview-invite"
echo ""

RESPONSE=$(curl -sS -u "$ADMIN_USER:$ADMIN_PASS" \
    -H "content-type: application/json" \
    -X POST "$BASE_URL/api/v1/admin/preview-invite" \
    -d "$JSON")

if echo "$RESPONSE" | python3 -c 'import json,sys;json.loads(sys.stdin.read())' >/dev/null 2>&1; then
    echo "$RESPONSE" | python3 -m json.tool
else
    echo "ERROR: response was not valid JSON" >&2
    echo "$RESPONSE" >&2
    exit 1
fi

# Extract grant_url for a friendly summary at the bottom.
GRANT_URL=$(echo "$RESPONSE" | python3 -c 'import json,sys;d=json.loads(sys.stdin.read());print(d.get("grant_url",""))' 2>/dev/null || echo "")
EXPIRES_ISO=$(echo "$RESPONSE" | python3 -c 'import json,sys;d=json.loads(sys.stdin.read());print(d.get("expires_at_iso",""))' 2>/dev/null || echo "")

if [ -n "$GRANT_URL" ]; then
    echo ""
    echo "==============================================================="
    echo "  COPY THIS INVITATION INTO YOUR EMAIL TO $EMAIL"
    echo "==============================================================="
    echo ""
    echo "  Subject: Your Mount Zara member-portal preview"
    echo ""
    echo "  Hi $FULL_NAME,"
    echo ""
    echo "  Thanks for helping us test the Mount Zara member portal"
    echo "  before it goes live. Click the link below to start —"
    echo "  it'll walk you through signup, the intake form, scheduling,"
    echo "  and the rest of the portal, just like any future member."
    echo ""
    echo "  Your one-click invitation:"
    echo ""
    echo "    $GRANT_URL"
    echo ""
    echo "  This link is single-use and expires $EXPIRES_ISO."
    echo "  Open it on whichever device you'll be using going forward —"
    echo "  the access carries over via a secure cookie for 90 days."
    echo ""
    echo "  If anything looks off or you have feedback, reply to this"
    echo "  email or write info@mountzara.com directly. We're watching"
    echo "  the flow in real time on our side so issues get fixed fast."
    echo ""
    echo "  — Mount Zara"
    echo ""
    echo "==============================================================="
    echo ""
    echo "  WATCH ALLY'S FLOW IN REAL TIME:"
    echo "    Open: $BASE_URL/admin/debug/sessions/?label=$LABEL"
    echo "    Or live-tail:  cd $(pwd) && wrangler pages deployment tail --project-name=mountzara"
    echo ""
    echo "==============================================================="
fi
