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
# Fact-sync gate (2026-07-28). Two worktrees edit this site; content facts
# drifted from their data sources (UIC affiliation lived on in the public
# curriculum JSON after the pages were corrected; internal docs/ was being
# served publicly, including a risk-management letter). Hermetic scan of
# every deployable file against the canonical fact list. No override flag:
# a violation means false or private information is about to go public.
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Asset ?v= cache keys — /assets/css|js are served immutable for a YEAR,
# keyed by ?v=<hash> in the HTML. 2026-08-12: home.css changed (Ken Burns
# easing) but its ?v= did not, so every repeat visitor — including the
# owner — kept the OLD cached CSS while the server had the fix. He reported
# "I still see the color changing" and he was right. Rewrite the hashes
# from content sha256 on EVERY deploy so a changed asset always gets a
# changed URL. Fails the deploy only if HTML references a missing asset.
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# DEPLOY_CI=1 — running inside GitHub Actions (2026-08-12).
#
# Several gates below drive a real browser against the CURRENTLY-LIVE site
# (contrast, visual-runtime, route-render, reader-path, content-render) and
# the production canary. A CI runner has no Playwright browsers installed,
# so they fail on a missing module rather than on a real defect — which is
# exactly what broke the push-to-main deploy after it was pointed at this
# script. They are also of limited value in CI: they audit what is ALREADY
# published, not the tree being pushed.
#
# In CI we therefore run every HERMETIC gate — fact-sync, canonical
# post-format, hero-animation lock, stale-tree, asset versions, KB
# anchoring — and skip only the ones that need a browser. The staged,
# filtered upload (docs/, wrangler.toml, .env* excluded) is unchanged, so
# CI can never publish internal files.
# ---------------------------------------------------------------------------
if [ -n "${DEPLOY_CI:-}" ]; then
    export DEPLOY_SKIP_VISUAL_AUDIT=1
    export DEPLOY_SKIP_ROUTE_RENDER_AUDIT=1
    export DEPLOY_SKIP_READER_PATH_AUDIT=1
    export DEPLOY_SKIP_CONTRAST_AUDIT=1
    export DEPLOY_SKIP_RENDER_AUDIT=1
    export DEPLOY_SKIP_RUNTIME_CSS_AUDIT=1
    export DEPLOY_SKIP_STRUCTURAL_GATE=1
    export DEPLOY_SKIP_VIDEO_SRC_AUDIT=1
    export DEPLOY_SKIP_POST_AUDIT=1
    export DEPLOY_SKIP_CANARY=1
    echo "ℹ️  DEPLOY_CI=1 — browser-driven live-site audits skipped (no browsers"
    echo "    on the runner). All hermetic content gates still enforced."
fi

# ---------------------------------------------------------------------------
# STALE-TREE GATE (2026-08-12) — the single most damaging failure this project
# has had. Two working copies deploy to the same production project with
# `wrangler pages deploy` (ad_hoc). On 2026-08-12 the OTHER copy deployed a
# tree that predated the CSS/JS split, and it silently replaced production with
# a build missing ~684 commits: the owner's corrected same-day-discharge figure,
# the Preclinical Fellowship line, the fellowship tense fix, the reel-autoplay
# fix and every clinical-modal rewrite all vanished from the live site. Desktop
# browsers kept showing the good version from cache, so it surfaced as "the
# iPhone version is the old website" — the truth was that production itself had
# been overwritten.
#
# A deploy from a tree that is BEHIND the published branch is almost never
# intentional; it is a clobber. Refuse it. This runs FIRST, before any upload.
# Override (documented, deliberate) with DEPLOY_ALLOW_STALE_TREE=1.
# ---------------------------------------------------------------------------
# `[ -d .git ]` is FALSE in a git worktree (.git is a FILE there), which
# skipped this entire gate and let a 685-commit-old tree deploy during
# testing. rev-parse works for clones, worktrees and submodules alike.
if [ -z "${DEPLOY_ALLOW_STALE_TREE:-}" ] && command -v git >/dev/null 2>&1 \
        && git rev-parse --git-dir >/dev/null 2>&1; then
    echo ""
    echo "🔒 stale-tree gate — is this working copy up to date with origin?"
    if git fetch -q origin main 2>/dev/null; then
        BEHIND=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo 0)
        # Belt AND braces. Comparing to origin/main alone is not enough: if
        # main is ITSELF behind (as it was on 2026-08-12, 684 commits stale),
        # an old tree measures "0 behind" and sails through — proven by a test
        # deploy from origin/main that clobbered production. So also require
        # the tree's own index.html to carry the published canonical markers.
        for MARK in "90.4" "Preclinical Fellowship" "/assets/css/home.css"; do
            if ! grep -qF "$MARK" index.html 2>/dev/null; then
                echo ""
                echo "🛑 DEPLOY BLOCKED — index.html in this working copy is missing"
                echo "   the published marker: \"$MARK\""
                echo "   This tree predates work that is already live; deploying it"
                echo "   would delete published content."
                echo "   Fix:  git pull --ff-only origin main"
                exit 1
            fi
        done
        if [ "${BEHIND:-0}" -gt 0 ]; then
            echo ""
            echo "🛑 DEPLOY BLOCKED — this working copy is $BEHIND commit(s) BEHIND"
            echo "   origin/main. Deploying it would overwrite production with an"
            echo "   older build and silently delete published work."
            echo ""
            echo "   Fix:  git pull --ff-only origin main   (then re-run this deploy)"
            echo ""
            echo "   Only if you are DELIBERATELY publishing an older tree:"
            echo "     DEPLOY_ALLOW_STALE_TREE=1 ./scripts/deploy-prod.sh '<reason>'"
            exit 1
        fi
        echo "   ✅ up to date with origin/main (0 commits behind)"
    else
        echo "   ⏭  could not reach origin — skipping staleness check"
    fi
fi

if [ -f scripts/bump_asset_versions.py ]; then
    echo ""
    echo "🔒 asset-version bump — ?v= cache keys from content hashes..."
    if "$PY" scripts/bump_asset_versions.py; then
        :
    else
        echo "🛑 DEPLOY BLOCKED — HTML references a versioned asset that does not exist."
        exit 1
    fi
fi

if command -v node >/dev/null 2>&1 && [ -f scripts/audit_fact_sync.mjs ]; then
    echo ""
    echo "🔒 fact-sync gate — canonical facts across all deployable files..."
    if node scripts/audit_fact_sync.mjs > /tmp/_fact_sync.log 2>&1; then
        tail -1 /tmp/_fact_sync.log
    else
        echo ""
        echo "🛑 DEPLOY BLOCKED by the fact-sync gate:"
        grep -E '✗' /tmp/_fact_sync.log | head -10
        exit 1
    fi
fi

# ---------------------------------------------------------------------------
# HERO ANIMATION LOCK (codified 2026-07-04). The opening hero animation broke
# on multiple revisions because unrelated edits (justify, headline wrapping, a
# well-meaning "safety net") silently touched or interacted with the reveal
# choreography. This gate fingerprints the exact animation-critical regions of
# index.html and BLOCKS the deploy if they changed without the lock being
# deliberately updated. To intentionally change the animation: make the edit,
# WATCH the opening sequence end-to-end in a real browser, then
#   node scripts/hero_anim_fingerprint.mjs --update && git add scripts/hero_animation.lock
# No env override — the whole point is that an animation change can't slip out
# unacknowledged.
# ---------------------------------------------------------------------------
if command -v node >/dev/null 2>&1 && [ -f scripts/hero_anim_fingerprint.mjs ]; then
    echo ""
    echo "🔒 hero animation lock — opening choreography unchanged..."
    if node scripts/hero_anim_fingerprint.mjs --check > /tmp/_hero_lock.log 2>&1; then
        tail -1 /tmp/_hero_lock.log
    else
        echo ""
        echo "🛑 DEPLOY BLOCKED — the opening hero animation code changed:"
        cat /tmp/_hero_lock.log
        exit 1
    fi
