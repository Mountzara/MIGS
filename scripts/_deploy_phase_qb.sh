#!/usr/bin/env bash
# =====================================================================
# scripts/_deploy_phase_qb.sh — Phase QB deploy
# Beta-tester feedback pipeline (capture + AI-rec review + approve)
# =====================================================================
set -e
cd "$(dirname "$0")/.."
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

PROJECT="mountzara"
DB_NAME="mountzara-clinical"
BRANCH="claude/setup-mountzara-landing-01M5e6zmrBbv1hX9jmgH6xz8"

echo "==============================================================="
echo "  Mount Zara — Phase QB deploy  $(date '+%Y-%m-%d %H:%M:%S')"
echo "==============================================================="

# 0. CF token
CF_TOKEN=$(security find-generic-password -s mountzara-cloudflare-deploy-token -w 2>/dev/null || true)
[ -z "$CF_TOKEN" ] && { echo "ERROR: no CF token in Keychain"; exit 1; }
export CLOUDFLARE_API_TOKEN="$CF_TOKEN"
echo "[0/4] CF token loaded."

# 1. Apply D1 migration 0014
echo ""
echo "[1/4] Applying schema/0014_phase_qb_feedback.sql to remote D1..."
/usr/local/bin/npx wrangler d1 execute "$DB_NAME" --remote \
    --file=schema/0014_phase_qb_feedback.sql 2>&1 | tail -8

# 2. Commit + push
echo ""
echo "[2/4] Commit + push..."
git add \
    schema/0014_phase_qb_feedback.sql \
    functions/_lib/auth.js \
    functions/api/v1/patient/feedback.js \
    functions/api/v1/admin/feedback \
    functions/portal/_middleware.js \
    portal/_feedback.js \
    admin/feedback \
    admin/_nav.js \
    scripts/_feedback_queue.sh \
    scripts/_deploy_phase_qb.sh

git commit -m "Phase QB: beta-tester feedback capture + AI rec pipeline

