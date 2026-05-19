#!/bin/bash
set -euo pipefail
export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin
ADMIN_PASS=$(/usr/bin/security find-generic-password -s 'mountzara-admin-password' -w)
ADMIN_USER='chris.mabini@gmail.com'
JAR=$(mktemp); trap "rm -f $JAR" EXIT

TS=$(date +%s)
EMAIL="triage-test-${TS}@example.test"

echo "[1] signup + grab session"
curl -sS -u "$ADMIN_USER:$ADMIN_PASS" -X POST -H 'content-type: application/json' -c "$JAR" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"TriageTest12345!\",\"first_name\":\"Triage\",\"last_name\":\"Tester\",\"dob\":\"1990-04-15\"}" \
    "https://mountzara.com/api/v1/auth/signup" | /usr/bin/python3 -m json.tool | head -4

echo
echo "[2] create new intake"
INTAKE_ID=$(curl -sS -u "$ADMIN_USER:$ADMIN_PASS" -b "$JAR" -X POST -H 'content-type: application/json' -d '{}' \
    "https://mountzara.com/api/v1/patient/intake/new" | /usr/bin/python3 -c "import json,sys;print(json.load(sys.stdin)['intake_id'])")
echo "  intake_id=$INTAKE_ID"

echo
echo "[3] save consent (Section 2) so submit can proceed"
curl -sS -u "$ADMIN_USER:$ADMIN_PASS" -b "$JAR" -X PATCH -H 'content-type: application/json' \
    -d '{"consent_accuracy":true,"consent_treatment":true,"electronic_signature":"Triage Tester","consent_date":"2026-05-16"}' \
    "https://mountzara.com/api/v1/patient/intake/$INTAKE_ID/section/2" > /dev/null
echo "  ok"

echo
echo "[4] save Section 4 chief complaint with complex-endo pattern"
curl -sS -u "$ADMIN_USER:$ADMIN_PASS" -b "$JAR" -X PATCH -H 'content-type: application/json' \
    -d '{"chief_complaint":"Severe cyclic pelvic pain x5 years, suspected endometriosis","pain_scale":8,"trig_with_periods":true,"trig_with_intercourse":true,"trig_with_bms":true,"mass_fibroids":true,"fibroid_size_cm":6,"goal_eliminate_pain":true,"goal_preserve_fertility":true,"treatment_preference":"unsure"}' \
    "https://mountzara.com/api/v1/patient/intake/$INTAKE_ID/section/4" > /dev/null
echo "  ok"

echo
echo "[5] save Section 12 ERAS with GLP-1 + anticoagulant flags"
curl -sS -u "$ADMIN_USER:$ADMIN_PASS" -b "$JAR" -X PATCH -H 'content-type: application/json' \
    -d '{"glp1_ozempic":true,"glp1_last_dose_date":"2026-05-13","bt_eliquis":true,"eras_diabetes":true,"eras_diabetes_hba1c":7.2}' \
    "https://mountzara.com/api/v1/patient/intake/$INTAKE_ID/section/12" > /dev/null
echo "  ok"

echo
echo "[6] submit intake — expect auto-triage to run (fallback, since no ANTHROPIC_API_KEY)"
curl -sS -u "$ADMIN_USER:$ADMIN_PASS" -b "$JAR" -X POST \
    "https://mountzara.com/api/v1/patient/intake/$INTAKE_ID/submit" | /usr/bin/python3 -m json.tool

echo
echo "[7] confirm appointment_triage row was created"
export CLOUDFLARE_API_TOKEN=$(/usr/bin/security find-generic-password -s 'mountzara-cloudflare-deploy-token' -w)
cd /Users/beans/Developer/MountZara/MIGS
npx --yes wrangler@latest d1 execute mountzara-clinical --remote \
    --command="SELECT id, ai_prompt_version, ai_visit_type, ai_duration_min, ai_urgency, ai_in_person_required, ai_preferred_time_of_day, ai_rationale FROM appointment_triage WHERE intake_id = '$INTAKE_ID'" 2>&1 | grep -E '"ai_|"id"' | head -20

echo
echo "[8] confirm audit_log captured triage_run with ai_used=false"
npx --yes wrangler@latest d1 execute mountzara-clinical --remote \
    --command="SELECT action, success, details_json FROM audit_log WHERE record_id IN (SELECT id FROM appointment_triage WHERE intake_id = '$INTAKE_ID')" 2>&1 | grep -E '"action"|"success"|details_json' | head -10