fi

# ---------------------------------------------------------------------------
# Canonical post-format gate (codified 2026-07-02). Hermetic unit+route tests
# of the auto-heal / format-audit / approve-block pipeline in
# functions/_lib/post_format.js + functions/api/posts/[[path]].js, run from
# committed fixtures built out of the real regressed corpus. HARD gate — a
# regression here is exactly how the stale paper-card format reached the
# public site twice (W23/W24). No override flag on purpose: the suite is
# hermetic (no network), runs in ~1s, and a failure means the format
# guarantee is actually broken.
# ---------------------------------------------------------------------------
if command -v node >/dev/null 2>&1 && [ -f scripts/test_post_format_gate.mjs ]; then
    echo ""
    echo "🔒 canonical post-format gate — auto-heal + audit + approve-block..."
    if node scripts/test_post_format_gate.mjs > /tmp/_post_format_gate.log 2>&1; then
        tail -1 /tmp/_post_format_gate.log
        echo "   ✅ post-format gate passed"
    else
        echo ""
        echo "🛑 DEPLOY BLOCKED by the canonical post-format gate:"
        tail -20 /tmp/_post_format_gate.log
        echo "   Full log: /tmp/_post_format_gate.log"
        exit 1
    fi
    echo ""
fi

# ---------------------------------------------------------------------------
# Syntax gate (codified 2026-08-13). `node --check` on every Function file,
# in milliseconds, before anything expensive runs.
#
# Written after a backtick inside a SQL comment inside a template literal
# closed the literal early and failed the wrangler build — after the whole
# gate chain, the staging copy and the upload had already run. esbuild
# catches it, but only at the very end of a two-minute deploy. This catches
# the same class of error first, and names the file and column.
# ---------------------------------------------------------------------------
if command -v node >/dev/null 2>&1; then
    echo ""
    echo "🔒 syntax gate — parsing every Function file..."
    SYNTAX_ERRS=0
    while IFS= read -r f; do
        if ! node --check "$f" 2>>/tmp/_syntax_gate.log; then
            SYNTAX_ERRS=$((SYNTAX_ERRS + 1))
        fi
    done < <(find functions -name '*.js' -o -name '*.mjs')
    if [ "$SYNTAX_ERRS" -gt 0 ]; then
        echo ""
        echo "🛑 DEPLOY BLOCKED — $SYNTAX_ERRS file(s) failed to parse:"
        tail -40 /tmp/_syntax_gate.log
        exit 1
    fi
    rm -f /tmp/_syntax_gate.log
    echo "   ✅ syntax gate passed"
    echo ""
fi

# ---------------------------------------------------------------------------
# SQL column gate (codified 2026-08-13). D1 throws on an unknown column at
# RUNTIME, so a handler that names one returns 500 forever with no build
# error and no test failure. Seven endpoints were in that state when this
# gate was written — the admin snapshot dashboard, the whole Transcription
# sync, the patient briefing's document list, the onboarding wizard's
# education step — several of them silently, because a bare catch turned
# "the query is broken" into "there is no data".
#
# Hermetic (parses schema/*.sql, no network, <1s). No override flag: a
# failure here means an endpoint is guaranteed to 500.
# ---------------------------------------------------------------------------
if command -v node >/dev/null 2>&1 && [ -f scripts/check_sql_columns.mjs ]; then
    echo ""
    echo "🔒 SQL column gate — every SELECT names a column that exists..."
    if node scripts/check_sql_columns.mjs --self-test > /tmp/_sql_cols_self.log 2>&1 \
       && node scripts/check_sql_columns.mjs > /tmp/_sql_cols.log 2>&1; then
        tail -1 /tmp/_sql_cols.log
        echo "   ✅ SQL column gate passed"
    else
        echo ""
        echo "🛑 DEPLOY BLOCKED by the SQL column gate:"
        tail -30 /tmp/_sql_cols.log /tmp/_sql_cols_self.log
        exit 1
    fi
    echo ""
fi

# ---------------------------------------------------------------------------
# Portal header gate (codified 2026-08-13). The camera policy on
# /portal/tech-check/ and the Stripe CSP on /portal/billing/ cannot be
# expressed in _headers — that file APPENDS, and the browser resolves
# duplicate Permissions-Policy features first-wins and duplicate CSPs by
# intersection, so both overrides were inert while looking correct in curl.
# They live in functions/_lib/portal_headers.js now; this asserts they stay
# single-valued and correct.
# ---------------------------------------------------------------------------
if command -v node >/dev/null 2>&1 && [ -f scripts/test_portal_headers.mjs ]; then
    echo ""
    echo "🔒 portal header gate — camera on tech-check, Stripe on billing..."
    if node scripts/test_portal_headers.mjs > /tmp/_portal_headers.log 2>&1; then
        tail -1 /tmp/_portal_headers.log
        echo "   ✅ portal header gate passed"
    else
        echo ""
        echo "🛑 DEPLOY BLOCKED by the portal header gate:"
        tail -20 /tmp/_portal_headers.log
        exit 1
    fi
    echo ""
fi

# ---------------------------------------------------------------------------
# Clinical grounding gate (codified 2026-08-13). The owner's standing rule:
# clinical answers come from HIS KB, never from the model's general
# knowledge. On the day this was written the rule was enforced NOWHERE —
# the 1,144-document library was wired into a single website-copy editor
# while triage, after-visit summaries, patient message drafts, visit-prep
# packs and the PROM recommender all called the model with no reference
# material at all.
#
# Nothing caught it because an ungrounded prompt is not a runtime error. It
# produces fluent, confident medicine from the wrong source — the failure
# mode with no symptom. This gate makes forgetting impossible.
# ---------------------------------------------------------------------------
if command -v node >/dev/null 2>&1 && [ -f scripts/check_clinical_grounding_wired.mjs ]; then
    echo ""
    echo "🔒 clinical grounding gate — every clinical path uses the practice KB..."
    if node scripts/check_clinical_grounding_wired.mjs > /tmp/_kb_wired.log 2>&1 \
       && node scripts/test_clinical_grounding.mjs > /tmp/_kb_verify.log 2>&1; then
        tail -1 /tmp/_kb_wired.log
        tail -1 /tmp/_kb_verify.log
        echo "   ✅ clinical grounding gate passed"
    else
        echo ""
        echo "🛑 DEPLOY BLOCKED by the clinical grounding gate:"
        tail -30 /tmp/_kb_wired.log /tmp/_kb_verify.log
        exit 1
    fi
    echo ""
fi

# ---------------------------------------------------------------------------
# Date gate (codified 2026-08-13). Three endpoints validated dates with a
# shape regex, so 2026-02-31 was accepted, stored, and then matched no
# calendar query ever again — written, acknowledged and lost — and a
# ?from=1900-01-01 trends request returned 46,000 points in 1.6 MB.
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Citation-integrity gate.
#
# The patient guides invite a reader to check the sources. That invitation
# has to be true on every deploy, not on the days somebody remembers to
# audit — the guides shipped for months with 556 references of which 85
# were cited anywhere, one guide had two <li id="ref-14"> blocks so every
# [14] resolved to the wrong paper, and none of it was visible until
# someone went looking. Structural only, so it never depends on a network.
# Run scripts/verify_citations.mjs (PubMed) before publishing new clinical
# content.
# ---------------------------------------------------------------------------
if command -v node >/dev/null 2>&1 && [ -f scripts/check_citation_integrity.mjs ]; then
    echo ""
    echo "📚 citation-integrity gate..."
    if node scripts/check_citation_integrity.mjs > /tmp/_cites.log 2>&1; then
        head -2 /tmp/_cites.log
        echo "   ✅ citation-integrity gate passed"
    else
        echo ""
        echo "🛑 DEPLOY BLOCKED — a citation does not hold up:"
        cat /tmp/_cites.log
        exit 1
    fi
