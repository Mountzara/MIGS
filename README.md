# Mount Zara Website

Professional landing page for Mount Zara - Excellence in Minimally Invasive Gynecologic Surgery.

## 🚀 Quick Deploy to Cloudflare Pages

### ⚡ EASIEST: One-Click GitHub Deploy (RECOMMENDED)

**This is the simplest method - just click through a web interface:**

1. **Go to Cloudflare Pages**:
   - Visit: https://dash.cloudflare.com/ → Click "Workers & Pages"

2. **Create New Project**:
   - Click "Create application" → "Pages" → "Connect to Git"
   - Authorize GitHub and select your `MIGS` repository

3. **Configure & Deploy**:
   - **Project name**: `mountzara`
   - **Production branch**: `main` (or your current branch)
   - **Framework preset**: None
   - **Build command**: (leave empty)
   - **Build output directory**: `/`
   - Click "Save and Deploy"

4. **Add Your Domain**:
   - Once deployed, go to "Custom domains" → "Set up a custom domain"
   - Enter `mountzara.com`
   - Cloudflare will auto-configure DNS (since you bought the domain there!)
   - Also add `www.mountzara.com`

**Done! Your site will be live in ~2 minutes** ✅

---

### 🔧 ALTERNATIVE: Automated Script Deploy

If you prefer command line, use the included deployment script:

```bash
# First, get your Cloudflare credentials:
# Account ID: https://dash.cloudflare.com/ (shown in sidebar)
# API Token: https://dash.cloudflare.com/profile/api-tokens (Create Token)

export CLOUDFLARE_ACCOUNT_ID="your-account-id-here"
export CLOUDFLARE_API_TOKEN="your-api-token-here"

# Then run the deploy script:
./deploy.sh
```

The script will automatically deploy and configure everything!

---

### 📤 FALLBACK: Manual Upload

If the above methods don't work:

1. Go to https://dash.cloudflare.com/ → "Workers & Pages" → "Create application" → "Pages" → "Upload assets"
2. Drag and drop this entire folder
3. Add custom domain `mountzara.com` in settings

### DNS Configuration

Since you bought the domain from Cloudflare, DNS should be automatic, but verify:

1. Go to your domain in Cloudflare dashboard
2. Ensure these records exist:
   ```
   Type: CNAME
   Name: @
   Target: <your-pages-url>.pages.dev
   Proxied: Yes (orange cloud)
   ```
   ```
   Type: CNAME
   Name: www
   Target: <your-pages-url>.pages.dev
   Proxied: Yes (orange cloud)
   ```

### Testing

After deployment, your site will be available at:
- `https://mountzara.com`
- `https://www.mountzara.com`
- `https://<project-name>.pages.dev`

## File Structure

```
/
├── index.html          # Main landing page
├── about/
│   └── index.html     # About Dr. Mabini
├── assets/
│   └── images/        # Logo and images
├── _redirects         # Cloudflare redirect rules
└── README.md          # This file
```

## Features

- Fast, lightweight, and mobile-responsive
- Modern design with smooth animations
- SEO optimized
- Clean, maintainable code
- No external dependencies

## Maintenance

To update the site:
1. Edit the HTML files locally
2. Test in your browser
3. Commit changes: `git add . && git commit -m "Description"`
4. Push to GitHub: `git push`
5. Cloudflare Pages will auto-deploy your changes

## Support

For issues or questions, contact the development team.
