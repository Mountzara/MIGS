#!/usr/bin/env bash
set -e
cd /Users/beans/Developer/MountZara/MIGS
export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH
source /Users/beans/.config/mountzara/cf-creds.env 2>/dev/null || true
echo '--- applying schema/0011_phase14_patient_humanization.sql to remote D1 ---'
/usr/local/bin/npx wrangler d1 execute mountzara-clinical --remote \
    --file=schema/0011_phase14_patient_humanization.sql 2>&1 | tail -20

echo ''
echo '--- verify new columns + table ---'
/usr/local/bin/npx wrangler d1 execute mountzara-clinical --remote --json --command \
    "SELECT name FROM pragma_table_info('patients') WHERE name IN ('nickname','photo_r2_key','photo_wrapped_dek','care_goals_json','care_goals_updated_at','photo_uploaded_at')" 2>&1 | tail -8

echo ''
/usr/local/bin/npx wrangler d1 execute mountzara-clinical --remote --json --command \
    "SELECT name FROM sqlite_master WHERE type='table' AND name='patient_personal_notes'" 2>&1 | tail -5