fi

# ---------------------------------------------------------------------------
# Citation-SUPPORT report (advisory, never blocks).
#
# The integrity gate proves a citation resolves. This asks the harder
# question — does the cited paper's own abstract support the SENTENCE it
# sits behind, and if the sentence asserts a figure, does that figure
# appear in the abstract. It found real mismatches: an endometrial-
# sampling paper cited for AUB epidemiology, for coagulation testing and
# for saline sonohysterography, and a stat card reading 90% while the
# paper it cited reported 71-95%.
#
# Advisory on purpose. A claim can be supported by a paper that phrases it
# differently, and only the full text settles some of them — blocking on
# that would train everyone to skip the gate. It prints, every deploy, so
# the number is never invisible.
# ---------------------------------------------------------------------------
if command -v node >/dev/null 2>&1 && [ -f scripts/check_citation_support.mjs ]; then
    echo ""
    echo "🔬 citation-support report (advisory)..."
    node scripts/check_citation_support.mjs > /tmp/_cite_support.log 2>&1 || true
    head -1 /tmp/_cite_support.log
    echo "      full detail: node scripts/check_citation_support.mjs"
fi

# ---------------------------------------------------------------------------
# Internal-link gate. A console whose own navigation points at a 404 reads
# as broken software no matter how well the rest works — /admin/cases/ sat
# like that for weeks while the nav highlighted it, and the single broken
# link on the public site was the Education button on the 404 page, offered
# to someone who had already hit a dead end.
# ---------------------------------------------------------------------------
if command -v node >/dev/null 2>&1 && [ -f scripts/check_internal_links.mjs ]; then
    echo ""
    echo "🔗 internal-link gate..."
    if node scripts/check_internal_links.mjs --strict > /tmp/_links.log 2>&1; then
        head -1 /tmp/_links.log
        echo "   ✅ internal-link gate passed"
    else
        echo ""
        echo "🛑 DEPLOY BLOCKED — a page links somewhere that does not exist:"
        cat /tmp/_links.log
        exit 1
    fi
fi

# ---------------------------------------------------------------------------
# Orders / results / estimates / referral gates.
#
# These three suites guard the parts of the system where a silent bug is a
# CLINICAL or REGULATORY failure rather than a broken page:
#   * orders     — a missed result is the classic outpatient negligence claim,
#                  so the overdue clock and the critical-result escalation are
#                  asserted rather than trusted.
#   * gfe        — the No Surprises Act deadline ladder and the required
#                  content elements (45 CFR 149.610). An estimate missing a
#                  required element is worse than none: it looks compliant.
#   * referrals  — an HMO/EPO member routed out of network is a denied claim
#                  the patient pays. A false "ok" here has a dollar value.
# ---------------------------------------------------------------------------
for _suite in orders gfe referrals avs_education visit_type_alias note_extract undeliverable_domains notify_provider; do
    if command -v node >/dev/null 2>&1 && [ -f "scripts/test_${_suite}.mjs" ]; then
        echo ""
        echo "🔒 ${_suite} gate..."
        if node "scripts/test_${_suite}.mjs" > "/tmp/_${_suite}.log" 2>&1; then
            tail -1 "/tmp/_${_suite}.log"
            echo "   ✅ ${_suite} gate passed"
        else
            echo ""
            echo "🛑 DEPLOY BLOCKED by the ${_suite} gate:"
            tail -20 "/tmp/_${_suite}.log"
            exit 1
        fi
    fi
done

if command -v node >/dev/null 2>&1 && [ -f scripts/test_iso_date.mjs ]; then
    echo ""
    echo "🔒 date gate — real calendar dates and bounded windows..."
    if node scripts/test_iso_date.mjs > /tmp/_iso_date.log 2>&1; then
        tail -1 /tmp/_iso_date.log
        echo "   ✅ date gate passed"
    else
        echo ""
        echo "🛑 DEPLOY BLOCKED by the date gate:"
        tail -20 /tmp/_iso_date.log
        exit 1
    fi
    echo ""
fi

# ---------------------------------------------------------------------------
# Inline-script gate (codified 2026-08-14). The public /portal/ page is
# generated from a JS TEMPLATE LITERAL, so an escape written for the
# BROWSER gets evaluated at generation time instead. One "\\n" that should
# have been "\\\\n" put a real newline inside a string literal, which is a
# hard syntax error — and a script that does not parse runs NONE of its
# lines. The membership tiers, the comparison table, the evidence and the
# disclosures all silently vanished from the page while the source looked
# correct, the API was healthy, and every deploy passed. The owner reported
# the model details were "left out"; nothing in the repo could have told
# him otherwise, because the failure existed only in the GENERATED output.
# ---------------------------------------------------------------------------
if command -v node >/dev/null 2>&1 && [ -f scripts/check_inline_scripts.mjs ]; then
    echo ""
    echo "🔒 inline-script gate — every inline <script> parses in a browser..."
    if node scripts/check_inline_scripts.mjs > /tmp/_inline.log 2>&1; then
        tail -1 /tmp/_inline.log
        echo "   ✅ inline-script gate passed"
    else
        echo ""
        echo "🛑 DEPLOY BLOCKED by the inline-script gate:"
        tail -25 /tmp/_inline.log
        exit 1
    fi
    echo ""
fi

# ---------------------------------------------------------------------------
# Notification gate (codified 2026-08-14). The outbox was write-only: six
# real notifications, three of them magic-link SIGN-IN emails, sat at
# attempts=1 and were never retried. The judgement that makes a retry loop
# safe is what counts as permanent — and the SES sandbox refusal reads like
# a rejection while being transient at the account level, so classifying it
# wrongly abandons exactly the mail that is about to start working.
# ---------------------------------------------------------------------------
if command -v node >/dev/null 2>&1 && [ -f scripts/test_notification_flush.mjs ]; then
    echo ""
    echo "🔒 notification gate — retry backoff and failure classification..."
    if node scripts/test_notification_flush.mjs > /tmp/_notif.log 2>&1; then
        tail -1 /tmp/_notif.log
        echo "   ✅ notification gate passed"
    else
        echo ""
        echo "🛑 DEPLOY BLOCKED by the notification gate:"
        tail -20 /tmp/_notif.log
        exit 1
    fi
    echo ""
fi

# ---------------------------------------------------------------------------
# Scheduling timezone gate (codified 2026-08-14). Every slot ever offered
# was five hours early: dateStringToMs defaulted its offset to zero and
# neither caller passed one, so a 9:00 a.m. block was stored as 09:00 UTC —
# 4:00 a.m. in Chicago. It survived because the admin page formats
# minute-of-day arithmetically ("09:00") while the patient page formats the
# epoch ("4:45 AM"), so neither surface could see the other's number.
# Covers both DST transitions, which a fixed -300 constant gets wrong twice
# a year.
# ---------------------------------------------------------------------------
if command -v node >/dev/null 2>&1 && [ -f scripts/test_scheduling_tz.mjs ]; then
    echo ""
    echo "🔒 scheduling timezone gate — slots land in practice hours..."
    if node scripts/test_scheduling_tz.mjs > /tmp/_tz.log 2>&1; then
        tail -1 /tmp/_tz.log
        echo "   ✅ scheduling timezone gate passed"
    else
        echo ""
        echo "🛑 DEPLOY BLOCKED by the scheduling timezone gate:"
        tail -20 /tmp/_tz.log
        exit 1
    fi
    echo ""
