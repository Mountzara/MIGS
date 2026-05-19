#!/usr/bin/env bash
# Wrapper for osascript-launched deploys — sets PATH so npx is found.
set -euo pipefail
export PATH="/usr/local/bin:/Users/beans/.nvm/versions/node/v22.18.0/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
cd "$(dirname "$0")/.."
exec bash scripts/deploy-prod.sh "$@"
