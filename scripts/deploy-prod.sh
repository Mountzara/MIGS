#!/usr/bin/env bash
# deploy-prod.sh — One-shot direct deploy of the current working tree to mountzara.com.
# Bypasses GitHub Actions / PR review entirely.
#
# Usage:
#   ./scripts/deploy-prod.sh                  # deploy current files as-is
#   ./scripts/deploy-prod.sh "msg here"       # with a deploy message
#
# Requires CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID in env (auto-loaded
# by .claude/hooks/session-start.sh on Claude Code sessions).

set -euo pipefail

# Auto-load creds if not already in env
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] && [ -f "$HOME/.config/mountzara/cf-creds.env" ]; then
    # shellcheck disable=SC1091
    source "$HOME/.config/mountzara/cf-creds.env"
fi

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] || [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
    echo "ERROR: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set." >&2
    echo "Expected creds file at: \$HOME/.config/mountzara/cf-creds.env" >&2
    exit 1
fi

PROJECT="${CF_PAGES_PROJECT:-mountzara}"
MSG="${1:-}"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "🚀 Deploying $REPO_ROOT → Cloudflare Pages project '$PROJECT' (production / main branch)"
echo "   Files:    $(find . -maxdepth 2 -type f \( -name '*.html' -o -name '*.js' -o -name '*.toml' \) | wc -l) html/js/toml"
echo "   Functions:$(find ./functions -type f 2>/dev/null | wc -l)"
[ -n "$MSG" ] && echo "   Message:  $MSG"
echo ""

npx --yes wrangler@latest pages deploy . \
    --project-name="$PROJECT" \
    --branch=main \
    --commit-dirty=true \
    ${MSG:+--commit-message="$MSG"}

echo ""
echo "✅ Deployed. Verifying mountzara.com is fresh..."
sleep 3
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "https://mountzara.com/?cb=$(date +%s%N)" -H "Cache-Control: no-cache" || echo "000")
echo "   mountzara.com → HTTP $HTTP"