fi

# ---------------------------------------------------------------------------
# Triage auto-release gate (codified 2026-08-14). The admin panel promises
# rows auto-release to the patient after four hours; the rule that makes
# that safe is that URGENT rows never do. Pin both.
# ---------------------------------------------------------------------------
if command -v node >/dev/null 2>&1 && [ -f scripts/test_triage_auto_release.mjs ]; then
    echo ""
    echo "🔒 triage auto-release gate — 4-hour clock, urgent always held..."
    if node scripts/test_triage_auto_release.mjs > /tmp/_triage_ar.log 2>&1; then
        tail -1 /tmp/_triage_ar.log
        echo "   ✅ triage auto-release gate passed"
    else
        echo ""
        echo "🛑 DEPLOY BLOCKED by the triage auto-release gate:"
        tail -20 /tmp/_triage_ar.log
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

# DEPLOY_GATES_ONLY=1 — run every pre-upload gate, then stop before staging or
# uploading anything. Added 2026-08-12 because verifying the stale-tree gate by
# running a real deploy overwrote production twice. Gate behaviour must be
# testable without touching the live site.
if [ -n "${DEPLOY_GATES_ONLY:-}" ]; then
    echo ""
    echo "✅ DEPLOY_GATES_ONLY — all pre-upload gates passed; stopping before upload."
    exit 0
fi

# ---------------------------------------------------------------------------
# Staged upload (added 2026-06-29). `wrangler pages deploy .` uploads the
# ENTIRE working tree. wrangler drops `.git`/`node_modules` by its own
# defaults, but it does NOT drop:
#   • companion-app/  — the native iOS/Mac app (MZAdmin). Its Xcode
#     DerivedData (companion-app/build/, present after a local build) is
#     500MB+/~9k files and alone can blow Cloudflare Pages' 20,000-file
#     ceiling, making the deploy hang/fail. Even without build/, the Swift
#     source is junk on a static web host.
#   • wrangler.toml   — uploaded + served live, leaking the D1 database_id
#     and KV namespace ids.
#   • .env / .env.*   — secret files (e.g. .env.pipeline) that were being
#     served byte-for-byte on the public site.
#   • .github/, .wrangler/ — CI config / local wrangler state, not web content.
#
# So we rsync ONLY the deployable site into a temp dir and deploy THAT —
# wrangler never even walks the excluded trees (the file-count ceiling is
# impossible to hit no matter how large DerivedData grows).
#
# Safe because production bindings + env vars + compatibility_date all live
# in the Pages dashboard deployment_config (verified 2026-06-29), NOT in
# wrangler.toml — so a config-less deploy from the stage dir inherits them
# unchanged. The pre-deploy gates above already ran against the repo
# (REPO_ROOT); the stage is a byte copy of those same files minus non-web
# junk, so what was verified is exactly what ships.
# ---------------------------------------------------------------------------
command -v rsync >/dev/null 2>&1 || RSYNC_MISSING=1

STAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mz-pages-deploy.XXXXXX")"
cleanup_stage() { rm -rf "$STAGE_DIR"; }
trap cleanup_stage EXIT

# Exclude set: dev junk (.git, node_modules, native app, build artifacts) plus
# non-web files (scripts/, schema/, *.md/*.sh/*.py, wrangler.toml, .env*). Kept
# identical between the rsync path and the tar fallback below.
if [ -z "${RSYNC_MISSING:-}" ]; then
    rsync -a \
        --exclude='.git/' \
        --exclude='.github/' \
        --exclude='.wrangler/' \
        --exclude='node_modules/' \
        --exclude='companion-app/' \
        --exclude='build/' \
        --exclude='DerivedData/' \
        --exclude='.build/' \
        --exclude='*.xcuserstate' \
        --exclude='.DS_Store' \
        --exclude='wrangler.toml' \
        --exclude='.env' \
        --exclude='.env.*' \
        --exclude='/scripts/' \
        --exclude='/schema/' \
        --exclude='/docs/' \
        --exclude='/cite_audit/' \
        --exclude='/.claude/' \
        --exclude='*.doc' \
        --exclude='*.docx' \
        --exclude='*.md' \
        --exclude='*.sh' \
        --exclude='*.py' \
        --exclude='.gitignore' \
        --exclude='.gitattributes' \
        "$REPO_ROOT/" "$STAGE_DIR/"
else
    # rsync-less fallback (2026-07-06): some managed containers ship without
    # rsync. tar is always present and its non-anchored --exclude matches the
    # same trees/extensions (excluding a directory excludes its contents), so
    # the staged byte set is identical to the rsync path — exactly what the
    # pre-deploy gates verified against REPO_ROOT.
    echo "ℹ️  rsync not present — staging via tar fallback."
    ( cd "$REPO_ROOT" && tar \
        --exclude='.git' --exclude='.github' --exclude='.wrangler' \
        --exclude='node_modules' --exclude='companion-app' --exclude='build' \
        --exclude='DerivedData' --exclude='.build' --exclude='*.xcuserstate' \
        --exclude='.DS_Store' --exclude='wrangler.toml' --exclude='.env' \
        --exclude='.env.*' --exclude='./scripts' --exclude='./schema' --exclude='./docs' \
        --exclude='./cite_audit' --exclude='./.claude' \
        --exclude='*.doc' --exclude='*.docx' \
        --exclude='*.md' --exclude='*.sh' --exclude='*.py' \
        --exclude='.gitignore' --exclude='.gitattributes' \
        -cf - . ) | ( cd "$STAGE_DIR" && tar -xf - )
fi

# ---------------------------------------------------------------------------
# Strip internal provenance comments from the PUBLIC copy (2026-08-20)
# ---------------------------------------------------------------------------
# The §0.8 anchors record which KB document and which field each claim came
# from. They are genuinely useful IN THE REPO — the citation audit reads
# them — and they have no business on the public internet: they publish
# internal knowledge-base document ids, the field taxonomy (keyPoints,
# criticalThresholds…) and the internal spec numbering, which together
# describe how the content pipeline works to anyone who views source.
#
# 278 of them were being served. The repo keeps them; the deployed bytes
# do not. Comments are removed from the STAGE only, so nothing in git
# changes and the audit tooling still works.
# ---------------------------------------------------------------------------
STRIPPED=0
while IFS= read -r f; do
    if grep -q '<!-- §0.8 anchor\|kb_doc_id=' "$f" 2>/dev/null; then
        # NOTE the [\s\S] rather than [^>]: the biggest leak was a 6,200-char
        # "§0.8 KB-anchor manifest" comment carrying a JSON block of KB
        # document ids, titles, fields and the claims quoted from them —
        # and JSON contains '>' characters, so a [^>] pattern stopped at the
        # first one and left the manifest in place.
        perl -0pi -e 's/<!--\s*§0\.8[\s\S]*?-->//gs; s/<!--[^>]*kb_doc_id[\s\S]*?-->//gs' "$f"
        STRIPPED=$((STRIPPED+1))
    fi
done < <(find "$STAGE_DIR" -name '*.html' -not -path '*/node_modules/*')
if [ "$STRIPPED" -gt 0 ]; then
    echo "🔒 stripped internal KB provenance comments from $STRIPPED staged page(s)"
    if grep -rq 'kb_doc_id=' "$STAGE_DIR" --include='*.html' 2>/dev/null; then
        echo "🛑 DEPLOY BLOCKED — internal kb_doc_id references still present in the stage after stripping."
        grep -rl 'kb_doc_id=' "$STAGE_DIR" --include='*.html' | head -5
        exit 1
    fi
fi

