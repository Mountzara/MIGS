# Stripe + Phase 6 Billing — Go-Live Guide

This is the step-by-step guide to turn on patient billing for mountzara.com. Everything in the codebase is built and deployed. You only need to do three things in a browser (Stripe BAA, generate keys, set up webhook), then paste six values into Terminal. Total time once the BAA is countersigned: about 10 minutes.

---

## Before you start

You will end up with seven values to paste into Terminal at the end. Have a temporary note open (Apple Notes, a text file — anywhere private) to collect them as you go. **Delete that note when you're done.**

Values you'll collect:

```
1. Stripe live secret key:       rk_live_...
2. Stripe live publishable key:  pk_live_...
3. Stripe webhook signing secret: whsec_...
4. Stripe test secret key:       rk_test_...        (for smoke test only)
5. Stripe test publishable key:  pk_test_...        (for smoke test only)
6. Stripe test webhook secret:   whsec_...          (for smoke test only)
7. BAA countersigned date:       e.g. 2026-05-20
```

You'll only need #4–#6 if you want to run the optional smoke test before going live. Recommended but not required.

---

## STEP 1 — Sign the Stripe Healthcare BAA

This is the only part with waiting. Do it first so it can process while you handle the rest. Stripe legal typically returns the countersigned BAA in 1–3 business days.

### 1a. Create or sign in to your Stripe account

