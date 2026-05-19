#!/usr/bin/env bash
# Jane-Doe-side end-to-end smoke test for the full patient payment flow.
#
# Flow:
#   1. As admin → create $5 invoice for Jane Doe via /api/v1/admin/billing/invoices
#   2. As Jane Doe → log in via /api/v1/auth/login, capture session cookie
#   3. As Jane Doe → GET /api/v1/patient/billing/invoices, verify invoice visible
#   4. As Jane Doe → POST /api/v1/patient/billing/invoices/<id>/pay, capture PI client_secret + payment_id
#   5. Server-side → confirm the PaymentIntent using Stripe test card pm_card_visa
#   6. Wait for webhook
#   7. Verify webhook fired + invoice status flipped to 'paid' + payments table has the row
#   8. Cleanup: void the test invoice (refund would also work; void is faster for test data)
#
# Both admin Basic Auth and Jane's session cookie are required because the
# preview gate (§11.5.2) is still active — admin Basic Auth bypasses the
# gate, then Jane's session satisfies requireRole(['patient']).
set -euo pipefail

ADMIN_PASS=$(security find-generic-password -s mountzara-admin-password -w)
ADMIN_USER=$(grep '^Username:' ~/Desktop/MountZara_Admin_Credentials.txt | sed 's/^Username: *//')
JANE_PASS=$(grep -i 'password' ~/Desktop/JaneDoe_credentials.txt | head -1 | sed 's/.*[Pp]assword: *//')
JANE_EMAIL=$(grep -iE '^[Ee]mail' ~/Desktop/JaneDoe_credentials.txt | head -1 | sed 's/.*[Ee]mail: *//')
STRIPE_KEY=$(security find-generic-password -s mountzara-stripe-secret-key -w)
BASE='https://mountzara.com'
COOKIE_JAR=/tmp/_mz_jane.cookies
rm -f "$COOKIE_JAR"

if [ -z "$JANE_EMAIL" ] || [ -z "$JANE_PASS" ]; then
    echo "ERROR: could not read Jane Doe creds from ~/Desktop/JaneDoe_credentials.txt"
    head -5 ~/Desktop/JaneDoe_credentials.txt
    exit 1
fi
echo "Jane email: $JANE_EMAIL"

