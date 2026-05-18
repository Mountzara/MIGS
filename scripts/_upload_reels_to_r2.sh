#!/usr/bin/env bash
# _upload_reels_to_r2.sh — push the 4 generated reel files to mountzara-media R2.
# Pulls CF API token from Keychain.

set -euo pipefail

export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin
export CLOUDFLARE_API_TOKEN=$(security find-generic-password -s mountzara-cloudflare-deploy-token -w 2>/dev/null)

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
    echo "ERROR: cloudflare token not in Keychain (service mountzara-cloudflare-deploy-token)"
    exit 1
fi

REPO_ROOT="/Users/beans/Developer/MountZara/MIGS"
cd "$REPO_ROOT"

REELS=(
    "rpoc-golden-hysteroscope-reel.mp4"
    "myomectomy-gel-port-reel.mp4"
    "isthmocele-ashermans-reel.mp4"
    "rpoc-arcuate-reel.mp4"
)

for R in "${REELS[@]}"; do
    SRC="/tmp/mz_reels/$R"
    if [ ! -f "$SRC" ]; then
        echo "ERROR: $SRC not found"
        exit 1
    fi
    echo "==> uploading $R ($(ls -lh "$SRC" | awk '{print $5}'))"
    /usr/local/bin/npx wrangler r2 object put "mountzara-media/$R" \
        --file="$SRC" \
        --content-type=video/mp4 \
        --remote 2>&1 | tail -5
done

echo ""
echo "All reels uploaded to mountzara-media."
