# Stripe + Phase 6 Billing — Go-Live Setup

The Phase 6 billing infrastructure is fully built and deployed. Patient invoices, Stripe Payment Intents, webhook handling, refunds, QB-friendly CSV exports, and AI-powered accountant insights are all in code and live. The only remaining steps are the three things only the account-owner can do.

Once these three steps are complete, billing goes live the same hour.

---

## Step 1 — Sign the Stripe Healthcare BAA

Stripe will not lawfully accept healthcare-related payments under your account name until a Business Associate Agreement is countersigned. This is a one-time action.

1. Sign in at `https://dashboard.stripe.com/` with the Mount Zara LLC business email.
2. If you don't have a Stripe account yet, sign up first — choose **"Service businesses → Healthcare → Other healthcare services"** as the business category. Provide EIN, business address, bank account for payouts.
3. Once your account is active, request the BAA at: `https://dashboard.stripe.com/account/legal` → scroll to **Healthcare Business Associate Agreement** → click **Request BAA**.
4. Stripe legal will email a DocuSign within 1–3 business days. Sign and return.
5. Once countersigned, log it in our `baa_ledger` D1 table alongside Cloudflare's existing row. From Terminal:

```bash
cd ~/Developer/MountZara/MIGS
npx wrangler d1 execute mountzara-clinical --remote --command "
INSERT INTO baa_ledger (id, vendor, status, signed_at, notes, created_at, updated_at)
VALUES (
  'baa-stripe',
  'Stripe',
  'signed',
  strftime('%s','now')*1000,
  'Stripe Healthcare BAA countersigned $YOUR_DATE_HERE. Covers Payments, Invoicing, Connect (if added), Atlas, Tax. Annual review.',
  strftime('%s','now')*1000,
  strftime('%s','now')*1000
);"
```

---

## Step 2 — Generate API keys + webhook secret

Three keys are required. All three go into Cloudflare Pages secrets (production) and macOS Keychain (local reference).

### 2a. Secret key (server-side API calls)

1. `https://dashboard.stripe.com/apikeys` → **Restricted keys** → **Create restricted key**.
2. Name: `mountzara-prod-server-key`.
3. Permissions — set **Write** on: Customers, PaymentIntents, PaymentMethods, Refunds, Charges, BalanceTransactions. **Read** on: Invoices, Balance. Everything else: **None**.
4. Click **Create key** → copy the `rk_live_...` value.

### 2b. Publishable key (client-side Stripe.js)

1. Same page → copy the `pk_live_...` value.
2. Publishable keys are designed to be exposed in browser JavaScript; safe.

### 2c. Webhook signing secret

1. `https://dashboard.stripe.com/webhooks` → **Add endpoint**.
2. **Endpoint URL:** `https://mountzara.com/api/v1/billing/stripe/webhook`
3. **Listen to events on this account** (not Connect).
4. **Events to send** — select these specifically:
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `charge.refunded`
   - `refund.updated`
   - `payment_method.attached`
   - `payment_method.detached`
   - `customer.updated`
5. Click **Add endpoint** → click the new endpoint → **Signing secret** → **Reveal** → copy the `whsec_...` value.

---

## Step 3 — Stash secrets in Cloudflare Pages + macOS Keychain

Run these from Terminal. Paste each value when prompted.

```bash
cd ~/Developer/MountZara/MIGS

# Cloudflare Pages secrets (live runtime)
npx wrangler pages secret put STRIPE_SECRET_KEY --project-name=mountzara
npx wrangler pages secret put STRIPE_PUBLISHABLE_KEY --project-name=mountzara
npx wrangler pages secret put STRIPE_WEBHOOK_SECRET --project-name=mountzara

# macOS Keychain (for local scripts / Claude session bootstrap)
security add-generic-password -U \
  -a "mountzara-stripe-secret-key" -s "mountzara-stripe-secret-key" \
  -w "rk_live_..."
security add-generic-password -U \
  -a "mountzara-stripe-publishable-key" -s "mountzara-stripe-publishable-key" \
  -w "pk_live_..."
security add-generic-password -U \
  -a "mountzara-stripe-webhook-secret" -s "mountzara-stripe-webhook-secret" \
  -w "whsec_..."
```

Then redeploy so the runtime picks up the secrets:

```bash
bash scripts/deploy-prod.sh "stripe live keys provisioned"
```

---

## Step 4 — Smoke test with Stripe test mode (optional but recommended)

Before invoicing a real patient, run the test-mode flow with Stripe's test card `4242 4242 4242 4242` (any future expiry, any CVC, any ZIP):

1. Temporarily swap the keys above for test keys (`sk_test_...`, `pk_test_...`, `whsec_test_...` from a separate test webhook endpoint pointed at `https://mountzara.com/api/v1/billing/stripe/webhook`).
2. Redeploy.
3. As admin, create a $5 invoice to Jane Doe (the seeded test patient) at `/admin/billing/invoices/`.
4. Log into the member portal as Jane → `/portal/billing/` → click Pay → enter test card.
5. Watch the payment land in D1:
   ```bash
   npx wrangler d1 execute mountzara-clinical --remote --command "SELECT * FROM payments ORDER BY captured_at DESC LIMIT 3"
   npx wrangler d1 execute mountzara-clinical --remote --command "SELECT * FROM stripe_webhook_events ORDER BY received_at DESC LIMIT 5"
   ```
