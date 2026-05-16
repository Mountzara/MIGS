#!/bin/bash
# =====================================================================
# scripts/_seed_jane_doe.sh — set up Jane Doe as a portal test patient
# =====================================================================
# Idempotent-ish (skips data inserts if they already exist via the
# existence check at the top). Sets a portal password + seeds:
#   - intake (in_progress) with sections 1, 4, 5, 12, 17 filled
#   - appointment_triage (released by clinician, ready-to-book)
#   - 10 days of symptom_diary_entries (pain trending down)
#   - 1 patient_education_assignment (endometriosis-101)
#   - 1 message thread (clinician-initiated) via the admin API so the
#     body is properly envelope-encrypted into mountzara-phi
#   - 1 reply from Jane via the patient API
#
# Credentials saved to ~/Desktop/JaneDoe_credentials.txt
# =====================================================================
set -euo pipefail
export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin
export CLOUDFLARE_API_TOKEN=$(/usr/bin/security find-generic-password -s 'mountzara-cloudflare-deploy-token' -w)
cd "$(dirname "$0")/.."

ADMIN_PASS=$(/usr/bin/security find-generic-password -s 'mountzara-admin-password' -w)
ADMIN_USER='chris.mabini@gmail.com'

JANE_ID='8cc1aa63-5931-4c54-babb-e06bc196d743'
JANE_EMAIL='chris.mabini@gmail.com'
JANE_PASSWORD='JaneDoeTest-2026-MzPortal!'
NOW_MS=$(/usr/bin/python3 -c 'import time; print(int(time.time()*1000))')
TODAY=$(/usr/bin/python3 -c 'import datetime; print(datetime.date.today().isoformat())')

# Skip if already seeded.
EXISTING=$(npx --yes wrangler@latest d1 execute mountzara-clinical --remote --command="SELECT password_hash IS NOT NULL AS has_pw FROM patients WHERE id = '$JANE_ID'" 2>&1 | grep -E '"has_pw"' | head -1 || echo "")
if echo "$EXISTING" | grep -q '"has_pw": 1'; then
    echo "Jane Doe already has a password — re-running data inserts will fail UNIQUE constraints."
    echo "If you want to fully re-seed, manually DELETE the existing rows first. Aborting."
    exit 1
fi

