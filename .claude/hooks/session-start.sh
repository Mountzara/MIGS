#!/usr/bin/env bash
# Auto-loads Cloudflare credentials and prints the autonomous-deploy briefing
# at the start of every Claude Code session in this repo.
#
# Configured in .claude/settings.json (SessionStart hook).

CREDS="$HOME/.config/mountzara/cf-creds.env"
TOKEN_FILE="$HOME/.config/mountzara/upload-token.txt"

cat <<'BRIEFING'
=== mountzara.com — autonomous deploy ready ===

You can deploy ANY change to production WITHOUT user involvement:

  ./scripts/deploy-prod.sh "deploy message"

This bypasses GitHub Actions and pushes directly to mountzara.com via
the Cloudflare Pages API. Cred env vars (CLOUDFLARE_API_TOKEN,
CLOUDFLARE_ACCOUNT_ID) are auto-loaded from
~/.config/mountzara/cf-creds.env.

R2 file uploads (e.g. videos): use the /upload/<key> endpoint with the
token in ~/.config/mountzara/upload-token.txt — see CLAUDE.md.

DO NOT instruct the user to merge PRs, run wrangler, or use the
Cloudflare dashboard. Make the change locally and run the deploy script.
================================================

BRIEFING

if [ -f "$CREDS" ]; then
    # shellcheck disable=SC1090
    source "$CREDS"
fi
