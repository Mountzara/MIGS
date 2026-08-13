// =====================================================================
// functions/_lib/billing.js — domain logic for Phase 6 patient billing
// =====================================================================
// Wraps the schema in 0010_phase6_stripe_billing.sql with a clean API
// for the patient-portal and admin endpoints to call.
//
// PHI handling per CLAUDE.md §4.2 + §11 Phase 6:
//   - invoice line-item descriptions that name a specific procedure or
//     condition ARE PHI. They get envelope-encrypted into mountzara-phi
//     and only the opaque service `code` (e.g. "office_visit_followup")
//     + dollar amount live in plaintext D1.
//   - The `tax_export_summary` field is a manually-sanitized invoice
//     summary safe to ship into QuickBooks (no diagnosis, no procedure
//     specifics). Used by /admin/billing/reports/.
// =====================================================================

import { newId } from "./db.js";
import { encryptPhi, decryptPhi } from "./phi.js";
import {
    createCustomer as stripeCreateCustomer,
    createPaymentIntent as stripeCreatePI,
    getPaymentIntent as stripeGetPI,
    createRefund as stripeCreateRefund,
    getBalanceTransaction as stripeGetBT,
    attachPaymentMethod as stripeAttachPM,
    detachPaymentMethod as stripeDetachPM,
} from "./stripe.js";

const PHI_AAD_LINE_ITEMS = "invoice/line_items";

// ---------- Customer mapping ----------
export async function ensureStripeCustomer(env, patient) {
    const row = await env.DB.prepare(
        "SELECT stripe_customer_id, livemode FROM stripe_customers WHERE patient_id = ? LIMIT 1"
    ).bind(patient.id).first();
    if (row) return { stripe_customer_id: row.stripe_customer_id, livemode: !!row.livemode };

    // First time — create on Stripe + cache locally.
    const fullName = [patient.first_name, patient.last_name].filter(Boolean).join(" ").trim();
    const cust = await stripeCreateCustomer(env, {
        email: patient.email,
        name: fullName || undefined,
        patient_id: patient.id,
        idempotency_key: `mzcust_${patient.id}`,
    });
    const now = Date.now();
    await env.DB.prepare(`
        INSERT INTO stripe_customers
            (patient_id, stripe_customer_id, sent_email, sent_name, livemode, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(patient_id) DO UPDATE SET
            stripe_customer_id = excluded.stripe_customer_id,
            sent_email = excluded.sent_email,
            sent_name = excluded.sent_name,
            livemode = excluded.livemode,
            updated_at = excluded.updated_at
    `).bind(patient.id, cust.id, patient.email, fullName || null, cust.livemode ? 1 : 0, now, now).run();
    return { stripe_customer_id: cust.id, livemode: !!cust.livemode };
}

// ---------- Service catalog ----------
export async function listServiceCatalog(env, { activeOnly = true } = {}) {
    const sql = activeOnly
        ? "SELECT * FROM billing_service_catalog WHERE is_active = 1 ORDER BY sort_order, display_name"
        : "SELECT * FROM billing_service_catalog ORDER BY sort_order, display_name";
    const res = await env.DB.prepare(sql).all();
    return res?.results || [];
}

export async function getService(env, code) {
    return env.DB.prepare(
        "SELECT * FROM billing_service_catalog WHERE code = ? AND is_active = 1 LIMIT 1"
    ).bind(code).first();
}

