#!/bin/bash
# Encode the new RPOC arcuate uterus video for the website.
# Source: 4.8 GB .mov on the FMIGS Drive
# Output: preview (10s, 720p, faststart) + full (1080p web-quality, faststart)
# Drops into /tmp/migs-previews/ alongside the other previews so the
# existing deploy-with-token.sh picks it up automatically (after we
# extend the script to handle the new filenames).

set -u

OUT=/tmp/migs-previews
LOG=/tmp/encode_rpoc_arcuate.log
DONE=/tmp/encode_rpoc_arcuate.done
mkdir -p "$OUT"
: > "$LOG"
rm -f "$DONE"

FFMPEG=/opt/homebrew/bin/ffmpeg
[ -x "$FFMPEG" ] || FFMPEG=/usr/local/bin/ffmpeg

SRC="/Volumes/FMIGS Drive/HSC RPOC Video/Hysteroscopic removal of retained products of conception (RPOC) in arcuate uterus V2.mov"

date "+==> %F %T start" >> "$LOG"

# Preview clip — 10 seconds starting 10 seconds in, 720p max, CRF 27, faststart, no audio
echo "==> encode rpoc-arcuate-preview.mp4 (10s preview)" >> "$LOG"
"$FFMPEG" -y -hide_banner -loglevel warning -nostats \
    -ss 10 -i "$SRC" -t 10 \
    -vf "scale='min(1280,iw)':-2,format=yuv420p" -r 30 \
    -c:v libx264 -preset slow -crf 27 -profile:v high -level 4.0 -pix_fmt yuv420p \
    -movflags +faststart -an \
    "$OUT/rpoc-arcuate-preview.mp4" >> "$LOG" 2>&1
echo "preview rc=$?" >> "$LOG"
ls -lh "$OUT/rpoc-arcuate-preview.mp4" >> "$LOG" 2>&1 || true

# Full quality web version — 1080p max, faststart, AAC audio (96 kbps).
# Uses Apple Silicon's h264_videotoolbox hardware encoder (5-10x faster than
# software libx264 for a 4.8 GB source). Quality target ~3-5 Mbps for a good
# balance between visual fidelity and file size.
echo "==> encode rpoc-arcuate.mp4 (full web-quality, hw-accel)" >> "$LOG"
"$FFMPEG" -y -hide_banner -loglevel warning -nostats \
    -i "$SRC" \
    -vf "scale='min(1920,iw)':-2,format=yuv420p" \
    -c:v h264_videotoolbox -b:v 4500k -maxrate 5500k -bufsize 9000k \
        -profile:v high -level 4.1 -pix_fmt yuv420p \
    -movflags +faststart \
    -c:a aac -b:a 96k -ac 2 \
    "$OUT/rpoc-arcuate.mp4" >> "$LOG" 2>&1
echo "full rc=$?" >> "$LOG"
ls -lh "$OUT/rpoc-arcuate.mp4" >> "$LOG" 2>&1 || true

date "+==> %F %T DONE" >> "$LOG"
echo OK > "$DONE"