# 1. Generate PBKDF2 hash (pbkdf2$<iter>$<salt-b64>$<hash-b64>) matching functions/_lib/auth.js.
HASH=$(/usr/local/bin/node -e "
const crypto = require('crypto');
const iter = 100000;
const salt = crypto.randomBytes(16);
const hash = crypto.pbkdf2Sync('$JANE_PASSWORD', salt, iter, 32, 'sha256');
console.log('pbkdf2\$' + iter + '\$' + salt.toString('base64') + '\$' + hash.toString('base64'));
")

# Pre-generate UUIDs.
INTAKE_ID=$(/usr/bin/uuidgen | tr 'A-Z' 'a-z')
TRIAGE_ID=$(/usr/bin/uuidgen | tr 'A-Z' 'a-z')
ASSIGN_ID=$(/usr/bin/uuidgen | tr 'A-Z' 'a-z')
SEC1_ID=$(/usr/bin/uuidgen | tr 'A-Z' 'a-z')
SEC4_ID=$(/usr/bin/uuidgen | tr 'A-Z' 'a-z')
SEC5_ID=$(/usr/bin/uuidgen | tr 'A-Z' 'a-z')
SEC12_ID=$(/usr/bin/uuidgen | tr 'A-Z' 'a-z')
SEC17_ID=$(/usr/bin/uuidgen | tr 'A-Z' 'a-z')

# Pre-compute symptom diary dates (last 10 days, pain trending down 8 -> 4).
SQLFILE=$(mktemp -t jane_seed)
trap "rm -f $SQLFILE" EXIT

cat > "$SQLFILE" <<EOF
-- =====================================================================
-- Jane Doe seed (single transactional pass).
-- =====================================================================

-- (1) Portal password + verified flags + small profile polish.
UPDATE patients
SET password_hash = '$HASH',
    password_set_at = $NOW_MS,
    email_verified_at = $NOW_MS,
    preferred_name = 'Jane',
    pronouns = 'she/her',
    timezone = 'America/Chicago',
    updated_at = $NOW_MS
WHERE id = '$JANE_ID';

-- (2) Intake in_progress, started a few days ago.
INSERT INTO intake_responses (id, patient_id, status, locale, started_at, updated_at, completion_pct)
VALUES ('$INTAKE_ID', '$JANE_ID', 'in_progress', 'en',
        $NOW_MS - 4 * 86400000, $NOW_MS - 12 * 3600000, 26);

-- Section 1 (patient_information) — minimal, identity carried on patients row.
INSERT INTO intake_section_data (id, intake_id, section_number, section_key, data_json, last_updated_at) VALUES
    ('${SEC1_ID}', '$INTAKE_ID', 1, 'patient_information',
     json('{"is_second_opinion":false,"recommended_surgery":false,"interpreter_language":null}'),
     $NOW_MS - 4 * 86400000);

-- Section 4 (chief_gynecologic_complaint) — endo-flavored so triage routes to endo_pain_evaluation.
INSERT INTO intake_section_data (id, intake_id, section_number, section_key, data_json, last_updated_at) VALUES
    ('${SEC4_ID}', '$INTAKE_ID', 4, 'chief_gynecologic_complaint',
     json('{"chief_complaint":"Cyclic pelvic pain x 3 years, worsening over the last 6 months. Pain peaks during menses and with intercourse. Tried OTC NSAIDs without much relief. Wondering about endometriosis.","bleed_over_8_days":false,"bleed_pad_per_hour":false,"bleed_clots_quarter":true,"bleed_anemia":false,"bleed_unpredictable":false,"bleed_duration_months":6,"pain_location":["center","right"],"pain_scale":7,"trig_with_periods":true,"trig_constant":false,"trig_with_intercourse":true,"trig_with_ovulation":false,"trig_full_bladder":false,"trig_with_bms":true,"pain_work_impact":true,"days_missed_month":2,"mass_fibroids":false,"mass_ovarian_cyst":false,"mass_adenomyosis":false,"goal_eliminate_pain":true,"goal_reduce_bleeding":false,"goal_preserve_fertility":true,"goal_avoid_hysterectomy":true,"goal_improve_qol":true,"goal_return_to_work":true,"treatment_preference":"unsure"}'),
     $NOW_MS - 3 * 86400000);

-- Section 5 (detailed_menstrual_history)
INSERT INTO intake_section_data (id, intake_id, section_number, section_key, data_json, last_updated_at) VALUES
    ('${SEC5_ID}', '$INTAKE_ID', 5, 'detailed_menstrual_history',
     json('{"lmp_normal":true,"cycle_length_days":28,"bleeding_days":6,"spotting_days":2,"products_regular_pads":true,"products_overnight_pads":true,"uses_double_protection":true,"bleed_affects_activities":true,"avoid_light_clothing":true,"night_accidents":false}'),
     $NOW_MS - 3 * 86400000);

-- Section 12 (medical_history_eras)
INSERT INTO intake_section_data (id, intake_id, section_number, section_key, data_json, last_updated_at) VALUES
    ('${SEC12_ID}', '$INTAKE_ID', 12, 'medical_history_eras',
     json('{"eras_anemia":false,"eras_sleep_apnea":false,"eras_smoking":false,"eras_diabetes":false,"eras_bmi40":false,"eras_bleeding_disorder":false,"eras_dvt_pe":false,"eras_cardiac":false,"eras_ckd":false,"eras_latex_allergy":false,"glp1_ozempic":false,"glp1_wegovy":false,"glp1_mounjaro":false,"glp1_saxenda":false,"glp1_other":false,"ht_bcp":true,"bt_asa":false,"bt_plavix":false,"bt_coumadin":false,"bt_eliquis":false,"bt_xarelto":false,"med_htn":false,"med_thyroid":false,"med_migraines":true,"med_depression_anxiety":false,"gyn_endometriosis":false,"gyn_pcos":false,"gyn_adenomyosis":false,"gyn_cpp":true}'),
     $NOW_MS - 2 * 86400000);

-- Section 17 (mental_health_screening) — PHQ-2 negative + mild surgical anxiety.
INSERT INTO intake_section_data (id, intake_id, section_number, section_key, data_json, last_updated_at) VALUES
    ('${SEC17_ID}', '$INTAKE_ID', 17, 'mental_health_screening',
     json('{"phq2_anhedonia":1,"phq2_depressed":1,"surgical_anxiety":"mild"}'),
     $NOW_MS - 2 * 86400000);

-- (3) appointment_triage — released by clinician so dashboard shows "ready to book".
INSERT INTO appointment_triage
    (id, intake_id, patient_id,
     ai_prompt_version, ai_visit_type, ai_duration_min, ai_urgency,
     ai_in_person_required, ai_preferred_time_of_day,
     ai_rationale, ai_secondary_concerns_json,
     clinician_override_visit_type, clinician_override_duration_min,
     clinician_override_reason, clinician_reviewed_at, clinician_reviewer_id,
     final_visit_type, final_duration_min,
     created_at, updated_at)
VALUES
    ('$TRIAGE_ID', '$INTAKE_ID', '$JANE_ID',
     'seed-jane-2026-05-16', 'endo_pain_evaluation', 45, 'routine',
     1, 'morning',
     'Established complaint with multi-trigger pain (periods + intercourse + BMs), location center+right, pain 7/10 affecting work — fits endo_pain_evaluation per §11.7.2.',
     '[]',
     NULL, NULL, NULL, $NOW_MS - 3600000, 'chris.mabini@gmail.com',
     'endo_pain_evaluation', 45,
     $NOW_MS - 3 * 86400000, $NOW_MS - 3600000);

-- (4) Symptom diary — 10 days, pain trending 8 -> 4 as patient starts NSAIDs around day 5.
EOF

# Generate 10 days of symptom entries dynamically.
/usr/bin/python3 <<PY >> "$SQLFILE"
import datetime, json, uuid, time
now_ms = int(time.time() * 1000)
today = datetime.date.today()
# pain trajectory: 8, 7, 7, 6, 5, 5, 5, 4, 4, 4 (newest first)
pains = [8, 7, 7, 6, 5, 5, 5, 4, 4, 4]
sleeps = [4, 5, 5, 6, 6, 7, 7, 7, 8, 8]
moods = [4, 4, 5, 5, 6, 6, 7, 7, 7, 8]
for i, pain in enumerate(pains):
    d = today - datetime.timedelta(days=i)
    iso = d.isoformat()
    entry_id = str(uuid.uuid4())
    values = {
        "pelvic_pain_0_10": pain,
        "sleep_quality_0_10": sleeps[i],
        "mood_0_10": moods[i],
        "pain_location": ["center", "right"] if pain >= 6 else ["center"],
        "work_school_impact_0_10": max(0, pain - 2),
    }
    if i < 4:
        values["bleeding_pads_per_hour"] = 1 if i < 2 else 0
        values["clots_quarter_size_plus"] = True if i < 2 else False
    note = "First day of period." if i == 0 else (
        "Started ibuprofen 400 mg q6h." if i == 5 else None)
    entry_ts = now_ms - i * 86400000
    note_sql = f"'{note}'" if note else "NULL"
    print(
        "INSERT INTO symptom_diary_entries (id, patient_id, entry_date, values_json, note, created_at, updated_at)"
        f" VALUES ('{entry_id}', '8cc1aa63-5931-4c54-babb-e06bc196d743', '{iso}', json('{json.dumps(values)}'), {note_sql}, {entry_ts}, {entry_ts});"
    )
PY

cat >> "$SQLFILE" <<EOF

-- (5) Education assignment — assign endometriosis-101 (if it exists) to Jane.
INSERT OR IGNORE INTO patient_education_assignments
    (id, patient_id, material_id, assigned_by_role, assigned_by_id, reason, assigned_at)
SELECT '$ASSIGN_ID', '$JANE_ID', m.id, 'clinician', 'chris.mabini@gmail.com',
       'related_to_intake', $NOW_MS - 2 * 86400000
FROM education_materials m
WHERE m.slug = 'endometriosis-101' LIMIT 1;
EOF

echo "[1/4] Applying D1 seed (password + intake + triage + 10-day symptom diary + edu assignment)…"
WRANGLER_OUT=$(npx --yes wrangler@latest d1 execute mountzara-clinical --remote --file="$SQLFILE" 2>&1)
if echo "$WRANGLER_OUT" | grep -qE 'ERROR|error|SQLITE_ERROR'; then
    echo "  WRANGLER ERROR:"
    echo "$WRANGLER_OUT" | grep -E 'ERROR|error|SQLITE_ERROR' | head -5
    echo "  Aborting before continuing to message seeding."
    exit 1
fi
echo "$WRANGLER_OUT" | grep -E 'rows_written|changed_db' | head -2

# 4. Add a few open availability blocks for the next week so booking has slots.
echo
echo "[2/4] Ensuring open availability blocks exist for next 5 weekdays…"
for OFFSET in 1 2 3 4 5; do
    DATE=$(/usr/bin/python3 -c "import datetime; print((datetime.date.today() + datetime.timedelta(days=$OFFSET)).isoformat())")
    DOW=$(/usr/bin/python3 -c "import datetime; print((datetime.date.today() + datetime.timedelta(days=$OFFSET)).weekday())")
    # Skip weekends (5 = Sat, 6 = Sun).
    if [ "$DOW" -ge 5 ]; then continue; fi
    # Check if a block already exists for that date.
    EXISTS=$(curl -sS -u "$ADMIN_USER:$ADMIN_PASS" "https://mountzara.com/api/v1/admin/availability?from=$DATE&to=$DATE" | /usr/bin/python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d.get("blocks",[])))')
    if [ "$EXISTS" -gt "0" ]; then
        echo "  $DATE — already has $EXISTS block(s), skipping"
        continue
    fi
    curl -sS -u "$ADMIN_USER:$ADMIN_PASS" -X POST -H 'content-type: application/json' \
        -d "{\"date\":\"$DATE\",\"start_minute_of_day\":540,\"end_minute_of_day\":720,\"block_kind\":\"open\",\"location\":\"clinic\",\"notes\":\"seed block for Jane Doe testing\"}" \
        'https://mountzara.com/api/v1/admin/availability' > /dev/null
    echo "  $DATE 09:00-12:00 created"
