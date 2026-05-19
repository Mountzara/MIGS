#!/usr/bin/env bash
# End-to-end Stripe smoke test in test mode.
#
# 1. Create a test Customer
# 2. Create a PaymentIntent for $5.00
# 3. Confirm it server-side with Stripe's test PaymentMethod pm_card_visa
# 4. Wait briefly for webhook to fire
# 5. Verify our /api/v1/_health still reports healthy
# 6. (Future: check stripe_webhook_events D1 table once we exercise via Jane Doe)
#
# Cleans up the test customer at the end.
set -euo pipefail

KEY=$(security find-generic-password -s mountzara-stripe-secret-key -w)
export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH
source /Users/beans/.config/mountzara/cf-creds.env

echo '=== Step 1: Create test Customer ==='
CUSTOMER=$(curl -sS -u "$KEY:" 'https://api.stripe.com/v1/customers' \
    -H 'Stripe-Version: 2024-06-20' \
    -X POST \
    -d 'email=stripe-e2e-test@mountzara.com' \
    -d 'name=E2E Smoketest' \
    -d 'metadata[mz_e2e]=1' \
    -H 'Idempotency-Key: mz-e2e-cust-1')
CUS_ID=$(echo "$CUSTOMER" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("id",""))')
echo "  customer: $CUS_ID"

echo ''
echo '=== Step 2: Attach pm_card_visa (Stripe test card) ==='
ATTACH=$(curl -sS -u "$KEY:" "https://api.stripe.com/v1/payment_methods/pm_card_visa/attach" \
    -H 'Stripe-Version: 2024-06-20' \
    -X POST \
    -d "customer=$CUS_ID")
PM_ID=$(echo "$ATTACH" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d.get("id",""))')
echo "  payment_method: $PM_ID  (test Visa ending 4242)"

echo ''
echo '=== Step 3: Create + confirm PaymentIntent for $5.00 ==='
PI=$(curl -sS -u "$KEY:" 'https://api.stripe.com/v1/payment_intents' \
    -H 'Stripe-Version: 2024-06-20' \
    -X POST \
    -d 'amount=500' \
    -d 'currency=usd' \
    -d "customer=$CUS_ID" \
    -d "payment_method=$PM_ID" \
    -d 'confirm=true' \
    -d 'off_session=true' \
    -d 'description=Mount Zara — E2E smoketest' \
    -d 'metadata[mz_e2e]=1' \
    -H 'Idempotency-Key: mz-e2e-pi-1')
PI_ID=$(echo "$PI" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d.get("id",""))')
PI_STATUS=$(echo "$PI" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d.get("status",""))')
PI_LATEST_CHARGE=$(echo "$PI" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d.get("latest_charge",""))')
echo "  payment_intent: $PI_ID"
echo "  status: $PI_STATUS"
echo "  latest_charge: $PI_LATEST_CHARGE"

echo ''
echo '=== Step 4: Wait 6s for webhook to fire ==='
sleep 6

echo ''
echo '=== Step 5: Health check ==='
ADMIN_PASS=$(security find-generic-password -s mountzara-admin-password -w)
ADMIN_USER=$(grep '^Username:' ~/Desktop/MountZara_Admin_Credentials.txt | sed 's/^Username: *//')
curl -sS -u "$ADMIN_USER:$ADMIN_PASS" https://mountzara.com/api/v1/_health \
    | python3 -c 'import json,sys;d=json.load(sys.stdin);print("  ok:", d.get("ok"), "  bindings.PHI:", d.get("bindings",{}).get("PHI"), "  bindings.DB:", d.get("bindings",{}).get("DB"))'

echo ''
echo '=== Step 6: Check stripe_webhook_events D1 table for our event ==='
/usr/local/bin/npx wrangler d1 execute mountzara-clinical --remote --json --command \
    "SELECT stripe_event_id, event_type, processed_at IS NOT NULL AS processed, processing_error, related_payment_id FROM stripe_webhook_events WHERE received_at > strftime('%s','now','-5 minutes')*1000 ORDER BY received_at DESC LIMIT 10" 2>/dev/null \
    | python3 -c '
import json, sys
d = json.load(sys.stdin)
rs = d[0].get("results", []) if isinstance(d, list) else []
print("  recent webhook events:", len(rs))
for r in rs:
    print(f"   {r[\"event_type\"]:34s} processed={r[\"processed\"]}  error={r.get(\"processing_error\") or \"\"}")
'

echo ''
echo '=== Cleanup ==='
curl -sS -u "$KEY:" "https://api.stripe.com/v1/customers/$CUS_ID" -H 'Stripe-Version: 2024-06-20' -X DELETE > /dev/null
echo "  deleted test customer $CUS_ID"
