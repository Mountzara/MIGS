#!/usr/bin/env bash
# generate_video_reels.sh — Generate 30-second "reel" preview files from the
# 4 long-form research videos on the homepage. Each reel is three 10-second
# segments concatenated, sampled at musically-relevant timestamps so the
# autoplay loop feels like a real highlight reel rather than a frozen
# opening shot.
#
# Per user (2026-05-17): "create snippets to play a continuous reel of 10
# second snippets at 2, 4, 5 minutes so its more of a real reel than just
# a 10 sec autoplay clip"
#
# For videos >5min: segments at 2:00, 4:00, 5:00 (120s, 240s, 300s)
# For rpoc-arcuate.mp4 (127s / 2:07): segments at 0:20, 1:00, 1:40
#
# Output: <name>-reel.mp4 — H.264 yuv420p, +faststart, scaled to 1280x720,
# no audio, ~2.5 Mbps. Browser-autoplay friendly across Safari/Chrome/Firefox.
#
# Runs via osascript on the user's Mac (sandbox proxy blocks R2). Uploads to
# mountzara-media R2 bucket via wrangler.

set -euo pipefail

FFMPEG="/opt/homebrew/bin/ffmpeg"
FFPROBE="/opt/homebrew/bin/ffprobe"
WORK="/tmp/mz_reels"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

mkdir -p "$WORK"
cd "$WORK"

# Each entry: <filename>|<t1>|<t2>|<t3>  (segment start seconds, each 10s long)
ENTRIES=(
    "rpoc-golden-hysteroscope.mp4|120|240|300"
    "myomectomy-gel-port.mp4|120|240|300"
    "isthmocele-ashermans.mp4|120|240|300"
    "rpoc-arcuate.mp4|20|60|100"
)

for entry in "${ENTRIES[@]}"; do
    IFS='|' read -r SRC T1 T2 T3 <<< "$entry"
    BASE="${SRC%.mp4}"
    REEL="${BASE}-reel.mp4"

    if [ ! -f "$SRC" ]; then
        echo "ERROR: master file missing: $WORK/$SRC"
        exit 1
    fi

    DUR=$("$FFPROBE" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$SRC")
    echo "==> $SRC (duration ${DUR}s) → segments @ ${T1}s, ${T2}s, ${T3}s"

    # Cut 3 × 10-second segments. Use -ss BEFORE -i for fast seeking;
    # combined with re-encode this lands accurately enough for a preview reel.
    for i in 1 2 3; do
        eval T=\$T$i
        SEG="${BASE}-seg${i}.mp4"
        rm -f "$SEG"
        "$FFMPEG" -hide_banner -loglevel error -y \
            -ss "$T" -i "$SRC" -t 10 \
            -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:black,setsar=1" \
            -c:v libx264 -profile:v high -level 4.0 -pix_fmt yuv420p \
            -preset medium -crf 23 -an \
            -movflags +faststart \
            "$SEG"
    done

    # Build concat list and stitch with stream copy (segments share codec params).
    LIST="${BASE}-concat.txt"
    printf "file '%s-seg1.mp4'\nfile '%s-seg2.mp4'\nfile '%s-seg3.mp4'\n" "$BASE" "$BASE" "$BASE" > "$LIST"

    rm -f "$REEL"
    "$FFMPEG" -hide_banner -loglevel error -y \
        -f concat -safe 0 -i "$LIST" \
        -c copy -movflags +faststart \
        "$REEL"

    # Cleanup intermediates
    rm -f "${BASE}-seg1.mp4" "${BASE}-seg2.mp4" "${BASE}-seg3.mp4" "$LIST"

    SIZE=$(ls -lh "$REEL" | awk '{print $5}')
    REEL_DUR=$("$FFPROBE" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$REEL")
    echo "    ✓ $REEL  ($SIZE, ${REEL_DUR}s)"
done

echo ""
echo "All reels generated in $WORK"
ls -lh "$WORK"/*-reel.mp4
