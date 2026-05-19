#!/bin/bash
# Watch for /tmp/encode_rpoc_arcuate.done to appear, then immediately run the
# deploy script so the full-quality rpoc-arcuate.mp4 gets uploaded and the
# Pages deploy completes. Auto-exits whether successful or after a 60-minute
# timeout (encode should never take that long with hw acceleration).

LOG=/tmp/watch_and_deploy.log
: > "$LOG"
echo "==> watcher start $(date)" >> "$LOG"

# Wait up to 60 minutes (360 * 10s = 3600s) for the encode to finish
for i in $(seq 1 360); do
  if [ -f /tmp/encode_rpoc_arcuate.done ]; then
    echo "==> .done detected after ${i}x10s — file size:" >> "$LOG"
    ls -lh /tmp/migs-previews/rpoc-arcuate.mp4 >> "$LOG" 2>&1
    break
  fi
  sleep 10
done

if [ ! -f /tmp/encode_rpoc_arcuate.done ]; then
  echo "==> TIMEOUT after 60 minutes — encode never produced .done marker" >> "$LOG"
  exit 1
fi

# Sanity: ensure the rpoc-arcuate.mp4 is reasonably sized (>5 MB)
SIZE=$(stat -f %z /tmp/migs-previews/rpoc-arcuate.mp4 2>/dev/null || echo 0)
if [ "$SIZE" -lt 5000000 ]; then
  echo "==> ABORT — full file too small ($SIZE bytes), encode likely failed" >> "$LOG"
  exit 1
fi

echo "==> running deploy-with-token.sh (token must already be on clipboard)" >> "$LOG"
bash /Users/beans/Developer/MountZara/MIGS/scripts/deploy-with-token.sh >> "$LOG" 2>&1
echo "==> deploy exit $?" >> "$LOG"

# Verify the full URL is live
sleep 12
STATUS=$(curl -sS -o /dev/null -w '%{http_code}' -A 'Mozilla/5.0' 'https://mountzara.com/media/rpoc-arcuate.mp4')
SIZEB=$(curl -sSI -A 'Mozilla/5.0' 'https://mountzara.com/media/rpoc-arcuate.mp4' | awk '/content-length/ {print $2}' | tr -d '\r\n')
echo "==> live verify: HTTP $STATUS, size=${SIZEB}B" >> "$LOG"

# Wipe clipboard
printf '' | /usr/bin/pbcopy
echo "==> done $(date)" >> "$LOG"
