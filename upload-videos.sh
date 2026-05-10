#!/bin/bash

# Mount Zara Video Upload Script
# Uploads surgical videos to Cloudflare R2 for website embedding

set -e

echo "🎥 Mount Zara Video Upload"
echo "=========================="
echo ""

# Check if wrangler is available
if ! command -v npx &> /dev/null; then
    echo "❌ npx not found. Please install Node.js first."
    exit 1
fi

# Video file paths (update these to your actual paths)
VIDEOS=(
    "/Users/beans/Library/Mobile Documents/com~apple~CloudDocs/MIGS Fellowship/RESEARCH PROJECTS/Conference_Submissions/AAGL/AAGL Projects 2024/AAGL Video Projects/Isthmocele/AAGL ICG Isthmocele Ashermans V2.mp4:isthmocele-ashermans.mp4"
    "/Users/beans/Library/Mobile Documents/com~apple~CloudDocs/MIGS Fellowship/RESEARCH PROJECTS/Conference_Submissions/AAGL/AAGL Projects 2024/AAGL Video Projects/RPOC Arcuate Uterus /AAGL HSC RPOC Angular Arcuate V2.mp4:rpoc-golden-hysteroscope.mp4"
    "/Users/beans/Library/Mobile Documents/com~apple~CloudDocs/MIGS Fellowship/RESEARCH PROJECTS/Conference_Submissions/AAGL/AAGL Projects 2024/AAGL Video Projects/Shopping Bag - RA Myomectomy/AAGL Gel-based port extraction myomectomy.mp4:myomectomy-gel-port.mp4"
)

# Create R2 bucket if it doesn't exist
echo "📦 Setting up Cloudflare R2 bucket..."
npx wrangler r2 bucket create mountzara-media 2>/dev/null || echo "Bucket already exists, continuing..."

# Upload each video
for video_pair in "${VIDEOS[@]}"; do
    IFS=':' read -r source_path dest_name <<< "$video_pair"

    if [ -f "$source_path" ]; then
        echo ""
        echo "⬆️  Uploading: $dest_name (this may take a while for large files...)"
        npx wrangler r2 object put "mountzara-media/$dest_name" --file="$source_path"
        echo "✅ Uploaded: $dest_name"
    else
        echo "⚠️  File not found: $source_path"
        echo "    Searched at: $source_path"
    fi
done

echo ""
echo "✅ Upload complete!"
echo ""
echo "🌐 Videos are now available in the mountzara-media R2 bucket"
echo "   They will stream from: https://mountzara.com/media/<filename>"
echo ""
echo "Next: Merge the latest code to main and videos will work automatically."
