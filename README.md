# Mount Zara Website

Professional landing page for Mount Zara - Excellence in Minimally Invasive Gynecologic Surgery.

## Deployment Instructions for Cloudflare Pages

### Method 1: Deploy via Git (Recommended)

1. **Push to GitHub** (if not already done):
   ```bash
   git push origin main
   ```

2. **Connect to Cloudflare Pages**:
   - Go to https://dash.cloudflare.com/
   - Navigate to "Workers & Pages"
   - Click "Create application" > "Pages" > "Connect to Git"
   - Select your repository
   - Configure build settings:
     - Framework preset: None
     - Build command: (leave empty)
     - Build output directory: `/`
   - Click "Save and Deploy"

3. **Configure Custom Domain**:
   - After deployment, go to "Custom domains"
   - Click "Set up a custom domain"
   - Enter `mountzara.com`
   - Follow the DNS configuration instructions

### Method 2: Direct Upload (Quick Start)

1. **Go to Cloudflare Dashboard**:
   - Navigate to https://dash.cloudflare.com/
   - Click "Workers & Pages" > "Create application" > "Pages" > "Upload assets"

2. **Upload your site**:
   - Drag and drop the entire project folder (or zip it first)
   - Click "Deploy site"

3. **Configure Custom Domain**:
   - Go to the deployed site settings
   - Click "Custom domains" > "Set up a custom domain"
   - Enter `mountzara.com`
   - Update your DNS settings as instructed

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