// ---------- Invoice creation ----------
// line_items: [{ service_code, description, quantity, unit_price_cents }, ...]
// `description` may reference a specific procedure (PHI); we encrypt the
// full line_items JSON into R2 and store only opaque codes + amounts in
// D1.
export async function createInvoice(env, args) {
    const {
        patient_id,
        appointment_id = null,
        encounter_id = null,
        line_items,                       // PHI-bearing — encrypted
        public_memo = null,                // public-safe memo
        tax_export_summary = null,         // generic summary for QB export (non-PHI)
        currency = "usd",
        issue_date,                        // YYYY-MM-DD
        due_date = null,
        created_by_user_id = null,
    } = args;

    if (!patient_id || !Array.isArray(line_items) || line_items.length === 0) {
        throw new Error("missing_patient_or_line_items");
    }
    if (!issue_date || !/^\d{4}-\d{2}-\d{2}$/.test(issue_date)) {
        throw new Error("invalid_issue_date");
    }

    // Compute totals
    let subtotal = 0;
    const clean = [];
    for (const li of line_items) {
        const qty = Number.isInteger(li.quantity) && li.quantity > 0 ? li.quantity : 1;
        const unit = Math.round(Number(li.unit_price_cents) || 0);
        const ext = qty * unit;
        subtotal += ext;
        clean.push({
            service_code: String(li.service_code || "other"),
            description: String(li.description || "").slice(0, 500),
            quantity: qty,
            unit_price_cents: unit,
            extended_cents: ext,
        });
    }
    const total = subtotal; // no tax/discount yet — add when needed

    // Encrypt PHI-bearing line items into mountzara-phi
    const id = newId();
    const aad = `${PHI_AAD_LINE_ITEMS}/${id}`;
    const r2Key = `invoice/${patient_id}/${id}/line_items.json.bin`;
    let put;
    try {
        put = await encryptPhi(env, JSON.stringify(clean), aad);
        await env.PHI.put(r2Key, put.ciphertext, {
            customMetadata: { "mz-iv-data": put.iv_data, "mz-iv-dek": put.iv_dek, aad },
        });
    } catch (e) {
        throw new Error(`phi_encrypt_failed:${e.message || e}`);
    }

    // Build invoice number (human-friendly)
    const yr = issue_date.slice(0, 4);
    const seqRow = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM invoices WHERE invoice_number LIKE ?"
    ).bind(`INV-${yr}-%`).first();
    const seq = (seqRow?.n || 0) + 1;
    const invoiceNumber = `INV-${yr}-${String(seq).padStart(4, "0")}`;

    const now = Date.now();
    await env.DB.prepare(`
        INSERT INTO invoices
            (id, patient_id, appointment_id, encounter_id,
             invoice_number, issue_date, due_date,
             currency, subtotal_cents, total_cents,
             status, public_memo, line_items_phi_r2_key, line_items_wrapped_dek,
             tax_export_summary, created_at, updated_at, created_by_user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)
    `).bind(
        id, patient_id, appointment_id, encounter_id,
        invoiceNumber, issue_date, due_date,
        currency, subtotal, total,
        public_memo, r2Key, put.wrapped_dek,
        tax_export_summary,
        now, now, created_by_user_id
    ).run();

    await writeBillingEvent(env, {
        actor_user_id: created_by_user_id,
        actor_role: "admin",
        action: "invoice_created",
        invoice_id: id,
        amount_cents: total,
        currency,
        details: { invoice_number: invoiceNumber, line_item_count: clean.length },
    });

    return { id, invoice_number: invoiceNumber, total_cents: total, currency };
}

// ---------- Load invoice for display (decrypts line items) ----------
export async function loadInvoice(env, invoice_id, { include_phi_line_items = false } = {}) {
    const inv = await env.DB.prepare("SELECT * FROM invoices WHERE id = ? LIMIT 1").bind(invoice_id).first();
    if (!inv) return null;
    let line_items = null;
    if (include_phi_line_items && inv.line_items_phi_r2_key && inv.line_items_wrapped_dek) {
        try {
            const obj = await env.PHI.get(inv.line_items_phi_r2_key);
            if (obj) {
                const ct = await obj.arrayBuffer();
                const md = obj.customMetadata || {};
                const aad = md.aad || `${PHI_AAD_LINE_ITEMS}/${invoice_id}`;
                // decryptPhi returns BYTES. This parsed them directly, threw,
                // and the catch below logged a warning — so invoice line items
                // silently came back empty on every invoice that had them.
                const plaintext = new TextDecoder().decode(
                    await decryptPhi(env, new Uint8Array(ct), inv.line_items_wrapped_dek, md["mz-iv-data"], md["mz-iv-dek"], aad));
                line_items = JSON.parse(plaintext);
            }
        } catch (e) {
            console.warn("loadInvoice decrypt failed", { invoice_id, error: String(e?.message || e) });
        }
    }
    return { ...inv, line_items };
}

// ---------- Mark invoice sent ----------
export async function markInvoiceSent(env, invoice_id, actor_user_id) {
    const now = Date.now();
    await env.DB.prepare(`
        UPDATE invoices SET status = 'sent', sent_at = ?, updated_at = ? WHERE id = ? AND status = 'draft'
    `).bind(now, now, invoice_id).run();
    await writeBillingEvent(env, {
        actor_user_id, actor_role: "admin", action: "invoice_sent", invoice_id,
    });
}

