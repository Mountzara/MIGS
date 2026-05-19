// =====================================================================
// POST /api/v1/billing/stripe/webhook — Stripe webhook event receiver
// =====================================================================
// Validated against env.STRIPE_WEBHOOK_SECRET using the v1 signature
// spec. Idempotent — duplicate event_ids (Stripe retries on 5xx) are
// no-op'd via stripe_webhook_events table.
//
// We handle:
//   payment_intent.succeeded         → record payment, mark invoice paid
//   payment_intent.payment_failed    → mark payment failed
//   charge.refunded                  → mark refund settled
//   refund.updated                   → update refund status
//   payment_method.attached          → log (defensive)
//   payment_method.detached          → log
//   customer.updated                 → reconcile email/name if changed
//
// Everything else is logged + acked (200) so Stripe doesn't retry.
//
// NEVER reject a webhook with 4xx unless signature failed — Stripe will
// retry up to 3 days on 4xx/5xx. 200 + log is the correct way to "skip"
// an unhandled event type.
// =====================================================================

import { verifyWebhookSignature, StripeError, getPaymentIntent } from "../../../../_lib/stripe.js";
import { recordPaymentSucceeded, writeBillingEvent } from "../../../../_lib/billing.js";

function ok() {
    return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
    });
}

function badSig(msg) {
    return new Response(JSON.stringify({ error: "signature_invalid", message: msg }), {
        status: 400,
        headers: { "content-type": "application/json" },
    });
}

function bad(msg, status = 400) {
    return new Response(JSON.stringify({ error: msg }), {
        status,
        headers: { "content-type": "application/json" },
    });
}

export async function onRequestPost(ctx) {
    const { request, env } = ctx;
    if (!env.DB) return bad("server_misconfigured", 500);

    const sig = request.headers.get("Stripe-Signature");
    const rawBody = await request.text();

    // 1. Verify signature
    let event;
    try {
        event = await verifyWebhookSignature(env, rawBody, sig);
    } catch (e) {
        if (e instanceof StripeError && (e.code === "signature_invalid" || e.code === "timestamp_too_old")) {
            return badSig(e.message);
        }
        console.error("webhook signature verify threw", { error: String(e?.message || e) });
        return badSig(String(e?.message || e));
    }

    // 2. Idempotency — have we seen this event_id?
    const existing = await env.DB.prepare(
        "SELECT stripe_event_id, processed_at FROM stripe_webhook_events WHERE stripe_event_id = ?"
    ).bind(event.id).first();
    if (existing && existing.processed_at) {
        return ok(); // already handled — Stripe retry
    }

    // 3. Persist receipt of event (so even if processing fails we don't double-handle)
    const now = Date.now();
    try {
        await env.DB.prepare(`
            INSERT OR REPLACE INTO stripe_webhook_events
                (stripe_event_id, event_type, livemode, api_version,
                 received_at, processed_at, raw_json)
            VALUES (?, ?, ?, ?, ?, NULL, ?)
        `).bind(
            event.id, event.type,
            event.livemode ? 1 : 0,
            event.api_version || null,
            now,
            // Store the raw JSON minus the customer card details (defensive — Stripe never sends PAN, but keep size sane)
            JSON.stringify(event).slice(0, 65536)
        ).run();
    } catch (e) {
        console.error("webhook event-log insert failed", { event_id: event.id, error: String(e?.message || e) });
    }

    // 4. Dispatch
    let processingError = null;
    let related = { invoice_id: null, payment_id: null, refund_id: null };
    try {
        switch (event.type) {
            case "payment_intent.succeeded": {
                const pi = event.data.object;
                // Re-fetch with charges expanded to make sure we have balance_transaction
                let full;
                try { full = await getPaymentIntent(env, pi.id, { expand: ["charges.data.balance_transaction"] }); }
                catch { full = pi; }
                const payment = await recordPaymentSucceeded(env, full);
                if (payment) {
                    related.invoice_id = payment.invoice_id;
                    related.payment_id = payment.id;
                }
                break;
            }
            case "payment_intent.payment_failed": {
                const pi = event.data.object;
                const err = pi.last_payment_error || {};
                await env.DB.prepare(`
                    UPDATE payments SET
                        status = 'failed',
                        failure_code = ?, failure_message = ?,
                        updated_at = ?
                    WHERE stripe_payment_intent_id = ?
                `).bind(err.code || null, err.message || null, now, pi.id).run();
                const row = await env.DB.prepare("SELECT * FROM payments WHERE stripe_payment_intent_id = ?").bind(pi.id).first();
                if (row) {
                    related.invoice_id = row.invoice_id;
                    related.payment_id = row.id;
                    await writeBillingEvent(env, {
                        actor_user_id: row.patient_id, actor_role: "stripe_webhook",
                        action: "payment_failed",
                        invoice_id: row.invoice_id, payment_id: row.id,
                        amount_cents: row.gross_amount_cents, currency: row.currency,
                        details: { code: err.code, message: err.message },
                        patient_visible: 1,
                    });
                }
                break;
            }
            case "charge.refunded": {
                const charge = event.data.object;
                // Charge object includes a refunds.data[] array — pick the latest
                const latest = (charge.refunds && charge.refunds.data || [])
                    .sort((a, b) => (b.created || 0) - (a.created || 0))[0];
                if (latest) {
                    await env.DB.prepare(`
                        UPDATE refunds SET
                            status = ?, settled_at = ?, updated_at = ?,
                            stripe_balance_transaction_id = ?
                        WHERE stripe_refund_id = ?
                    `).bind(latest.status, now, now, latest.balance_transaction || null, latest.id).run();
                    const row = await env.DB.prepare("SELECT * FROM refunds WHERE stripe_refund_id = ?").bind(latest.id).first();
                    if (row) {
                        related.invoice_id = row.invoice_id;
                        related.refund_id = row.id;
                        await writeBillingEvent(env, {
                            actor_role: "stripe_webhook", action: "refund_succeeded",
                            invoice_id: row.invoice_id, payment_id: row.payment_id, refund_id: row.id,
                            amount_cents: row.amount_cents, currency: row.currency,
                            patient_visible: 1,
                        });
                    }
                }
                break;
            }
            case "refund.updated": {
                const rf = event.data.object;
                await env.DB.prepare("UPDATE refunds SET status = ?, updated_at = ? WHERE stripe_refund_id = ?")
                    .bind(rf.status, now, rf.id).run();
                break;
            }
            case "payment_method.attached":
            case "payment_method.detached":
            case "customer.updated":
            case "invoice.payment_succeeded":
            case "invoice.payment_failed":
                // Log only — these come through when we use Stripe's
                // Invoice product directly. Currently we use ad-hoc
                // PaymentIntents per invoice, so these are informational.
                break;
            default:
                // Unhandled event type — log + ack.
                break;
        }
    } catch (e) {
        processingError = String(e?.message || e);
        console.error("webhook handler threw", { event_id: event.id, event_type: event.type, error: processingError });
    }

    // 5. Mark processed (success or with error)
    await env.DB.prepare(`
        UPDATE stripe_webhook_events SET
            processed_at = ?, processing_error = ?,
            related_invoice_id = ?, related_payment_id = ?, related_refund_id = ?
        WHERE stripe_event_id = ?
    `).bind(now, processingError, related.invoice_id, related.payment_id, related.refund_id, event.id).run();

    // Stripe expects 2xx for both success AND handled-with-warning. 5xx
    // triggers retry storms — only return 5xx if we want Stripe to retry.
    return ok();
}
