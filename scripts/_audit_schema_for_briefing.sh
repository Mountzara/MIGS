#!/usr/bin/env bash
set -e
cd /Users/beans/Developer/MountZara/MIGS
export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH
source /Users/beans/.config/mountzara/cf-creds.env 2>/dev/null || true

for table in appointments appointment_triage prom_responses prom_assignments \
             prom_definitions patient_snapshots snapshot_problem_list \
             snapshot_action_items intake_responses; do
    echo "=== $table ==="
    /usr/local/bin/npx wrangler d1 execute mountzara-clinical --remote --command \
        "SELECT name FROM pragma_table_info('$table')" 2>&1 | \
        grep -E '"name":' | sed 's/.*"name": "/  /' | sed 's/".*//' | tr '\n' ' '
    echo ''
    echo ''
done