# Strip ALL authoring comments from the PUBLIC copy (2026-08-20)
# ---------------------------------------------------------------------------
# The block above removed the §0.8 / kb_doc_id provenance comments and
# nothing else, so everything else this repo writes into markup was still
# being served: which gate enforces which invariant, where the hero
# fingerprint lock lives, why each breakpoint is the number it is, what
# every data- attribute drives, and the reasoning behind each fix. On
# index.html alone that was 71 comments and 14.6 KB — a design document,
# published, against the owner's explicit directive that a visitor must not
# be able to learn how the site works.
#
# The repo keeps every comment (that is how the next session avoids
# re-breaking things); the STAGE loses them. The stripper skips <script>
# and <style> regions, because a JS string may contain the characters
# "<!--" and a naive regex would eat live code from there to the next
# "-->". See scripts/strip_html_comments.mjs and its --self-test.
# ---------------------------------------------------------------------------
if command -v node >/dev/null 2>&1 && [ -f scripts/strip_html_comments.mjs ]; then
    if ! node scripts/strip_html_comments.mjs --self-test > /tmp/_strip_selftest.log 2>&1; then
        echo "🛑 DEPLOY BLOCKED — strip_html_comments self-test failed; refusing to run it over the stage."
        cat /tmp/_strip_selftest.log
        exit 1
    fi
    echo -n "🔒 "
    node scripts/strip_html_comments.mjs "$STAGE_DIR"
fi

# ---------------------------------------------------------------------------
# Stage-integrity assertion (added 2026-08-13)
# ---------------------------------------------------------------------------
# The exclude list above is a set of UNANCHORED patterns, so `docs/` did not
# mean "the docs directory at the repo root" — it meant "any directory named
# docs, at any depth". `functions/api/v1/admin/compliance/docs/` matched.
# Both of its handlers were silently dropped from every deploy since that
# endpoint shipped, and GET /api/v1/admin/compliance/docs returned 404 in
# production while existing, complete, in the repo. Nothing reported it: the
# staging step has no idea which files were supposed to survive.
#
# The three directory excludes are anchored now (`/docs/`), but the real fix
# is to stop trusting the pattern list. Every file under functions/ is
# deployable by definition — that is what the directory IS — so any
# discrepancy between the repo and the stage is a bug in the exclude list,
# and it blocks the deploy rather than shipping a hole in the API.
REPO_FN_COUNT=$(find "$REPO_ROOT/functions" -type f \( -name '*.js' -o -name '*.mjs' \) 2>/dev/null | wc -l | tr -d ' ')
STAGE_FN_COUNT=$(find "$STAGE_DIR/functions" -type f \( -name '*.js' -o -name '*.mjs' \) 2>/dev/null | wc -l | tr -d ' ')
if [ "$REPO_FN_COUNT" != "$STAGE_FN_COUNT" ]; then
    echo ""
    echo "🛑 DEPLOY BLOCKED — the staging filter dropped Pages Functions."
    echo "   repo:  $REPO_FN_COUNT handler(s) under functions/"
    echo "   stage: $STAGE_FN_COUNT"
    echo "   Missing (these would 404 in production):"
    diff \
        <(cd "$REPO_ROOT" && find functions -type f \( -name '*.js' -o -name '*.mjs' \) | sort) \
        <(cd "$STAGE_DIR"  && find functions -type f \( -name '*.js' -o -name '*.mjs' \) | sort) \
        | grep '^<' | sed 's/^< /      /'
    echo "   An exclude pattern in this script is matching a path under functions/."
    echo "   Anchor it with a leading slash (rsync) or ./ (tar)."
    exit 1
fi
echo "   ✅ stage integrity: all $REPO_FN_COUNT Function handlers staged"

# ---------------------------------------------------------------------------
# Working directories must never ship (added 2026-08-14)
# ---------------------------------------------------------------------------
# `cite_audit/` and `.claude/` were being published. Among them,
# https://mountzara.com/cite_audit/authoritative-cv-2026-08.txt served the
# owner's full CV including a mobile number he had deliberately kept off
# the published CV page, and /.claude/settings.json returned 200.
#
# Asserted rather than trusted: the exclude list is the thing that was
# wrong, so checking the exclude list proves nothing. This checks the STAGE.
for LEAK in cite_audit .claude docs scripts schema; do
    if [ -e "$STAGE_DIR/$LEAK" ]; then
        echo ""
        echo "🛑 DEPLOY BLOCKED — '$LEAK/' is in the staged upload and must never be public."
        echo "   Found: $(find "$STAGE_DIR/$LEAK" -type f | head -5 | sed "s|$STAGE_DIR/||" | tr '\n' ' ')"
        echo "   Anchor its exclude in BOTH staging paths in this script."
        exit 1
    fi
done
echo "   ✅ no working directories staged (cite_audit, .claude, docs, scripts, schema)"

# ---------------------------------------------------------------------------
# Oversized-file prune (added 2026-07-28)
# ---------------------------------------------------------------------------
# Cloudflare Pages rejects the ENTIRE deploy if any single file exceeds
# 25 MiB. A stray large asset dropped anywhere in the repo therefore blocks
# every subsequent deploy with an error that names the file but not the fix
# — on 2026-07-28 a 185 MiB .m4v in docs/fmigs-year3/ hard-failed a deploy
# that had already passed every pre-deploy gate.
#
# Large media belongs in R2 (mountzara-media, served at /media/<key>) per
# the project CLAUDE.md, never in the Pages bundle. Prune anything over the
# ceiling from the STAGE dir — the working tree is untouched — and say
# loudly what was dropped so an asset that genuinely needed shipping isn't
# lost silently. Runs after staging so it covers the rsync and tar paths
# identically.
PAGES_MAX_MIB=25
OVERSIZED=$(find "$STAGE_DIR" -type f -size +${PAGES_MAX_MIB}M 2>/dev/null || true)
if [ -n "$OVERSIZED" ]; then
    echo "⚠️  Files over Cloudflare Pages' ${PAGES_MAX_MIB} MiB per-file limit — pruned from this deploy:"
    while IFS= read -r big; do
        [ -z "$big" ] && continue
        sz=$(du -m "$big" 2>/dev/null | cut -f1)
        echo "      - ${big#$STAGE_DIR/} (${sz} MiB)"
        rm -f "$big"
    done <<< "$OVERSIZED"
    echo "   These were NOT deployed and were NOT removed from your working tree."
    echo "   If any of them needs to be live, upload to R2 instead:"
    echo "     TOKEN=\$(cat ~/.config/mountzara/upload-token.txt)"
    echo "     curl -X PUT -H \"Authorization: Bearer \$TOKEN\" \\"
    echo "       --data-binary @<file> https://mountzara.com/upload/<key>"
    echo ""
fi

STAGED_FILES=$(find "$STAGE_DIR" -type f | wc -l | tr -d ' ')
echo "📦 Staged $STAGED_FILES deployable files → $STAGE_DIR"
echo "   Excluded: companion-app/ (native app) + build artifacts, wrangler.toml, .env*, .github/, .wrangler/, files >${PAGES_MAX_MIB} MiB"
echo ""

