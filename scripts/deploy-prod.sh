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

# §0.8.1 KB-anchoring deploy gate — clinical-content surfaces MUST be
# anchored against the JSON KB master before they can ship. Verifier
# refuses the deploy if any /education/*/index.html, /portal/education/*/
# index.html lacks the §0.8 manifest or has hallucinated KB anchors.
# Skip with DEPLOY_SKIP_KB_GATE=1 (use only for non-clinical changes that
# don't touch any clinical surface — and ONLY when you've manually
# verified that fact).
if [ -z "${DEPLOY_SKIP_KB_GATE:-}" ]; then
    echo "🔒 §0.8.1 KB-anchoring gate — verifying every clinical surface..."
    FAILED=0
    for f in education/*/index.html portal/education/*/index.html ; do
        if [ ! -f "$f" ]; then continue; fi
        if ! python3 scripts/verify_kb_anchoring.py "$f" > /tmp/_kbverify.out 2>&1 ; then
            echo "   ❌ $f — KB anchoring gate FAILED:"
            sed -n '/✗/p' /tmp/_kbverify.out | sed 's/^/      /'
            FAILED=1
        else
            echo "   ✅ $f"
        fi
    done
    if [ "$FAILED" = "1" ]; then
        echo ""
        echo "🛑 DEPLOY BLOCKED by §0.8.1 KB-anchoring gate. Fix the issues above."
        echo "   Read CLAUDE.md §0.8.1 for the rule. Override (DANGEROUS, audited) with"
        echo "   DEPLOY_SKIP_KB_GATE=1 ./scripts/deploy-prod.sh '<reason>'"
        exit 1
    fi
    echo ""
fi

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

# §0.8.1 post-deploy gate for R2-served clinical posts. Unlike local
# /education/* files (gated pre-deploy above), R2-served posts (the W20
# Monday Morning + trend briefs in mountzara-content) are checked AFTER
# the Pages deploy lands, since their content lives in R2 and is served
# by /api/posts. A failure here is a hard error — clinical content that
# has lost its §0.8 manifest must be re-anchored immediately.
if [ -z "${DEPLOY_SKIP_KB_GATE:-}" ]; then
    echo ""
    echo "🔒 §0.8.1 R2-post gate — verifying R2-served clinical posts..."
    if ! python3 scripts/verify_kb_anchoring.py --r2-posts ; then
        echo ""
        echo "🛑 R2-POST GATE FAILED — at least one R2-served clinical post"
        echo "   is missing its §0.8 KB-anchor manifest. Re-anchor with"
        echo "   scripts/_anchor_all_clinical_posts.py (and _anchor_w20_post.py)"
        echo "   then re-run this deploy."
        exit 1
    fi
fi
