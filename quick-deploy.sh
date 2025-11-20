#!/bin/bash

# One-Command Cloudflare Deploy for mountzara.com
# This script will deploy your site immediately

echo "🚀 Deploying mountzara.com to Cloudflare Pages..."
echo ""

# Check if credentials are set
if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
    echo "⚠️  Quick Setup Needed:"
    echo ""
    echo "1. Open this URL in your browser:"
    echo "   👉 https://dash.cloudflare.com/profile/api-tokens/create"
    echo ""
    echo "2. Click 'Create Custom Token'"
    echo "3. Set:"
    echo "   - Token name: mountzara-deploy"
    echo "   - Permissions: Account > Cloudflare Pages > Edit"
    echo "   - Account Resources: Include > Your Account"
    echo ""
    echo "4. Click 'Continue to summary' then 'Create Token'"
    echo "5. Copy the token and paste it when prompted below"
    echo ""

    read -p "Paste your Cloudflare API Token here: " CLOUDFLARE_API_TOKEN
    export CLOUDFLARE_API_TOKEN
fi

# Deploy
echo ""
echo "📦 Deploying..."
npx wrangler pages deploy . --project-name=mountzara

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ SUCCESS! Your site is deployed!"
    echo ""
    echo "Next: Add your custom domain"
    echo "1. Go to: https://dash.cloudflare.com/"
    echo "2. Click: Workers & Pages > mountzara > Custom domains"
    echo "3. Click: Set up a custom domain"
    echo "4. Enter: mountzara.com"
    echo "5. Click: Continue (DNS will auto-configure!)"
    echo ""
    echo "🎉 Your site will be live at mountzara.com in ~2 minutes!"
else
    echo ""
    echo "❌ Deployment failed. Check the error above."
    echo ""
    echo "Need help? Check DEPLOY.md for detailed instructions."
fi
