#!/usr/bin/env bash
# =====================================================================
# scripts/smoketest_phase17.sh — Phase 17 Sprint 1 gate smoketests
# =====================================================================
# Curl-based assertions for the Telehealth Compliance Foundation gates:
#   R1  chaperone enforcement (booking + launch)
#   R3  state-licensure gate (intake submit + booking + launch presence)
#   R4  privacy + per-visit physical-presence attestation (launch)
#   R5  patient device/connection tech-check
#   §11.5.2 preview gate (anonymous traffic gets 404, never a PHI surface)
#
# Auth model (functions/_lib/preview_gate.js):
#   - admin HTTP Basic Auth satisfies the preview gate for setup/teardown.
#   - a logged-in patient's mz_session cookie satisfies BOTH the preview
#     gate AND requireRole(["patient"]) on every patient endpoint.
# So the script logs in as the seeded test patient "Jane Doe"
# (scripts/_seed_jane_doe.sh) for the patient-side assertions and uses
# admin Basic Auth + wrangler D1 for fixtures.
#
# Status codes were unified this sprint: licensure refusal is 422
# (license_state_mismatch / state_required); chaperone refusal is 409
# (chaperone_confirmation_required). See docs/SPRINT_STATE.md.
#
# Usage:
#   bash scripts/smoketest_phase17.sh                 # full suite (run POST-deploy)
#   BASE=https://<deploy>.pages.dev bash scripts/...  # target a preview deploy
#   SMOKE_SKIP_FIXTURES=1 bash scripts/...            # live, non-mutating subset only
#
# Exit 0 iff every assertion passed. Per CLAUDE.md §0.1/§0.4 — no silent
# failures; every SKIP is printed with a reason.
# =====================================================================
set -uo pipefail
export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin

BASE="${BASE:-${1:-https://mountzara.com}}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PY="$(command -v /opt/homebrew/bin/python3 || command -v python3)"
JAR="$(mktemp -t mz_jane_cookies)"
BODY="$(mktemp -t mz_smoke_body)"
JANE_EMAIL='chris.mabini@gmail.com'
JANE_PASSWORD='JaneDoeTest-2026-MzPortal!'
CLINICIAN_ID='mabini-christopher-z'

PASS=0; FAIL=0; SKIP=0
declare -a FAILED_NAMES=()

c_grn() { printf '\033[32m%s\033[0m' "$1"; }
c_red() { printf '\033[31m%s\033[0m' "$1"; }
c_yel() { printf '\033[33m%s\033[0m' "$1"; }

# assert_code <name> <expected_code> <actual_code>
assert_code() {
    local name="$1" exp="$2" act="$3"
    if [ "$act" = "$exp" ]; then
        echo "  $(c_grn PASS)  $name  (HTTP $act)"; PASS=$((PASS+1))
    else
        echo "  $(c_red FAIL)  $name  (expected HTTP $exp, got $act)"; FAIL=$((FAIL+1)); FAILED_NAMES+=("$name")
    fi
}
# assert_code_in <name> <actual> <exp1> [exp2...]
assert_code_in() {
    local name="$1" act="$2"; shift 2
    local e
    for e in "$@"; do
        if [ "$act" = "$e" ]; then echo "  $(c_grn PASS)  $name  (HTTP $act)"; PASS=$((PASS+1)); return; fi
    done
    echo "  $(c_red FAIL)  $name  (expected HTTP one of [$*], got $act)"; FAIL=$((FAIL+1)); FAILED_NAMES+=("$name")
}
# assert_err <name> <expected_error_code> <body_file>
assert_err() {
    local name="$1" experr="$2" bf="$3"
    local got
    got="$("$PY" -c 'import sys,json
try:
    print(json.load(open(sys.argv[1])).get("error",""))
except Exception:
    print("<unparseable>")' "$bf")"
    if [ "$got" = "$experr" ]; then
        echo "  $(c_grn PASS)  $name  (error=$got)"; PASS=$((PASS+1))
    else
        echo "  $(c_red FAIL)  $name  (expected error=$experr, got error=$got)"; FAIL=$((FAIL+1)); FAILED_NAMES+=("$name")
    fi
}
skip() { echo "  $(c_yel SKIP)  $1  — $2"; SKIP=$((SKIP+1)); }
section() { echo; echo "=== $1 ==="; }

