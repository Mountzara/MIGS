#!/bin/bash

# Automated Cloudflare Pages Deployment Script for mountzara.com
# This script will help you deploy your site to Cloudflare Pages

set -e

echo "🚀 Mount Zara - Cloudflare Pages Deployment"
echo "==========================================="
echo ""

# Check if Cloudflare credentials are set
if [ -z "$CLOUDFLARE_API_TOKEN" ] && [ -z "$CLOUDFLARE_ACCOUNT_ID" ]; then
    echo "📋 To deploy automatically, I need your Cloudflare credentials."
    echo ""
    echo "Getting your credentials is easy:"
    echo ""
    echo "1. Get your Account ID:"
    echo "   - Go to: https://dash.cloudflare.com/"
    echo "   - Click on 'Pages' in the left sidebar"
    echo "   - Your Account ID is shown in the URL or right sidebar"
    echo ""
    echo "2. Get your API Token:"
    echo "   - Go to: https://dash.cloudflare.com/profile/api-tokens"
    echo "   - Click 'Create Token'"
    echo "   - Use template: 'Edit Cloudflare Workers'"
    echo "   - Or create custom token with 'Cloudflare Pages:Edit' permission"
    echo ""
    echo "Then run:"
    echo "  export CLOUDFLARE_ACCOUNT_ID='your-account-id'"
    echo "  export CLOUDFLARE_API_TOKEN='your-api-token'"
    echo "  ./deploy.sh"
    echo ""
    echo "Or use the ONE-CLICK option below! 👇"
    echo ""
    exit 1
fi

echo "✅ Cloudflare credentials found!"
echo ""
echo "📦 Deploying to Cloudflare Pages..."
echo ""

# Deploy using Wrangler
npx wrangler pages deploy . --project-name=mountzara

echo ""
echo "✅ Deployment complete!"
echo ""
echo "Next steps:"
echo "1. Go to: https://dash.cloudflare.com/ → Pages → mountzara"
echo "2. Click 'Custom domains' → 'Set up a custom domain'"
echo "3. Enter 'mountzara.com' and follow the prompts"
echo ""
echo "Your site will be live at mountzara.com in a few minutes!"
