#!/bin/bash
# =====================================================================
# scripts/deploy-phase8-phase9.sh
# =====================================================================
# Deploys the Phase 8 (billing pipeline) + Phase 9 (patient snapshot +
# bidirectional sync) work. Per CLAUDE.md §9.8 standing authorization.
#
#  1. Resolves CLOUDFLARE_API_TOKEN from env → macOS Keychain →
#     wrangler's own OAuth session (in that order).
#  2. Parallel-session check per §9.8.2 — fetches origin + lists the
#     last 5 Pages deployments so we can detect anything that landed
#     between sessions.
#  3. Applies schema/0006_phase8_billing.sql + 0007_phase9_snapshots.sql
#     to D1 mountzara-clinical. Idempotent — safe to re-run.
#  4. Deploys Pages from the current working tree.
#  5. HEAD-checks the new admin surfaces to confirm they're live
#     (expects 401 Basic Auth challenge — proves middleware is active).
#  6. Commits the staged changes with a descriptive message and pushes
#     the active branch.
#
# Run from anywhere — the script cd's to the repo itself.
# =====================================================================

set -euo pipefail
export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin
export TERM=dumb

REPO="$HOME/Developer/MountZara/MIGS"
PROJECT="mountzara"
DB="mountzara-clinical"
BRANCH="$(cd "$REPO" && git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"

cd "$REPO"

echo "==> repo: $REPO"
echo "==> branch: $BRANCH"

# ---- 1. Resolve API token ------------------------------------------------
TOKEN="${CLOUDFLARE_API_TOKEN:-}"
if [ -z "$TOKEN" ]; then
  TOKEN=$(security find-generic-password -s 'mountzara-cloudflare-deploy-token' -w 2>/dev/null || true)
  if [ -n "$TOKEN" ]; then
    echo "==> token loaded from Keychain (len=${#TOKEN})"
    export CLOUDFLARE_API_TOKEN="$TOKEN"
  fi
fi
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  if [ -d "$HOME/.wrangler/config" ] || [ -f "$HOME/Library/Preferences/.wrangler/config/default.toml" ]; then
    echo "==> no API token in env or Keychain — falling back to wrangler OAuth session"
  else
    echo "FAIL: no CLOUDFLARE_API_TOKEN in env, no 'mountzara-cloudflare-deploy-token' in Keychain,"
    echo "       and no wrangler OAuth session found."
    echo ""
    echo "Fix: either"
    echo "  security add-generic-password -s 'mountzara-cloudflare-deploy-token' \\"
    echo "      -a \"\$USER\" -w '<paste-Cloudflare-Claude-Admin-token>' -U"
    echo "  (re-run this script)"
    echo "OR"
    echo "  npx wrangler@latest login"
    echo "  (complete the OAuth flow, then re-run this script)"
    exit 1
  fi
fi

# ---- 2. Parallel-session check (§9.8.2) ----------------------------------
echo ""
echo "==> §9.8.2 parallel-session check"
git fetch origin 2>&1 | sed 's/^/    /'
echo "    git status:"
git status -sb | sed 's/^/      /'
echo ""
echo "    last 5 Cloudflare Pages deployments:"
npx wrangler@latest pages deployment list --project-name="$PROJECT" 2>/dev/null \
  | head -8 | sed 's/^/      /'
echo ""

# ---- 3. Apply schema migrations ------------------------------------------
echo "==> applying schema/0006_phase8_billing.sql to remote D1 ($DB)"
npx wrangler@latest d1 execute "$DB" --remote --file=schema/0006_phase8_billing.sql \
  2>&1 | tail -20 | sed 's/^/    /'

echo ""
echo "==> applying schema/0007_phase9_snapshots.sql to remote D1 ($DB)"
npx wrangler@latest d1 execute "$DB" --remote --file=schema/0007_phase9_snapshots.sql \
  2>&1 | tail -20 | sed 's/^/    /'

# ---- 4. Deploy Pages -----------------------------------------------------
echo ""
echo "==> deploying Pages (project=$PROJECT branch=$BRANCH)"
npx wrangler@latest pages deploy . --project-name="$PROJECT" --branch=main --commit-dirty=true \
  2>&1 | tail -25 | sed 's/^/    /'

echo ""
echo "==> waiting 12s for CDN propagation"
sleep 12

# ---- 5. Verify --------------------------------------------------------
echo ""
echo "==> HEAD-check the new admin surfaces (expect 401 = middleware live)"
for path in \
  /admin/billing/ \
  /admin/billing/payers/ \
  /admin/cases/ptn_jane/snapshot/ \
  /api/v1/admin/billing/claims \
  /api/v1/admin/billing/payers \
  /api/v1/admin/snapshots/ptn_jane \
  ; do
  status=$(curl -sS -o /dev/null -w '%{http_code}' -A 'Mozilla/5.0' "https://mountzara.com${path}")
  echo "    $status  https://mountzara.com${path}"
done

echo ""
echo "==> HEAD-check the sync endpoints (expect 401 without Bearer token)"
for path in \
  /api/v1/sync/transcription/coding \
  /api/v1/sync/transcription/snapshot \
  /api/v1/sync/transcription/patients \
  ; do
  status=$(curl -sS -o /dev/null -w '%{http_code}' -X POST -A 'Mozilla/5.0' "https://mountzara.com${path}")
  echo "    $status  POST https://mountzara.com${path}"
done

# ---- 6. Commit + push ----------------------------------------------------
echo ""
echo "==> staging changes for commit"
git add -A
if git diff --cached --quiet; then
  echo "    (no staged changes — repo is clean)"