done

# 5. Seed message thread (clinician → Jane) via admin API so body is envelope-encrypted in R2.
echo
echo "[3/4] Seeding clinician → Jane message thread via admin API…"
THREAD_RES=$(curl -sS -u "$ADMIN_USER:$ADMIN_PASS" -X POST -H 'content-type: application/json' \
    -d "{\"patient_id\":\"$JANE_ID\",\"subject\":\"Welcome — quick pre-visit checklist\",\"body\":\"Hi Jane,\\n\\nWelcome to the portal. Ahead of your visit, please:\\n\\n1. Finish the intake — you have a few sections left.\\n2. Track symptoms daily (even just pain and sleep helps).\\n3. Read the Endometriosis 101 primer I assigned.\\n\\nIf anything urgent comes up, send a secure message here.\\n\\n— Dr. Mabini\"}" \
    'https://mountzara.com/api/v1/admin/messages')
THREAD_ID=$(echo "$THREAD_RES" | /usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin).get("thread_id",""))')
if [ -z "$THREAD_ID" ]; then
    echo "  WARN: thread creation failed: $THREAD_RES"
else
    echo "  thread_id=$THREAD_ID"
fi

# 6. Have Jane reply via patient session.
echo
echo "[4/4] Patient-side reply from Jane…"
JAR=$(mktemp)
curl -sS -c "$JAR" -X POST -H 'content-type: application/json' \
    -d "{\"email\":\"$JANE_EMAIL\",\"password\":\"$JANE_PASSWORD\"}" \
    'https://mountzara.com/api/v1/auth/login' > /dev/null
