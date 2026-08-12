#!/usr/bin/env bash
# =====================================================================
# guard_production.sh — production self-heal watchdog (2026-08-12)
# =====================================================================
# WHY THIS EXISTS
# Two working copies deploy to this Cloudflare Pages project with
# `wrangler pages deploy`. On 2026-08-12 the other copy deployed a tree
# that predated the CSS/JS split and silently replaced production with a
# build missing ~684 commits — the owner's corrected 90.4% same-day
# figure, the Preclinical Fellowship line, the fellowship tense fix, the
# reel-autoplay fix and every clinical-modal rewrite vanished from the
# live site. Desktop browsers kept serving the good build from cache, so
# nobody noticed until the owner opened the site on a phone.
#
# The stale-tree gate in deploy-prod.sh prevents this — but ONLY in a
# working copy that has pulled it. A copy still running the old deploy
# script bypasses every gate. This watchdog closes that hole WITHOUT
# needing the other copy to change anything: it watches the live site and
# repairs it.
#
# WHAT IT DOES
#   1. Runs scripts/verify_production.py against the live site.
#   2. If production is healthy: exit 0, do nothing.
#   3. If production has REGRESSED: fast-forward this copy to origin/main
#      (the single source of truth) and redeploy, which runs the full
#      gate suite. Then re-verify and report.
#
# WHY IT CANNOT FIGHT A LEGITIMATE DEPLOY
# The canary keys on PUBLISHED FACTS the owner corrected (90.4%, the
# Preclinical Fellowship line) plus the post-split architecture. Any
# deploy from an up-to-date tree still contains all of them, so it passes
# and the watchdog stays asleep. Only a genuinely stale build trips it.
#
# Usage:
#   scripts/guard_production.sh            # check, and repair if needed
#   scripts/guard_production.sh --dry-run  # check and report; never deploy
# =====================================================================
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1
DRY_RUN=""
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "[$STAMP] production guard — checking live site…"

if python3 scripts/verify_production.py; then
    echo "[$STAMP] healthy — no action."
    exit 0
fi

echo ""
echo "[$STAMP] 🛑 REGRESSION DETECTED on production."

if [ -n "$DRY_RUN" ]; then
    echo "[$STAMP] --dry-run set; not repairing. Repair with:"
    echo "    git pull --ff-only origin main && ./scripts/deploy-prod.sh 'restore'"
    exit 2
fi

# Repair from the single source of truth. --ff-only so the watchdog can
# never invent a merge or discard local commits; if this copy has diverged
# it stops and says so rather than guessing.
echo "[$STAMP] syncing to origin/main…"
if ! git fetch origin main 2>&1 | tail -1; then
    echo "[$STAMP] ✗ could not fetch origin — aborting repair."
    exit 1
fi
if ! git merge --ff-only origin/main 2>&1 | tail -2; then
    echo "[$STAMP] ✗ this copy has diverged from origin/main; refusing to"
    echo "         auto-merge. Resolve by hand, then redeploy."
    exit 1
fi

echo "[$STAMP] redeploying from main (full gate suite runs)…"
if ./scripts/deploy-prod.sh "AUTO-RESTORE: production had regressed to a stale build" 2>&1 | tail -6; then
    echo "[$STAMP] redeploy finished — re-verifying…"
else
    echo "[$STAMP] ✗ redeploy failed; production may still be regressed."
    exit 1
fi

if python3 scripts/verify_production.py; then
    echo "[$STAMP] ✅ production restored and verified."
    exit 0
fi
echo "[$STAMP] ✗ production STILL regressed after redeploy — needs a human."
exit 1
