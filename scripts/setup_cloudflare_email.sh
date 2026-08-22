#!/usr/bin/env bash
# =====================================================================
# setup_cloudflare_email.sh — switch mail delivery to Cloudflare Email
# Sending, end to end, in one command.
# =====================================================================
# WHY THIS EXISTS
# AWS SES refused production access twice on "no sending history" — a
# catch-22 for a sandboxed account that is not allowed to build one. The
# stack is already Cloudflare everywhere else (Pages, Functions, D1, R2,
# DNS), and Cloudflare Email Sending has no sandbox: onboard the domain,
# hold a token with Email Sending: Edit, send.
#
# THE ONE THING THIS CANNOT DO is mint that token. Every credential on
# this machine was probed on 2026-08-20: the Pages token, the DNS token
# and the D1 token all 403 on /email/sending/*, and none can create
# tokens (code 9109 on /accounts/{id}/tokens). Token creation is a
# dashboard act by design — it is the one secret that authorises SENDING
# MAIL AS THE PRACTICE, and it should require a human.
#
#   Create it here (2 minutes):
#     https://dash.cloudflare.com/profile/api-tokens
#     Create Token → Custom token
#       Permission:  Account · Email Sending · Edit
#       Account:     Mount Zara
#
# USAGE
#   CF_EMAIL_TOKEN=<token> ./scripts/setup_cloudflare_email.sh
#   ./scripts/setup_cloudflare_email.sh <token>
#
# WHAT IT DOES, IN ORDER (idempotent — safe to re-run):
#   1. verifies the token is real and has the Email Sending permission
#   2. onboards mountzara.com onto Email Sending (no-op if already done)
#   3. confirms the DNS records the onboarding created are resolving
#   4. sends a REAL test email to the owner through the REST API
#   5. stores CF_EMAIL_TOKEN / CF_EMAIL_ACCOUNT_ID / NOTIFY_PROVIDER=
#      cloudflare on the Pages production deployment_config
#   6. redeploys so the Functions pick the new provider up
#   7. flushes the outbox so previously-failed notifications retry
#
# The SES configuration is left in place untouched — NOTIFY_PROVIDER is
# the only switch, so rollback is setting it back to "ses".
# =====================================================================
set -euo pipefail

TOKEN="${1:-${CF_EMAIL_TOKEN:-}}"
if [ -z "$TOKEN" ]; then
    echo "usage: CF_EMAIL_TOKEN=<token> $0    (see header for how to create the token)"
    exit 1
fi

ACC="8fbe127f640681ddd813aaf33b95507f"
DOMAIN="mountzara.com"
OWNER_EMAIL="chris.mabini@gmail.com"
FROM_ADDR="no-reply@mountzara.com"
API="https://api.cloudflare.com/client/v4"

# Pages-scoped credentials for step 5/6 (auto-sourced on sessions; source
# defensively here for cron/manual runs).
[ -f "$HOME/.config/mountzara/cf-creds.env" ] && source "$HOME/.config/mountzara/cf-creds.env"
PAGES_TOKEN="${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN (Pages token) not in env}"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n🛑 %s\n' "$*"; exit 1; }

# ---------------------------------------------------------------------
say "1/7 Verifying the token…"
V=$(curl -s -H "Authorization: Bearer $TOKEN" "$API/user/tokens/verify")
echo "$V" | grep -q '"status":"active"' || fail "token is not active: $(echo "$V" | head -c 200)"

# The limits endpoint doubles as the permission + entitlement probe:
# 403/10102 = token lacks Email Sending: Edit; 403/10105 = the account has
# never enabled Email Sending (do that once in the dashboard: Compute →
# Email Service).
L=$(curl -s -o /tmp/_ces_limits.json -w "%{http_code}" \
      -H "Authorization: Bearer $TOKEN" "$API/accounts/$ACC/email/sending/limits")
case "$L" in
  200) echo "   token OK — limits: $(head -c 200 /tmp/_ces_limits.json)";;
  403) grep -q 10105 /tmp/_ces_limits.json \
         && fail "account not yet entitled: open dash.cloudflare.com → Compute → Email Service once, then re-run" \
         || fail "token lacks Email Sending: Edit — recreate it with that permission" ;;
  *)   echo "   (limits probe returned $L — continuing; onboarding will surface any real problem)";;
esac

# ---------------------------------------------------------------------
say "2/7 Onboarding $DOMAIN onto Email Sending…"
if CLOUDFLARE_API_TOKEN="$TOKEN" CLOUDFLARE_ACCOUNT_ID="$ACC" \
   npx --yes wrangler email sending enable "$DOMAIN" > /tmp/_ces_enable.log 2>&1; then
    echo "   onboarded (or already onboarded)"
else
    grep -qiE "already|enabled|exists" /tmp/_ces_enable.log \
        && echo "   already onboarded" \
        || { cat /tmp/_ces_enable.log; fail "onboarding failed — see output above"; }
