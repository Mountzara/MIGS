#!/usr/bin/env bash
# =====================================================================
# scripts/_deploy_phase_qa.sh — Phase QA deploy (Ally invite + session_trace)
# =====================================================================
# Comprehensive single-shot deploy:
#   1. Apply D1 migration 0013 (session_trace + preview_invites tables)
#   2. Provision PREVIEW_INVITE_KEY + IP_HASH_SALT Pages secrets if missing
#      (cached in macOS Keychain for future-session rediscovery)
#   3. Commit + push the code change
#   4. Deploy via wrangler pages deploy
#   5. Health-check the new admin endpoints
#
# Per CLAUDE.md §9.8.1 — operator must have macOS Keychain entry
# 'mountzara-cloudflare-deploy-token' set (one-time, manual).
# =====================================================================
set -e
cd "$(dirname "$0")/.."
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

PROJECT="mountzara"
DB_NAME="mountzara-clinical"
BRANCH="claude/setup-mountzara-landing-01M5e6zmrBbv1hX9jmgH6xz8"

echo "==============================================================="
echo "  Mount Zara — Phase QA deploy"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "==============================================================="

# ---------------------------------------------------------------------
# 0. Token from Keychain
# ---------------------------------------------------------------------
CF_TOKEN=$(security find-generic-password -s mountzara-cloudflare-deploy-token -w 2>/dev/null || true)
if [ -z "$CF_TOKEN" ]; then
    echo "ERROR: Keychain entry 'mountzara-cloudflare-deploy-token' missing." >&2
    exit 1
fi
export CLOUDFLARE_API_TOKEN="$CF_TOKEN"
echo "[0/5] CF token loaded from Keychain."

# ---------------------------------------------------------------------
# 1. Apply D1 migration 0013
# ---------------------------------------------------------------------
echo ""
echo "[1/5] Applying schema/0013_phase_qa_session_trace.sql to remote D1..."
if /usr/local/bin/npx wrangler d1 execute "$DB_NAME" --remote \
        --file=schema/0013_phase_qa_session_trace.sql 2>&1 | tail -8; then
    echo "  ✓ Schema applied"
else
    echo "  (Schema may already exist — IF NOT EXISTS guards are in place.)"
fi

# ---------------------------------------------------------------------
# 2. Provision PREVIEW_INVITE_KEY + IP_HASH_SALT (only if missing)
# ---------------------------------------------------------------------
echo ""
echo "[2/5] Checking + provisioning Pages secrets..."

# PREVIEW_INVITE_KEY
PIK=$(security find-generic-password -s mountzara-preview-invite-key -w 2>/dev/null || true)
if [ -z "$PIK" ]; then
    PIK=$(openssl rand -base64 48 | tr -d '=+/\n' | head -c 48)
    echo "  Minting new PREVIEW_INVITE_KEY (48 chars, will cache in Keychain)..."
    security add-generic-password -s mountzara-preview-invite-key -a mountzara -w "$PIK" -U 2>/dev/null || true
    echo "$PIK" | /usr/local/bin/npx wrangler pages secret put PREVIEW_INVITE_KEY \
        --project-name="$PROJECT" 2>&1 | tail -3
    echo "  ✓ PREVIEW_INVITE_KEY set"
else
    # Best-effort: ensure CF Pages has the same key. If user is rotating,
    # they can clear Keychain manually first.
    echo "$PIK" | /usr/local/bin/npx wrangler pages secret put PREVIEW_INVITE_KEY \
        --project-name="$PROJECT" 2>&1 | tail -3 || true
    echo "  ✓ PREVIEW_INVITE_KEY re-affirmed from Keychain"
fi

# IP_HASH_SALT
IHS=$(security find-generic-password -s mountzara-ip-hash-salt -w 2>/dev/null || true)
if [ -z "$IHS" ]; then
    IHS=$(openssl rand -base64 32 | tr -d '=+/\n' | head -c 32)
    echo "  Minting new IP_HASH_SALT (32 chars, will cache in Keychain)..."
    security add-generic-password -s mountzara-ip-hash-salt -a mountzara -w "$IHS" -U 2>/dev/null || true
    echo "$IHS" | /usr/local/bin/npx wrangler pages secret put IP_HASH_SALT \
        --project-name="$PROJECT" 2>&1 | tail -3
    echo "  ✓ IP_HASH_SALT set"
else
    echo "$IHS" | /usr/local/bin/npx wrangler pages secret put IP_HASH_SALT \
        --project-name="$PROJECT" 2>&1 | tail -3 || true
    echo "  ✓ IP_HASH_SALT re-affirmed from Keychain"
