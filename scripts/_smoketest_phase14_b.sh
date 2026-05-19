#!/usr/bin/env bash
set -e
ADMIN_PASS=$(security find-generic-password -s mountzara-admin-password -w)
ADMIN_USER=$(grep '^Username:' ~/Desktop/MountZara_Admin_Credentials.txt | sed 's/^Username: *//')
JANE_PID='8cc1aa63-5931-4c54-babb-e06bc196d743'
BASE='https://mountzara.com'
HERE=/Users/beans/Developer/MountZara/MIGS/scripts

echo '=== 1) Single-patient briefing for Jane Doe ==='
curl -sS -u "$ADMIN_USER:$ADMIN_PASS" "$BASE/api/v1/admin/briefings/$JANE_PID" \
    | /usr/bin/python3 "$HERE/_inspect_briefing.py"

echo ''
echo '=== 2) Day-window briefings (today) ==='
TODAY=$(date -u +%Y-%m-%d)
curl -sS -u "$ADMIN_USER:$ADMIN_PASS" "$BASE/api/v1/admin/briefings?date=$TODAY" \
    | /usr/bin/python3 "$HERE/_inspect_window.py"

echo ''
echo '=== 3) Week-window briefings (next 7 days starting today) ==='
curl -sS -u "$ADMIN_USER:$ADMIN_PASS" "$BASE/api/v1/admin/briefings?date=$TODAY&range=week" \
    | /usr/bin/python3 "$HERE/_inspect_window.py"