// ---------- Payment Intent creation (patient clicks Pay) ----------
export async function createPaymentIntentForInvoice(env, args) {
    const { invoice_id, patient, off_session = false, payment_method_id = null, statement_descriptor_suffix } = args;
    const inv = await env.DB.prepare("SELECT * FROM invoices WHERE id = ? AND patient_id = ?").bind(invoice_id, patient.id).first();
    if (!inv) throw new Error("invoice_not_found");
    if (inv.status === "paid") throw new Error("invoice_already_paid");
    if (inv.status === "void") throw new Error("invoice_voided");

    const remaining = inv.total_cents - (inv.amount_paid_cents || 0);
    if (remaining <= 0) throw new Error("invoice_has_no_balance");

    const { stripe_customer_id } = await ensureStripeCustomer(env, patient);

    const pi = await stripeCreatePI(env, {
        amount_cents: remaining,
        currency: inv.currency || "usd",
        customer_id: stripe_customer_id,
        payment_method_id,
        off_session,
        confirm: !!(off_session && payment_method_id),
        // The description is shown on the patient's card statement (after
        // statement_descriptor_suffix) — keep it PHI-free. Use invoice
        // number, not service description.
        description: `Mount Zara — Invoice ${inv.invoice_number}`,
        statement_descriptor_suffix,
        receipt_email: patient.email,
        metadata: {
            mountzara_invoice_id: inv.id,
            mountzara_patient_id: patient.id,
            mountzara_invoice_number: inv.invoice_number,
        },
        idempotency_key: `mzpi_${inv.id}_${remaining}`,
    });

    // Cache the PI ID on the invoice
    const now = Date.now();
    await env.DB.prepare(
        "UPDATE invoices SET stripe_payment_intent_id = ?, updated_at = ? WHERE id = ?"
    ).bind(pi.id, now, inv.id).run();

    // Create a pending payment row
    const payment_id = newId();
    await env.DB.prepare(`
        INSERT INTO payments
            (id, patient_id, invoice_id, stripe_payment_intent_id,
             gross_amount_cents, currency, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(payment_id, patient.id, inv.id, pi.id, remaining, inv.currency || "usd", "pending", now, now).run();

    await writeBillingEvent(env, {
        actor_user_id: patient.id,
        actor_role: "patient",
        action: "payment_initiated",
        invoice_id: inv.id,
        payment_id,
        amount_cents: remaining,
        currency: inv.currency,
        patient_visible: 1,
    });

    return {
        client_secret: pi.client_secret,
        stripe_payment_intent_id: pi.id,
        payment_id,
        amount_cents: remaining,
        currency: inv.currency || "usd",
    };
}

// ---------- Handle PI succeeded (called from webhook) ----------
export async function recordPaymentSucceeded(env, paymentIntent) {
    const pi_id = paymentIntent.id;
    const charge = (paymentIntent.charges && paymentIntent.charges.data && paymentIntent.charges.data[0]) || null;
    const balanceTxnId = charge && charge.balance_transaction;

    let fee_cents = 0, net_cents = paymentIntent.amount;
    if (balanceTxnId) {
        try {
            const txn = await stripeGetBT(env, balanceTxnId);
            fee_cents = txn.fee || 0;
            net_cents = txn.net || (paymentIntent.amount - fee_cents);
        } catch (e) {
            console.warn("balance_transaction fetch failed", { balanceTxnId, error: String(e?.message || e) });
        }
    }

    const now = Date.now();
    const captured_at = charge?.created ? charge.created * 1000 : now;

    // Update payment row
    const upd = await env.DB.prepare(`
        UPDATE payments SET
            stripe_charge_id = ?, stripe_balance_transaction_id = ?, stripe_pm_id = ?,
            gross_amount_cents = ?, fee_amount_cents = ?, net_amount_cents = ?,
            status = 'succeeded', captured_at = ?, updated_at = ?
        WHERE stripe_payment_intent_id = ?
    `).bind(
        charge?.id || null,
        balanceTxnId || null,
        paymentIntent.payment_method || null,
        paymentIntent.amount, fee_cents, net_cents,
        captured_at, now,
        pi_id
    ).run();

    const payment = await env.DB.prepare(
        "SELECT * FROM payments WHERE stripe_payment_intent_id = ? LIMIT 1"
    ).bind(pi_id).first();
    if (!payment) return null;

    // Update the invoice
    await env.DB.prepare(`
        UPDATE invoices SET
            amount_paid_cents = amount_paid_cents + ?,
            status = CASE WHEN (amount_paid_cents + ?) >= total_cents THEN 'paid' ELSE 'partially_paid' END,
            paid_at = CASE WHEN (amount_paid_cents + ?) >= total_cents THEN ? ELSE paid_at END,
            updated_at = ?
        WHERE id = ?
    `).bind(payment.gross_amount_cents, payment.gross_amount_cents, payment.gross_amount_cents, captured_at, now, payment.invoice_id).run();

    await writeBillingEvent(env, {
        actor_user_id: payment.patient_id,
        actor_role: "stripe_webhook",
        action: "payment_succeeded",
        invoice_id: payment.invoice_id,
        payment_id: payment.id,
        amount_cents: payment.gross_amount_cents,
        currency: payment.currency,
        patient_visible: 1,
        details: { fee_cents, net_cents, stripe_pi: pi_id },
    });

    return payment;
}

// ---------- Refund ----------
export async function issueRefund(env, args) {
    const { payment_id, amount_cents, reason = null, admin_memo = null, initiated_by_user_id } = args;
    const payment = await env.DB.prepare("SELECT * FROM payments WHERE id = ?").bind(payment_id).first();
    if (!payment) throw new Error("payment_not_found");
    if (payment.status !== "succeeded") throw new Error("payment_not_succeeded");

    const requested = Math.min(amount_cents, payment.gross_amount_cents);
    const stripeRef = await stripeCreateRefund(env, {
        payment_intent_id: payment.stripe_payment_intent_id,
        amount_cents: requested,
        reason: reason || undefined,
        metadata: {
            mountzara_payment_id: payment.id,
            mountzara_invoice_id: payment.invoice_id,
            mountzara_patient_id: payment.patient_id,
        },
        idempotency_key: `mzrf_${payment.id}_${requested}_${Date.now()}`,
    });

    const id = newId();
    const now = Date.now();
    await env.DB.prepare(`
        INSERT INTO refunds
            (id, payment_id, invoice_id, patient_id, stripe_refund_id,
             amount_cents, currency, reason, status, admin_memo,
             initiated_at, initiated_by_user_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
        id, payment.id, payment.invoice_id, payment.patient_id, stripeRef.id,
        requested, payment.currency, reason, stripeRef.status, admin_memo,
        now, initiated_by_user_id, now, now
    ).run();

    // Update invoice running totals
    await env.DB.prepare(`
        UPDATE invoices SET
            amount_refunded_cents = amount_refunded_cents + ?,
            status = CASE
                WHEN (amount_refunded_cents + ?) >= total_cents THEN 'refunded'
                ELSE status
            END,
            updated_at = ?
        WHERE id = ?
    `).bind(requested, requested, now, payment.invoice_id).run();

    await writeBillingEvent(env, {
        actor_user_id: initiated_by_user_id,
        actor_role: "admin",
        action: "refund_initiated",
        invoice_id: payment.invoice_id,
        payment_id: payment.id,
        refund_id: id,
        amount_cents: requested,
        currency: payment.currency,
        details: { stripe_refund_id: stripeRef.id, reason },
    });

    return { id, stripe_refund_id: stripeRef.id, amount_cents: requested };
}

// ---------- Card-on-file management ----------
export async function attachCard(env, { patient, stripe_pm_id, is_default = false }) {
    const { stripe_customer_id } = await ensureStripeCustomer(env, patient);
    const pm = await stripeAttachPM(env, stripe_pm_id, stripe_customer_id);
    const card = pm.card || {};
    const id = newId();
    const now = Date.now();
    await env.DB.prepare(`
        INSERT INTO payment_methods
            (id, patient_id, stripe_pm_id, stripe_customer_id, type,
             brand, last4, exp_month, exp_year, is_default,
             attached_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
        id, patient.id, pm.id, stripe_customer_id, pm.type,
        card.brand || null, card.last4 || null, card.exp_month || null, card.exp_year || null,
        is_default ? 1 : 0,
        now, now, now
    ).run();
    await writeBillingEvent(env, {
        actor_user_id: patient.id, actor_role: "patient", action: "card_attached",
        details: { stripe_pm_id, brand: card.brand, last4: card.last4 },
        patient_visible: 1,
    });
    return { id, last4: card.last4, brand: card.brand };
}

export async function detachCard(env, { patient, stripe_pm_id, initiated_by_user_id }) {
    await stripeDetachPM(env, stripe_pm_id);
    const now = Date.now();
    await env.DB.prepare(
        "UPDATE payment_methods SET detached_at = ?, updated_at = ? WHERE patient_id = ? AND stripe_pm_id = ?"
    ).bind(now, now, patient.id, stripe_pm_id).run();
    await writeBillingEvent(env, {
        actor_user_id: initiated_by_user_id || patient.id,
        actor_role: initiated_by_user_id === patient.id ? "patient" : "admin",
        action: "card_detached",
        details: { stripe_pm_id },
        patient_visible: 1,
    });
}

// ---------- Event log helper ----------
export async function writeBillingEvent(env, {
    actor_user_id = null, actor_role,
    action,
    invoice_id = null, payment_id = null, refund_id = null,
    amount_cents = null, currency = null,
    ip = null, user_agent = null,
    details = null, patient_visible = 0,
}) {
    const id = newId();
    await env.DB.prepare(`
        INSERT INTO billing_event_log
            (id, occurred_at, actor_user_id, actor_role, action,
             invoice_id, payment_id, refund_id, amount_cents, currency,
             ip, user_agent, details_json, patient_visible)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
        id, Date.now(), actor_user_id, actor_role, action,
        invoice_id, payment_id, refund_id, amount_cents, currency,
        ip, user_agent,
        details ? JSON.stringify(details) : null,
        patient_visible ? 1 : 0
    ).run();
    return id;
}
