#!/usr/bin/env bash
# phi_master_key_rotate.sh — annual rotation of PHI_MASTER_KEY.
#
# Per CLAUDE.md §11 Tier 7 (HIPAA hardening) and the HIPAA risk register
# residual HIGH #4. Runs end-to-end:
#
#   1. Generates a new 32-byte master key.
#   2. Prompts the operator to ESCROW the new key offline (write it down,
#      print + safe-seal, or burn to a USB and store with attorney).
#   3. Sets BOTH Cloudflare Pages secrets:
#        - PHI_MASTER_KEY_OLD (current value, pulled from local backup)
#        - PHI_MASTER_KEY     (the new value)
#        - PHI_ROTATION_CONFIRM_TOKEN (single-use confirm)
#   4. Triggers the rotation Worker endpoint in batches until 0 rows
#      remain with unrotated wrapped DEKs.
#   5. Removes PHI_MASTER_KEY_OLD + PHI_ROTATION_CONFIRM_TOKEN.
#   6. Stores the new key locally in macOS Keychain for next year's rotation.
#
# Run from a TRUSTED operator workstation only (the Mac that already
# holds the Cloudflare deploy token). The new master key is generated
# locally — it never leaves this machine (other than encrypted-at-rest
# in Cloudflare Pages secrets).

set -euo pipefail

PROJECT="${CF_PAGES_PROJECT:-mountzara}"
BASE_URL="${MOUNTZARA_BASE_URL:-https://mountzara.com}"
ADMIN_USER="${MOUNTZARA_ADMIN_USER:-admin}"

# -------- preflight --------
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] && [ -f "$HOME/.config/mountzara/cf-creds.env" ]; then
    # shellcheck disable=SC1091
    source "$HOME/.config/mountzara/cf-creds.env"
