// =====================================================================
// GET /api/v1/patient/billing/invoices — patient's invoice list
// =====================================================================
// Returns invoices ordered by issue_date DESC. Excludes PHI line items
// by default — patient sees totals + status only on the list view.
// Detail page fetches via /<invoice_id> below with PHI included.
//
// Auth: patient session. Preview gate honored.
// =====================================================================

import { previewAccess, preLaunchNotFound } from "../../../../_lib/preview_gate.js";
import { requireRole } from "../../../../_lib/auth.js";

function err(status, code, message) {
    return new Response(JSON.stringify({ error: code, message }), {
        status,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

export async function onRequestGet(ctx) {
    const { request, env } = ctx;
    const { allow } = await previewAccess(request, env);
    if (!allow) return preLaunchNotFound();

    let session;
    try { session = await requireRole(ctx, ["patient"]); }
    catch (resp) { return resp; }
    if (!session.patient_id || !env.DB) return err(500, "server_error", "DB not bound");

    const res = await env.DB.prepare(`
        SELECT id, invoice_number, issue_date, due_date,
               currency, subtotal_cents, total_cents,
               amount_paid_cents, amount_refunded_cents,
               status, public_memo, sent_at, paid_at,
               created_at, updated_at
        FROM invoices
        WHERE patient_id = ?
          AND status IN ('sent', 'partially_paid', 'paid', 'refunded')
        ORDER BY issue_date DESC, created_at DESC
        LIMIT 100
    `).bind(session.patient_id).all();

    const invoices = (res?.results || []).map(r => ({
        ...r,
        balance_cents: r.total_cents - r.amount_paid_cents,
    }));

    // Summary card data
    const outstanding = invoices
        .filter(i => i.status === "sent" || i.status === "partially_paid")
        .reduce((sum, i) => sum + i.balance_cents, 0);

    return new Response(JSON.stringify({
        invoices,
        count: invoices.length,
        outstanding_balance_cents: outstanding,
        currency: invoices[0]?.currency || "usd",
    }), {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}
