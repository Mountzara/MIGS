// =====================================================================
// GET /api/v1/admin/billing/reports/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
// =====================================================================
// Income + expense summary for a period — feeds the /admin/billing/reports/
// dashboard. Defaults to current calendar month.
//
// Returns:
//   {
//     period: { from, to, days },
//     income: {
//       gross_cents,       // Schedule C line 1 — gross receipts
//       refunds_cents,     // Schedule C line 2 — returns and allowances
//       net_receipts_cents,// line 1 - line 2 = line 3 (net receipts)
//       stripe_fees_cents, // Schedule C line 17 (legal/prof) OR line 27a
//       bank_deposits_cents,// = net_receipts - fees (matches Stripe payouts)
//       invoice_count, payment_count, refund_count
//     },
//     by_service: [ { service_code, display_name, gross_cents, payment_count } ],
//     by_month:   [ { month, gross_cents, fees_cents, refunds_cents, net_cents } ]
//   }
// =====================================================================

import { adminRoute, jsonResponse, jsonError } from "../../../../../_lib/admin_api.js";

function todayIso() {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
}
function firstOfMonthIso() {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-01`;
}
function isDate(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function dateToMs(d) { return new Date(d + "T00:00:00Z").getTime(); }

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env, request }) => {
        const url = new URL(request.url);
        const from = url.searchParams.get("from") || firstOfMonthIso();
        const to   = url.searchParams.get("to")   || todayIso();
        if (!isDate(from) || !isDate(to)) return jsonError("invalid_date_range", 400, { example: "?from=2026-05-01&to=2026-05-31" });
        const fromMs = dateToMs(from);
        const toMs   = dateToMs(to) + 86400000 - 1; // inclusive of `to`

        // Successful payments in window
        const payments = await env.DB.prepare(`
            SELECT
                COUNT(*)                          AS payment_count,
                COALESCE(SUM(gross_amount_cents),0) AS gross_cents,
                COALESCE(SUM(fee_amount_cents),  0) AS fees_cents,
                COALESCE(SUM(net_amount_cents),  0) AS net_cents
            FROM payments
            WHERE status = 'succeeded' AND captured_at BETWEEN ? AND ?
        `).bind(fromMs, toMs).first();

        const refunds = await env.DB.prepare(`
            SELECT
                COUNT(*)                          AS refund_count,
                COALESCE(SUM(amount_cents),     0) AS refunds_cents
            FROM refunds
            WHERE status = 'succeeded' AND initiated_at BETWEEN ? AND ?
        `).bind(fromMs, toMs).first();

        const invoices = await env.DB.prepare(`
            SELECT COUNT(*) AS invoice_count
            FROM invoices
            WHERE issue_date BETWEEN ? AND ?
        `).bind(from, to).first();

        // By service (decode line items? Expensive — instead join via invoice's
        // tax_export_summary or, better, payments aggregated through invoice
        // and joined to billing_service_catalog if we cached one-line-item-per-invoice).
        // For now: group successful payments by the invoice's tax_export_summary
        // (operator-set, non-PHI) — useful enough for a tax view.
        const byCat = await env.DB.prepare(`
            SELECT
                COALESCE(i.tax_export_summary, 'Office services') AS category,
                COUNT(p.id)                                       AS payment_count,
                COALESCE(SUM(p.gross_amount_cents), 0)            AS gross_cents
            FROM payments p
            JOIN invoices i ON i.id = p.invoice_id
            WHERE p.status = 'succeeded' AND p.captured_at BETWEEN ? AND ?
            GROUP BY category
            ORDER BY gross_cents DESC
        `).bind(fromMs, toMs).all();

        const byMonth = await env.DB.prepare(`
            SELECT
                strftime('%Y-%m', datetime(captured_at/1000, 'unixepoch')) AS month,
                COUNT(*)                              AS payment_count,
                COALESCE(SUM(gross_amount_cents), 0)  AS gross_cents,
                COALESCE(SUM(fee_amount_cents),   0)  AS fees_cents,
                COALESCE(SUM(net_amount_cents),   0)  AS net_cents
            FROM payments
            WHERE status = 'succeeded' AND captured_at BETWEEN ? AND ?
            GROUP BY month
            ORDER BY month
        `).bind(fromMs, toMs).all();

        const gross = payments?.gross_cents || 0;
        const refundsAmt = refunds?.refunds_cents || 0;
        const fees = payments?.fees_cents || 0;
        const netReceipts = gross - refundsAmt;
        const bankDeposits = netReceipts - fees;

        return jsonResponse({
            period: { from, to, days: Math.round((toMs - fromMs) / 86400000) + 1 },
            income: {
                gross_cents: gross,                       // Sched C line 1
                refunds_cents: refundsAmt,                // Sched C line 2
                net_receipts_cents: netReceipts,          // Sched C line 3
                stripe_fees_cents: fees,                  // Sched C line 17 / 27a
                bank_deposits_cents: bankDeposits,        // reconciles to Stripe payouts
                invoice_count: invoices?.invoice_count || 0,
                payment_count: payments?.payment_count || 0,
                refund_count: refunds?.refund_count || 0,
            },
            by_service: byCat?.results || [],
            by_month:   byMonth?.results || [],
        });
    });
}