# Look up Jane's patient_id
echo ''
echo '=== Step 1: look up Jane Doe patient_id ==='
JANE_PID=$(curl -sS -u "$ADMIN_USER:$ADMIN_PASS" "$BASE/api/v1/admin/patients" \
    | python3 -c 'import json,sys
d=json.load(sys.stdin)
ps=d.get("patients") or d.get("results") or []
for p in ps:
    if (p.get("email") or "").lower() == "'"$JANE_EMAIL"'".lower():
        print(p["id"]); break')
echo "  patient_id: $JANE_PID"

# Admin creates a $5 invoice for Jane
echo ''
echo '=== Step 2: admin creates $5 invoice for Jane ==='
TODAY=$(date -u +%Y-%m-%d)
INVOICE_CREATE=$(curl -sS -u "$ADMIN_USER:$ADMIN_PASS" \
    -H 'content-type: application/json' \
    "$BASE/api/v1/admin/billing/invoices" \
    -X POST \
    -d "{\"patient_id\":\"$JANE_PID\",\"issue_date\":\"$TODAY\",\"line_items\":[{\"service_code\":\"office_visit_followup\",\"description\":\"E2E smoke test charge\",\"quantity\":1,\"unit_price_cents\":500}],\"public_memo\":\"Stripe e2e smoke test\",\"tax_export_summary\":\"Office services\",\"send_immediately\":true}")
INVOICE_ID=$(echo "$INVOICE_CREATE" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d.get("id",""))')
INVOICE_NUMBER=$(echo "$INVOICE_CREATE" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d.get("invoice_number",""))')
echo "  invoice: $INVOICE_NUMBER  id=$INVOICE_ID"

# Jane logs in
echo ''
echo '=== Step 3: Jane Doe logs in (admin auth bypasses preview gate) ==='
LOGIN_RESP=$(curl -sS -u "$ADMIN_USER:$ADMIN_PASS" \
    -H 'content-type: application/json' \
    -c "$COOKIE_JAR" \
    "$BASE/api/v1/auth/login" \
    -X POST \
    -d "{\"email\":\"$JANE_EMAIL\",\"password\":\"$JANE_PASS\"}")
LOGIN_OK=$(echo "$LOGIN_RESP" | python3 -c 'import json,sys;d=json.load(sys.stdin);print("ok" if d.get("ok") or d.get("patient_id") else "FAIL: " + str(d))')
echo "  $LOGIN_OK"
echo "  cookies received: $(grep -cE 'mz_session' "$COOKIE_JAR" 2>/dev/null || echo 0)"

# Jane lists invoices
echo ''
echo '=== Step 4: Jane lists her invoices ==='
JANE_LIST=$(curl -sS -u "$ADMIN_USER:$ADMIN_PASS" -b "$COOKIE_JAR" "$BASE/api/v1/patient/billing/invoices")
echo "$JANE_LIST" | python3 -c '
import json, sys
d = json.load(sys.stdin)
invs = d.get("invoices", [])
ob = d.get("outstanding_balance_cents", 0) / 100
print("  count: %d  outstanding: $%.2f" % (len(invs), ob))
for i in invs[:5]:
    n = i.get("invoice_number", "?")
    s = i.get("status")
    t = i.get("total_cents", 0) / 100
    b = i.get("balance_cents", 0) / 100
    print("   %s status=%s total=$%.2f balance=$%.2f" % (n, s, t, b))
'

# Jane initiates payment
echo ''
echo '=== Step 5: Jane initiates payment (creates Stripe PaymentIntent) ==='
PAY_RESP=$(curl -sS -u "$ADMIN_USER:$ADMIN_PASS" -b "$COOKIE_JAR" \
    -H 'content-type: application/json' \
    "$BASE/api/v1/patient/billing/invoices/$INVOICE_ID/pay" \
    -X POST -d '{}')
PI_ID=$(echo "$PAY_RESP" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d.get("stripe_payment_intent_id",""))')
PAYMENT_ID=$(echo "$PAY_RESP" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d.get("payment_id",""))')
AMT_CENTS=$(echo "$PAY_RESP" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d.get("amount_cents",0))')
echo "  payment_intent_id: $PI_ID"
echo "  internal payment_id: $PAYMENT_ID"
echo "  amount_cents: $AMT_CENTS"

# Server-side confirm with Stripe test card pm_card_visa (simulates the
# patient pressing Pay in Stripe Elements with a 4242 card)
echo ''
echo '=== Step 6: confirm PaymentIntent with pm_card_visa (simulates browser confirm) ==='
CONFIRM=$(curl -sS -u "$STRIPE_KEY:" "https://api.stripe.com/v1/payment_intents/$PI_ID/confirm" \
    -H 'Stripe-Version: 2024-06-20' \
    -X POST \
    -d 'payment_method=pm_card_visa' \
    -d "return_url=$BASE/portal/billing/?paid=$INVOICE_ID" \
    -H "Idempotency-Key: mz-e2e-jane-confirm-$INVOICE_ID")
CONFIRM_STATUS=$(echo "$CONFIRM" | python3 -c 'import json,sys;d=json.load(sys.stdin);err=d.get("error");print("ERROR: " + str(err.get("message")) if err else d.get("status",""))')
echo "  status: $CONFIRM_STATUS"

# Wait for webhook
echo ''
echo '=== Step 7: wait 6s for webhook to fire ==='
sleep 6

# Verify webhook event landed
echo ''
echo '=== Step 8: verify webhook events ==='
export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH
source /Users/beans/.config/mountzara/cf-creds.env
/usr/local/bin/npx wrangler d1 execute mountzara-clinical --remote --json --command \
    "SELECT stripe_event_id, event_type, processed_at IS NOT NULL AS processed, processing_error, related_invoice_id, related_payment_id FROM stripe_webhook_events WHERE received_at > strftime('%s','now','-2 minutes')*1000 ORDER BY received_at DESC LIMIT 10" 2>/dev/null \
    > /tmp/_mz_webhook_q.json
python3 -c '
import json
d = json.load(open("/tmp/_mz_webhook_q.json"))
rs = d[0].get("results", []) if isinstance(d, list) else []
print("  events in last 2 min:", len(rs))
for r in rs:
    label = r["event_type"].ljust(34)
    proc = "yes" if r["processed"] else "NO"
    err = r.get("processing_error") or "-"
    inv = (r.get("related_invoice_id") or "")[:8]
    print("   %s  processed=%s  inv=%s  err=%s" % (label, proc, inv, err))
'

# Verify invoice flipped to paid
echo ''
echo '=== Step 9: verify Jane invoice status flipped to paid ==='
JANE_INV2=$(curl -sS -u "$ADMIN_USER:$ADMIN_PASS" -b "$COOKIE_JAR" "$BASE/api/v1/patient/billing/invoices/$INVOICE_ID")
echo "$JANE_INV2" | python3 -c '
import json, sys
d = json.load(sys.stdin).get("invoice", {})
print("  status: %s  paid_at: %s  paid_cents: %s  balance_cents: %s" % (
    d.get("status"), d.get("paid_at"), d.get("amount_paid_cents"), d.get("balance_cents")
))
'

# Verify payment row in our DB
echo ''
echo '=== Step 10: verify payment row in our DB ==='
/usr/local/bin/npx wrangler d1 execute mountzara-clinical --remote --json --command \
    "SELECT status, gross_amount_cents, fee_amount_cents, net_amount_cents, captured_at, stripe_payment_intent_id FROM payments WHERE id = '$PAYMENT_ID'" 2>/dev/null \
    > /tmp/_mz_pay_q.json
python3 -c '
import json
d = json.load(open("/tmp/_mz_pay_q.json"))
rs = d[0].get("results", []) if isinstance(d, list) else []
if not rs:
    print("  payment row NOT FOUND in D1"); raise SystemExit(0)
r = rs[0]
print("  status: %s" % r["status"])
print("  gross: $%.2f  fee: $%.2f  net: $%.2f" % (
    r["gross_amount_cents"]/100, r["fee_amount_cents"]/100, r["net_amount_cents"]/100
))
print("  stripe_pi: %s" % r["stripe_payment_intent_id"])
'

# Cleanup: void the test invoice + refund full $5 to the test customer
echo ''
echo '=== Step 11: cleanup — refund the $5 test charge ==='
REFUND=$(curl -sS -u "$ADMIN_USER:$ADMIN_PASS" \
    -H 'content-type: application/json' \
    "$BASE/api/v1/admin/billing/payments/$PAYMENT_ID/refund" \
    -X POST \
    -d '{"reason":"requested_by_customer","admin_memo":"e2e smoke test cleanup"}')
echo "$REFUND" | python3 -c '
import json, sys
d = json.load(sys.stdin)
err = d.get("error")
if err:
    print("  refund: FAILED " + str(err))
else:
    print("  refund: OK  amount=" + str(d.get("amount_cents", 0)) + " refund_id=" + str(d.get("id", "")))
'

echo ''
echo '✓ End-to-end Jane Doe smoke test complete.'