Per user directive 2026-05-19 (\"add a feature for beta testers like Ally —
in the entire portal, provide easy convenient areas to add feedback —
once feedback is received, please process this feedback with claude to
create recommendations on changes to the website that I can approve in
another admin page for user feedback recs and improvement pipeline
that is automated and done via AI when I'm back on claude cowork\"):

Floating purple/glass 'Feedback' button on every /portal/* page (injected
into HTML responses via portal/_middleware.js HTMLRewriter — single point
of control, no per-SPA edits). Click opens a modal with type chips (bug
/ confusing / suggestion / praise / other) + severity chips (blocker /
annoying / nice-to-have) + 4 KB free-text + optional getDisplayMedia()
screenshot capture. POSTs to /api/v1/patient/feedback. Works for both
authenticated patients (mz_session) AND preview-cookie holders pre-signup
(Ally before she completes signup).

Submissions land in D1 member_feedback (status='new'). When the operator
brings me back to a Cowork session and says 'run the feedback queue', I
fetch via scripts/_feedback_queue.sh, read each row, propose a structured
recommendation (summary / root_cause / proposed_change / files_to_edit /
severity / effort / rationale / confidence), and PATCH it back via
/api/v1/admin/feedback/<id>. Row auto-bumps to status='ai_analyzed'.

Operator reviews on /admin/feedback/ — Apple-glass purple cards showing
original feedback + screenshot preview + AI rec dl + Approve / Reject /
Won't-fix buttons. Approve → status='approved' → enters my Cowork
implementation queue. Reject / wont_fix captures operator reason in
audit-event timeline. PHI-conservative throughout: comment_text is
patient-volunteered (kept verbatim, 4 KB cap); never reads form values
off the page; ip stored as SHA256+salt via session_trace; screenshot
envelope-encrypted to mountzara-phi with per-record DEK wrapped by
PHI_MASTER_KEY (same pattern as patient photos).

schema/0014_phase_qb_feedback.sql
  - member_feedback (patient_id nullable for pre-signup, route,
    viewport, type, severity, comment_text 4 KB, screenshot_r2_key,
    screenshot_wrapped_dek, ai_recommendation_json, status: new ->
    ai_analyzed -> approved -> implemented, plus rejected / wont_fix)
  - feedback_audit_events (per-state-transition timeline for admin UI)

functions/_lib/auth.js  +requireRoleOptional()  — soft-resolves an
mz_session without throwing 401 when absent. Used by the feedback
endpoint to attribute submissions to a real patient_id when one exists.

functions/api/v1/patient/feedback.js (new) — POST handler. Validates
type/severity/comment, envelope-encrypts screenshot to mountzara-phi
with AAD scoped to the timestamp, inserts row + audit-event +
audit_log + session_trace.

functions/api/v1/admin/feedback/index.js (new) — GET list w/ status
+ type + label + route filters; per-status summary.

functions/api/v1/admin/feedback/[id].js (new) — GET detail + audit
timeline; PATCH writes ai_recommendation_json (Cowork-side).

functions/api/v1/admin/feedback/[id]/approve.js (new) — approve rec.
functions/api/v1/admin/feedback/[id]/reject.js (new) — reject / won't_fix.
functions/api/v1/admin/feedback/[id]/screenshot.js (new) — decrypt +
serve image (admin only).

portal/_feedback.js (new) — the floating launcher + modal. Apple-glass
purple gradient launcher (#a78bfa -> #6d28d9 with backdrop-filter blur).
Modal uses mzRise on open, Escape closes, outside-click closes, focus
trap on first chip, body scroll-lock while open, @media prefers-reduced-
motion override. Screenshot capture uses getDisplayMedia({preferCurrentTab})
+ ImageCapture.grabFrame() -> canvas.toDataURL('image/png'). Never reads
form values off the page (privacy invariant).

functions/portal/_middleware.js — extended with HTMLRewriter that
appends '<script async src=/portal/_feedback.js>' to every <body> on
HTML responses. Skips /portal/preview-grant (self-contained handoff).

admin/feedback/index.html (new) — review queue UI. Status summary
chips clickable as filters. Each card: type/severity/status badges
(color-coded), invite_label chip, route chip, two-column body
(tester comment + screenshot preview | AI recommendation dl), action
row with Approve/Reject/Won't-fix. Auto-refresh every 30s. Approve
prompts for optional note; Reject prompts for required reason.

admin/_nav.js — 'Feedback' link added before 'Debug'.

scripts/_feedback_queue.sh (new) — Cowork-side helper. Sources the
admin-auth resolver, fetches the queue, pretty-prints each item with
route/type/severity/comment/recent_traces, saves JSON to
/tmp/_mz_feedback_queue.json so I can iterate-and-PATCH back.

§9.8.2 merge-first: pre-flight 0/0 with origin.
§3.10 audit: no homepage/about/admin static asset altered.
§4.2 / §4.4.4: PHI invariants documented in every file." 2>&1 | tail -6

git push origin "$BRANCH" 2>&1 | tail -3

# 3. Deploy
echo ""
echo "[3/4] Deploying..."
DEPLOY=$(/usr/local/bin/npx wrangler pages deploy . \
    --project-name="$PROJECT" --branch=main --commit-dirty=true 2>&1)
echo "$DEPLOY" | tail -8
DEPLOY_URL=$(echo "$DEPLOY" | grep -oE 'https://[a-z0-9]+\.mountzara\.pages\.dev' | tail -1)

# 4. Smoke-test (use the canonical admin-auth resolver from _lib_admin_auth.sh)
echo ""
echo "[4/4] Smoke-testing (waiting 12s for CDN)..."
sleep 12

source "$(dirname "$0")/_lib_admin_auth.sh"
resolve_admin_auth

echo ""
echo "  GET /api/v1/admin/feedback (admin auth, expect 200 + summary)"
curl -sS -u "$MZ_ADMIN_USER:$MZ_ADMIN_PASS" -o /tmp/_fb_smoke.json \
    -w 'HTTP %{http_code} | size %{size_download}\n' \
    'https://mountzara.com/api/v1/admin/feedback'

echo ""
echo "  POST /api/v1/patient/feedback (no auth, anon, expect 201 — anon-via-preview-cookie OK if PREVIEW gate would normally allow; here we're testing the endpoint itself)"
curl -sS -X POST -H 'content-type: application/json' \
    -o /tmp/_fb_post.json -w 'HTTP %{http_code}\n' \
    -d '{"route":"/portal/test","viewport_width":1440,"viewport_height":900,"feedback_type":"praise","severity":null,"comment_text":"smoke-test from deploy script — kept here as a sanity check"}' \
    'https://mountzara.com/api/v1/patient/feedback' || true

echo ""
echo "  GET /admin/feedback/ (admin auth, expect 200 HTML)"
curl -sS -u "$MZ_ADMIN_USER:$MZ_ADMIN_PASS" -o /dev/null \
    -w 'HTTP %{http_code}\n' 'https://mountzara.com/admin/feedback/'

echo ""
echo "==============================================================="
echo "  ✓ Phase QB deploy complete"
echo "  Review queue:  https://mountzara.com/admin/feedback/"
echo "  Portal widget: floating bottom-right on every /portal/* page"
echo "==============================================================="