# Deploy from the stage dir. There is no wrangler.toml there, so wrangler runs
# config-less (no `pages_build_output_dir` vs positional-directory conflict);
# --project-name pins the project explicitly and production inherits bindings/
# compatibility_date from the dashboard. Run in a subshell so the post-deploy
# gates below still execute from REPO_ROOT.
( cd "$STAGE_DIR" && npx --yes wrangler@latest pages deploy . \
    --project-name="$PROJECT" \
    --branch=main \
    --commit-dirty=true \
    ${MSG:+--commit-message="$MSG"} )

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
    # Numeric-fidelity gate (2026-07-06): every decimal effect estimate in a
    # deep-dive modal's Key-Findings section must be traceable to that modal's
    # own embedded verbatim abstract (literal or 2-decimal rounding). Blocks a
    # generator misextraction / fabrication from presenting an unverifiable
    # number as a clinical finding. Offline per-modal check; network-flaky
    # corpus load degrades to skip (never a false block).
    if command -v node >/dev/null 2>&1 && [ -f scripts/audit_numeric_fidelity.mjs ]; then
        echo ""
        echo "🔒 numeric-fidelity gate — effect estimates vs embedded abstracts..."
        if ! node scripts/audit_numeric_fidelity.mjs ; then
            echo ""
            echo "🛑 NUMERIC-FIDELITY GATE FAILED — a published post presents an"
            echo "   effect estimate (OR/RR/HR/CI/AUC) that is NOT traceable to its"
            echo "   modal's own verbatim PubMed abstract. Correct the number in R2"
            echo "   from the real abstract (or remove the unverifiable estimate)."
            echo "   Override: DEPLOY_SKIP_STRUCTURAL_GATE=1 ./scripts/deploy-prod.sh '<reason>'"
            exit 1
        fi
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
        # Asset live-body verification (2026-08-12) — an edge once cached a stale
# body under a fresh ?v= key (deploy race) and served it, immutable, while
# the repo said the fix shipped. Verify every referenced asset URL's live
# body hash equals its ?v= key; a mismatch is a poisoned edge entry.
echo ""
echo "🔍 Asset live-body verification — ?v= keys vs served bytes..."
if "$PY" scripts/bump_asset_versions.py --verify-live; then
    echo "   ✅ asset bodies verified"
else
    echo "🛑 DEPLOY POISONED — a CDN edge serves a stale body under a fresh ?v= key."
    echo "   Rotate the key (touch the asset, rerun deploy) — do NOT ignore this."
    exit 1
fi

# Production canary (2026-08-12) — after uploading, confirm the LIVE site is
# actually serving the current build. This is the check whose absence let a
# stale-tree clobber sit unnoticed on production.
echo ""
echo "🔍 Production canary — is the live site serving this build?"
if [ -n "${DEPLOY_SKIP_CANARY:-}" ]; then
    echo "   ⏭  skipped (DEPLOY_SKIP_CANARY)"
elif "$PY" scripts/verify_production.py; then
    echo "   ✅ production canary passed"
else
    echo "🛑 PRODUCTION CANARY FAILED — the live site is NOT serving this build."
    exit 1
fi

# ---------------------------------------------------------------------------
# Public-header assertion (post-deploy, live).
#
# _headers is not enough and never was: Cloudflare does not apply it to a
# response a FUNCTION returns, so /education/* served twelve clinical guides
# with no CSP, no HSTS and no frame protection while the file that
# "configured" them looked correct. /portal/* hit the identical trap
# earlier. Configuration is not evidence — this reads the live headers.
# ---------------------------------------------------------------------------
if command -v node >/dev/null 2>&1 && [ -f scripts/check_public_headers.mjs ]; then
    echo ""
    echo "🛡  public-header assertion..."
    if MZ_ADMIN_BASIC="${MZ_ADMIN_BASIC:-}" node scripts/check_public_headers.mjs --strict > /tmp/_pubhdr.log 2>&1; then
        tail -1 /tmp/_pubhdr.log
        echo "   ✅ public headers verified on the live site"
    else
        echo ""
        echo "🛑 A public route is under-protected:"
        cat /tmp/_pubhdr.log
        exit 1
    fi
fi


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
# HARD GATE since 2026-07-22: calibrated against a live render (29/29 across
# desktop-chromium + iPhone + iPhone-reduce-motion profiles, with engine and
# codec fallbacks that skip loudly instead of false-failing). Demote to
# report-only with DEPLOY_VISUAL_GATE_SOFT=1; skip entirely with
# DEPLOY_SKIP_VISUAL_AUDIT=1.
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
            echo "🛑 VISUAL/INTERACTIVE audit FAILED — the page LOOKS broken at"
            echo "   runtime (image/video/animation/reveal), not just in source:"
            grep -E '✗' /tmp/_visual_audit.log | head -20
            echo "   Full log: /tmp/_visual_audit.log"
            if [ -n "${DEPLOY_VISUAL_GATE_SOFT:-}" ]; then
                echo "⚠️  DEPLOY_VISUAL_GATE_SOFT set — reporting only, not blocking."
            else
                echo "   Override: DEPLOY_VISUAL_GATE_SOFT=1 ./scripts/deploy-prod.sh '<reason>'"
                exit 1
            fi
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

# ---------------------------------------------------------------------------
# Content-render gate (added 2026-07-21 per SYSTEM_MAP.md §14.1). The string
# and structural gates repeatedly PASSED weekly briefs that a READER saw as
# broken — placeholder deep dives, missing per-topic AI synthesis, unstyled
# dd-* modals — because the markup existed as a source string (often only in
# the CSS) while the rendered DOM was wrong. This gate renders each published
# roundup's body_html in headless Chromium and asserts on the ACTUAL DOM:
# every topic group shows real synthesis prose, deep-dive modals are authored
# (no "Pending review") AND styled (headings pick up the stylesheet), and the
# body throws no JS errors. Verified 2026-07-21 to be green on the entire
# approved corpus (W20/W21 gold standard + W23–W29) and red on each of those
# three regressions. Best-effort: self-skips (exit 0) when playwright-core /
# Chromium is absent, same policy as the runtime-CSS audit.
# Skip with DEPLOY_SKIP_RENDER_AUDIT=1 — dangerous, document why.
# ---------------------------------------------------------------------------
if [ -z "${DEPLOY_SKIP_RENDER_AUDIT:-}" ]; then
    if command -v node >/dev/null 2>&1 && [ -f scripts/audit_render.mjs ]; then
        echo ""
        echo "🔍 Content-render gate — every roundup rendered + reader-DOM asserted on live site..."
        if node scripts/audit_render.mjs > /tmp/_render_audit.log 2>&1; then
            tail -1 /tmp/_render_audit.log
            echo "   ✅ content-render gate passed"
        else
            echo ""
            echo "🛑 CONTENT-RENDER GATE FAILED — a published roundup renders"
            echo "   incorrectly for a reader (missing per-topic synthesis, a"
            echo "   'Pending review' deep-dive stub, an unstyled modal, or a page"
            echo "   JS error). Heal the post body in R2 (functions/_lib/post_format.js"
            echo "   auditPublishable/healPost) and re-run."
            grep -E '✗' /tmp/_render_audit.log | head -20
            echo ""
            echo "   Full log: /tmp/_render_audit.log"
            echo "   Override: DEPLOY_SKIP_RENDER_AUDIT=1 ./scripts/deploy-prod.sh '<reason>'"
            exit 1
        fi
    fi
fi

