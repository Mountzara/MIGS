#!/bin/bash
set -euo pipefail
export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin
export CLOUDFLARE_API_TOKEN=$(/usr/bin/security find-generic-password -s 'mountzara-cloudflare-deploy-token' -w)
cd /Users/beans/Developer/MountZara/MIGS
npx --yes wrangler@latest pages deploy . --project-name=mountzara --branch=main --commit-dirty=true > /tmp/_dep_p25a.txt 2>&1
grep -E 'Deployment complete|ERROR' /tmp/_dep_p25a.txt | sed 's/\x1b\[[0-9;]*m//g' | head -10
