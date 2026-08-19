#!/usr/bin/env bash
# =====================================================================
# transcription_smoke.sh — prove the app↔platform seam from the app's side
# =====================================================================
# Run this ON THE MAC that runs MedicalTranscription.app:
#
#   TRANSCRIPTION_SYNC_TOKEN=<token> ./transcription_smoke.sh
#
# It exercises the same endpoints the app uses, read-only plus one
# dry-run (nothing is written), and says PASS/FAIL per step. If all five
# pass, any remaining problem is inside the app's own configuration —
# not the network, not the token, not the platform.
# =====================================================================
set -u
B="https://mountzara.com/api/v1/sync/transcription"
T="${TRANSCRIPTION_SYNC_TOKEN:-}"
[ -z "$T" ] && { echo "Set TRANSCRIPTION_SYNC_TOKEN first."; exit 1; }
fail=0
step() { printf "%-46s" "$1"; }
ok()   { echo "PASS"; }
bad()  { echo "FAIL — $1"; fail=1; }

step "1. auth accepted"
code=$(curl -s -o /tmp/_sm1 -w "%{http_code}" -H "Authorization: Bearer $T" "$B/patients")
[ "$code" = "200" ] && ok || bad "HTTP $code (wrong token, or TRANSCRIPTION_SYNC_TOKEN not set on the server)"

step "2. wrong token refused"
code=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer nope" "$B/patients")
[ "$code" = "401" ] && ok || bad "expected 401, got $code — auth is not enforcing"

step "3. patient list parses"
PID=$(python3 -c "import json;d=json.load(open('/tmp/_sm1'));ps=d.get('patients',[]);print(ps[0]['patient_id'] if ps else '')" 2>/dev/null)
[ -n "$PID" ] && ok || bad "no patients returned — add one on /admin/patients/ first"

step "4. visit context loads"
if [ -n "$PID" ]; then
    n=$(curl -s -H "Authorization: Bearer $T" "$B/patients/$PID/context" \
        | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('context',{}).get('patient',{}).get('id',''))" 2>/dev/null)
    [ "$n" = "$PID" ] && ok || bad "context did not return the requested patient"
else bad "skipped — no patient id"; fi

step "5. dictated-orders dry run"
if [ -n "$PID" ]; then
    r=$(curl -s -X POST -H "Authorization: Bearer $T" -H 'content-type: application/json' "$B/orders" \
        -d "{\"patient_id\":\"$PID\",\"dry_run\":true,\"orders\":[{\"order_type\":\"lab\",\"indication\":\"smoke test\",\"icd10\":[\"Z00.00\"],\"tests\":[{\"name\":\"CBC\"}]}]}" \
        | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('dry_run'),d.get('created'))" 2>/dev/null)
    [ "$r" = "True 1" ] && ok || bad "dry run did not validate (got: $r)"
else bad "skipped — no patient id"; fi

echo
[ "$fail" = 0 ] && echo "ALL PASS — the seam works from this machine. Configure the app with this base URL and token." \
               || echo "Something failed above — fix that before touching the app."
exit $fail
