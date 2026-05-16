#!/bin/bash
# =====================================================================
# scripts/_seed_blank_test_patient.sh — create a second test patient
# with credentials but ZERO seeded data, so flows can be exercised
# from a clean-slate dashboard.
# =====================================================================
set -euo pipefail
export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin
export CLOUDFLARE_API_TOKEN=$(/usr/bin/security find-generic-password -s 'mountzara-cloudflare-deploy-token' -w)
cd "$(dirname "$0")/.."

ADMIN_PASS=$(/usr/bin/security find-generic-password -s 'mountzara-admin-password' -w)
ADMIN_USER='chris.mabini@gmail.com'

BLANK_EMAIL='blank-test@example.test'
BLANK_FIRST='Blank'
BLANK_LAST='Tester'
BLANK_DOB='1990-01-15'
BLANK_PASSWORD='BlankTester-2026-MzPortal!'
NOW_MS=$(/usr/bin/python3 -c 'import time; print(int(time.time()*1000))')

# 1. Check whether patient exists; if not, create via admin API.
EXISTING_ID=$(curl -sS -u "$ADMIN_USER:$ADMIN_PASS" "https://mountzara.com/api/v1/admin/patients?q=$BLANK_EMAIL&limit=5" | /usr/local/bin/node -e "
let s=''; process.stdin.on('data',d=>s+=d).on('end',()=>{
  try { const r=JSON.parse(s); const m=(r.patients||[]).find(p=>p.email==='$BLANK_EMAIL'); process.stdout.write(m?m.id:''); }
  catch { process.stdout.write(''); }
});")

if [ -z "$EXISTING_ID" ]; then
    echo "[1/3] Creating blank test patient via admin API…"
    BLANK_ID=$(curl -sS -u "$ADMIN_USER:$ADMIN_PASS" -X POST -H 'content-type: application/json' \
        -d "{\"email\":\"$BLANK_EMAIL\",\"first_name\":\"$BLANK_FIRST\",\"last_name\":\"$BLANK_LAST\",\"dob\":\"$BLANK_DOB\"}" \
        'https://mountzara.com/api/v1/admin/patients' | /usr/local/bin/node -e "
let s=''; process.stdin.on('data',d=>s+=d).on('end',()=>{
  try { const r=JSON.parse(s); process.stdout.write(r.id || ''); } catch { process.stdout.write(''); }
});")
    if [ -z "$BLANK_ID" ]; then
        echo "  ERROR: patient create failed."
        exit 1
    fi
    echo "  created patient_id=$BLANK_ID"
else
    BLANK_ID="$EXISTING_ID"
    echo "[1/3] Blank test patient already exists: $BLANK_ID"
fi

# 2. Generate PBKDF2 hash matching functions/_lib/auth.js format.
echo "[2/3] Generating PBKDF2 100k-iter hash + setting on patient row…"
HASH=$(/usr/local/bin/node -e "
const crypto = require('crypto');
const iter = 100000;
const salt = crypto.randomBytes(16);
const hash = crypto.pbkdf2Sync('$BLANK_PASSWORD', salt, iter, 32, 'sha256');
console.log('pbkdf2\$' + iter + '\$' + salt.toString('base64') + '\$' + hash.toString('base64'));
")
SQL="UPDATE patients SET password_hash='$HASH', password_set_at=$NOW_MS, email_verified_at=$NOW_MS, updated_at=$NOW_MS WHERE id='$BLANK_ID';"
SQLFILE=$(mktemp -t blank_seed)
trap "rm -f $SQLFILE" EXIT
echo "$SQL" > "$SQLFILE"
WRANGLER_OUT=$(npx --yes wrangler@latest d1 execute mountzara-clinical --remote --file="$SQLFILE" 2>&1)
if echo "$WRANGLER_OUT" | grep -qE 'ERROR|SQLITE_ERROR'; then
    echo "  ERROR: $(echo "$WRANGLER_OUT" | grep -E 'ERROR|SQLITE_ERROR' | head -3)"
    exit 1
fi
echo "  password set"

# 3. Save credentials.
CREDS_FILE="$HOME/Desktop/BlankTester_credentials.txt"
cat > "$CREDS_FILE" <<CRED
============================================================
 BLANK TESTER — empty-state portal test patient
============================================================
Generated:  $(/bin/date)
Patient ID: $BLANK_ID
Name:       $BLANK_FIRST $BLANK_LAST
DOB:        $BLANK_DOB

Email:      $BLANK_EMAIL
Password:   $BLANK_PASSWORD

Login URL:  https://mountzara.com/portal/login
Dashboard:  https://mountzara.com/portal/

Pre-loaded data:
  NONE. Empty across every module. Dashboard will show:
    - "Start with your intake" on the appointment card
    - "No messages yet" on messages
    - "Today's diary is empty" on symptoms
    - "No intake started" on intake
    - "Library opening soon" or available primers (no assignments)
  Use this account to exercise the empty-state designs and to
  walk through any flow from scratch — submit intake, run AI
  triage, book a slot, send first message, log first symptom.

============================================================
 IMPORTANT — preview-gate access (until launch)
============================================================
The patient portal is currently admin-preview-only — public
visitors hitting /portal/* see the Coming Soon page until
the PORTAL_PUBLIC_LAUNCH Pages secret flips to "true".

To log in as this test patient via the browser:
  1. Visit https://mountzara.com/portal/login
  2. Your browser will FIRST prompt for HTTP Basic Auth
     (Mount Zara Admin realm). Enter your admin credentials:
        Username: $ADMIN_USER
        Password: (in macOS Keychain item
                   'mountzara-admin-password')
     Safari/Chrome will remember this for the browser session.
  3. After the admin prompt passes, the portal login form
     appears. Enter the Blank Tester email + password above.

To open the portal publicly later:
  npx wrangler pages secret put PORTAL_PUBLIC_LAUNCH \\
      --project-name=mountzara
  (set value: true), then redeploy. Admin prompt goes away.

============================================================
CRED
chmod 600 "$CREDS_FILE"

echo
echo "============================================================"
echo "[3/3] Credentials saved to: $CREDS_FILE"
echo "Email:    $BLANK_EMAIL"
echo "Password: $BLANK_PASSWORD"
echo "============================================================"
