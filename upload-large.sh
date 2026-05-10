#!/usr/bin/env bash
# upload-large.sh — Resumable, low-memory uploader for files of any size.
#
# Streams chunks directly from disk into the mountzara.com /upload-mpu
# multipart endpoint. Never loads the whole file into RAM. Needs no
# extra disk space beyond the source file (no temp copies).
#
# Usage:
#   ./scripts/upload-large.sh /path/to/local-file.mp4 destination-key.mp4
#
# Env: UPLOAD_TOKEN (required). On Mac, paste the bearer token in.

set -euo pipefail

# URL-encode helper (must be defined before use)
urlencode() {
    python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$1"
}

FILE="${1:-}"
KEY="${2:-}"
ENDPOINT="${ENDPOINT:-https://mountzara.com/upload-mpu}"
CHUNK_MB="${CHUNK_MB:-90}"   # under Cloudflare's 100MB edge limit
TOKEN="${UPLOAD_TOKEN:-}"

if [ -z "$FILE" ] || [ -z "$KEY" ]; then
    echo "Usage: $0 <local-file> <r2-key>" >&2
    exit 2
fi
if [ -z "$TOKEN" ]; then
    echo "ERROR: set UPLOAD_TOKEN env var (export UPLOAD_TOKEN='...')" >&2
    exit 2
fi
if [ ! -f "$FILE" ]; then
    echo "ERROR: file not found: $FILE" >&2
    exit 2
fi

# File size — works on macOS and Linux
if SIZE=$(stat -f%z "$FILE" 2>/dev/null); then :; else SIZE=$(stat -c%s "$FILE"); fi

CHUNK_BYTES=$(( CHUNK_MB * 1024 * 1024 ))
PARTS=$(( (SIZE + CHUNK_BYTES - 1) / CHUNK_BYTES ))

echo "📤 Uploading $FILE → $KEY"
printf "   size: %s bytes (%.1f MB), %d parts of %d MB\n" \
    "$SIZE" "$(awk "BEGIN{print $SIZE/1048576}")" "$PARTS" "$CHUNK_MB"

# 1. init multipart upload
INIT=$(curl -fsS -X POST -H "Authorization: Bearer $TOKEN" "$ENDPOINT/init?key=$(urlencode "$KEY")")
UPLOAD_ID=$(echo "$INIT" | python3 -c "import json,sys;print(json.load(sys.stdin)['uploadId'])")
echo "   uploadId: $UPLOAD_ID"

# Build parts array as we go
PARTS_FILE="$(mktemp)"
trap 'rm -f "$PARTS_FILE"' EXIT
echo "[" > "$PARTS_FILE"

for (( i=1; i<=PARTS; i++ )); do
    OFFSET=$(( (i - 1) * CHUNK_BYTES ))
    REMAINING=$(( SIZE - OFFSET ))
    THIS_CHUNK=$(( REMAINING < CHUNK_BYTES ? REMAINING : CHUNK_BYTES ))

    printf "   part %d/%d (%d bytes)... " "$i" "$PARTS" "$THIS_CHUNK"

    # Stream the chunk from disk via dd → curl. No file copies, no RAM blowup.
    # bs=1M (uppercase) and skip=N work on both Linux and macOS.
    RESP=$(dd if="$FILE" bs=1M skip=$(( (i - 1) * CHUNK_MB )) count=$CHUNK_MB 2>/dev/null \
        | curl -fsS -X PUT \
            -H "Authorization: Bearer $TOKEN" \
            -H "Content-Type: application/octet-stream" \
            --data-binary @- \
            "$ENDPOINT/part?key=$(urlencode "$KEY")&uploadId=$UPLOAD_ID&partNumber=$i")

    ETAG=$(echo "$RESP" | python3 -c "import json,sys;print(json.load(sys.stdin)['etag'])")
    echo "etag=$ETAG"

    if [ "$i" -gt 1 ]; then echo "," >> "$PARTS_FILE"; fi
    printf '{"partNumber":%d,"etag":%s}' "$i" "$(python3 -c "import json,sys;print(json.dumps('$ETAG'))")" >> "$PARTS_FILE"
done

echo "" >> "$PARTS_FILE"
echo "]" >> "$PARTS_FILE"

echo "   completing..."
RESULT=$(curl -fsS -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    --data-binary "@$PARTS_FILE" \
    "$ENDPOINT/complete?key=$(urlencode "$KEY")&uploadId=$UPLOAD_ID")
echo "✅ Done: $RESULT"
