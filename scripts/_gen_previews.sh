#!/bin/bash
# One-shot: generate 3 web-preview clips for mountzara.com research cards.
# Source: the existing full-size MP4s already in R2 (Cloudflare CDN), via HTTPS range requests.
# Why: the original iCloud-stored sources on disk are 0-byte cloud-only stubs;
#      fetching ~15 MB via Cloudflare CDN is much faster than materializing 600MB-1.2GB
#      from iCloud Drive. ffmpeg supports http(s) input with range-request seeking.
# Output: /tmp/migs-previews/*-preview.mp4
# Spec: 10-second slice from 10s in, 720p (aspect preserved), H.264 CRF 27, +faststart, no audio.

set -u  # no -e: keep going past a single failed encode so partial output is visible

OUT=/tmp/migs-previews
LOG=/tmp/migs-previews.log
DONE=/tmp/migs-previews.done
mkdir -p "$OUT"
: > "$LOG"
rm -f "$DONE"

FFMPEG=/opt/homebrew/bin/ffmpeg
[ -x "$FFMPEG" ] || FFMPEG=/usr/local/bin/ffmpeg

encode() {
  local url="$1" out="$2" start="$3" dur="$4"
  echo "=== encode $out (R2: $url, start=${start}s dur=${dur}s) ===" >> "$LOG"
  "$FFMPEG" -y -hide_banner -loglevel warning -nostats \
    -reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5 \
    -ss "$start" -i "$url" -t "$dur" \
    -vf "scale='min(1280,iw)':-2,format=yuv420p" -r 30 \
    -c:v libx264 -preset slow -crf 27 -profile:v high -level 4.0 -pix_fmt yuv420p \
    -movflags +faststart -an \
    "$OUT/$out" >> "$LOG" 2>&1
  local rc=$?
  echo "exit=$rc" >> "$LOG"
  ls -lh "$OUT/$out" >> "$LOG" 2>&1 || true
  return $rc
}

encode https://mountzara.com/media/rpoc-golden-hysteroscope.mp4  rpoc-golden-hysteroscope-preview.mp4 10 10
encode https://mountzara.com/media/myomectomy-gel-port.mp4       myomectomy-gel-port-preview.mp4      10 10
encode https://mountzara.com/media/isthmocele-ashermans.mp4      isthmocele-ashermans-preview.mp4     10 10

{
  echo "=== final listing ==="
  ls -lh "$OUT"
  echo "=== faststart probe (moov should appear in first 64 bytes) ==="
  for f in "$OUT"/*-preview.mp4; do
    echo "--- $f ---"
    xxd "$f" 2>/dev/null | head -3
    "$FFMPEG"_probe="${FFMPEG%/ffmpeg}/ffprobe"
    [ -x "${FFMPEG%/ffmpeg}/ffprobe" ] && "${FFMPEG%/ffmpeg}/ffprobe" -v error -show_entries format=duration,size,bit_rate -of default=noprint_wrappers=1 "$f" 2>&1
  done
} >> "$LOG" 2>&1

echo OK > "$DONE"
