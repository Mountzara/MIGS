#!/usr/bin/env bash
set -e
cd /Users/beans/Developer/MountZara/MIGS
export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH
source /Users/beans/.config/mountzara/cf-creds.env 2>/dev/null || true
JANE_PID='8cc1aa63-5931-4c54-babb-e06bc196d743'

for section in 4 7 8 10 12 13 14; do
    echo "=== Section $section ==="
    /usr/local/bin/npx wrangler d1 execute mountzara-clinical --remote --json --command \
        "SELECT data_json FROM intake_section_data WHERE intake_id IN (SELECT id FROM intake_responses WHERE patient_id='$JANE_PID' ORDER BY started_at DESC LIMIT 1) AND section_number=$section" \
        2>/dev/null \
        | /usr/bin/python3 -c '
import json, sys
d = json.load(sys.stdin)
rs = d[0].get("results", []) if isinstance(d, list) else []
if not rs:
    print("  (no data)")
else:
    raw = rs[0].get("data_json", "")
    try:
        parsed = json.loads(raw)
        print(json.dumps(parsed, indent=2))
    except Exception:
        print(raw[:600])
'
    echo ''
done
