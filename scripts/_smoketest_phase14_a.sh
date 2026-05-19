#!/usr/bin/env bash
# Smoke test phase 14 round A — exercises every endpoint end-to-end against
# Jane Doe (patient_id 8cc1aa63-5931-4c54-babb-e06bc196d743).
set -e

ADMIN_PASS=$(security find-generic-password -s mountzara-admin-password -w)
ADMIN_USER=$(grep '^Username:' ~/Desktop/MountZara_Admin_Credentials.txt | sed 's/^Username: *//')
JANE_PID='8cc1aa63-5931-4c54-babb-e06bc196d743'
BASE='https://mountzara.com'

echo '=== 1) PATCH profile (nickname + care goals) ==='
curl -sS -u "$ADMIN_USER:$ADMIN_PASS" \
    -X PATCH "$BASE/api/v1/admin/patients/$JANE_PID/profile" \
    -H 'content-type: application/json' \
    -d '{
      "nickname": "JD",
      "care_goals": {
        "goals": ["Avoid hysterectomy if possible", "Return to running by 12 weeks post-op"],
        "preferences": ["Telehealth-first when feasible", "Morning visits"],
        "avoid": ["Opioids unless absolutely necessary"],
        "notes": "Has a teaching schedule, prefers Tues/Thurs afternoons clear."
      }
    }' | python3 -m json.tool 2>/dev/null | head -25
echo ''

echo '=== 2) Verify by reading patient row directly from D1 ==='
export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH
source /Users/beans/.config/mountzara/cf-creds.env 2>/dev/null || true
/usr/local/bin/npx wrangler d1 execute mountzara-clinical --remote --command \
    "SELECT nickname, care_goals_json FROM patients WHERE id='$JANE_PID'" 2>&1 | tail -10
echo ''

echo '=== 3) Create personal note (category=personal, pinned) ==='
NOTE_RESP=$(curl -sS -u "$ADMIN_USER:$ADMIN_PASS" \
    -X POST "$BASE/api/v1/admin/patients/$JANE_PID/notes" \
    -H 'content-type: application/json' \
    -d '{
      "category": "personal",
      "summary": "Recently adopted a tabby cat named Pixel",
      "body": "Got Pixel from the shelter 2 weeks ago. Goes on long walks at lunch with him on a leash. Great icebreaker — she lights up when you ask about him.",
      "is_pinned": true
    }')
echo "$NOTE_RESP" | python3 -m json.tool 2>/dev/null | head -20
NOTE_ID=$(echo "$NOTE_RESP" | python3 -c 'import json,sys; print(json.load(sys.stdin)["note"]["id"])')
echo ''
echo "  created note id: $NOTE_ID"
echo ''

echo '=== 4) Create a second note (category=preference) ==='
curl -sS -u "$ADMIN_USER:$ADMIN_PASS" \
    -X POST "$BASE/api/v1/admin/patients/$JANE_PID/notes" \
    -H 'content-type: application/json' \
    -d '{
      "category": "preference",
      "summary": "Prefers concrete next steps in writing after each visit",
      "body": "Found that summarizing the plan as a 3-line bullet list at end of visit lands better than a paragraph. Sticks for her."
    }' | python3 -m json.tool 2>/dev/null | head -10
echo ''

echo '=== 5) List notes (decrypts bodies, pinned first) ==='
curl -sS -u "$ADMIN_USER:$ADMIN_PASS" "$BASE/api/v1/admin/patients/$JANE_PID/notes" | python3 -m json.tool 2>/dev/null | head -35
echo ''

echo '=== 6) PATCH the first note (flip is_pinned off, add memo to body) ==='
curl -sS -u "$ADMIN_USER:$ADMIN_PASS" \
    -X PATCH "$BASE/api/v1/admin/patients/$JANE_PID/notes/$NOTE_ID" \
    -H 'content-type: application/json' \
    -d '{
      "is_pinned": false,
      "body": "Got Pixel from the shelter 2 weeks ago. Goes on lunch walks with him on a leash. Update: also got a fish tank started — surgical-grade attention to detail there."
    }' | python3 -m json.tool 2>/dev/null
echo ''

echo '=== 7) DELETE the first note ==='
curl -sS -u "$ADMIN_USER:$ADMIN_PASS" \
    -X DELETE "$BASE/api/v1/admin/patients/$JANE_PID/notes/$NOTE_ID" | python3 -m json.tool 2>/dev/null
echo ''

echo '=== 8) Final state — list remaining notes ==='
curl -sS -u "$ADMIN_USER:$ADMIN_PASS" "$BASE/api/v1/admin/patients/$JANE_PID/notes" | python3 -m json.tool 2>/dev/null | head -25

echo ''
echo '✓ Phase 14 Round A smoke test complete.'