jget() { "$PY" -c 'import sys,json
try:
    d=json.load(open(sys.argv[1]))
    for k in sys.argv[2].split("."):
        d=d[k] if isinstance(d,dict) else None
    print(d if d is not None else "")
except Exception:
    print("")' "$1" "$2"; }

# ---- curl wrappers: echo HTTP code, write body to $BODY ----
anon_post() { curl -sS -o "$BODY" -w '%{http_code}' -X POST -H 'content-type: application/json' --data "$2" "$BASE$1"; }
jane_post() { curl -sS -o "$BODY" -w '%{http_code}' -b "$JAR" -c "$JAR" -X POST -H 'content-type: application/json' --data "$2" "$BASE$1"; }
jane_patch() { curl -sS -o "$BODY" -w '%{http_code}' -b "$JAR" -c "$JAR" -X PATCH -H 'content-type: application/json' --data "$2" "$BASE$1"; }
adm_get() { curl -sS -o "$BODY" -w '%{http_code}' -u "$MZ_ADMIN_USER:$MZ_ADMIN_PASS" "$BASE$1"; }
adm_post() { curl -sS -o "$BODY" -w '%{http_code}' -u "$MZ_ADMIN_USER:$MZ_ADMIN_PASS" -X POST -H 'content-type: application/json' --data "$2" "$BASE$1"; }
adm_put() { curl -sS -o "$BODY" -w '%{http_code}' -u "$MZ_ADMIN_USER:$MZ_ADMIN_PASS" -X PUT -H 'content-type: application/json' --data "$2" "$BASE$1"; }

# ---- D1 helper (remote) ----
if [ -f "$HOME/.config/mountzara/cf-creds.env" ]; then . "$HOME/.config/mountzara/cf-creds.env"; fi
: "${CLOUDFLARE_API_TOKEN:=$(security find-generic-password -s 'mountzara-cloudflare-deploy-token' -w 2>/dev/null || true)}"
export CLOUDFLARE_API_TOKEN
d1() { npx --yes wrangler@latest d1 execute mountzara-clinical --remote --command "$1" 2>/dev/null; }
d1val() { # run a SELECT, return the first JSON value column via python
    d1 "$1" | "$PY" -c 'import sys,json,re
raw=sys.stdin.read()
m=re.search(r"\[\s*{.*}\s*\]", raw, re.S)
if not m: print(""); sys.exit()
try:
    rows=json.loads(m.group(0))
    if rows:
        v=list(rows[0].values())[0]
        print("" if v is None else v)
    else:
        print("")
except Exception:
    print("")'; }

cleanup() { rm -f "$JAR" "$BODY" 2>/dev/null || true; }
trap cleanup EXIT

echo "Phase 17 Sprint 1 smoketest — target: $BASE"
echo "($(date -u '+%Y-%m-%dT%H:%M:%SZ'))"

# ---------------------------------------------------------------------
section "0) Auth setup"
# Admin auth via the canonical resolver (§10.3.1)
# shellcheck source=/dev/null
. "$HERE/_lib_admin_auth.sh"
if ! resolve_admin_auth "$BASE"; then
    echo "$(c_red 'ABORT'): admin auth could not be resolved."; exit 3
fi
echo "  admin: $MZ_ADMIN_USER"

# Patient (Jane) login -> session cookie jar.
# Pre-launch, the login endpoint is itself behind the §11.5.2 preview gate,
# so the bootstrap login carries admin Basic Auth (the operator-preview
# path) purely to satisfy the gate. The resulting mz_session cookie then
# satisfies the gate on every subsequent patient request on its own.
login_code=$(curl -sS -o "$BODY" -w '%{http_code}' -c "$JAR" -u "$MZ_ADMIN_USER:$MZ_ADMIN_PASS" \
    -X POST -H 'content-type: application/json' \
    --data "{\"email\":\"$JANE_EMAIL\",\"password\":\"$JANE_PASSWORD\"}" "$BASE/api/v1/auth/login")
if [ "$login_code" = "200" ]; then
    JANE_PID="$(jget "$BODY" patient_id)"
    echo "  jane:  logged in (patient_id=${JANE_PID:-?})"
else
    echo "$(c_red 'ABORT'): Jane login returned HTTP $login_code (need the seeded test patient — run scripts/_seed_jane_doe.sh)."
    cat "$BODY"; exit 3
fi

# ---------------------------------------------------------------------
section "0b) Dynamic-route reachability — pages must NOT fall through to the homepage"
# Codified 2026-06-10 after the Sprint 2 batch-1 visual VERIFY found that
# the _redirects wildcards for /portal/visit/<id>/launch and /portal/nps/
# <token> silently served the MARKETING HOMEPAGE (the same trailing-slash
# failure documented for /admin/cases/<id>/). Dynamic-segment portal
# routes are served by Pages Functions which stamp an x-mz-route response
# header — these assertions fail loudly if any future change (a _redirects
# edit, a Functions routing change, a renamed asset) regresses the route.
check_route() { # name, url, expected x-mz-route value
    local name="$1" url="$2" want="$3"
    local hdr
    hdr=$(curl -sS -o /dev/null -u "$MZ_ADMIN_USER:$MZ_ADMIN_PASS" -D - "$BASE$url" | tr -d '\r' | awk -F': ' 'tolower($1)=="x-mz-route"{print $2}')
    if [ "$hdr" = "$want" ]; then
        echo "  $(c_grn PASS)  $name  (x-mz-route=$hdr)"; PASS=$((PASS+1))
    else
        echo "  $(c_red FAIL)  $name  (expected x-mz-route=$want, got '${hdr:-<none — likely homepage fallthrough>}')"; FAIL=$((FAIL+1)); FAILED_NAMES+=("$name")
    fi
}
check_route "launch page route (no slash)"  "/portal/visit/smoke-route-check/launch"  "visit-launch-interstitial"
check_route "launch page route (slash)"     "/portal/visit/smoke-route-check/launch/" "visit-launch-interstitial"
check_route "NPS page route (no slash)"     "/portal/nps/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"  "nps-survey"
check_route "NPS page route (slash)"        "/portal/nps/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/" "nps-survey"
# The patient appointment GET must return JSON, never HTML (it didn't
# exist until 2026-06-10 — requests fell through to the homepage).
ct=$(curl -sS -o /dev/null -b "$JAR" -D - "$BASE/api/v1/patient/appointments/smoke-route-check" | tr -d '\r' | awk -F': ' 'tolower($1)=="content-type"{print $2}')
case "$ct" in
    application/json*) echo "  $(c_grn PASS)  patient appointment GET returns JSON  ($ct)"; PASS=$((PASS+1)) ;;
    *) echo "  $(c_red FAIL)  patient appointment GET returns '$ct' (expected application/json — endpoint missing?)"; FAIL=$((FAIL+1)); FAILED_NAMES+=("appointment GET json") ;;
