# 🚀 Deploy mountzara.com in 3 Minutes

## Step-by-Step Deployment Guide

This guide will walk you through deploying your Mount Zara website to Cloudflare Pages using the easiest method.

---

## Prerequisites

- ✅ You have a Cloudflare account (you already have one since you bought the domain!)
- ✅ Your code is pushed to GitHub (already done!)
- ✅ You own mountzara.com on Cloudflare (you do!)

---

## Deployment Steps

### Step 1: Access Cloudflare Dashboard

1. Go to https://dash.cloudflare.com/
2. Log in with your Cloudflare account

### Step 2: Navigate to Workers & Pages

1. In the left sidebar, click on **"Workers & Pages"**
2. Click the **"Create application"** button
3. Select the **"Pages"** tab
4. Click **"Connect to Git"**

### Step 3: Connect Your GitHub Repository

1. Click **"Connect GitHub"** (or GitLab if you use that)
2. Authorize Cloudflare to access your GitHub
3. Select your repository: **`Mountzara/MIGS`**
4. Click **"Begin setup"**

### Step 4: Configure Build Settings

On the setup page, enter:

- **Project name**: `mountzara`
- **Production branch**: `main` (or whatever your main branch is called)
- **Framework preset**: `None`
- **Build command**: Leave empty (no build needed!)
- **Build output directory**: `/` (just a forward slash)

Click **"Save and Deploy"**

### Step 5: Wait for Deployment (1-2 minutes)

Cloudflare will now:
- Clone your repository
- Deploy your files
- Give you a temporary URL like `mountzara.pages.dev`

Watch the deployment logs - it should succeed in about 1-2 minutes.

### Step 6: Add Your Custom Domain

Once deployment succeeds:

1. Click on **"Custom domains"** in the top menu
2. Click **"Set up a custom domain"**
3. Enter: `mountzara.com`
4. Click **"Continue"**
5. Since you own the domain on Cloudflare, it will automatically configure DNS!
6. Click **"Activate domain"**

Repeat for www:
1. Click **"Set up a custom domain"** again
2. Enter: `www.mountzara.com`
3. Click **"Continue"** and **"Activate domain"**

### Step 7: Verify It's Live!

1. Wait 1-2 minutes for DNS to propagate
2. Visit https://mountzara.com in your browser
3. You should see your beautiful landing page!

---

## ✅ You're Done!

Your website is now live at:
- https://mountzara.com
- https://www.mountzara.com
- https://mountzara.pages.dev (backup URL)

---

## Automatic Updates

Now whenever you push code to GitHub, Cloudflare will automatically:
- Detect the push
- Build and deploy your changes
- Update your live site in ~1 minute

No manual redeployment needed!

---

## Troubleshooting

### Domain not working?

1. Go to Cloudflare Dashboard → Your Domain → DNS Records
2. Verify you have CNAME records:
   - `@` → `mountzara.pages.dev` (Proxied)
   - `www` → `mountzara.pages.dev` (Proxied)

### Build failed?

- Check the deployment logs in Cloudflare Pages
- Ensure your `index.html` exists in the root directory
- Contact support if issues persist

### SSL Certificate pending?

- This is normal! SSL certificates can take up to 24 hours
- Usually ready in 5-10 minutes
- Your site works, just might show a warning temporarily

---

## Need Help?

- Cloudflare Docs: https://developers.cloudflare.com/pages/
- Cloudflare Support: https://dash.cloudflare.com/?to=/:account/support

---

## What's Next?

Your site is live! You can now:
- Share your URL on social media
- Add more pages (just commit to GitHub and it auto-deploys)
- Monitor analytics in Cloudflare Dashboard
- Set up email forwarding for contact@mountzara.com
- Add more features as needed

---

**Congratulations on launching mountzara.com!** 🎉