if [ -n "$THREAD_ID" ]; then
    curl -sS -b "$JAR" -X POST -H 'content-type: application/json' \
        -d "{\"body\":\"Thanks Dr. Mabini! I'll wrap up the intake tonight and start the symptom log. Quick question — should I keep taking ibuprofen 400 mg through my next period or hold it before the visit?\"}" \
        "https://mountzara.com/api/v1/patient/messages/$THREAD_ID" > /dev/null
    echo "  patient reply posted"
fi
rm -f "$JAR"

# 7. Save credentials to Desktop.
CREDS_FILE="$HOME/Desktop/JaneDoe_credentials.txt"
cat > "$CREDS_FILE" <<CRED
============================================================
 JANE DOE — test patient portal credentials
============================================================
Generated:  $(/bin/date)
Patient ID: $JANE_ID
DOB:        1983-12-15

Email:      $JANE_EMAIL
Password:   $JANE_PASSWORD

Login URL:  https://mountzara.com/portal/login
Dashboard:  https://mountzara.com/portal/

Pre-loaded data:
  - Intake in_progress with chief complaint suggestive of endometriosis
    (sections 1, 4, 5, 12, 17 saved; sections 2, 3, 6-11, 13-16, 18-19 still empty)
  - Triage released as 'Complex Pelvic Pain / Endometriosis Evaluation',
    45 min, in-person preferred, morning. Dashboard shows "ready to book".
  - 10 days of symptom diary entries with pain trending 8 -> 4 after
    NSAIDs started day 5. Mood + sleep also improving.
  - Education primer 'endometriosis-101' assigned by Dr. Mabini.
  - One message thread (Welcome / pre-visit checklist) from Dr. Mabini
    with one patient reply from Jane.
  - Open availability blocks Mon-Fri 09:00-12:00 for the next week so
    the booking flow has live slots.