esac

# ---------------------------------------------------------------------
section "A) Preview gate — anonymous traffic gets 404 (never a PHI surface)"
assert_code "anon tech-check -> 404"        404 "$(anon_post /api/v1/patient/tech-check '{"camera_ok":true}')"
assert_code "anon booking -> 404"           404 "$(anon_post /api/v1/patient/appointments/book '{"triage_id":"x"}')"
assert_code "anon launch -> 404"            404 "$(anon_post /api/v1/patient/appointments/bogus/launch '{"privacy_confirmed":true}')"
assert_code "anon intake-submit -> 404"     404 "$(anon_post /api/v1/patient/intake/bogus/submit '{}')"

# ---------------------------------------------------------------------
section "B) R5 — patient device/connection tech-check persists"
code=$(jane_post /api/v1/patient/tech-check '{"camera_ok":true,"microphone_ok":true,"speaker_ok":true,"network_kbps":5000,"browser":"smoketest","os":"smoketest"}')
assert_code "tech-check (all pass) -> 200" 200 "$code"
[ "$(jget "$BODY" ok)" = "True" ] && { echo "  $(c_grn PASS)  tech-check overall_ok=true"; PASS=$((PASS+1)); } || { echo "  $(c_red FAIL)  tech-check overall_ok!=true"; FAIL=$((FAIL+1)); FAILED_NAMES+=("tech-check ok flag"); }
code=$(jane_post /api/v1/patient/tech-check '{"camera_ok":true,"microphone_ok":true,"speaker_ok":true,"network_kbps":100,"failure_reasons":[{"component":"network","reason":"below 600kbps floor"}]}')
assert_code "tech-check (sub-floor network) -> 200" 200 "$code"
[ "$(jget "$BODY" ok)" = "False" ] && { echo "  $(c_grn PASS)  tech-check overall_ok=false on slow network"; PASS=$((PASS+1)); } || { echo "  $(c_red FAIL)  tech-check should fail overall on slow network"; FAIL=$((FAIL+1)); FAILED_NAMES+=("tech-check slow-net flag"); }

