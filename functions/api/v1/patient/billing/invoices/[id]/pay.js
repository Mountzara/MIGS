// =====================================================================
// POST /api/v1/patient/billing/invoices/<id>/pay — start payment
// =====================================================================
// Creates a Stripe PaymentIntent for the invoice's remaining balance.
// Returns { client_secret, publishable_key } — the patient's browser
// then uses Stripe.js + Stripe Elements to confirm the payment.
//
// Card data NEVER touches our servers. Stripe Elements posts the card
// directly to Stripe and returns a payment_method_id (pm_xxx) via the
// client_secret-bound confirm() call.
//
// Optional body:
//   { saved_payment_method_id: "pm_xxx" }  — pay with a card on file
//
// Auth: patient session. Preview gate honored.
// =====================================================================

import { previewAccess, preLaunchNotFound } from "../../../../../../_lib/preview_gate.js";
import { requireRole } from "../../../../../../_lib/auth.js";
import { createPaymentIntentForInvoice } from "../../../../../../_lib/billing.js";

function err(status, code, message, extra = {}) {
    return new Response(JSON.stringify({ error: code, message, ...extra }), {
        status,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

async function loadPatient(env, patient_id) {
    return env.DB.prepare(
        "SELECT id, first_name, last_name, email FROM patients WHERE id = ? LIMIT 1"
    ).bind(patient_id).first();
}

export async function onRequestPost(ctx) {
    const { request, env, params } = ctx;
    const { allow } = await previewAccess(request, env);
    if (!allow) return preLaunchNotFound();

    let session;
    try { session = await requireRole(ctx, ["patient"]); }
    catch (resp) { return resp; }
    if (!session.patient_id || !env.DB) return err(500, "server_error");
    if (!env.STRIPE_SECRET_KEY) return err(503, "stripe_not_configured", "Stripe is not yet configured for live payments.");

    const id = String(params?.id || "");
    if (!id) return err(400, "bad_params");

    const patient = await loadPatient(env, session.patient_id);
    if (!patient) return err(404, "patient_not_found");

    let body = {};
    try { body = await request.json(); } catch {}
    const saved_pm = body && typeof body.saved_payment_method_id === "string" ? body.saved_payment_method_id : null;

    try {
        const result = await createPaymentIntentForInvoice(env, {
            invoice_id: id,
            patient,
            payment_method_id: saved_pm,
            off_session: !!saved_pm,
            statement_descriptor_suffix: "MOUNTZARA",
        });
        return new Response(JSON.stringify({
            ok: true,
            client_secret: result.client_secret,
            stripe_payment_intent_id: result.stripe_payment_intent_id,
            payment_id: result.payment_id,
            amount_cents: result.amount_cents,
            currency: result.currency,
            publishable_key: env.STRIPE_PUBLISHABLE_KEY,
        }), {
            status: 201,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
    } catch (e) {
        const code = String(e?.message || e);
        if (code === "invoice_not_found") return err(404, "invoice_not_found");
        if (code === "invoice_already_paid") return err(409, "invoice_already_paid");
        if (code === "invoice_voided") return err(409, "invoice_voided");
        if (code === "invoice_has_no_balance") return err(409, "invoice_has_no_balance");
        console.error("createPaymentIntentForInvoice threw", { error: code });
        return err(500, "stripe_error", code);
    }
}