Note on email collision:
  Jane's email matches the admin user email by design. Admin login at
  /admin/ uses HTTP Basic Auth with the admin password in macOS
  Keychain (item 'mountzara-admin-password'); Jane's patient login
  uses the portal password above and a session cookie. They do not
  conflict — same email, two different auth mechanisms on different
  paths.

============================================================
 IMPORTANT — preview-gate access (until launch)
============================================================
The patient portal is currently admin-preview-only — public visitors
hitting /portal/* see the Coming Soon page until the
PORTAL_PUBLIC_LAUNCH Pages secret flips to "true".

To log in as Jane via the browser:
  1. Visit https://mountzara.com/portal/login
  2. Your browser FIRST prompts for HTTP Basic Auth (Mount Zara
     Admin realm). Enter your admin credentials:
        Username: chris.mabini@gmail.com
        Password: (from macOS Keychain 'mountzara-admin-password')
     Safari/Chrome remembers this for the browser session.
  3. After the admin prompt passes, the portal login form appears.
     Enter Jane's email + password above.

To open the portal to the public later:
  npx wrangler pages secret put PORTAL_PUBLIC_LAUNCH \\
      --project-name=mountzara
  (set value: true), then redeploy. Admin prompt goes away and
  anyone can use the portal as a real patient.

============================================================
CRED
chmod 600 "$CREDS_FILE"

echo
echo "============================================================"
echo "Credentials saved to: $CREDS_FILE"
echo "Email:    $JANE_EMAIL"
echo "Password: $JANE_PASSWORD"
echo "Login:    https://mountzara.com/portal/login"
echo "============================================================"