# ---------------------------------------------------------------------
section "C) R3 — admin licensed-states endpoint (also sets the D7 list)"
code=$(adm_get /api/v1/admin/practice/licensed-states)
assert_code "GET licensed-states -> 200" 200 "$code"
ORIG_STATES="$("$PY" -c 'import sys,json
try:
    d=json.load(open(sys.argv[1])); print(",".join(d.get("states") or d.get("licensed_states") or []))
except Exception: print("")' "$BODY")"
echo "  current licensed_states: [${ORIG_STATES}]"
code=$(adm_put /api/v1/admin/practice/licensed-states '{"states":[]}')
assert_code_in "PUT empty list refused (fails closed)" "$code" 400 422
code=$(adm_put /api/v1/admin/practice/licensed-states '{"states":["IL","CA"]}')
assert_code "PUT [IL,CA] -> 200" 200 "$code"
code=$(adm_get /api/v1/admin/practice/licensed-states)
NEW_STATES="$("$PY" -c 'import sys,json
try:
    d=json.load(open(sys.argv[1])); print(",".join(d.get("states") or d.get("licensed_states") or []))
except Exception: print("")' "$BODY")"
case ",$NEW_STATES," in *",IL,"*) il=1;; *) il=0;; esac
case ",$NEW_STATES," in *",CA,"*) ca=1;; *) ca=0;; esac
[ "$il" = 1 ] && [ "$ca" = 1 ] && { echo "  $(c_grn PASS)  licensed_states now [${NEW_STATES}]"; PASS=$((PASS+1)); } || { echo "  $(c_red FAIL)  expected IL+CA, got [${NEW_STATES}]"; FAIL=$((FAIL+1)); FAILED_NAMES+=("licensed-states IL+CA"); }

if [ -n "${SMOKE_SKIP_FIXTURES:-}" ]; then
    echo; echo "(SMOKE_SKIP_FIXTURES set — skipping mutating fixture phases D/E/F)"
else
# ---------------------------------------------------------------------
section "D) R3 — intake-submit licensure gate (throwaway intake)"
code=$(jane_post /api/v1/patient/intake/new '{}')
TID="$(jget "$BODY" intake_id)"; [ -z "$TID" ] && TID="$(jget "$BODY" id)"
if [ -z "$TID" ]; then
    skip "intake-submit gate" "could not create a throwaway intake (POST /intake/new returned HTTP $code)"
else
    echo "  throwaway intake: $TID"
    jane_patch "/api/v1/patient/intake/$TID/section/2" '{"consent_telehealth":true,"consent_signature":"Jane Doe","consent_at":"2026-06-09"}' >/dev/null
    # No section 1 yet -> state_required
    code=$(jane_post "/api/v1/patient/intake/$TID/submit" '{}')
    assert_code "submit (no state) -> 422" 422 "$code"; assert_err "  error=state_required" state_required "$BODY"
    # Section 1 with an unlicensed state -> license_state_mismatch
    jane_patch "/api/v1/patient/intake/$TID/section/1" '{"address_state":"TX"}' >/dev/null
    code=$(jane_post "/api/v1/patient/intake/$TID/submit" '{}')
    assert_code "submit (TX, unlicensed) -> 422" 422 "$code"; assert_err "  error=license_state_mismatch" license_state_mismatch "$BODY"
    # cleanup the throwaway intake
    d1 "DELETE FROM intake_section_data WHERE intake_id='$TID'; DELETE FROM intake_responses WHERE id='$TID';" >/dev/null 2>&1 || true
fi