else
  git diff --cached --stat | sed 's/^/    /'
  cat > .commit_msg.tmp <<'COMMITMSG'
Phase 8 (A+B+C) billing pipeline + Phase 9 (A+B) patient snapshot/EMR

Phase 8 — Insurance billing pipeline (foundation + payer management +
clinician review actions):
- Schema 0006: 8 tables — billing_payers, billing_claims,
  billing_claim_lines, billing_claim_diagnoses,
  billing_compliance_flags, billing_upcoding_opportunities,
  billing_documentation_suggestions, billing_audit_log (7y retention)
- POST /api/v1/sync/transcription/coding — Bearer-authed ingestion of
  the Swift CodingAnalysis payload (E/M, ICD-10s, CPTs, modifiers,
  wRVU, compliance flags, upcoding, doc suggestions, medico-legal
  score, 1995/1997 CMS audit). Idempotent on source_session_id with
  replace-on-pending semantics.
- GET /api/v1/admin/billing/claims (list + filters) and
  /api/v1/admin/billing/claims/[id] (drill-down + audit tail + tally)
- POST /api/v1/admin/billing/claims/[id]/approve (force-flag for
  unresolved errors) and .../reject (with reason)
- PATCH .../flags/[flag_id] (resolve/unresolve)
- PATCH .../upcoding/[op_id] (accept + apply-to-line; auto-bumps
  em_code + re-sums totals when targeting the E/M line)
- PATCH .../doc-suggestions/[sugg_id] (apply/unapply)
- GET/POST /api/v1/admin/billing/payers and
  GET/PATCH/DELETE /api/v1/admin/billing/payers/[id] (DELETE blocks
  on existing claims)
- admin/billing/index.html — claim queue SPA with action bar
  (Approve/Reject), inline resolve/accept/apply buttons on each
  flag/upcoding/doc suggestion, medico-legal SVG gauge
- admin/billing/payers/index.html — payer CRUD SPA with modal form,
  rate-schedule JSON editor, Apple-glass purple design
- admin/_nav.js — added "Billing" link
- docs/BILLING_PIPELINE.md — architecture, 11-state status machine,
  endpoint contracts, Availity-primary / Office-Ally-fallback vendor
  strategy, Round B–G roadmap

Phase 9 — Patient AI snapshot + bidirectional context sync:
- Schema 0007: 8 tables — patient_snapshots (versioned, is_current=1,
  cap 50/patient), snapshot_problem_list, snapshot_diagnostic_trends,
  snapshot_imaging_measurements, snapshot_timeline_events,
  snapshot_action_items, patient_sync_state, patient_dirty_flag
- POST /api/v1/sync/transcription/snapshot — App→Website
  PatientProgressSummary push, versioning + archive-prior, dedup via
  source_app_snapshot_id
- GET /api/v1/sync/transcription/patients?since=<ts> — Website→App
  delta cursor list (dirty + new-since-pull union)
- GET /api/v1/sync/transcription/patients/[id]/context — full
  patient bundle for app SOAP/coding/snapshot AI (demographics, 19-
  section intake, 90d symptom diary, active triage, prior encounters,
  current snapshot head, recent claims). Clears dirty flag on pull.
- GET /api/v1/admin/snapshots/[patient_id]?version=<n> — current or
  historical snapshot + every child + supplementary website data
- GET .../history — version list with child counts
- GET .../diff?from=<v>&to=<v> — computed diff (newProblems,
  resolvedProblems, changedStatuses, removedProblems,
  newRecommendations, removedRecommendations, newActionItems,
  imagingDeltas with computed cm delta + summary)
- admin/cases/[id]/snapshot/index.html — EMR-grade SPA per §3.10:
  hero with quick-action pills, 5-card meta strip, clinical
  overview + narrative patient story, problem list with status
  chips, diagnostic-trend cards with numeric sparklines + interp
  tinting, imaging measurements with computed prior-comparison
  deltas, vertical purple-rail timeline, AI recommendations,
  action items color-coded by priority, symptom-diary 30-day
  sparkline grid, engagement summary, appointments, recent
  encounters, recent billing, sync state. Version-switcher pill +
  Compare modal with color-coded diff rendering.
- _redirects — more-specific /admin/cases/*/snapshot/ rewrite ahead
  of the case-detail wildcard
- admin/cases/[id]/index.html — added "AI snapshot →" pill in
  header
- functions/api/v1/patient/intake/[intake_id]/submit.js — wired
  patient_dirty_flag UPSERT on intake submit so the app's next
  pull surfaces the new context
- docs/PATIENT_SNAPSHOT_PIPELINE.md + docs/TRANSCRIPTION_APP_INTEGRATION.md

§3.10 regression audit passes — no homepage / about / nav / global-
style tokens were touched. All changes additive (new files + nav
link append + _redirects more-specific rule + intake-submit dirty-
flag UPSERT + case-detail header pill).
COMMITMSG
  git commit -F .commit_msg.tmp
  rm -f .commit_msg.tmp
  echo ""
  echo "==> pushing to origin/$BRANCH"
  git push origin "$BRANCH" 2>&1 | sed 's/^/    /'
fi

echo ""
echo "==> DONE."
echo ""
echo "    Open these to verify visually:"
echo "    • https://mountzara.com/admin/billing/"
echo "    • https://mountzara.com/admin/billing/payers/"
echo "    • https://mountzara.com/admin/cases/<patient_id>/snapshot/"