1. Open a browser tab to **https://dashboard.stripe.com/**
2. If you already have a Stripe account, sign in with the Mount Zara LLC business email.
3. If not:
   - Click **Sign up**.
   - **Email**: use the Mount Zara LLC business email (the same one tied to QuickBooks).
   - **Country**: United States.
   - **Account type**: Company.
   - **Business structure**: Sole proprietorship (single-member LLC is also fine).
   - **Industry category**: choose **Medical services → Healthcare or other health services**. (Stripe asks this specifically because it determines whether you'll qualify for the BAA.)
   - **EIN**: the Mount Zara LLC EIN.
   - **Business address**: registered Mount Zara LLC address.
   - **Bank account**: where payouts will land (this is the practice's operating account).
   - Verify your phone number and identity (standard KYC).

**Checkpoint:** You should see a dashboard with your business name in the top-left, and the URL is `https://dashboard.stripe.com/...`. If you see a banner that says "Activate your account" you can complete activation now — payouts can't run until activation is finished, but the BAA can be requested in parallel.

### 1b. Request the BAA

1. Click your business name in the top-left → **Settings**, or go directly to **https://dashboard.stripe.com/settings**
2. In the left sidebar, click **Compliance and security** → **Healthcare BAA**.
   - If you don't see that option, click **Business** in the sidebar → **Business details** → scroll for **Healthcare Business Associate Agreement (BAA)**.
   - If you still don't see it, the industry category in step 1a wasn't set to a healthcare type. Go back to **Business → Business details → Industry** and change it first.
3. Click **Request BAA**.
4. Stripe will ask:
   - **Type of healthcare entity**: Health Care Provider.
   - **Covered services**: Payments (and Invoicing, if shown).
   - **Authorized signatory**: your name + title (Owner / Member-Manager / DO).
5. Click **Submit**.

**Checkpoint:** The page should now show "BAA request pending review." Stripe will email you in 1–3 business days with a DocuSign link.

### 1c. After Stripe emails the BAA

1. Click the DocuSign link in the email, review the agreement, sign and submit.
2. Stripe will countersign within a day or two. You'll get a final PDF.
3. **Save the date you signed** to the temporary note. This goes into our compliance ledger at the end.

You can continue to Step 2 BEFORE the BAA is fully countersigned — the keys you generate now will work in test mode immediately, and only need to be flipped to live mode after the BAA lands. **Do not process real patient charges before the BAA is fully countersigned.**

---

## STEP 2 — Generate the three Stripe credentials

Three pieces of information are required: a **secret key** (used by our server to call Stripe), a **publishable key** (used by the patient's browser to talk to Stripe directly so card data never touches our servers), and a **webhook signing secret** (used to verify that incoming webhook events really came from Stripe).

### 2a. Generate the restricted secret key

1. In the Stripe dashboard, click the **mode toggle** in the top-right and choose **Live mode** (you'll see "Live mode" in the URL bar after).
   - If the BAA isn't countersigned yet, stay in **Test mode** for now — repeat this entire section under test mode first so you have `rk_test_...` values for the smoke test, then come back later for the `rk_live_...` values.
2. Navigate to **Developers → API keys**, or open **https://dashboard.stripe.com/apikeys** directly.
3. Scroll to **Restricted keys** (not the secret key at the top — that's the unrestricted root key, which we should NOT use for production).
4. Click **+ Create restricted key**.
5. **Key name**: `mountzara-prod-server-key` (or `mountzara-test-server-key` for the test variant).
6. **Permissions** — set the following to **Write**:
   - Core resources → **Customers**
   - Core resources → **PaymentIntents**
   - Core resources → **PaymentMethods**
   - Core resources → **Refunds**
   - Core resources → **Charges**
7. Set the following to **Read**:
   - Core resources → **Balance**
   - Core resources → **Balance transactions**
   - Billing → **Invoices**
8. Leave everything else at **None**.
9. Click **Create key** at the bottom.
10. **Copy the key value** that appears (starts with `rk_live_` or `rk_test_`). You can only see the full value once — paste it immediately into your temporary note.

**Checkpoint:** Your temporary note now has `Stripe live secret key: rk_live_xxxxxxxxxxxx` (or test equivalent).

### 2b. Copy the publishable key

1. Still on **Developers → API keys**.
2. At the top of the page in the **Standard keys** section, copy the **Publishable key** (starts with `pk_live_` or `pk_test_`).
3. Paste into the temporary note.

**Checkpoint:** Your temporary note now has `Stripe live publishable key: pk_live_xxxxxxxxxxxx`.

Publishable keys are designed to be embedded in browser JavaScript — they are safe to expose. Secret keys must never appear in browser code or git.

### 2c. Set up the webhook endpoint and copy its signing secret

1. Navigate to **Developers → Webhooks**, or open **https://dashboard.stripe.com/webhooks**
2. Click **+ Add endpoint**.
3. **Endpoint URL**: copy this exactly:
   ```
   https://mountzara.com/api/v1/billing/stripe/webhook
   ```
4. **Description**: `Mount Zara — production billing webhook` (or `... — test webhook` for test mode).
5. **Listen to events on this account** (default — not Connect).
6. **API version**: leave at the default (the current version).
7. **Events to send** — click **+ Select events** and check exactly these seven:
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `charge.refunded`
   - `refund.updated`
   - `payment_method.attached`
   - `payment_method.detached`
   - `customer.updated`
8. Click **Add events**, then **Add endpoint** at the bottom.
9. You're now on the endpoint's detail page. Find the **Signing secret** section and click **Reveal**.
10. Copy the value (starts with `whsec_...`) into your temporary note.

**Checkpoint:** Your temporary note now has `Stripe webhook signing secret: whsec_xxxxxxxxxxxx`.

If you're setting up both test and live modes, you'll do this entire section twice (once under each mode) — each gets its own webhook endpoint and its own `whsec_` value.

---

## STEP 3 — Paste credentials into Terminal

Open **Terminal** on your Mac. The commands below cache the keys in two places: Cloudflare Pages secrets (where the live website reads them) and macOS Keychain (where local scripts and future Claude sessions read them).

### 3a. Navigate to the repository

```bash
cd ~/Developer/MountZara/MIGS
```

### 3b. Set the three Cloudflare Pages secrets

Run these one at a time. Each command will prompt `? Enter a secret value:` — paste the corresponding value from your temporary note and press Return.

```bash
# 1 of 3 — secret key
npx wrangler pages secret put STRIPE_SECRET_KEY --project-name=mountzara
# (paste rk_live_xxxxxxxxxxxx here when prompted, press Return)

# 2 of 3 — publishable key
npx wrangler pages secret put STRIPE_PUBLISHABLE_KEY --project-name=mountzara
# (paste pk_live_xxxxxxxxxxxx when prompted)

# 3 of 3 — webhook signing secret
npx wrangler pages secret put STRIPE_WEBHOOK_SECRET --project-name=mountzara
# (paste whsec_xxxxxxxxxxxx when prompted)
```

**Checkpoint:** After each command, you should see `✨ Success! Uploaded secret STRIPE_*_KEY`. If wrangler asks you to log in or select a project, the project name is `mountzara` and the account is the one with Mount Zara LLC's Cloudflare login.

### 3c. Cache the same three secrets in macOS Keychain

```bash
security add-generic-password -U \
  -a "mountzara-stripe-secret-key" \
  -s "mountzara-stripe-secret-key" \
  -w "rk_live_xxxxxxxxxxxx"
# ↑ replace rk_live_xxxxxxxxxxxx with your actual secret key

security add-generic-password -U \
  -a "mountzara-stripe-publishable-key" \
  -s "mountzara-stripe-publishable-key" \
  -w "pk_live_xxxxxxxxxxxx"
# ↑ replace with your actual publishable key

security add-generic-password -U \
  -a "mountzara-stripe-webhook-secret" \
  -s "mountzara-stripe-webhook-secret" \
  -w "whsec_xxxxxxxxxxxx"
# ↑ replace with your actual webhook signing secret
```

**Checkpoint:** Each command will silently succeed (no output is good output). If you see an error, the most common cause is forgetting to update the placeholder.

### 3d. Log the Stripe BAA in our compliance ledger

This records the BAA status in our D1 database alongside the Cloudflare BAA already on file. Required for HIPAA documentation.

Replace `2026-05-20` with the date Stripe countersigned your BAA:

```bash
npx wrangler d1 execute mountzara-clinical --remote --command "
INSERT INTO baa_ledger (id, vendor, status, signed_at, notes, created_at, updated_at)
VALUES (
  'baa-stripe',
  'Stripe',
  'signed',
  strftime('%s','now')*1000,
  'Stripe Healthcare BAA countersigned 2026-05-20. Covers Payments, Invoicing. Annual review.',
  strftime('%s','now')*1000,
  strftime('%s','now')*1000
);"
```

**Checkpoint:** You should see `rows_written: 1` in the output.

### 3e. Redeploy so Cloudflare picks up the new secrets

```bash
bash scripts/deploy-prod.sh "stripe live keys provisioned"
```

**Checkpoint:** The script ends with `✨ Deployment complete!` and prints a `https://...mountzara.pages.dev` URL. After about 30 seconds, the keys are live on `https://mountzara.com/`.

### 3f. Confirm the system sees the new keys

```bash
ADMIN_PASS=$(security find-generic-password -s mountzara-admin-password -w)
ADMIN_USER=$(grep '^Username:' ~/Desktop/MountZara_Admin_Credentials.txt | sed 's/^Username: *//')

curl -sS -u "$ADMIN_USER:$ADMIN_PASS" https://mountzara.com/api/v1/_health | python3 -m json.tool
```

**Checkpoint:** The output should show `"ok": true` and all bindings green.

### 3g. Securely delete your temporary note

Once everything above is verified working, delete the temporary note containing the seven values. They live in Keychain + Cloudflare Pages now and don't need to be in any other location.

---

## STEP 4 — Optional but recommended: smoke test with Stripe test mode

Before you invoice a real patient, run the full flow once with Stripe's test card to confirm everything works end-to-end. This requires the **test-mode** keys you collected in 2a–2c (the `rk_test_`, `pk_test_`, `whsec_` test variants).

If you skipped collecting test keys, you can do this section later, or skip it entirely and just be extra careful with the first real invoice.

### 4a. Temporarily swap to test keys

Same three commands as 3b, but paste the test values:

```bash
npx wrangler pages secret put STRIPE_SECRET_KEY --project-name=mountzara
# paste rk_test_xxxx

npx wrangler pages secret put STRIPE_PUBLISHABLE_KEY --project-name=mountzara
# paste pk_test_xxxx

npx wrangler pages secret put STRIPE_WEBHOOK_SECRET --project-name=mountzara
# paste the test webhook whsec_xxxx

bash scripts/deploy-prod.sh "stripe test keys for smoke test"
```

### 4b. Create a $5 test invoice to Jane Doe

1. Open **https://mountzara.com/admin/billing/** in your browser (admin Basic Auth required).
2. Click **Create invoice**.
3. **Patient**: Jane Doe (the seeded test patient).
4. **Service**: Office visit follow-up ($150 default — change the quantity or amount to $5 for the test).
5. **Issue date**: today.
6. Check **Send immediately to patient**.
7. Click **Create invoice**.

### 4c. Pay the test invoice as Jane Doe

1. Open a new private/incognito browser window (so you're not signed in as admin).
2. Go to **https://mountzara.com/portal/login**.
3. Log in as Jane Doe — credentials are in `~/Desktop/JaneDoe_credentials.txt`.
4. Click **Billing** in the nav.
5. You should see the $5 invoice. Click **Pay $5.00**.
6. In the Stripe Elements modal that appears, use this test card:
   - **Card number**: `4242 4242 4242 4242`
   - **Expiry**: any future date (e.g. `12/30`)
   - **CVC**: any 3 digits (e.g. `123`)
   - **ZIP**: any 5 digits (e.g. `60201`)
7. Click **Pay now**.

**Checkpoint:** You should see a green "Payment received — thank you" banner. The invoice flips to "paid" status.

### 4d. Verify the payment landed end-to-end

Back in Terminal:

```bash
npx wrangler d1 execute mountzara-clinical --remote --command \
  "SELECT id, status, gross_amount_cents, fee_amount_cents, net_amount_cents, captured_at FROM payments ORDER BY captured_at DESC LIMIT 3"

npx wrangler d1 execute mountzara-clinical --remote --command \
  "SELECT stripe_event_id, event_type, processed_at, processing_error FROM stripe_webhook_events ORDER BY received_at DESC LIMIT 5"
```

You should see one new payment row with `status='succeeded'` and one webhook event with `event_type='payment_intent.succeeded'` and a `processed_at` timestamp.

### 4e. Issue a partial refund

1. Back in the admin view at **https://mountzara.com/admin/billing/**, click into the invoice you just paid.
2. Click **Issue refund** → enter `$1` as the partial amount → reason `requested_by_customer` → submit.

**Checkpoint:** Invoice status becomes `partially_paid` (since $4 remains charged after the $1 refund). The `refunds` D1 table has a new row.

### 4f. Switch back to live keys

Repeat 3b with your **live** keys (the `rk_live_` / `pk_live_` / live `whsec_` values), then redeploy:

```bash
npx wrangler pages secret put STRIPE_SECRET_KEY --project-name=mountzara
# paste rk_live_xxxx

npx wrangler pages secret put STRIPE_PUBLISHABLE_KEY --project-name=mountzara
# paste pk_live_xxxx

npx wrangler pages secret put STRIPE_WEBHOOK_SECRET --project-name=mountzara
# paste the LIVE webhook whsec_xxxx

bash scripts/deploy-prod.sh "stripe live keys restored"
```

You're now ready to invoice real patients.

---

## STEP 5 — Your first real invoice + first QuickBooks export

1. **Generate an invoice for a real patient.** Open `/admin/billing/`, click Create invoice, choose the patient, pick a service from the catalog, set the amount, click Send.
2. The patient gets an email with a "View and pay invoice" link going to their portal.
3. When they pay, the AI insights panel on `/admin/` updates within 5 minutes (KV cache window).
4. **At month-end, export to QuickBooks**:
   - Open `/admin/billing/reports/` (or wherever you want to put the report link — the API endpoint is `/api/v1/admin/billing/reports/export?from=2026-05-01&to=2026-05-31&mode=tax_safe&format=qbo`).
   - Open the CSV in QuickBooks Self-Employed → **Transactions → Add → Import from CSV**.
   - Map columns when prompted (the CSV uses QBO's standard column names so it should auto-map).
   - Stripe fees will appear as a separate negative-amount line — categorize those as **Other business expenses** in QBSE (Schedule C line 27a).
5. **Save the CSV** alongside your monthly bank statement for reconciliation. Stripe's payouts to your bank should match the CSV's net amount column.

---

## What can go wrong and what to do

**"BAA option doesn't appear in Stripe dashboard"** — Your business industry isn't set to a healthcare category. Settings → Business details → Industry → change to "Medical services" → save → refresh → the BAA option will now appear.

**"Webhook signature verification failed"** when you pay an invoice — You used the WRONG webhook signing secret. The test-mode webhook has a different `whsec_` than the live-mode webhook. Verify in the Stripe dashboard which mode you're currently in and re-fetch the matching secret.

**Payment succeeds in Stripe but invoice stays "sent" in the admin** — Webhook isn't reaching us. Check the webhook endpoint in Stripe dashboard → Recent deliveries. If they show errors, the endpoint URL is wrong or our deployment is broken (check `/api/v1/_health`).

**"Card declined" with the 4242 card** — You're using live mode keys with a test card, or vice versa. Test cards only work with `pk_test_` / `rk_test_` keys.

**Real patient enters card and it's declined** — Real declines are normal. The Stripe dashboard at `/payments` shows the decline reason. Common ones: insufficient funds, card lost/stolen flag, address-verification mismatch. The patient sees a friendly error in the portal and can try a different card.

**"How do I refund the Stripe fee too?"** — You can't. Stripe keeps the processing fee on a refund. The patient gets back their full payment amount, and you eat the original fee. This is standard for every payment processor.

---

## Annual housekeeping

Once a year (early January):

1. **Review the BAA in the dashboard.** Look at `dashboard.stripe.com/settings/compliance` — if Stripe has published a new BAA version, you'll see a banner asking you to re-sign.
2. **Update the Social Security wage base** in our code. Each November, SSA publishes the new wage base (e.g. $168,600 for 2024). Open `functions/_lib/billing_insights.js` and update the `SS_WAGE_BASE_2026` constant to the new year's value. Commit and redeploy.
3. **Rotate the restricted secret key.** Generate a new `rk_live_...` per Step 2a (same permissions). Update Pages secrets per Step 3b. Then in the Stripe dashboard, revoke the old key. Doing it in that order means zero downtime.
4. **Export and archive the full year's CSV.** Step 5 above, but with date range `from=2025-01-01&to=2025-12-31`. Match against Stripe's 1099-K (Stripe sends this in late January for payments above the IRS threshold).

---

## Reference cheat sheet

| What | Where |
|---|---|
| Stripe live dashboard | https://dashboard.stripe.com/ |
| Stripe API keys | https://dashboard.stripe.com/apikeys |
| Stripe webhooks | https://dashboard.stripe.com/webhooks |
| Healthcare BAA request | https://dashboard.stripe.com/settings/compliance |
| Mount Zara billing admin | https://mountzara.com/admin/billing/ |
| Mount Zara member billing | https://mountzara.com/portal/billing/ |
| Mission Control dashboard | https://mountzara.com/admin/ |
| AI insights endpoint | /api/v1/admin/billing/insights?window=mtd |
| QB-friendly CSV export | /api/v1/admin/billing/reports/export?from=...&to=...&mode=tax_safe&format=qbo |
| Health check | /api/v1/_health |
| Cloudflare Pages secrets | `npx wrangler pages secret list --project-name=mountzara` |
| macOS Keychain entries | `security dump-keychain ~/Library/Keychains/login.keychain-db \| grep mountzara` |

---

**You're done when:** the `/admin/` dashboard shows real payment data in its KPI strip and the AI Advisor panel narrates actual numbers (instead of "No payment activity").

If anything in this guide breaks or feels unclear, paste the error message into the next Claude session and I'll diagnose. The whole point of writing this down is that you should never have to remember any of it from memory.