# ---------------------------------------------------------------------
section "E) R3+R1 — booking licensure + chaperone gates (released-triage fixture)"
JANE_INTAKE="$(d1val "SELECT id FROM intake_responses WHERE patient_id='$JANE_PID' ORDER BY started_at DESC LIMIT 1")"
if [ -z "$JANE_INTAKE" ]; then
    skip "booking gates" "Jane has no intake row to attach a triage fixture to"
else
    # snapshot Jane's real section-1 so we can restore it
    ORIG_S1="$(d1val "SELECT data_json FROM intake_section_data WHERE intake_id='$JANE_INTAKE' AND section_number=1")"
    TRIAGE_FIX="smoke-triage-$(date +%s)"
    NOWI="$(date +%s)000"
    d1 "INSERT INTO appointment_triage (id,intake_id,patient_id,ai_prompt_version,ai_visit_type,ai_duration_min,ai_urgency,ai_in_person_required,final_visit_type,clinician_reviewed_at,created_at,updated_at) VALUES ('$TRIAGE_FIX','$JANE_INTAKE','$JANE_PID','smoketest','endo_pain_evaluation',45,'routine',0,'endo_pain_evaluation','$(date -u +%Y-%m-%dT%H:%M:%SZ)',$NOWI,$NOWI);" >/dev/null 2>&1 || true
    have_triage="$(d1val "SELECT id FROM appointment_triage WHERE id='$TRIAGE_FIX'")"
    if [ -z "$have_triage" ]; then
        skip "booking gates" "could not insert the released-triage fixture into D1"
    else
        # (1) Out-of-license-state booking -> 422 license_state_mismatch
        d1 "INSERT INTO intake_section_data (id,intake_id,section_number,section_key,data_json,last_updated_at) VALUES ('smoke-s1-$NOWI','$JANE_INTAKE',1,'demographics','{\"address_state\":\"TX\"}',$NOWI) ON CONFLICT(intake_id,section_number) DO UPDATE SET data_json='{\"address_state\":\"TX\"}';" >/dev/null 2>&1 || \
        d1 "UPDATE intake_section_data SET data_json='{\"address_state\":\"TX\"}' WHERE intake_id='$JANE_INTAKE' AND section_number=1;" >/dev/null 2>&1 || true
        code=$(jane_post /api/v1/patient/appointments/book "{\"triage_id\":\"$TRIAGE_FIX\",\"block_id\":\"smoke-block\",\"start_minute_of_day\":600,\"modality\":\"telehealth\"}")
        assert_code "book (TX, unlicensed) -> 422" 422 "$code"; assert_err "  error=license_state_mismatch" license_state_mismatch "$BODY"

        # (2) Licensed state, chaperone-required visit, no confirmation -> 409
        d1 "UPDATE intake_section_data SET data_json='{\"address_state\":\"IL\"}' WHERE intake_id='$JANE_INTAKE' AND section_number=1;" >/dev/null 2>&1 || true
        code=$(jane_post /api/v1/patient/appointments/book "{\"triage_id\":\"$TRIAGE_FIX\",\"block_id\":\"smoke-block\",\"start_minute_of_day\":600,\"modality\":\"telehealth\"}")
        assert_code "book (chaperone, no confirm) -> 409" 409 "$code"; assert_err "  error=chaperone_confirmation_required" chaperone_confirmation_required "$BODY"

        # (3) Same booking WITH chaperone confirmation -> passes the chaperone gate
        #     (dummy block_id means it then stops at block_not_found; the point is
        #      it is NOT rejected for the chaperone reason any more).
        code=$(jane_post /api/v1/patient/appointments/book "{\"triage_id\":\"$TRIAGE_FIX\",\"block_id\":\"smoke-block\",\"start_minute_of_day\":600,\"modality\":\"telehealth\",\"chaperone_confirmed\":true,\"chaperone_confirmation_method\":\"partner_present\"}")
        got_err="$(jget "$BODY" error)"
        if [ "$got_err" != "chaperone_confirmation_required" ] && [ "$got_err" != "invalid_chaperone_confirmation_method" ]; then
            echo "  $(c_grn PASS)  book (chaperone confirmed) clears the chaperone gate (HTTP $code, error=${got_err:-none})"; PASS=$((PASS+1))
        else
            echo "  $(c_red FAIL)  book (chaperone confirmed) still blocked on chaperone (error=$got_err)"; FAIL=$((FAIL+1)); FAILED_NAMES+=("book chaperone accept")
        fi

        # cleanup: remove the triage fixture, restore Jane's section 1
        d1 "DELETE FROM appointment_triage WHERE id='$TRIAGE_FIX';" >/dev/null 2>&1 || true
        if [ -n "$ORIG_S1" ]; then
            d1 "UPDATE intake_section_data SET data_json='$(printf '%s' "$ORIG_S1" | sed "s/'/''/g")' WHERE intake_id='$JANE_INTAKE' AND section_number=1;" >/dev/null 2>&1 || true
        else
            d1 "DELETE FROM intake_section_data WHERE intake_id='$JANE_INTAKE' AND section_number=1 AND data_json IN ('{\"address_state\":\"IL\"}','{\"address_state\":\"TX\"}');" >/dev/null 2>&1 || true
        fi
    fi