# ---------------------------------------------------------------------------
# Reader-path gate (added 2026-07-22 per SYSTEM_MAP.md §14.1). The content-
# render gate renders body_html in ISOLATION; this one walks the path a
# reader actually takes for EVERY published post (not just roundups): the
# /evidence/ + /trending/ listings render one linked card per post, each
# detail page loads through the real shell (API fetch -> innerHTML ->
# script re-execution), deep-dive modals open BY CLICKING their trigger
# buttons, roundup synthesis/references are VISIBLE, no page JS errors, and
# no page — post, listing, home, about — scrolls horizontally at 390px.
# First run found 3 shipped defects the other gates could not see: the
# /trending/ shell never re-executed body scripts (every deep-dive button
# dead), a 39px site-wide mobile nav overflow, and 115-246px popover
# overflow on W20/W21-era posts. Best-effort skip without Chromium.
# Skip with DEPLOY_SKIP_READER_PATH_AUDIT=1 — dangerous, document why.
# ---------------------------------------------------------------------------
if [ -z "${DEPLOY_SKIP_READER_PATH_AUDIT:-}" ]; then
    if command -v node >/dev/null 2>&1 && [ -f scripts/audit_reader_path.mjs ]; then
        echo ""
        echo "🔍 Reader-path gate — every post walked end-to-end through the real shells..."
        if node scripts/audit_reader_path.mjs > /tmp/_reader_path_audit.log 2>&1; then
            tail -1 /tmp/_reader_path_audit.log
            echo "   ✅ reader-path gate passed"
        else
            echo ""
            echo "🛑 READER-PATH GATE FAILED — a published post is broken on the"
            echo "   path a reader actually takes (listing card missing, shell load,"
            echo "   dead deep-dive trigger, invisible synthesis, JS error, or"
            echo "   mobile horizontal overflow):"
            grep -E '✗' /tmp/_reader_path_audit.log | head -20
            echo ""
            echo "   Full log: /tmp/_reader_path_audit.log"
            echo "   Override: DEPLOY_SKIP_READER_PATH_AUDIT=1 ./scripts/deploy-prod.sh '<reason>'"
            exit 1
        fi
    fi
fi

# ---------------------------------------------------------------------------
# WCAG contrast gate, PIXEL-MEASURED (2026-08-08). Every previous attempt to
# compute contrast by compositing CSS layers was wrong on this site (fixed art
# + screen blends + backdrop-filter glass + gradients): it scored a cream app
# mock as dark plum and white body copy as failing. This renders each page
# twice per scroll position — once normally, once with every glyph made
# transparent — and samples the second frame behind each line of text, so the
# measured backdrop is what the reader actually sees.
# Skip with DEPLOY_SKIP_CONTRAST_AUDIT=1.
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# DARK-SURFACE GATE (2026-08-25) — the site is light, site-wide.
# ---------------------------------------------------------------------------
# Static, colour-based companion to the contrast gate. The light conversion
# shipped three times looking finished while a whole FAMILY of surface stayed
# dark — tokens, then gradient canvases, then dialog/panel neutrals, then the
# pages built inside Pages Functions that no file sweep touches. This checks
# by COLOUR rather than by name, so a dark ground fails wherever it is written
# and in whatever syntax. See SYSTEM_MAP §8.0.0.
# ---------------------------------------------------------------------------
# PATIENT-JOURNEY GATE (2026-08-25)
# ---------------------------------------------------------------------------
# audit_route_render.py proves a route LOADS. It cannot tell you whether a
# patient can get from one step to the next: a contact modal that opens onto
# no email, a portal door that dead-ends instead of offering sign-in, an
# education index whose cards link nowhere — each renders perfectly and passes
# a render check while the journey is broken. This walks the path and asserts
# what a patient must be able to DO at each step. Public surfaces only, so it
# needs no credentials.
# ---------------------------------------------------------------------------
# CITATION EVIDENCE GATE (2026-08-25)
# ---------------------------------------------------------------------------
# verify_citations.mjs proves each PMID resolves to the paper the tooltip
# names (esummary: author, title, year). This proves the FIGURES: every
# claim carrying a number is checked against the paper's own abstract, held
# in scripts/pubmed_corpus.json.
#
# It blocks on one thing only — a cited PMID with no abstract in the corpus.
# That has to block, because verification would otherwise skip it and report
# FEWER findings, which reads exactly like progress. The unsupported figures
# themselves are advisory: choosing what supports a medical claim is a
# clinician's judgement, and a gate that blocks on 87 of those is a gate
# everyone learns to skip.
#
# Offline and deterministic by construction: same tree, same result. Refresh
# the corpus deliberately with --refresh and commit the diff.
if [ -f scripts/cite_verify_pubmed.mjs ]; then
    echo ""
    echo "🔍 Citation evidence gate — every figure against the paper's own abstract..."
    if node scripts/cite_verify_pubmed.mjs > /tmp/_cite_evidence.log 2>&1; then
        tail -4 /tmp/_cite_evidence.log
        echo "   ✅ citation evidence gate passed"
    else
        cat /tmp/_cite_evidence.log
        echo ""
        echo "   Full log: /tmp/_cite_evidence.log"
        exit 1
    fi
fi

if [ -f scripts/audit_patient_journey.py ]; then
    echo ""
    echo "🔍 Patient-journey gate — the path a patient is invited onto, walked..."
    if python3 scripts/audit_patient_journey.py https://mountzara.com > /tmp/_patient_journey.log 2>&1; then
        tail -1 /tmp/_patient_journey.log
        echo "   ✅ patient-journey gate passed"
    else
        cat /tmp/_patient_journey.log
        echo ""
        echo "   Full log: /tmp/_patient_journey.log"
        exit 1
    fi
fi

if [ -f scripts/audit_dark_surfaces.py ]; then
    echo ""
    echo "🔍 Dark-surface gate — no dark grounds outside brand violets and scrims..."
    if python3 scripts/audit_dark_surfaces.py > /tmp/_dark_surfaces.log 2>&1; then
        tail -1 /tmp/_dark_surfaces.log
        echo "   ✅ dark-surface gate passed"
    else
        cat /tmp/_dark_surfaces.log
        echo ""
        echo "   Full log: /tmp/_dark_surfaces.log"
        exit 1
    fi
fi

# ---------------------------------------------------------------------------
# REF-POPOVER GATE (2026-09-01) — every citation popover carries its content.
# ---------------------------------------------------------------------------
# The owner's standing rule: hovering an inline citation shows the paper's
# title, PMID and the curated plain-language summary — on education guides,
# evidence briefs, trending posts, and every modal they open. 826 education
# popovers shipped as bare one-liners and no gate noticed. The RULES live in
# ONE place — functions/_lib/post_format.js (auditPopoverSurface), the same
# module the production publish gate runs — per the owner's 2026-09-01
# directive that popover requirements apply uniformly site-wide from a
# single source. This script is only the walker: it derives the surfaces
# (education pages from the tree, posts from the live API — a scan that
# covers zero posts FAILS, it does not pass) and checks every popover
# against the committed PubMed corpus (structure, sourced summaries, no
# abstract dumps, metadata faithful to PubMed). Summaries that don't exist
# yet are advisory: writing "what a paper shows" is clinical content for
# the owner, not something a gate may author to silence itself.
if [ -f scripts/audit_ref_popovers.mjs ]; then
    echo ""
    echo "🔍 Ref-popover gate — every citation hover carries title, PMID, summary..."
    if node scripts/audit_ref_popovers.mjs > /tmp/_ref_popovers.log 2>&1; then
        tail -2 /tmp/_ref_popovers.log
        echo "   ✅ ref-popover gate passed"
    else
        cat /tmp/_ref_popovers.log
        echo ""
        echo "   Full log: /tmp/_ref_popovers.log"
        exit 1
    fi
fi

# ---------------------------------------------------------------------------
# NO-DOSING GATE (2026-09-01) — owner directive: no dosing in counseling prose.
# ---------------------------------------------------------------------------
# "I NEVER want you to post actual dosing and things that really should be
# reserved for private patient-doctor decisions about management." Counseling
# prose is dose-free everywhere; text attributed to a specific paper (verbatim
# abstracts, deep-dive analyses, cite cards, popovers, ref-list entries) is
# research reporting and keeps the study's own facts. Also enforces the
# standing medico-legal disclaimer (mz-eddisclaimer) on every educational
# surface. Surfaces derived (tree + posts API, fails loud). Worker twin:
# auditDosingLanguage in functions/_lib/post_format.js.
if [ -f scripts/audit_no_dosing.py ]; then
    echo ""
    echo "🔍 No-dosing gate — counseling prose dose-free, disclaimers present..."
    if python3 scripts/audit_no_dosing.py > /tmp/_no_dosing.log 2>&1; then
        tail -1 /tmp/_no_dosing.log
        echo "   ✅ no-dosing gate passed"
    else
        cat /tmp/_no_dosing.log
        echo ""
        echo "   Full log: /tmp/_no_dosing.log"
        exit 1
    fi
