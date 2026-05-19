#!/usr/bin/env bash
# _stripe_clip_stash.sh — read a Stripe credential from pbpaste, validate
# its prefix, then stash it in BOTH Cloudflare Pages secrets AND macOS
# Keychain. Usage:
#
#   _stripe_clip_stash.sh secret      # expects rk_live_ or rk_test_ on clipboard
#   _stripe_clip_stash.sh publishable # expects pk_live_ or pk_test_
#   _stripe_clip_stash.sh webhook     # expects whsec_
#
# Designed to be invoked by Claude via osascript after the user copies a
# value from their Stripe dashboard. No prompts; reads pbpaste directly.
# Refuses to proceed if the prefix doesn't match expected pattern, so we
# never accidentally store the wrong value in the wrong slot.
set -euo pipefail

KIND="${1:-}"
case "$KIND" in
    secret)
        EXPECTED_RE='^(rk_live_|rk_test_)[A-Za-z0-9]{20,}$'
        CF_NAME="STRIPE_SECRET_KEY"
        KC_NAME="mountzara-stripe-secret-key"
        ;;
    publishable)
        EXPECTED_RE='^(pk_live_|pk_test_)[A-Za-z0-9]{20,}$'
        CF_NAME="STRIPE_PUBLISHABLE_KEY"
        KC_NAME="mountzara-stripe-publishable-key"
        ;;
    webhook)
        EXPECTED_RE='^whsec_[A-Za-z0-9]{20,}$'
        CF_NAME="STRIPE_WEBHOOK_SECRET"
        KC_NAME="mountzara-stripe-webhook-secret"
        ;;
    *)
        echo "usage: $0 {secret|publishable|webhook}" >&2
        exit 2
        ;;
esac

VAL="$(pbpaste 2>/dev/null | tr -d '[:space:]')"
if [ -z "$VAL" ]; then
    echo "ERROR: clipboard is empty. Copy the $KIND key from Stripe first, then re-run." >&2
    exit 1
fi
if ! [[ "$VAL" =~ $EXPECTED_RE ]]; then
    echo "ERROR: clipboard value does not look like a Stripe $KIND key." >&2
    echo "       Expected prefix matching $EXPECTED_RE" >&2
    echo "       First 12 chars seen: ${VAL:0:12}…" >&2
    exit 1
fi

# Determine mode (test vs live) for logging
MODE="unknown"
case "$VAL" in
    *_live_*) MODE="LIVE" ;;
    *_test_*) MODE="TEST" ;;
    whsec_*)  MODE="MATCHES-CURRENT-MODE" ;;
esac
PREFIX="${VAL:0:11}"
echo "✓ Valid $KIND key on clipboard ($MODE) — prefix $PREFIX…"

# 1) Cloudflare Pages secret (the runtime source of truth)
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
if [ -f "$HOME/.config/mountzara/cf-creds.env" ]; then
    # shellcheck disable=SC1091
    source "$HOME/.config/mountzara/cf-creds.env"
fi
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] || [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
    echo "ERROR: CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID not set." >&2
    echo "       Expected creds file at: \$HOME/.config/mountzara/cf-creds.env" >&2
    exit 1
fi
echo "$VAL" | /usr/local/bin/npx wrangler pages secret put "$CF_NAME" --project-name=mountzara > /tmp/_stripe_stash.log 2>&1
if grep -q "Success" /tmp/_stripe_stash.log; then
    echo "✓ Cloudflare Pages secret $CF_NAME set"
else
    echo "ERROR: Cloudflare Pages secret put failed" >&2
    cat /tmp/_stripe_stash.log >&2
    exit 1
fi

# 2) macOS Keychain (local reference / re-deploy bootstrap)
security add-generic-password -U \
    -a "$KC_NAME" -s "$KC_NAME" -w "$VAL" 2>&1
echo "✓ Keychain entry $KC_NAME updated"

echo "DONE: $KIND key stashed ($MODE)."
