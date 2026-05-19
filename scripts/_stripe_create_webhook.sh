#!/usr/bin/env bash
# Try to create the Stripe webhook endpoint via API using the cached
# restricted key. If the key has Webhook Endpoints write permission,
# this succeeds and returns the signing secret — which we then stash
# in Pages + Keychain. If not, prints the manual-dashboard fallback URL.
set -euo pipefail

KEY=$(security find-generic-password -s mountzara-stripe-secret-key -w)
if [ -z "$KEY" ]; then echo "ERROR: secret key not in keychain" >&2; exit 1; fi

URL="https://mountzara.com/api/v1/billing/stripe/webhook"

RESP=$(curl -sS -u "$KEY:" 'https://api.stripe.com/v1/webhook_endpoints' \
    -H 'Stripe-Version: 2024-06-20' \
    -X POST \
    -d "url=$URL" \
    -d 'description=Mount Zara — production billing webhook' \
    -d 'enabled_events[]=payment_intent.succeeded' \
    -d 'enabled_events[]=payment_intent.payment_failed' \
    -d 'enabled_events[]=charge.refunded' \
    -d 'enabled_events[]=refund.updated' \
    -d 'enabled_events[]=payment_method.attached' \
    -d 'enabled_events[]=payment_method.detached' \
    -d 'enabled_events[]=customer.updated' \
    -H 'Idempotency-Key: mz-webhook-create-1')

echo "$RESP" | python3 <<'PY'
import json, sys
d = json.load(sys.stdin) if False else None
import json as J
raw = open('/dev/stdin').read() if False else None
PY

# Simpler: just print + parse
python3 -c "
import json, sys
d = json.loads('''$RESP''')
err = d.get('error')
if err:
    print('  status: failed')
    print('  error type:', err.get('type'))
    print('  error code:', err.get('code'))
    print('  error message:', err.get('message'))
    if 'permission' in (err.get('message') or '').lower():
        print('')
        print('  Restricted key lacks Webhook Endpoints write permission.')
        print('  Path: Stripe dashboard -> https://dashboard.stripe.com/test/webhooks')
        print('  -> + Add endpoint -> URL: $URL')
    sys.exit(1)
else:
    secret = d.get('secret', '')
    print('  status: SUCCESS')
    print('  webhook id:', d.get('id'))
    print('  url:', d.get('url'))
    print('  events:', len(d.get('enabled_events', [])))
    print('  has secret:', bool(secret))
    print(secret)
" || exit 1
