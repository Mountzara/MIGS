// =====================================================================
// POST /api/v1/admin/billing/payments/<id>/refund
// =====================================================================
// Body: { amount_cents?, reason?, admin_memo? }
// amount_cents defaults to full payment amount.
// reason ∈ {duplicate, requested_by_customer, fraudulent, service_not_rendered}
// =====================================================================

import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../../../../_lib/admin_api.js";
import { issueRefund } from "../../../../../../_lib/billing.js";

export async function onRequestPost(ctx) {
    return adminRoute(ctx, async ({ env, request, admin, ctx: c }) => {
        if (!env.STRIPE_SECRET_KEY) return jsonError("stripe_not_configured", 503);
        const payment_id = String(c.params?.id || "");
        if (!payment_id) return jsonError("bad_params", 400);

        const body = await readJsonBody(request);
        // Load payment to default amount if not provided
        const payment = await env.DB.prepare(
            "SELECT * FROM payments WHERE id = ? LIMIT 1"
        ).bind(payment_id).first();
        if (!payment) return jsonError("payment_not_found", 404);
        const amt = Number.isInteger(body.amount_cents) && body.amount_cents > 0
            ? Math.min(body.amount_cents, payment.gross_amount_cents)
            : payment.gross_amount_cents;

        try {
            const out = await issueRefund(env, {
                payment_id,
                amount_cents: amt,
                reason: body.reason || null,
                admin_memo: body.admin_memo || null,
                initiated_by_user_id: admin.user,
            });
            return jsonResponse({ ok: true, ...out }, { status: 201 });
        } catch (e) {
            return jsonError(String(e?.message || e), 400);
        }
    });
}
