#!/usr/bin/env bash
set -e
cd /Users/beans/Developer/MountZara/MIGS
export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH
source /Users/beans/.config/mountzara/cf-creds.env 2>/dev/null || true

echo '--- new patients columns ---'
/usr/local/bin/npx wrangler d1 execute mountzara-clinical --remote --command "SELECT name FROM pragma_table_info('patients') WHERE name IN ('nickname','photo_r2_key','photo_wrapped_dek','care_goals_json','care_goals_updated_at','photo_uploaded_at')" 2>&1 | tail -15

echo ''
echo '--- patient_personal_notes table ---'
/usr/local/bin/npx wrangler d1 execute mountzara-clinical --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name='patient_personal_notes'" 2>&1 | tail -6

echo ''
echo '--- patient_personal_notes columns ---'
/usr/local/bin/npx wrangler d1 execute mountzara-clinical --remote --command "SELECT name FROM pragma_table_info('patient_personal_notes')" 2>&1 | tail -25
