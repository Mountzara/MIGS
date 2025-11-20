#!/bin/bash

# INSTANT DEPLOY - Run this command:
# curl -sL https://raw.githubusercontent.com/Mountzara/MIGS/main/instant-deploy.sh | bash

echo "🚀 Mount Zara - Instant Deploy Script"
echo "====================================="
echo ""

# Get API token
if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
    echo "To deploy, I need your Cloudflare API Token."
    echo ""
    echo "Get it here (takes 30 seconds):"
    echo "https://dash.cloudflare.com/profile/api-tokens/create"
    echo ""
    echo "Create a token with: Cloudflare Pages > Edit permission"
    echo ""
    read -sp "Paste your API Token: " CLOUDFLARE_API_TOKEN
    echo ""
    export CLOUDFLARE_API_TOKEN
fi

# Deploy
cd /home/user/MIGS
npx wrangler pages deploy . --project-name=mountzara

echo ""
echo "✅ Deployed! Now add your domain at:"
echo "https://dash.cloudflare.com/ > Workers & Pages > mountzara > Custom domains"
