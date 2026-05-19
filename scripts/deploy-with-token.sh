#!/bin/bash
# Token-based deploy: reads CLOUDFLARE_API_TOKEN from environment (or clipboard via pbpaste fallback).
# Uploads 3 preview clips to R2 bucket mountzara-media, deploys updated index.html via Pages,
# then HEAD-checks each new URL to confirm 200.

set -euo pipefail
export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin
export TERM=dumb

REPO=/Users/beans/Developer/MountZara/MIGS
PREVIEW_DIR=/tmp/migs-previews
cd "$REPO"

# Source the token: env first, else clipboard. Clipboard is whitespace-trimmed.
TOKEN="${CLOUDFLARE_API_TOKEN:-}"
if [ -z "$TOKEN" ]; then
  TOKEN=$(pbpaste | tr -d '[:space:]')
fi
if [ -z "$TOKEN" ]; then
  echo "FAIL: no token in env or clipboard"
  exit 1
fi
# Sanity: Cloudflare tokens are 40-char alphanumeric. Don't echo the token itself.
if ! [[ "$TOKEN" =~ ^[A-Za-z0-9_-]{30,80}$ ]]; then
  echo "FAIL: clipboard doesn't look like a Cloudflare token (len=${#TOKEN})"
  exit 1
fi
export CLOUDFLARE_API_TOKEN="$TOKEN"
echo "==> token loaded (length ${#TOKEN})"

# Discover account ID from the token by calling Cloudflare's accounts API directly.
echo "==> resolving Cloudflare account ID via API..."
ACCT_JSON=$(curl -sS -X GET https://api.cloudflare.com/client/v4/accounts \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")
ACCT_ID=$(echo "$ACCT_JSON" | /usr/bin/python3 -c 'import json,sys;d=json.load(sys.stdin);print(d["result"][0]["id"]) if d.get("success") else sys.exit("no_account")')
if [ -z "${ACCT_ID:-}" ]; then
  echo "FAIL: could not resolve account ID from token"
  echo "$ACCT_JSON" | head -c 500
  exit 1
fi
export CLOUDFLARE_ACCOUNT_ID="$ACCT_ID"
echo "==> account ID = $ACCT_ID"

echo "==> auditing preview files (re-upload only if local copy exists)"
PRESENT_PREVIEWS=()
MISSING_PREVIEWS=()
for f in rpoc-golden-hysteroscope-preview.mp4 myomectomy-gel-port-preview.mp4 isthmocele-ashermans-preview.mp4 rpoc-arcuate-preview.mp4 ; do
  if [ -s "$PREVIEW_DIR/$f" ]; then
    PRESENT_PREVIEWS+=("$f")
    echo "  ok $f ($(du -h "$PREVIEW_DIR/$f" | awk '{print $1}'))"
  else
    MISSING_PREVIEWS+=("$f")
    echo "  skip $f (no local copy — relying on existing R2 object)"
  fi
done

if [ "${#PRESENT_PREVIEWS[@]}" -gt 0 ]; then
  echo "==> uploading ${#PRESENT_PREVIEWS[@]} preview(s) to R2 bucket mountzara-media"
  for f in "${PRESENT_PREVIEWS[@]}" ; do
    echo "  -> $f"
    npx wrangler r2 object put "mountzara-media/$f" --file="$PREVIEW_DIR/$f" --remote
  done
else
  echo "==> no preview files staged locally — skipping R2 preview uploads (existing R2 objects unchanged)"
fi

# Upload the full-quality rpoc-arcuate.mp4 the first time it appears AND its
# encode is verifiably complete (the encode script writes /tmp/encode_rpoc_arcuate.done
# only after a clean exit). Other full-quality videos were uploaded during the
# original migration; only the new card needs its full file pushed here.
if [ -s "$PREVIEW_DIR/rpoc-arcuate.mp4" ] && [ -f /tmp/encode_rpoc_arcuate.done ]; then
  echo "==> uploading full-quality rpoc-arcuate.mp4 to R2 bucket mountzara-media"
  npx wrangler r2 object put "mountzara-media/rpoc-arcuate.mp4" --file="$PREVIEW_DIR/rpoc-arcuate.mp4" --remote
elif [ -s "$PREVIEW_DIR/rpoc-arcuate.mp4" ]; then
  echo "==> skipping rpoc-arcuate.mp4 upload — encode still in progress (.done not yet present)"
fi

echo "==> deploying Pages (project: mountzara)"
npx wrangler pages deploy . --project-name=mountzara --branch=main --commit-dirty=true

echo "==> waiting 10s for CDN propagation"
sleep 10

echo "==> verifying live preview URLs"
for f in rpoc-golden-hysteroscope-preview.mp4 myomectomy-gel-port-preview.mp4 isthmocele-ashermans-preview.mp4 rpoc-arcuate-preview.mp4 ; do
  status=$(curl -sS -o /dev/null -w '%{http_code}' -A 'Mozilla/5.0' "https://mountzara.com/media/$f")
  size=$(curl -sSI -A 'Mozilla/5.0' "https://mountzara.com/media/$f" | awk '/content-length/ {print $2}' | tr -d '\r\n')
  echo "  $status  size=${size}B  https://mountzara.com/media/$f"
done

echo "==> verifying deployed HTML references previews"
curl -sS -A 'Mozilla/5.0' "https://mountzara.com/?bust=$(date +%s)" -o /tmp/_live.html
count=$(grep -c -- '-preview\.mp4' /tmp/_live.html)
echo "  '-preview.mp4' occurrences in live HTML: $count (expect 4)"

echo "==> done"
