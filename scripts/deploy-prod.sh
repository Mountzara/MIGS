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
        # Skip underscore-prefixed scaffolding directories (e.g. _template/).
        # These are authoring templates, NOT shipped clinical surfaces, and
        # by definition won't carry a real §0.8 manifest until they're
        # cloned + populated for a specific topic. Convention: any dir name
        # starting with `_` is non-public.
        case "$f" in
            education/_*/*|portal/education/_*/*) continue ;;
        esac
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

# ---------------------------------------------------------------------------
# §0.4.1 / §0.4 — comprehensive regression audit (codified 2026-05-21).
# Runs scripts/regression_audit.py against every known clinical surface BEFORE
# the wrangler deploy. Exit code 0 = pass; 1 = block deploy.
#
# Override (DANGEROUS, audited): DEPLOY_SKIP_REGRESSION_AUDIT=1
# ---------------------------------------------------------------------------
if [ -z "${DEPLOY_SKIP_REGRESSION_AUDIT:-}" ]; then
    AUDIT="/Users/beans/Developer/MountZara/agent-platform/scripts/regression_audit.py"
    if [ -f "$AUDIT" ]; then
        echo ""
        echo "🔍 §0.4.1 comprehensive regression audit (all surfaces)..."
        if /opt/homebrew/bin/python3 "$AUDIT" --all > /tmp/_deploy_audit.log 2>&1; then
            tail -1 /tmp/_deploy_audit.log
            echo "   ✅ audit passed"
        else
            echo ""
            echo "🛑 DEPLOY BLOCKED by §0.4.1 comprehensive regression audit. Failures:"
            grep -B1 FAIL /tmp/_deploy_audit.log | head -30
            echo ""
            echo "   Full log: /tmp/_deploy_audit.log"
            echo "   Override (DANGEROUS): DEPLOY_SKIP_REGRESSION_AUDIT=1 ./scripts/deploy-prod.sh '<reason>'"
            exit 1
        fi
        echo ""
    else
        echo "⚠️  regression_audit.py not found at $AUDIT — skipping §0.4.1 gate (this is a bug)"
    fi
fi

# ---------------------------------------------------------------------------
# Mirror-drift audit (added 2026-05-26). Per SYSTEM_MAP.md §14: education/
# <slug>/index.html and portal/education/<slug>/index.html are byte-similar
# copies. Diffs them with a per-element allowlist and exits 1 on real drift.
# Soft gate by default — skip with DEPLOY_SKIP_MIRROR_DRIFT_AUDIT=1.
# ---------------------------------------------------------------------------
if [ -z "${DEPLOY_SKIP_MIRROR_DRIFT_AUDIT:-}" ]; then
    if [ -x scripts/audit_mirror_drift.py ]; then
        echo "🔍 Mirror-drift audit (education/<slug> vs portal/education/<slug>)..."
        if /opt/homebrew/bin/python3 scripts/audit_mirror_drift.py > /tmp/_mirror_drift.log 2>&1; then
            echo "   ✅ no drift across 12 topics"
        else
            echo ""
            echo "🛑 DEPLOY BLOCKED by mirror-drift audit. Diff summary:"
            grep -E '❌|DRIFT' /tmp/_mirror_drift.log | head -20
            echo ""
            echo "   Full log: /tmp/_mirror_drift.log"
            echo "   Override: DEPLOY_SKIP_MIRROR_DRIFT_AUDIT=1 ./scripts/deploy-prod.sh '<reason>'"
            exit 1
        fi
        echo ""
    fi
fi

# ---------------------------------------------------------------------------
# Runtime-CSS audit (added 2026-05-26). Closes the §3.10 grep-vs-runtime
# gap that allowed the 2026-05-26 line 5703 CSS corruption to ship silently
# (SYSTEM_MAP.md §1.1). Loads each surface via headless WebKit (Playwright)
# and calls getComputedStyle() to verify design tokens actually apply at
# runtime, not just that the bytes are present in the source.
#
# This audit runs against LIVE mountzara.com so it must run AFTER the
# wrangler deploy completes (see post-deploy section below). The
# placeholder here documents the intent; the actual invocation is in
# the post-deploy block.
# ---------------------------------------------------------------------------

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

# §1.2 / §3.7 / §3.8 / §3.9 / §3.10 / §3.12 post-deploy gate (added
# 2026-05-25 by audit_live_post.py). The KB-anchoring gate above only
# checks the §0.8 manifest; this one runs the full CLAUDE.md compliance
# audit on every published R2-served post — bare-MIGS detection per §1.2,
# infra-language per §3.7/§3.11, blue-token per §3.10, missing-abstract
# per §3.7/§3.8, REVIEW REQUIRED leak per §3.8, zero-cite-grid per §3.8.
# Skip with DEPLOY_SKIP_POST_AUDIT=1 only for non-clinical site-shell
# pushes that don't touch post bodies.
if [ -z "${DEPLOY_SKIP_POST_AUDIT:-}" ]; then
    echo ""
    echo "🔒 §3 post-audit gate — running scripts/audit_live_post.py against every published post..."
    if ! python3 scripts/audit_live_post.py --list ; then
        echo ""
        echo "🛑 §3 POST-AUDIT FAILED — at least one published post violates"
        echo "   CLAUDE.md §1.2 / §3.7 / §3.8 / §3.9 / §3.10 / §3.12."
        echo "   Inspect the per-post checklist above and either:"
        echo "     (a) fix the post body in R2 via the admin PUT endpoint, or"
        echo "     (b) re-run with DEPLOY_SKIP_POST_AUDIT=1 only when the"
        echo "         failure is pre-existing and explicitly accepted."
        exit 1
    fi
fi

# ---------------------------------------------------------------------------
# Runtime-CSS post-deploy gate (added 2026-05-26 per SYSTEM_MAP.md §14).
# Loads live mountzara.com homepage via headless WebKit and runs
# getComputedStyle assertions on .identity-card, site-wide-glass selectors,
# hero element, active pip, carousels, and forbidden blue tokens. Catches
# CSS that is bytes-present-but-runtime-absent (the §1.1 corruption class).
# Skip with DEPLOY_SKIP_RUNTIME_CSS_AUDIT=1. Requires Playwright +
# Chromium installed on the deploy-running machine.
# ---------------------------------------------------------------------------
if [ -z "${DEPLOY_SKIP_RUNTIME_CSS_AUDIT:-}" ]; then
    if [ -x scripts/audit_runtime_css.py ]; then
        echo ""
        echo "🔍 Runtime-CSS audit — getComputedStyle assertions on live site..."
        if /usr/bin/python3 scripts/audit_runtime_css.py homepage > /tmp/_runtime_css_audit.log 2>&1; then
            tail -2 /tmp/_runtime_css_audit.log
            echo "   ✅ runtime CSS audit passed"
        else
            echo ""
            echo "🛑 RUNTIME-CSS AUDIT FAILED — at least one §3.10 token is"
            echo "   bytes-present but runtime-absent (the §1.1 corruption class)."
            echo "   Failed checks:"
            grep -E '✗|FAIL' /tmp/_runtime_css_audit.log | head -20
            echo ""
            echo "   Full log: /tmp/_runtime_css_audit.log"
            echo "   Override: DEPLOY_SKIP_RUNTIME_CSS_AUDIT=1 ./scripts/deploy-prod.sh '<reason>'"
            exit 1
        fi
    fi
fi
