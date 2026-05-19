#!/usr/bin/env bash
set -e
cd /Users/beans/Developer/MountZara/MIGS
export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH
source /Users/beans/.config/mountzara/cf-creds.env 2>/dev/null || true
JANE_PID='8cc1aa63-5931-4c54-babb-e06bc196d743'

for section in 4 7 8 10 12 13 14; do
    echo "=== Section $section ==="
    /usr/local/bin/npx wrangler d1 execute mountzara-clinical --remote --command \
        "SELECT section_key, data_json FROM intake_section_data WHERE intake_id IN (SELECT id FROM intake_responses WHERE patient_id='$JANE_PID' ORDER BY started_at DESC LIMIT 1) AND section_number=$section" \
        2>&1 | tail -8
    echo ''
done