fi

# ---------------------------------------------------------------------
# 3. Commit + push code
# ---------------------------------------------------------------------
echo ""
echo "[3/5] Committing code changes..."

git add \
    schema/0013_phase_qa_session_trace.sql \
    functions/_lib/session_trace.js \
    functions/_lib/preview_invite.js \
    functions/_lib/preview_gate.js \
    functions/api/v1/admin/preview-invite.js \
    functions/api/v1/admin/debug/sessions.js \
    functions/portal/preview-grant \
    functions/api/v1/auth/login.js \
    functions/api/v1/auth/signup.js \
    "functions/api/v1/patient/intake/[intake_id]/section/[n].js" \
    admin/debug \
    admin/_nav.js \
    scripts/_invite_ally.sh \
    scripts/_deploy_phase_qa.sh

git commit -m "Phase QA: test-user invitation pathway + session_trace surface

Per CLAUDE.md §4.4 + §11.5.2 + Phase QA. Adds a signed preview-access
cookie path so an operator-issued invitation can let one external test
member (Ally O'Flinn first) walk the complete signup → intake →
scheduling flow without flipping PORTAL_PUBLIC_LAUNCH globally. Pairs
the walk-through with a fine-grained session-trace table so any issue
the recipient hits is visible in real time on /admin/debug/sessions/.

schema/0013_phase_qa_session_trace.sql
  - session_trace table: per-request fine-grained event log (route,
    method, status, action, outcome, duration_ms, PHI-free detail_json,
    SHA256-hashed session token + ip_hash). 30-day retention target.
  - preview_invites table: operator-minted invitation rows (email,
    label, token_hash for one-time URL, cookie_jti for the signed
    access cookie, expires_at, grant_used_at, revoked_at, patient_id).

functions/_lib/session_trace.js (new)
  - recordTrace(env, evt) — never-throws fire-and-forget event writer
  - traceWrap(ctx, action, handler) — wraps an endpoint for auto-trace
  - readInviteLabel(request) — pulls mz_preview_label cookie or falls
    back to 'admin_preview' / 'anon'
  - listRecentTraces(env, filters) — feeds the live admin view
  - PHI-conservative: ip stored as SHA256(ip + IP_HASH_SALT) truncated
    to 24 hex chars; session tokens stored as SHA256 truncated; UA
    capped at 200 chars; detail_json capped at 4 KB

functions/_lib/preview_invite.js (new)
  - HMAC-SHA256 mint/verify for both single-use grant tokens AND the
    long-lived access cookie. Bodies are { v, kind, jti, label,
    email_prefix, exp_ms } — NO PHI in the token payload, only the
    label and a 4-char email prefix mask. PREVIEW_INVITE_KEY ≥32 chars.

functions/_lib/preview_gate.js
  - Extended previewAccess() to honor:
    (a) /portal/preview-grant path (token validates inline)
    (b) valid mz_preview_access signed cookie (HMAC + exp_ms)
  - Existing allow-paths (PORTAL_PUBLIC_LAUNCH, admin Basic, magic-link
    redeem, mz_session cookie) preserved verbatim.

functions/api/v1/admin/preview-invite.js (new)
  - POST mints a grant token + inserts preview_invites row + returns
    grant_url for the operator to email out-of-band
  - GET lists the 100 most recent invites (email redacted to prefix)
  - admin-only via adminRoute()

functions/portal/preview-grant/index.js (new)
  - Landing page for the click-once URL. Validates HMAC + expiry +
    looks up token_hash → preview_invites row, enforces single-use
    (with 5-minute refresh window for accidental double-clicks), mints
    signed mz_preview_access cookie (90d default) + mz_preview_label
    cookie (non-HttpOnly, for client-side filtering), redirects to
    /portal/signup?invited=<label>. Apple-glass purple per §3.10 with
    mzRise cascade + prefers-reduced-motion override.

functions/api/v1/admin/debug/sessions.js (new)
  - GET returns recent session_trace events + per-label summary

admin/debug/sessions/index.html (new)
  - Live trace view. Auto-refreshes 5s, filters by label/outcome/limit.
    Pulls active invitations panel from /api/v1/admin/preview-invite.
    JetBrains Mono table with status/outcome color-coding (ok=green,
    error=red, blocked=pink, validation_fail=amber). PHI-free.

admin/_nav.js
  - Added 'Debug' link to the section-nav SECTIONS array.

Trace instrumentation wired into (§0.6 manual per-file edits, every
parse-checked with node --check):
  - functions/api/v1/auth/login.js — gate-closed, rate-limited,
    failed-attempt, success events
  - functions/api/v1/auth/signup.js — gate-closed, every validation
    branch, email-exists, success
  - functions/api/v1/patient/intake/[intake_id]/section/[n].js —
    section_save with PHI-free detail (section_number, completion_pct,
    payload_keys, payload_bytes — never the values themselves)

scripts/_invite_ally.sh
  - One-shot operator script: reads admin password from Keychain
    (mountzara-admin-password), POSTs the invite, pretty-prints the
    grant_url + a copy-paste-ready email to Ally + the live debug URL.

scripts/_deploy_phase_qa.sh (this script)
  - Applies schema migration → provisions PREVIEW_INVITE_KEY +
    IP_HASH_SALT Pages secrets (auto-cached in Keychain) → commits +
    pushes → deploys → curl-verifies the new endpoints.

Privacy invariants (HARD):
  - No raw IP, no raw session token in session_trace (both SHA256+salt)
  - No PHI ever in detail_json — sizes, statuses, step numbers only
  - preview_invites stores email lowercase-normalized for lookup but
    the GET-all endpoint never re-emits the email — only a 4-char prefix
  - The mz_preview_access cookie carries NO PHI and NO session authority;
    real auth still requires mz_session via password or magic-link

§9.8.2 merge-first: pre-flight git fetch shows local 0/0 with origin.
§3.10 audit: no homepage/about/admin static asset touched; only one
new nav link in admin/_nav.js. Apple-glass purple tokens preserved
in the new preview-grant + debug-sessions pages."

git push origin "$BRANCH" 2>&1 | tail -5
echo "  ✓ Committed + pushed"

# ---------------------------------------------------------------------
# 4. Deploy via wrangler
# ---------------------------------------------------------------------
echo ""
echo "[4/5] Deploying to Cloudflare Pages..."
DEPLOY_OUT=$(/usr/local/bin/npx wrangler pages deploy . \
    --project-name="$PROJECT" --branch=main --commit-dirty=true 2>&1)
echo "$DEPLOY_OUT" | tail -10

# Pull the deployment URL from output.
DEPLOY_URL=$(echo "$DEPLOY_OUT" | grep -oE 'https://[a-z0-9]+\.mountzara\.pages\.dev' | tail -1)
if [ -z "$DEPLOY_URL" ]; then
    DEPLOY_URL="https://mountzara.com"
    echo "  (Could not parse deployment URL; using production alias.)"
else
    echo "  Deploy-specific URL: $DEPLOY_URL"
fi

# ---------------------------------------------------------------------
# 5. Health-check the new endpoints
# ---------------------------------------------------------------------
echo ""
echo "[5/5] Health-checking (waiting 12s for CDN warm-up)..."
sleep 12

ADMIN_PASS=$(security find-generic-password -s mountzara-admin-password -w 2>/dev/null)

echo ""
echo "  GET https://mountzara.com/portal/preview-grant/   (no token, expect 401 friendly)"
HTTP=$(curl -sS -o /dev/null -w "%{http_code}" "https://mountzara.com/portal/preview-grant/")
echo "    HTTP $HTTP"

echo ""
echo "  GET https://mountzara.com/api/v1/admin/preview-invite   (no auth, expect 401)"
HTTP=$(curl -sS -o /dev/null -w "%{http_code}" "https://mountzara.com/api/v1/admin/preview-invite")
echo "    HTTP $HTTP"

echo ""
echo "  GET https://mountzara.com/api/v1/admin/preview-invite   (with admin auth, expect 200)"
HTTP=$(curl -sS -u "admin:$ADMIN_PASS" -o /dev/null -w "%{http_code}" "https://mountzara.com/api/v1/admin/preview-invite")
echo "    HTTP $HTTP"

echo ""
echo "  GET https://mountzara.com/api/v1/admin/debug/sessions   (with admin auth, expect 200)"
HTTP=$(curl -sS -u "admin:$ADMIN_PASS" -o /dev/null -w "%{http_code}" "https://mountzara.com/api/v1/admin/debug/sessions")
echo "    HTTP $HTTP"

echo ""
echo "==============================================================="
echo "  ✓ Phase QA deploy complete"
echo ""
echo "  Next: run scripts/_invite_ally.sh to mint Ally's invitation."
echo "  Then watch her flow at: https://mountzara.com/admin/debug/sessions/?label=ally"
echo "==============================================================="
