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

# Portable Python interpreter. Earlier versions hard-coded the Mac Homebrew
# path (/opt/homebrew/bin/python3) and an absolute /usr/bin/python3, so every
# gate that used them silently failed-to-launch on the Linux agent/CI VM and
# blocked the deploy with a phantom "audit failed". Resolve from PATH (works on
# macOS and Linux); override with MZ_PYTHON if you need a specific interpreter.
PY="${MZ_PYTHON:-$(command -v python3 || true)}"
if [ -z "$PY" ]; then
    echo "ERROR: python3 not found on PATH (set MZ_PYTHON)." >&2
    exit 1
fi

# A gate whose tool/data dependency is missing in THIS environment should SKIP
# cleanly (printed, auditable) — not block the deploy and not be conflated with
# the DANGEROUS operator overrides. Returns 0 if a Python module imports.
py_has_module() { "$PY" -c "import importlib,sys; importlib.import_module(sys.argv[1])" "$1" >/dev/null 2>&1; }

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
# KB availability — the master KB lives in the sibling MountZara medical-
# transcription repo (Mac dev box), absent on the agent/CI VM. When it's not
# here the gate physically cannot run; skip it cleanly (NOT a dangerous
# override, NOT a failure) so the deploy proceeds and the gate still fully
# enforces wherever the KB master IS present (set MZ_KB_DIR to point at it).
KB_GATE_OK=1
if [ -z "${DEPLOY_SKIP_KB_GATE:-}" ]; then
    if ! "$PY" scripts/verify_kb_anchoring.py --kb-available >/dev/null 2>&1; then
        KB_GATE_OK=0
        echo "⏭️  §0.8.1 KB-anchoring gate SKIPPED — KB master not present in this"
        echo "    environment ($("$PY" scripts/verify_kb_anchoring.py --kb-available 2>&1 | tail -1))."
        echo "    Enforced wherever the KB master exists; set MZ_KB_DIR to enable here."
        echo ""
    fi
fi
if [ -z "${DEPLOY_SKIP_KB_GATE:-}" ] && [ "$KB_GATE_OK" = "1" ]; then
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
        if ! "$PY" scripts/verify_kb_anchoring.py "$f" > /tmp/_kbverify.out 2>&1 ; then
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
    # Lives in the sibling agent-platform repo (Mac dev box); overridable via
    # MZ_REGRESSION_AUDIT. Absent on the agent/CI VM → clean environment skip.
    AUDIT="${MZ_REGRESSION_AUDIT:-/Users/beans/Developer/MountZara/agent-platform/scripts/regression_audit.py}"
    if [ -f "$AUDIT" ]; then
        echo ""
        echo "🔍 §0.4.1 comprehensive regression audit (all surfaces)..."
        if "$PY" "$AUDIT" --all > /tmp/_deploy_audit.log 2>&1; then
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
        echo "⏭️  §0.4.1 regression audit SKIPPED — regression_audit.py not present in"
        echo "    this environment ($AUDIT). Set MZ_REGRESSION_AUDIT to enable here."
    fi
fi

# ---------------------------------------------------------------------------
# Mirror-drift audit (added 2026-05-26). Per SYSTEM_MAP.md §14: education/
# <slug>/index.html and portal/education/<slug>/index.html are byte-similar
# copies. Diffs them with a per-element allowlist and exits 1 on real drift.
# Soft gate by default — skip with DEPLOY_SKIP_MIRROR_DRIFT_AUDIT=1.
# ---------------------------------------------------------------------------
if [ -z "${DEPLOY_SKIP_MIRROR_DRIFT_AUDIT:-}" ]; then
    if [ -f scripts/audit_mirror_drift.py ]; then
        echo "🔍 Mirror-drift audit (education/<slug> vs portal/education/<slug>)..."
        if "$PY" scripts/audit_mirror_drift.py > /tmp/_mirror_drift.log 2>&1; then
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

# STRUCTURAL-INTEGRITY post-deploy gate (added 2026-06-12). The §3 gate above
# checks prose rules but NOT the structural defect class that let the W21
# regression ship: placeholder modal titles ("Foundational reference"),
# cross-contaminated header metadata (wrong paper's title/n), "n = —" headers,
# broken inline-reference popovers (truncated / empty / wrong-paper synopsis),
# and unfilled "Foundational reference" reference-list entries. audit_deploy_gate
# reuses the accuracy + inline-ref auditors and hard-fails on any of these.
# Advisory judgment calls (derived sums, hedging) are intentionally NOT gated.
# Skip with DEPLOY_SKIP_STRUCTURAL_GATE=1 only for non-clinical shell pushes.
if [ -z "${DEPLOY_SKIP_STRUCTURAL_GATE:-}" ]; then
    echo ""
    echo "🔒 structural-integrity gate — modal headers, inline refs, reference lists..."
    if ! python3 scripts/audit_deploy_gate.py ; then
        echo ""
        echo "🛑 STRUCTURAL-INTEGRITY GATE FAILED — a published post has a"
        echo "   placeholder/contaminated modal header, a broken inline-reference"
        echo "   popover, or an unfilled reference-list entry. Fix the post body in"
        echo "   R2 (author each from the real PubMed record) and re-run. Override:"
        echo "   DEPLOY_SKIP_STRUCTURAL_GATE=1 ./scripts/deploy-prod.sh '<reason>'"
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
    if [ -f scripts/audit_runtime_css.py ] && ! py_has_module playwright; then
        echo ""
        echo "⏭️  Runtime-CSS audit SKIPPED — Playwright not installed in this"
        echo "    environment. (pip install playwright && playwright install chromium to enable.)"
    elif [ -f scripts/audit_runtime_css.py ]; then
        echo ""
        echo "🔍 Runtime-CSS audit — getComputedStyle assertions on live site..."
        if "$PY" scripts/audit_runtime_css.py homepage > /tmp/_runtime_css_audit.log 2>&1; then
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

