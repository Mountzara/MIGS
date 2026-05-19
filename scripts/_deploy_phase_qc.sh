#!/usr/bin/env bash
# =====================================================================
# scripts/_deploy_phase_qc.sh — onboarding wizard
# =====================================================================
set -e
cd "$(dirname "$0")/.."
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

PROJECT="mountzara"
DB_NAME="mountzara-clinical"
BRANCH="claude/setup-mountzara-landing-01M5e6zmrBbv1hX9jmgH6xz8"

echo "==============================================================="
echo "  Mount Zara — Phase QC deploy  $(date '+%Y-%m-%d %H:%M:%S')"
echo "==============================================================="

CF_TOKEN=$(security find-generic-password -s mountzara-cloudflare-deploy-token -w 2>/dev/null || true)
[ -z "$CF_TOKEN" ] && { echo "ERROR: no CF token"; exit 1; }
export CLOUDFLARE_API_TOKEN="$CF_TOKEN"
echo "[0/4] CF token loaded."

echo ""
echo "[1/4] Applying schema/0015_phase_qc_wizard.sql..."
/usr/local/bin/npx wrangler d1 execute "$DB_NAME" --remote \
    --file=schema/0015_phase_qc_wizard.sql 2>&1 | tail -6

echo ""
echo "[2/4] Commit + push..."
git add \
    schema/0015_phase_qc_wizard.sql \
    functions/_lib/wizard.js \
    functions/api/v1/patient/wizard \
    functions/portal/_middleware.js \
    portal/_wizard.js \
    scripts/_deploy_phase_qc.sh

git commit -m "Phase QC: onboarding wizard with click-to-go modal navigation

Per user directive 2026-05-19: 'a wizard completion tool that will
guide the user in modal popups integration of next steps to take to
complete the user profile from beginning to end, make it VERY
convenient with click to go directly type of navigation in the initial
wizard, with ability to turn wizard on or off at anytime'.

7 canonical steps (profile_basics, photo_and_nickname, care_goals,
intake, appointment, education_ack, symptom_diary) with predicates
that read the live data layer — completion is derived, not stored,
so a step can never be 'stuck complete' if the underlying data was
deleted. Per-step skipped + snoozed-until state is stored in
wizard_state.progress_json so the patient's intent persists across
sessions.

schema/0015_phase_qc_wizard.sql
  - wizard_state (patient_id PK, enabled flag, progress_json with
    per-step skipped/snoozed metadata, started_at, last_opened_at,
    completed_at, snooze_until global, disabled_at)

functions/_lib/wizard.js
  - WIZARD_STEPS catalog (title, blurb, cta_label, cta_route,
    time_estimate). cta_route is the click-to-go-directly target.
  - readWizardState(env, pid) — creates default if absent
  - computeStepStatus(env, pid) — walks patients + intake_responses +
    appointments + patient_education_assignments + symptom_diary_entries
    and returns each step's completed/skipped/snoozed status PLUS
    the auto-derived next_step_key + should_auto_open boolean.
  - patchWizardState(env, pid, mutations) — flip enabled, mark step
    skipped, set per-step or global snooze (capped at 30 days).

functions/api/v1/patient/wizard/state.js
  - GET returns the full state for the rendering widget.
  - PATCH writes mutations. session_trace event on both.

portal/_wizard.js — the widget. Bottom-left purple-conic-gradient
progress ring chip on every /portal/* page that always shows
N/total completion. Opens a modal with two view modes:
  * 'next' — the one-step prompt that auto-opens on /portal/ home
    if there's still work to do and the user hasn't snoozed globally
  * 'all' — the full 7-step checklist. Clicking a not-yet-complete
    row navigates directly to that step's cta_route.
Action row: 'Go now' (primary CTA, hard-navigates), 'Skip this step',
'Remind me later' (24h snooze on that step), 'See all steps',
'Pause wizard' (flips enabled flag — chip turns to 'Wizard paused —
turn back on'). When paused, the chip still shows and a single click
re-opens the modal where the user can turn it back on.

functions/portal/_middleware.js — HTMLRewriter renamed to
PortalScriptInjector; injects BOTH /portal/_feedback.js AND
/portal/_wizard.js before </body> on every HTML response. Single
point of control for both widgets.

§3.10 Apple-glass purple, mzRise pulse, prefers-reduced-motion override,
focus-trap on first primary button, body scroll-lock, Escape closes,
outside-click closes. SKIP_PATHS guard (login/signup/magic-link/
preview-grant) so the widget doesn't try to fetch state before there's
a session." 2>&1 | tail -6

git push origin "$BRANCH" 2>&1 | tail -3

echo ""
echo "[3/4] Deploying..."
/usr/local/bin/npx wrangler pages deploy . \
    --project-name="$PROJECT" --branch=main --commit-dirty=true 2>&1 | tail -8

echo ""
echo "[4/4] Smoke-testing..."
sleep 12

source "$(dirname "$0")/_lib_admin_auth.sh"
resolve_admin_auth

echo "  GET /api/v1/patient/wizard/state (no session, expect 401 or 404)"
curl -sS -o /dev/null -w 'HTTP %{http_code}\n' \
    'https://mountzara.com/api/v1/patient/wizard/state'

echo "  GET /admin/feedback/ (regression — should still work)"
curl -sS -u "$MZ_ADMIN_USER:$MZ_ADMIN_PASS" -o /dev/null -w 'HTTP %{http_code}\n' \
    'https://mountzara.com/admin/feedback/'

echo ""
echo "  Inspect portal HTML — confirm both feedback + wizard script tags are injected"
curl -sS -u "$MZ_ADMIN_USER:$MZ_ADMIN_PASS" 'https://mountzara.com/portal/' | \
    grep -E 'src="/portal/(_feedback|_wizard)\.js"' || echo "WARN: script-tag injection not detected"

echo ""
echo "==============================================================="
echo "  ✓ Phase QC deploy complete"
echo "  Portal pages now auto-inject the wizard chip + auto-open modal on /portal/"
echo "  Wizard state API: /api/v1/patient/wizard/state"
echo "==============================================================="
