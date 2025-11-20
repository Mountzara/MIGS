# ⚡ Deploy mountzara.com in 60 Seconds

Your landing page is ready! Just one quick step to make it live:

## Run This One Command:

```bash
./quick-deploy.sh
```

That's it! The script will:
1. Ask you to paste your Cloudflare API token (one-time only)
2. Deploy everything automatically
3. Tell you the final step to add your domain

## Getting Your API Token (30 seconds):

1. Visit: https://dash.cloudflare.com/profile/api-tokens/create
2. Click "Create Custom Token"
3. Give it a name: `mountzara-deploy`
4. Set permissions:
   - **Account** > **Cloudflare Pages** > **Edit**
5. Click "Continue to summary" → "Create Token"
6. Copy the token
7. Paste it when the script asks

Done! Your site will be live at mountzara.com

---

## Why Do You Need This?

Cloudflare requires authentication to deploy sites (for security). This is a one-time setup - after this, future deployments can happen automatically via GitHub Actions.

---

## Alternative: Use Cloudflare Dashboard (No Token Needed)

If you prefer clicking instead of using CLI:

1. Go to https://dash.cloudflare.com/
2. Click "Workers & Pages" → "Create application" → "Pages" → "Connect to Git"
3. Select your `MIGS` repository
4. Configure:
   - Project: `mountzara`
   - Branch: `main`
   - Framework: None
   - Build command: (empty)
   - Build directory: `/`
5. Click "Save and Deploy"
6. Add custom domain: `mountzara.com`

Takes ~3 minutes clicking through the interface.

---

## Questions?

See `DEPLOY.md` for detailed instructions or troubleshooting.
