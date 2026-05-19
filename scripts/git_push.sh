#!/usr/bin/env bash
# git_push.sh — quick push that surfaces token-state errors clearly.
#
# After scripts/github_device_flow_auth.sh has cached the OAuth token,
# this wrapper just runs `git push` and gives a clean error if the
# token has been revoked. Safe to invoke from osascript with no user
# interaction.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Make sure the token is present in Keychain before we attempt the push.
if ! security find-generic-password \
        -a "mountzara-github-oauth-token" \
        -s "mountzara-github-oauth-token" \
        -w >/dev/null 2>&1; then
    cat <<EOF >&2
ERROR: GitHub OAuth token is not in Keychain.

Run the one-shot device-flow auth:
    ./scripts/github_device_flow_auth.sh

That script prompts you to visit a URL, enter a short code, and approve.
The resulting token caches in macOS Keychain. After that, every subsequent
\`git push\` on this repo is silent.
EOF
    exit 1
fi

BRANCH="$(git branch --show-current)"
REMOTE="${1:-origin}"
TARGET_BRANCH="${2:-$BRANCH}"

echo "📤 git push $REMOTE $BRANCH → $TARGET_BRANCH"
if git push "$REMOTE" "HEAD:refs/heads/$TARGET_BRANCH" 2>&1 | tee /tmp/_git_push.log ; then
    echo "✅ Pushed."
else
    rc=$?
    if grep -qE '403|401|invalid_token|Bad credentials|token has expired' /tmp/_git_push.log ; then
        echo ""
        echo "⚠️  Token rejected — re-run ./scripts/github_device_flow_auth.sh to refresh."
    fi
    exit "$rc"
fi
