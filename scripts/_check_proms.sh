#!/usr/bin/env bash
# Quick sanity check: list seeded PROM definitions + Jane Doe's assignments.
set -euo pipefail
export PATH=/usr/local/bin:/Users/beans/.nvm/versions/node/v22.18.0/bin:$PATH
export CLOUDFLARE_API_TOKEN=$(security find-generic-password -s mountzara-cloudflare-deploy-token -w)
cd /Users/beans/Developer/MountZara/MIGS

echo "== prom_definitions =="
/usr/local/bin/npx wrangler d1 execute mountzara-clinical --remote --json --command="SELECT slug, tier, short_name, domain FROM prom_definitions ORDER BY tier, slug;" 2>/dev/null \
    | python3 -c "import sys,json; rows=json.load(sys.stdin)[0]['results']; [print('  tier{}  {:14s} {:12s} {}'.format(r['tier'], r['slug'], r['short_name'] or '', r['domain'] or '')) for r in rows]"

echo
echo "== Jane Doe assignments =="
/usr/local/bin/npx wrangler d1 execute mountzara-clinical --remote --json --command="SELECT prom_slug, status, period_label, substr(trigger_reason,1,70) AS reason FROM prom_assignments WHERE patient_id='8cc1aa63-5931-4c54-babb-e06bc196d743' ORDER BY assigned_at DESC;" 2>/dev/null \
    | python3 -c "import sys,json; rows=json.load(sys.stdin)[0]['results']; [print('  {:10s} {:12s} {:10s} {}'.format(r['prom_slug'], r['status'], r['period_label'] or '', r['reason'] or '')) for r in rows]"