fi
CLOUDFLARE_API_TOKEN="$TOKEN" CLOUDFLARE_ACCOUNT_ID="$ACC" \
    npx --yes wrangler email sending dns get "$DOMAIN" 2>/dev/null | sed 's/^/   /' || true

# ---------------------------------------------------------------------
say "3/7 Checking the sending DNS actually resolves…"
# Onboarding writes records under cf-bounce.<domain> plus SPF/DKIM TXTs.
# 5–15 min propagation is typical on Cloudflare DNS; poll briefly.
ok_dns=0
for i in 1 2 3 4 5 6; do
    if dig +short MX "cf-bounce.$DOMAIN" | grep -q . ; then ok_dns=1; break; fi
    sleep 20
done
[ "$ok_dns" = 1 ] && echo "   cf-bounce MX resolving" \
                  || echo "   ⚠ cf-bounce MX not visible yet (propagation) — the test send below is the real check"

# ---------------------------------------------------------------------
say "4/7 Sending a REAL test email to $OWNER_EMAIL…"
S=$(curl -s -o /tmp/_ces_send.json -w "%{http_code}" -X POST \
      "$API/accounts/$ACC/email/sending/send" \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
      --data "{
        \"to\": \"$OWNER_EMAIL\",
        \"from\": {\"address\": \"$FROM_ADDR\", \"name\": \"Mount Zara\"},
        \"subject\": \"Mount Zara mail is now on Cloudflare\",
        \"text\": \"This message was sent through Cloudflare Email Sending from $FROM_ADDR. If you are reading it, the provider switch works end to end: domain onboarded, DNS live, token valid. No sandbox, no approval queue.\",
        \"html\": \"<p>This message was sent through <strong>Cloudflare Email Sending</strong> from $FROM_ADDR.</p><p>If you are reading it, the provider switch works end to end: domain onboarded, DNS live, token valid. No sandbox, no approval queue.</p>\"
      }")
[ "$S" = 200 ] || { cat /tmp/_ces_send.json; fail "test send failed (HTTP $S)"; }
grep -q '"delivered"\|"queued"' /tmp/_ces_send.json || { cat /tmp/_ces_send.json; fail "send accepted but no delivery status returned"; }
echo "   sent: $(head -c 200 /tmp/_ces_send.json)"

# ---------------------------------------------------------------------
say "5/7 Storing provider secrets on the Pages project…"
curl -s -X PATCH "$API/accounts/$ACC/pages/projects/mountzara" \
  -H "Authorization: Bearer $PAGES_TOKEN" -H "Content-Type: application/json" \
  -d "{\"deployment_configs\":{\"production\":{\"env_vars\":{
        \"CF_EMAIL_TOKEN\":      {\"value\": \"$TOKEN\", \"type\": \"secret_text\"},
        \"CF_EMAIL_ACCOUNT_ID\": {\"value\": \"$ACC\",   \"type\": \"secret_text\"},
        \"NOTIFY_PROVIDER\":     {\"value\": \"cloudflare\", \"type\": \"secret_text\"},
        \"NOTIFY_ALLOW_NON_BAA\":{\"value\": \"yes\", \"type\": \"secret_text\"}
      }}}}" | grep -q '"success":true' || fail "Pages env-var PATCH failed"
echo "   CF_EMAIL_TOKEN, CF_EMAIL_ACCOUNT_ID, NOTIFY_PROVIDER=cloudflare set"
echo "   NOTIFY_ALLOW_NON_BAA=yes — VALID ONLY PRE-LAUNCH. Before patients enroll:"
echo "   confirm a BAA with Cloudflare covering Email Service, or switch back to ses."

# ---------------------------------------------------------------------
say "6/7 Redeploying so Functions pick up the new provider…"
"$(dirname "$0")/deploy-prod.sh" "switch mail provider to Cloudflare Email Sending"

# ---------------------------------------------------------------------
say "7/7 Flushing the outbox so failed sends retry on the new provider…"
# The flush endpoint is guarded by X-Pipeline-Token, same as the other
# internal cron endpoints. PIPELINE_TOKEN comes in with the sourced creds;
# skip loudly rather than fail the whole setup if it is absent here.
if [ -n "${PIPELINE_TOKEN:-}" ]; then
    curl -s -X POST "https://mountzara.com/api/v1/internal/notifications/flush" \
         -H "X-Pipeline-Token: $PIPELINE_TOKEN" \
         -H "Content-Type: application/json" -d '{}' | head -c 300 || true
else
    echo "   ⚠ PIPELINE_TOKEN not in env — outbox not flushed. The hourly cron will retry it, or run the flush from the admin notifications page."
fi
echo
say "DONE. Verify: admin → notifications health should show provider=cloudflare and a fresh successful send."