6. Verify the invoice flips to `paid` status.
7. Issue a $1 refund through `/admin/billing/invoices/<invoice_id>`. Confirm `refunds` table row + invoice `status='partially_paid'`.
8. Once verified, swap back to live keys per Step 3 and redeploy.

---

## Step 5 — First QB export

After your first real payment lands:

1. `/admin/billing/reports/` (admin dashboard → Billing → Reports).
2. Pick a date range and click **Export QBO-friendly CSV (tax-safe)**.
3. Import into QuickBooks Self-Employed: **Transactions → Add → Import from CSV**. The columns match QBSE's sales-receipt import format.
4. Stripe fees come in as a separate expense line — categorize as **Other business expenses** in QBSE (Schedule C line 27a).
5. Save the CSV alongside your monthly bank statement for reconciliation.

The tax-safe export uses generic descriptions ("Office services", "OMT treatment") and patient identifiers like "Patient #1" — no PHI leaves the BAA-covered boundary. The detailed export (with patient names + invoice numbers) is for your in-house records only; do NOT import the detailed version into QBSE.

---

## Step 6 — Annual housekeeping

Once a year (around January):

- Review the BAA expiration date in `baa_ledger` and confirm Stripe hasn't published a new BAA requiring re-signing.
- Update the `SS_WAGE_BASE_2026` constant in `functions/_lib/billing_insights.js` to the new year's Social Security wage base (typically published in November by SSA).
- Rotate the Stripe restricted secret key (`rk_live_...`) per Step 2a — keep a 24-hour overlap window where both old and new key work, swap secrets, then revoke the old.

---

## Reference: D1 tables involved

| Table | Purpose |
|---|---|
| `baa_ledger` | BAA status per vendor — Cloudflare + Stripe required before live mode |
| `stripe_customers` | patient_id ↔ Stripe `cus_xxx` mapping |
| `payment_methods` | Saved cards (Stripe `pm_xxx` only, never PAN) |
| `invoices` | Invoice header — totals, status, PHI line items encrypted in R2 |
| `billing_service_catalog` | Operator-editable price book seeded with 16 default services |
| `payments` | Successful payments with gross/fee/net + Stripe ref IDs |
| `refunds` | Refund records linked to payments |
| `stripe_webhook_events` | Idempotency table for webhook retries |
| `billing_event_log` | Payment-specific audit trail (separate from main audit_log) |
| `billing_export_log` | Tamper-evident log of every CSV export with SHA-256 |

## Reference: Endpoints

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /api/v1/patient/billing/invoices` | patient session | Patient's invoice list |
| `GET /api/v1/patient/billing/invoices/:id` | patient session | Single invoice w/ decrypted PHI line items |
| `POST /api/v1/patient/billing/invoices/:id/pay` | patient session | Create PaymentIntent |
| `POST /api/v1/billing/stripe/webhook` | Stripe HMAC sig | Stripe event receiver |
| `GET /api/v1/admin/billing/invoices` | admin | List invoices (filterable) |
| `POST /api/v1/admin/billing/invoices` | admin | Create invoice |
| `PATCH /api/v1/admin/billing/invoices/:id` | admin | Mark sent / void / write-off |
| `POST /api/v1/admin/billing/payments/:id/refund` | admin | Issue refund |
| `GET /api/v1/admin/billing/services` | admin | Service catalog |
| `GET /api/v1/admin/billing/reports/summary` | admin | KPI summary |
| `GET /api/v1/admin/billing/reports/export` | admin | QB-friendly CSV export |
| `GET /api/v1/admin/billing/insights` | admin | AI-narrated accountant insights |

All admin endpoints are protected by HTTP Basic Auth via `functions/admin/_middleware.js` (PBKDF2 100k iterations per §9.8.3). Patient endpoints require a valid `mz_session` cookie obtained via the standard member portal login.

---

## Anything broken? Quick diagnostics

```bash
# Health endpoint — verifies all bindings + secret key presence
curl -u "$USER:$PASS" https://mountzara.com/api/v1/_health | python3 -m json.tool

# Latest webhook events (last 20)
npx wrangler d1 execute mountzara-clinical --remote --command \
  "SELECT stripe_event_id, event_type, processed_at, processing_error FROM stripe_webhook_events ORDER BY received_at DESC LIMIT 20"

# Outstanding A/R right now
npx wrangler d1 execute mountzara-clinical --remote --command \
  "SELECT SUM(total_cents - amount_paid_cents)/100.0 AS outstanding_usd FROM invoices WHERE status IN ('sent','partially_paid')"
```

---

**That's the entire setup.** Steps 1–3 are the only items requiring your attention; the rest is verification. Once Stripe keys are provisioned and the BAA is signed, the new admin Dashboard at `/admin/` will surface live billing insights, AI recommendations, and tax-prep projections automatically.