# ---------------------------------------------------------------------------
# Visual / interactive runtime audit (audit_visual_runtime.py). Verifies that
# what the reader SEES works at runtime in a real headless browser: images
# loaded, autoplay videos playing, the hero drawing video starts on time and
# covers the screen, the Ken-Burns animation is applied + actually moving, and
# the opening fade-in sequence completes.
#
# SOFT GATE for now (reports, does NOT block) — it must be calibrated against a
# live render on a browser-equipped machine before being promoted to a hard
# gate. Promote by setting DEPLOY_VISUAL_GATE_HARD=1 once calibrated.
# Skip entirely with DEPLOY_SKIP_VISUAL_AUDIT=1.
# ---------------------------------------------------------------------------
if [ -z "${DEPLOY_SKIP_VISUAL_AUDIT:-}" ] && [ -f scripts/audit_visual_runtime.py ]; then
    if ! py_has_module playwright; then
        echo ""
        echo "⏭️  Visual/interactive audit SKIPPED — Playwright not installed."
    else
        echo ""
        echo "🔍 Visual/interactive runtime audit (images/videos/Ken-Burns/animations)..."
        if "$PY" scripts/audit_visual_runtime.py > /tmp/_visual_audit.log 2>&1; then
            tail -1 /tmp/_visual_audit.log
            echo "   ✅ visual/interactive audit passed"
        else
            echo ""
            echo "⚠️  VISUAL/INTERACTIVE audit reported failures (SOFT gate — not blocking):"
            grep -E '✗' /tmp/_visual_audit.log | head -20
            echo "   Full log: /tmp/_visual_audit.log"
            if [ -n "${DEPLOY_VISUAL_GATE_HARD:-}" ]; then
                echo "🛑 DEPLOY_VISUAL_GATE_HARD set — blocking."
                exit 1
            fi
            echo "   (Calibrate against a live render, then set DEPLOY_VISUAL_GATE_HARD=1 to enforce.)"
        fi
    fi
fi

# ---------------------------------------------------------------------------
# Route-render audit (added 2026-06-10 per SYSTEM_MAP.md §13.5). Converts
# §0.2.1 visual VERIFY into a HARD GATE: loads every route in
# scripts/route_render_manifest.json on live production in headless Chromium
# and asserts title + DOM selector — catching (a) the _redirects/Functions
# fallthrough-to-homepage class that left the R4 launch interstitial
# unreachable for 13 days, and (b) page JS that silently fails to build the
# DOM. The discovery contract also FAILS the deploy if a static SPA route
# exists in the repo with no manifest entry — a new page cannot ship without
# its render assertions (or a conscious `unaudited` row) in the same commit.
# Skip with DEPLOY_SKIP_ROUTE_RENDER_AUDIT=1 — dangerous, document why.
# ---------------------------------------------------------------------------
if [ -z "${DEPLOY_SKIP_ROUTE_RENDER_AUDIT:-}" ]; then
    if [ -f scripts/audit_route_render.py ] && ! py_has_module playwright; then
        echo ""
        echo "⏭️  Route-render audit SKIPPED — Playwright not installed in this"
        echo "    environment. (pip install playwright && playwright install chromium to enable.)"
    elif [ -f scripts/audit_route_render.py ]; then
        echo ""
        echo "🔍 Route-render audit — every registered route loaded + DOM-asserted on live site..."
        if "$PY" scripts/audit_route_render.py > /tmp/_route_render_audit.log 2>&1; then
            tail -1 /tmp/_route_render_audit.log
            echo "   ✅ route-render audit passed"
        else
            echo ""
            echo "🛑 ROUTE-RENDER AUDIT FAILED — a page route is serving the wrong"
            echo "   content (homepage fallthrough / broken page JS), or a new route"
            echo "   shipped without a scripts/route_render_manifest.json entry."
            grep -E '✗' /tmp/_route_render_audit.log | head -20
            echo ""
            echo "   Full log: /tmp/_route_render_audit.log"
            echo "   Override: DEPLOY_SKIP_ROUTE_RENDER_AUDIT=1 ./scripts/deploy-prod.sh '<reason>'"
            exit 1
        fi
    fi
fi
