# Video Setup Instructions

## Step 1: Upload Videos to Cloudflare R2

**On your Mac, run this command:**

```bash
cd /path/to/your/MIGS/folder
export CLOUDFLARE_API_TOKEN="your-cloudflare-api-token-here"
export CLOUDFLARE_ACCOUNT_ID="your-account-id-here"
./upload-videos.sh
```

*Note: Use the same Cloudflare credentials from the initial site deployment.*

This will:
1. Create a Cloudflare R2 bucket called `mountzara-videos`
2. Upload all 3 surgical videos
3. Make them available for embedding

## Step 2: Configure R2 Public Access

After upload, configure public access in Cloudflare dashboard:

1. Go to https://dash.cloudflare.com/ → R2
2. Click on `mountzara-videos` bucket
3. Go to Settings → Public Access
4. Enable "Allow Access" with custom domain or R2.dev subdomain

## Videos to Upload

1. **Golden Hysteroscope Winner** → `rpoc-golden-hysteroscope.mp4`
   - RPOC from Angular Pregnancy in Arcuate Uterus

2. **Isthmocele with Asherman's** → `isthmocele-ashermans.mp4`
   - ICG-guided hysteroscopic-assisted robotic repair

3. **Robotic Myomectomy** → `myomectomy-gel-port.mp4`  
   - Gel-based port and bag containment system

## After Upload

The videos will be embedded in the research cards automatically once the R2 URLs are live.

## Alternative: Use assets/videos (simpler, but large files in git)

If you prefer to avoid R2 setup:

```bash
# Copy videos to project
cp "/Users/beans/Library/Mobile Documents/com~apple~CloudDocs/MIGS Fellowship/RESEARCH PROJECTS/Conference_Submissions/AAGL/AAGL Projects 2024/AAGL Video Projects/Isthmocele/AAGL ICG Isthmocele Ashermans V2.mp4" assets/videos/isthmocele-ashermans.mp4

cp "/Users/beans/Library/Mobile Documents/com~apple~CloudDocs/MIGS Fellowship/RESEARCH PROJECTS/Conference_Submissions/AAGL/AAGL Projects 2024/AAGL Video Projects/RPOC Arcuate Uterus /AAGL HSC RPOC Angular Arcuate V2.mp4" assets/videos/rpoc-golden-hysteroscope.mp4

cp "/Users/beans/Library/Mobile Documents/com~apple~CloudDocs/MIGS Fellowship/RESEARCH PROJECTS/Conference_Submissions/AAGL/AAGL Projects 2024/AAGL Video Projects/Shopping Bag - RA Myomectomy/AAGL Gel-based port extraction myomectomy.mp4" assets/videos/myomectomy-gel-port.mp4

# Add to .gitignore to prevent bloating repo
echo "assets/videos/*.mp4" >> .gitignore

# Deploy
git add assets/.gitkeep
git commit -m "Prepare for video uploads"
./deploy.sh
```

Then manually upload the videos to Cloudflare Pages via dashboard.
