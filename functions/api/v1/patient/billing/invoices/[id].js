// =====================================================================
// GET  /api/v1/patient/billing/invoices/<id>      — single invoice w/ PHI line items
// POST /api/v1/patient/billing/invoices/<id>/pay  — create PaymentIntent
// =====================================================================

import { previewAccess, preLaunchNotFound } from "../../../../../_lib/preview_gate.js";
import { requireRole } from "../../../../../_lib/auth.js";
import { loadInvoice, createPaymentIntentForInvoice } from "../../../../../_lib/billing.js";

function err(status, code, message) {
    return new Response(JSON.stringify({ error: code, message }), {
        status,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

async function loadPatient(env, patient_id) {
    return env.DB.prepare(
        "SELECT id, first_name, last_name, email FROM patients WHERE id = ? LIMIT 1"
    ).bind(patient_id).first();
}

export async function onRequestGet(ctx) {
    const { request, env, params } = ctx;
    const { allow } = await previewAccess(request, env);
    if (!allow) return preLaunchNotFound();

    let session;
    try { session = await requireRole(ctx, ["patient"]); }
    catch (resp) { return resp; }
    if (!session.patient_id || !env.DB) return err(500, "server_error", "DB not bound");

    const id = String(params?.id || "");
    if (!id) return err(400, "bad_params");

    const inv = await loadInvoice(env, id, { include_phi_line_items: true });
    if (!inv) return err(404, "invoice_not_found");
    if (inv.patient_id !== session.patient_id) return err(403, "forbidden");

    return new Response(JSON.stringify({
        invoice: {
            id: inv.id,
            invoice_number: inv.invoice_number,
            issue_date: inv.issue_date,
            due_date: inv.due_date,
            currency: inv.currency,
            subtotal_cents: inv.subtotal_cents,
            tax_cents: inv.tax_cents,
            discount_cents: inv.discount_cents,
            total_cents: inv.total_cents,
            amount_paid_cents: inv.amount_paid_cents,
            amount_refunded_cents: inv.amount_refunded_cents,
            balance_cents: inv.total_cents - inv.amount_paid_cents,
            status: inv.status,
            public_memo: inv.public_memo,
            line_items: inv.line_items || [],
            sent_at: inv.sent_at,
            paid_at: inv.paid_at,
        },
    }), {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}
