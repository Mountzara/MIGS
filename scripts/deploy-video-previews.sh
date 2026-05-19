#!/bin/bash
# Deploy mountzara.com video-preview fix.
# Prereq: run `npx wrangler login` once first (opens browser, click through).
# What this does:
#   1. Uploads the 3 preview clips at /tmp/migs-previews/*-preview.mp4 to R2 bucket mountzara-media
#   2. Runs `wrangler pages deploy .` to push the updated index.html (preview-source URLs) live
#   3. HEAD-checks each preview URL on mountzara.com to verify it returned HTTP 200
# Assumes wrangler.toml in this directory has the R2 binding MEDIA -> mountzara-media.

set -euo pipefail

export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH
REPO=/Users/beans/Developer/MountZara/MIGS
PREVIEW_DIR=/tmp/migs-previews

cd "$REPO"

echo "==> Verifying preview files are present"
for f in rpoc-golden-hysteroscope-preview.mp4 myomectomy-gel-port-preview.mp4 isthmocele-ashermans-preview.mp4 ; do
  if [ ! -s "$PREVIEW_DIR/$f" ]; then
    echo "FAIL: missing or empty: $PREVIEW_DIR/$f" ; exit 1
  fi
  echo "  ok: $PREVIEW_DIR/$f ($(du -h "$PREVIEW_DIR/$f" | awk '{print $1}'))"
done

echo ""
echo "==> Checking wrangler auth"
if ! npx wrangler whoami 2>&1 | grep -q '@'; then
  echo "Not logged in. Run:    npx wrangler login"
  exit 2
fi

echo ""
echo "==> Uploading previews to R2 bucket mountzara-media"
for f in rpoc-golden-hysteroscope-preview.mp4 myomectomy-gel-port-preview.mp4 isthmocele-ashermans-preview.mp4 ; do
  echo "  -> $f"
  npx wrangler r2 object put "mountzara-media/$f" --file="$PREVIEW_DIR/$f" --remote
done

echo ""
echo "==> Deploying Pages site (project: mountzara)"
npx wrangler pages deploy . --project-name=mountzara --branch=main --commit-dirty=true

echo ""
echo "==> Waiting 10s for CDN propagation then verifying live URLs"
sleep 10
for f in rpoc-golden-hysteroscope-preview.mp4 myomectomy-gel-port-preview.mp4 isthmocele-ashermans-preview.mp4 ; do
  url="https://mountzara.com/media/$f"
  status=$(curl -sS -o /dev/null -w '%{http_code}' -A 'Mozilla/5.0' "$url")
  echo "  $status   $url"
  if [ "$status" != "200" ]; then
    echo "  ^^^ WARNING: expected 200"
  fi
done

echo ""
echo "==> Verifying the deployed index.html uses preview URLs"
curl -sS -A 'Mozilla/5.0' https://mountzara.com/ -o /tmp/_live_index.html
grep -c 'preview\.mp4' /tmp/_live_index.html | awk '{print "  preview-url occurrences in live HTML: " $1 " (expect 3)"}'

echo ""
echo "Done. Hard-reload the site (Cmd+Shift+R) to bypass any stale browser cache."
