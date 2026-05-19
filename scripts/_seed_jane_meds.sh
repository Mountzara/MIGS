#!/usr/bin/env bash
# Seed Jane Doe's intake Section 13 with a realistic test med list so the
# Phase 15 AE engine has something to chew on. NOT a production seed —
# remove after the smoke test if desired.
set -e
cd /Users/beans/Developer/MountZara/MIGS
export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH
source /Users/beans/.config/mountzara/cf-creds.env 2>/dev/null || true
JANE_PID='8cc1aa63-5931-4c54-babb-e06bc196d743'

INTAKE_ID=$(/usr/local/bin/npx wrangler d1 execute mountzara-clinical --remote --json --command \
    "SELECT id FROM intake_responses WHERE patient_id='$JANE_PID' ORDER BY started_at DESC LIMIT 1" 2>/dev/null \
    | /usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["results"][0]["id"])')
echo "intake_id: $INTAKE_ID"

DATA_JSON='{"pain_meds":"Ibuprofen 600mg as needed for pain","contraceptives":"Loestrin Fe 1/20 daily","other_meds":"Sertraline 50mg daily, Topamax 50mg BID for migraines"}'

NOW=$(date +%s)000
NEW_ID=$(uuidgen | tr A-Z a-z)

/usr/local/bin/npx wrangler d1 execute mountzara-clinical --remote --command \
    "INSERT INTO intake_section_data (id, intake_id, section_number, section_key, data_json, last_updated_at) VALUES ('$NEW_ID', '$INTAKE_ID', 13, 'current_medications', '$DATA_JSON', $NOW) ON CONFLICT(intake_id, section_number) DO UPDATE SET data_json=excluded.data_json, last_updated_at=excluded.last_updated_at" \
    2>&1 | tail -5