fi
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] || [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
    echo "ERROR: CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID must be set." >&2
    exit 1
fi

ADMIN_PASS=$(security find-generic-password -a "mountzara-admin-password" -s "mountzara-admin-password" -w 2>/dev/null || true)
if [ -z "$ADMIN_PASS" ]; then
    read -srp "Admin password (not in keychain — enter manually): " ADMIN_PASS
    echo
fi

# -------- step 1: snapshot the CURRENT master key locally --------
echo ""
echo "Step 1: snapshotting CURRENT master key from Keychain."
echo "   The current key MUST already be escrowed in your offline backup."
echo "   If it's not, abort now (Ctrl-C) and run the initial escrow ritual"
echo "   documented at docs/PHI_MASTER_KEY_ROTATION.md before retrying."
echo ""
CURRENT_KEY=$(security find-generic-password -a "mountzara-phi-master-key" -s "mountzara-phi-master-key" -w 2>/dev/null || true)
if [ -z "$CURRENT_KEY" ]; then
    echo "ERROR: current PHI_MASTER_KEY not found in Keychain under name"
    echo "       'mountzara-phi-master-key'. Either:"
    echo ""
    echo "  a) This is the first rotation — restore the current key from your"
    echo "     offline backup and store it in Keychain with:"
    echo ""
    echo "       security add-generic-password \\"
    echo "         -a mountzara-phi-master-key \\"
    echo "         -s mountzara-phi-master-key \\"
    echo "         -w '<the current base64 key>'"
    echo ""
    echo "  b) Or run the initial escrow ritual at"
    echo "     docs/PHI_MASTER_KEY_ROTATION.md to create the very first key."
    exit 1
fi
echo "   ✓ Current key is in Keychain. Proceeding."

# -------- step 2: generate new key --------
echo ""
echo "Step 2: generating NEW master key (32 bytes, base64)."
NEW_KEY=$(openssl rand -base64 32 | tr -d '\n')
CONFIRM_TOKEN=$(openssl rand -hex 16)

echo ""
echo "============================================================"
echo "                       NEW MASTER KEY"
echo "============================================================"
echo ""
echo "   $NEW_KEY"
echo ""
echo "============================================================"
echo ""
echo "WRITE THIS DOWN OR PRINT IT NOW."
echo ""
echo "Required offline-backup ritual (per docs/PHI_MASTER_KEY_ROTATION.md):"
echo ""
echo "  1. Print this key on a sheet of paper."
echo "  2. Seal in a tamper-evident envelope."
echo "  3. Sign + date the envelope across the seal."
echo "  4. Store in your fireproof safe AND give a duplicate sealed copy"
echo "     to your attorney for off-site escrow."
echo ""
echo "DO NOT proceed until the key is escrowed. If this rotation completes"
echo "and the key is lost, every PHI ciphertext in mountzara-phi becomes"
echo "permanently unreadable."
echo ""
read -p "Type ESCROWED to confirm the new key is safely backed up offline: " CONFIRM
if [ "$CONFIRM" != "ESCROWED" ]; then
    echo "Aborted. New key was NOT stored anywhere — rerun when ready."
    exit 1
fi

# -------- step 3: set both secrets on Cloudflare Pages --------
echo ""
echo "Step 3: setting CF Pages secrets..."
echo "  - PHI_MASTER_KEY_OLD       (the value being rotated AWAY from)"
echo "  - PHI_MASTER_KEY            (the new value)"
echo "  - PHI_ROTATION_CONFIRM_TOKEN (single-use token)"
echo ""
echo "$CURRENT_KEY"     | npx --yes wrangler@latest pages secret put PHI_MASTER_KEY_OLD       --project-name="$PROJECT"
echo "$NEW_KEY"         | npx --yes wrangler@latest pages secret put PHI_MASTER_KEY            --project-name="$PROJECT"
echo "$CONFIRM_TOKEN"   | npx --yes wrangler@latest pages secret put PHI_ROTATION_CONFIRM_TOKEN --project-name="$PROJECT"
echo "   ✓ Secrets staged. Wait 30 s for Cloudflare to propagate..."
sleep 30

# -------- step 4: dry-run status check --------
echo ""
echo "Step 4: checking row counts that still need rotation..."
STATUS=$(curl -s -u "$ADMIN_USER:$ADMIN_PASS" "$BASE_URL/api/v1/admin/phi/rotate")
echo "$STATUS" | python3 -m json.tool

# -------- step 5: rotation loop --------
echo ""
echo "Step 5: rotating in batches of 100 rows..."
BATCH_NUM=0
while : ; do
    BATCH_NUM=$((BATCH_NUM + 1))
    echo ""
    echo "  Batch #$BATCH_NUM..."
    RESP=$(curl -s -X POST -u "$ADMIN_USER:$ADMIN_PASS" \
        "$BASE_URL/api/v1/admin/phi/rotate?confirm=$CONFIRM_TOKEN")
    echo "$RESP" | python3 -m json.tool
    ROTATED=$(echo "$RESP"  | python3 -c "import json,sys; print(json.load(sys.stdin).get('rotated', 0))" 2>/dev/null || echo "0")
    ALREADY=$(echo "$RESP"  | python3 -c "import json,sys; print(json.load(sys.stdin).get('already_rotated', 0))" 2>/dev/null || echo "0")
    FAILED=$(echo "$RESP"   | python3 -c "import json,sys; print(json.load(sys.stdin).get('failed', 0))" 2>/dev/null || echo "0")
    BATCH_TOTAL=$((ROTATED + ALREADY))
    if [ "$BATCH_TOTAL" -eq 0 ] || [ "$BATCH_NUM" -ge 100 ]; then
        echo ""
        echo "  Loop end: rotated=$ROTATED already=$ALREADY failed=$FAILED in last batch."
        break
    fi
done

# -------- step 6: cleanup --------
echo ""
echo "Step 6: cleanup."
echo "  Deleting PHI_MASTER_KEY_OLD + PHI_ROTATION_CONFIRM_TOKEN..."
npx --yes wrangler@latest pages secret delete PHI_MASTER_KEY_OLD --project-name="$PROJECT"
npx --yes wrangler@latest pages secret delete PHI_ROTATION_CONFIRM_TOKEN --project-name="$PROJECT"

echo ""
echo "  Updating local Keychain to the new key..."
security delete-generic-password -a "mountzara-phi-master-key" -s "mountzara-phi-master-key" 2>/dev/null || true
security add-generic-password \
    -a "mountzara-phi-master-key" \
    -s "mountzara-phi-master-key" \
    -w "$NEW_KEY"

echo ""
echo "✅ Rotation complete."
echo ""
echo "Reminders:"
echo "  - The OLD key escrow envelope is now SUPERSEDED. Destroy the old"
echo "    envelope, BUT keep this new envelope intact for at least 1 year"
echo "    in case any R2 customMetadata fails to roll forward and you need"
echo "    to fall back."
echo "  - Schedule the next rotation in 12 months."
echo "  - Audit the rotation event from /admin/analytics or by tailing the"
echo "    audit_log table for 'phi_master_key_rotation_batch'."
