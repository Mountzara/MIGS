// =====================================================================
// /api/v1/admin/billing/invoices/<id>
// GET     — single invoice with PHI line items + payment history
// PATCH   — { status: 'void' | 'sent' | 'written_off', public_memo? }
// =====================================================================

import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../../../_lib/admin_api.js";
import { loadInvoice, markInvoiceSent, writeBillingEvent } from "../../../../../_lib/billing.js";

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env, ctx: c }) => {
        const id = String(c.params?.id || "");
        if (!id) return jsonError("bad_params", 400);
        const inv = await loadInvoice(env, id, { include_phi_line_items: true });
        if (!inv) return jsonError("invoice_not_found", 404);

        const payments = await env.DB.prepare(`
            SELECT id, status, gross_amount_cents, fee_amount_cents, net_amount_cents,
                   stripe_payment_intent_id, stripe_charge_id, captured_at, created_at, currency
            FROM payments
            WHERE invoice_id = ?
            ORDER BY created_at DESC
        `).bind(id).all();

        const refunds = await env.DB.prepare(`
            SELECT id, payment_id, amount_cents, currency, reason, status,
                   stripe_refund_id, admin_memo, initiated_at, settled_at
            FROM refunds
            WHERE invoice_id = ?
            ORDER BY initiated_at DESC
        `).bind(id).all();

        return jsonResponse({
            invoice: { ...inv, balance_cents: inv.total_cents - inv.amount_paid_cents },
            payments: payments?.results || [],
            refunds: refunds?.results || [],
        });
    });
}

export async function onRequestPatch(ctx) {
    return adminRoute(ctx, async ({ env, request, admin, ctx: c }) => {
        const id = String(c.params?.id || "");
        if (!id) return jsonError("bad_params", 400);
        const body = await readJsonBody(request);

        if (body.status === "sent") {
            await markInvoiceSent(env, id, admin.user);
            return jsonResponse({ ok: true, status: "sent" });
        }

        if (body.status === "void") {
            const now = Date.now();
            await env.DB.prepare(
                "UPDATE invoices SET status='void', voided_at=?, updated_at=? WHERE id=? AND status IN ('draft','sent','partially_paid')"
            ).bind(now, now, id).run();
            await writeBillingEvent(env, {
                actor_user_id: admin.user, actor_role: "admin",
                action: "invoice_voided", invoice_id: id,
            });
            return jsonResponse({ ok: true, status: "void" });
        }

        if (body.status === "written_off") {
            const now = Date.now();
            await env.DB.prepare(
                "UPDATE invoices SET status='written_off', updated_at=? WHERE id=? AND status IN ('sent','partially_paid')"
            ).bind(now, id).run();
            await writeBillingEvent(env, {
                actor_user_id: admin.user, actor_role: "admin",
                action: "invoice_written_off", invoice_id: id,
            });
            return jsonResponse({ ok: true, status: "written_off" });
        }

        if (typeof body.public_memo === "string") {
            const now = Date.now();
            await env.DB.prepare(
                "UPDATE invoices SET public_memo=?, updated_at=? WHERE id=?"
            ).bind(body.public_memo.slice(0, 500), now, id).run();
            return jsonResponse({ ok: true });
        }

        return jsonError("no_supported_action", 400);
    });
}