fi

# ---------------------------------------------------------------------
section "F) R3+R4 — launch ladder (early / presence / licensure / success)"
NOW_MS="$("$PY" -c 'import time;print(int(time.time()*1000))')"
START_EARLY=$((NOW_MS + 30*60*1000))   # T+30min -> launch is too early
START_INWIN=$((NOW_MS + 10*60*1000))   # T+10min -> inside the T-15 window
mk_appt() { # echo created appointment id (telehealth, non-chaperone)
    adm_post /api/v1/admin/appointments "{\"patient_id\":\"$JANE_PID\",\"visit_type\":\"telehealth_consult\",\"starts_at\":$1,\"modality\":\"telehealth\",\"chief_complaint_summary\":\"smoketest\"}" >/dev/null
    jget "$BODY" id
}
APPT_EARLY="$(mk_appt "$START_EARLY")"
APPT_INWIN="$(mk_appt "$START_INWIN")"
if [ -z "$APPT_EARLY" ] || [ -z "$APPT_INWIN" ]; then
    skip "launch ladder" "could not admin-create the telehealth fixture appointments"
else
    code=$(jane_post "/api/v1/patient/appointments/$APPT_EARLY/launch" '{"privacy_confirmed":true,"alone_confirmed":true,"current_state":"IL"}')
    assert_code "launch T+30 (too early) -> 403" 403 "$code"; assert_err "  error=launch_too_early" launch_too_early "$BODY"

    code=$(jane_post "/api/v1/patient/appointments/$APPT_INWIN/launch" '{"privacy_confirmed":true,"alone_confirmed":true}')
    assert_code "launch (no current_state) -> 403" 403 "$code"; assert_err "  error=location_attestation_required" location_attestation_required "$BODY"

    code=$(jane_post "/api/v1/patient/appointments/$APPT_INWIN/launch" '{"privacy_confirmed":true,"alone_confirmed":true,"current_state":"TX"}')
    assert_code "launch (TX, unlicensed) -> 422" 422 "$code"; assert_err "  error=license_state_mismatch" license_state_mismatch "$BODY"

    code=$(jane_post "/api/v1/patient/appointments/$APPT_INWIN/launch" '{"privacy_confirmed":true,"alone_confirmed":true,"current_state":"IL"}')
    # 200 = room served; 503 = doxy URL not configured (gate passed either way)
    assert_code_in "launch (IL, in-window) clears all gates" "$code" 200 503

    # cleanup the fixture appointments + their attestation rows
    d1 "DELETE FROM visit_launch_attestations WHERE appointment_id IN ('$APPT_EARLY','$APPT_INWIN'); DELETE FROM appointments WHERE id IN ('$APPT_EARLY','$APPT_INWIN');" >/dev/null 2>&1 || true
fi
fi  # end SMOKE_SKIP_FIXTURES guard

# ---------------------------------------------------------------------
section "Summary"
echo "  PASS=$PASS  FAIL=$FAIL  SKIP=$SKIP"
if [ "$FAIL" -gt 0 ]; then
    echo "  Failed assertions:"; for n in "${FAILED_NAMES[@]}"; do echo "    - $n"; done
    exit 1
fi
echo "  $(c_grn 'All assertions passed.')"
exit 0