fi

# ---------------------------------------------------------------------------
# PAGE-CANVAS GATE (2026-09-01) — every route's ground is opaque paper.
# ---------------------------------------------------------------------------
# The light conversion left html/body TRANSPARENT on most routes (only tint
# gradients painted), so the ground became the visitor's browser canvas —
# grey in dark-mode Safari; the owner saw "an ugly grey". Runtime check over
# every derived route: the document must compute an OPAQUE paper-family
# ground. fix_page_canvas.py appends the guard style; this proves the
# rendered result.
if [ -f scripts/audit_page_canvas.py ]; then
    echo ""
    echo "🔍 Page-canvas gate — every route grounds on opaque paper..."
    if python3 scripts/audit_page_canvas.py https://mountzara.com > /tmp/_page_canvas.log 2>&1; then
        tail -1 /tmp/_page_canvas.log
        echo "   ✅ page-canvas gate passed"
    else
        cat /tmp/_page_canvas.log
        echo ""
        echo "   Full log: /tmp/_page_canvas.log"
        exit 1
    fi
fi

# ---------------------------------------------------------------------------
# LIGHT-TEXT GATE (2026-08-25) — no text the same brightness as its ground.
# ---------------------------------------------------------------------------
# Runtime companion to the dark-surface gate, and the one that covers BREADTH.
# audit_contrast_pixels.py is more rigorous but slow enough that it only ever
# ran over nine routes; the light conversion broke text on eighty. This does
# one paint per route with modals forced open, so "is any text invisible
# anywhere on the site" is answerable on every deploy. It skips text over a
# photograph (the /about/ cover) and text on violet buttons.
if [ -f scripts/audit_light_text.py ]; then
    echo ""
    echo "🔍 Light-text gate — no text matching its own ground, incl. modals..."
    if python3 scripts/audit_light_text.py https://mountzara.com > /tmp/_light_text.log 2>&1; then
        tail -1 /tmp/_light_text.log
        echo "   ✅ light-text gate passed"
    else
        cat /tmp/_light_text.log
        echo ""
        echo "   Full log: /tmp/_light_text.log"
        exit 1
    fi
fi

if [ -z "${DEPLOY_SKIP_CONTRAST_AUDIT:-}" ] && [ -f scripts/audit_contrast_pixels.py ]; then
    echo ""
    echo "🔍 Contrast gate — WCAG ratios measured from rendered pixels..."
    if python3 scripts/audit_contrast_pixels.py https://mountzara.com --open-modals > /tmp/_contrast_audit.log 2>&1; then
        tail -1 /tmp/_contrast_audit.log
        echo "   ✅ contrast gate passed"
    else
        echo ""
        # The audit exits non-zero for two different reasons: real failing
        # ratios, and pages it could not measure (load error, engine crash
        # mid-capture). Both must block — a gate that saw no pixels has
        # proved nothing — but naming the wrong one sends the next person
        # hunting a colour bug that does not exist. 2026-08-20: a WebKit
        # "Target crashed" was reported here as "does not meet WCAG".
        if grep -qE 'CAPTURE CRASHED|never loaded|NOTHING was measured' /tmp/_contrast_audit.log; then
            echo "🛑 CONTRAST GATE COULD NOT MEASURE THE SITE — this is not a"
            echo "   contrast verdict; the engine failed to capture some pages:"
            grep -E 'CAPTURE CRASHED|never loaded|NOTHING was measured' /tmp/_contrast_audit.log | head -10
        else
            echo "🛑 CONTRAST GATE FAILED — text on this site does not meet WCAG"
            echo "   4.5:1 (3:1 for large text) against its real painted backdrop:"
        fi
        grep -E '✗|:1 \(need' /tmp/_contrast_audit.log | head -20
        echo ""
        echo "   Full log: /tmp/_contrast_audit.log"
        echo "   Override: DEPLOY_SKIP_CONTRAST_AUDIT=1 ./scripts/deploy-prod.sh '<reason>'"
        exit 1
    fi
fi

# ---------------------------------------------------------------------------
# Video-source playability gate (2026-07-22). The visual audit's Chromium
# cannot decode H.264, so reel autoplay was "codec-skipped" = NOT verified.
# This validates every homepage <source> at the FILE level on live: 200,
# video type, faststart moov, and a real ffmpeg decode of the first frames.
# Skip with DEPLOY_SKIP_VIDEO_SRC_AUDIT=1.
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Nav + reading-sheet gate (2026-08-20)
# ---------------------------------------------------------------------------
# Added after a nav consolidation shipped with `.mobile-toggle{display:none}`
# as the LAST rule for that selector. The hamburger was invisible at every
# width and there was NO navigation below 1180px. Every other gate passed —
# fact-sync, contrast, visual, route-render, public headers, the lot —
# because not one of them asks whether a person can reach the menu.
#
# It also covers the reading sheet, whose entire value is typographic: a
# silent fallback to card sizing leaves the feature apparently working while
# defeating its purpose.
#
# WebKit, not Chromium: this VM's proxy resets Chromium connections (the
# same note is in audit_visual_runtime.py). A transport failure reports
# UNJUDGEABLE and exits 0 — proving the site is reachable is the canary's
# job, and blocking every deploy on a proxy quirk would make this useless.
# Skip with DEPLOY_SKIP_NAV_AUDIT=1.
# ---------------------------------------------------------------------------
if [ -z "${DEPLOY_SKIP_NAV_AUDIT:-}" ] && command -v python3 >/dev/null 2>&1 && [ -f scripts/audit_nav_and_reading.py ]; then
    echo ""
    echo "🔍 Nav + reading-sheet gate — menu reachable, sheet typography intact..."
    if python3 scripts/audit_nav_and_reading.py "https://mountzara.com/" > /tmp/_nav_read.log 2>&1; then
        tail -2 /tmp/_nav_read.log
        echo "   ✅ nav + reading-sheet gate passed"
    else
        echo ""
        echo "🛑 NAV / READING-SHEET GATE FAILED — the live site's navigation or"
        echo "   reading sheet is broken:"
        grep -E '✗|FAILED' /tmp/_nav_read.log | head -12
        echo "   Override: DEPLOY_SKIP_NAV_AUDIT=1 ./scripts/deploy-prod.sh '<reason>'"
        exit 1
    fi
fi

if [ -z "${DEPLOY_SKIP_VIDEO_SRC_AUDIT:-}" ] && command -v node >/dev/null 2>&1 && [ -f scripts/audit_video_sources.mjs ]; then
    echo ""
    echo "🔍 Video-source gate — every reel URL playable at file level..."
    if node scripts/audit_video_sources.mjs > /tmp/_video_src_audit.log 2>&1; then
        tail -1 /tmp/_video_src_audit.log
        echo "   ✅ video-source gate passed"
    else
        echo ""
        echo "🛑 VIDEO-SOURCE GATE FAILED — a reel the homepage references is"
        echo "   missing, mis-typed, not faststart, or undecodable:"
        grep -E '✗' /tmp/_video_src_audit.log | head -10
        echo "   Override: DEPLOY_SKIP_VIDEO_SRC_AUDIT=1 ./scripts/deploy-prod.sh '<reason>'"
        exit 1
    fi
fi
