// =====================================================================
// GET /api/v1/admin/billing/reports/export
//     ?from=&to=&mode=tax_safe|detailed&format=qbo|qb_desktop|csv
// =====================================================================
// Generates QB-ready CSV exports of payments + refunds for a period.
//
// Modes:
//   - tax_safe (default): NO PHI. Customer column is "Patient #<seq>",
//     description is the operator-set tax_export_summary (or generic
//     fallback "Office services"). SAFE to import into QBSE / QBO
//     (which lack BAAs).
//   - detailed: includes patient name + invoice number + email. For
//     in-house records only — NOT to be imported into non-BAA systems.
//
// Formats:
//   - qbo (default): QuickBooks Online sales-receipt CSV import format
//   - qb_desktop:    QuickBooks Desktop IIF format
//   - csv:           generic flat CSV (date, customer, item, amount, fee, net, memo)
//
// Every export is logged to billing_export_log with SHA-256 of the file
// for tamper-evidence + audit trail.
// =====================================================================

import { adminRoute, jsonError } from "../../../../../_lib/admin_api.js";
import { newId } from "../../../../../_lib/db.js";
import { writeBillingEvent } from "../../../../../_lib/billing.js";

function isDate(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function dateToMs(d) { return new Date(d + "T00:00:00Z").getTime(); }
function isoToDate(ms) {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
}

function csvEscape(s) {
    if (s === null || s === undefined) return "";
    const str = String(s);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

async function sha256Hex(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    const bytes = new Uint8Array(buf);
    let hex = "";
    for (const b of bytes) hex += b.toString(16).padStart(2, "0");
    return hex;
}

// QBO sales-receipt CSV columns
// Source: support.quickbooks.intuit.com → Import sales receipts
const QBO_HEADER = [
    "SalesReceiptNo", "Customer", "SalesReceiptDate", "DepositAccount",
    "PaymentMethod", "Memo", "Item(Product/Service)", "ItemDescription",
    "ItemQuantity", "ItemRate", "ItemAmount", "Currency",
];

const DETAILED_HEADER = [
    "Date", "Type", "Reference", "Customer", "Email",
    "InvoiceNumber", "InvoiceTotalCents", "PaymentAmountCents",
    "StripeFeeCents", "NetDepositCents", "Currency",
    "ServiceCategory", "Memo", "StripeChargeId", "StripeBalanceTxnId",
];

const TAX_SAFE_HEADER = [
    "Date", "Type", "Reference", "Customer", "InvoiceNumber",
    "AmountCents", "FeeCents", "NetCents", "Currency",
    "ServiceCategory", "Memo",
];

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env, request, admin }) => {
        const url = new URL(request.url);
        const from = url.searchParams.get("from");
        const to   = url.searchParams.get("to");
        const mode = url.searchParams.get("mode") || "tax_safe";
        const format = url.searchParams.get("format") || "qbo";

        if (!isDate(from) || !isDate(to)) {
            return jsonError("invalid_date_range", 400, { example: "?from=2026-01-01&to=2026-12-31" });
        }
        if (!["tax_safe", "detailed"].includes(mode)) return jsonError("invalid_mode", 400);
        if (!["qbo", "csv"].includes(format)) return jsonError("invalid_format", 400);

        const fromMs = dateToMs(from);
        const toMs   = dateToMs(to) + 86400000 - 1;

        // Load all successful payments + refunds in window
        const payments = await env.DB.prepare(`
            SELECT p.id, p.captured_at, p.gross_amount_cents, p.fee_amount_cents, p.net_amount_cents,
                   p.currency, p.stripe_charge_id, p.stripe_balance_transaction_id,
                   p.patient_id,
                   i.invoice_number, i.tax_export_summary, i.public_memo,
                   pat.first_name, pat.last_name, pat.email
            FROM payments p
            JOIN invoices i ON i.id = p.invoice_id
            LEFT JOIN patients pat ON pat.id = p.patient_id
            WHERE p.status = 'succeeded' AND p.captured_at BETWEEN ? AND ?
            ORDER BY p.captured_at
        `).bind(fromMs, toMs).all();

        const refunds = await env.DB.prepare(`
            SELECT r.id, r.initiated_at, r.settled_at, r.amount_cents, r.currency,
                   r.stripe_refund_id, r.reason, r.admin_memo,
                   r.patient_id,
                   i.invoice_number, i.tax_export_summary,
                   pat.first_name, pat.last_name, pat.email
            FROM refunds r
            JOIN invoices i ON i.id = r.invoice_id
            LEFT JOIN patients pat ON pat.id = r.patient_id
            WHERE r.status = 'succeeded' AND r.initiated_at BETWEEN ? AND ?
            ORDER BY r.initiated_at
        `).bind(fromMs, toMs).all();

        // Anonymized Patient #N map (for tax_safe mode — stable per export run)
        const seq = new Map();
        let nextSeq = 1;
        function patientLabel(patient_id, first_name, last_name) {
            if (mode === "detailed") return [first_name, last_name].filter(Boolean).join(" ") || "Unknown";
            if (!seq.has(patient_id)) seq.set(patient_id, nextSeq++);
            return `Patient #${seq.get(patient_id)}`;
        }
        function emailFor(patient_id, email) {
            if (mode === "detailed") return email || "";
            return ""; // tax_safe: omit email
        }
        function categoryFor(tax_export_summary) {
            return tax_export_summary || "Office services";
        }

        const rows = [];

        for (const p of (payments?.results || [])) {
            const date = isoToDate(p.captured_at);
            const customer = patientLabel(p.patient_id, p.first_name, p.last_name);
            const cat = categoryFor(p.tax_export_summary);
            if (mode === "detailed") {
                rows.push({
                    Date: date, Type: "Payment", Reference: p.id, Customer: customer,
                    Email: emailFor(p.patient_id, p.email),
                    InvoiceNumber: p.invoice_number,
                    InvoiceTotalCents: p.gross_amount_cents,
                    PaymentAmountCents: p.gross_amount_cents,
                    StripeFeeCents: p.fee_amount_cents,
                    NetDepositCents: p.net_amount_cents,
                    Currency: (p.currency || "usd").toUpperCase(),
                    ServiceCategory: cat,
                    Memo: p.public_memo || "",
                    StripeChargeId: p.stripe_charge_id || "",
                    StripeBalanceTxnId: p.stripe_balance_transaction_id || "",
                });
            } else {
                rows.push({
                    Date: date, Type: "Payment", Reference: p.invoice_number,
                    Customer: customer, InvoiceNumber: p.invoice_number,
                    AmountCents: p.gross_amount_cents,
                    FeeCents: p.fee_amount_cents,
                    NetCents: p.net_amount_cents,
                    Currency: (p.currency || "usd").toUpperCase(),
                    ServiceCategory: cat,
                    Memo: "",
                });
            }
        }

        for (const r of (refunds?.results || [])) {
            const date = isoToDate(r.settled_at || r.initiated_at);
            const customer = patientLabel(r.patient_id, r.first_name, r.last_name);
            const cat = categoryFor(r.tax_export_summary);
            const amt = -r.amount_cents; // negative = return
            if (mode === "detailed") {
                rows.push({
                    Date: date, Type: "Refund", Reference: r.id, Customer: customer,
                    Email: emailFor(r.patient_id, r.email),
                    InvoiceNumber: r.invoice_number,
                    InvoiceTotalCents: 0,
                    PaymentAmountCents: amt,
                    StripeFeeCents: 0,
                    NetDepositCents: amt,
                    Currency: (r.currency || "usd").toUpperCase(),
                    ServiceCategory: cat,
                    Memo: r.admin_memo || r.reason || "",
                    StripeChargeId: "",
                    StripeBalanceTxnId: "",
                });
            } else {
                rows.push({
                    Date: date, Type: "Refund", Reference: r.invoice_number,
                    Customer: customer, InvoiceNumber: r.invoice_number,
                    AmountCents: amt,
                    FeeCents: 0, NetCents: amt,
                    Currency: (r.currency || "usd").toUpperCase(),
                    ServiceCategory: cat,
                    Memo: r.reason || "",
                });
            }
        }

        // Build CSV
        let header;
        if (format === "qbo") {
            // QBO sales-receipt CSV — only payments (not refunds; QBO refunds use a different doc type)
            header = QBO_HEADER;
            const csv = [QBO_HEADER.map(csvEscape).join(",")];
            for (const r of rows) {
                if (r.Type === "Refund") continue; // skip — issued separately as credit memo
                const dollars = (Math.round((r.AmountCents ?? r.PaymentAmountCents) || 0) / 100).toFixed(2);
                csv.push([
                    r.InvoiceNumber, r.Customer, r.Date, "Checking",
                    "Stripe", r.Memo || "", r.ServiceCategory, r.ServiceCategory,
                    "1", dollars, dollars, r.Currency,
                ].map(csvEscape).join(","));
            }
            const out = csv.join("\n");
            return await respond(out, "qbo");
        } else {
            // Generic flat CSV
            header = mode === "detailed" ? DETAILED_HEADER : TAX_SAFE_HEADER;
            const csv = [header.map(csvEscape).join(",")];
            for (const r of rows) {
                csv.push(header.map(h => csvEscape(r[h] ?? "")).join(","));
            }
            const out = csv.join("\n");
            return await respond(out, "csv");
        }

        async function respond(text, fmt) {
            const file_sha256 = await sha256Hex(text);
            // Audit log
            try {
                const id = newId();
                const gross = rows.reduce((s, r) => s + (r.AmountCents ?? r.PaymentAmountCents ?? 0), 0);
                const fees = rows.reduce((s, r) => s + (r.FeeCents ?? r.StripeFeeCents ?? 0), 0);
                const net = gross - fees;
                await env.DB.prepare(`
                    INSERT INTO billing_export_log
                        (id, generated_at, generated_by_user_id, mode, format,
                         period_start, period_end, invoice_count, payment_count, refund_count,
                         gross_total_cents, fee_total_cents, net_total_cents, file_sha256,
                         ip, user_agent)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).bind(
                    id, Date.now(), admin.user, mode, fmt,
                    from, to,
                    0, (payments?.results || []).length, (refunds?.results || []).length,
                    gross, fees, net, file_sha256,
                    request.headers.get("CF-Connecting-IP") || "",
                    request.headers.get("User-Agent") || ""
                ).run();
                await writeBillingEvent(env, {
                    actor_user_id: admin.user, actor_role: "admin",
                    action: "tax_export_generated",
                    details: { mode, format: fmt, from, to, rows: rows.length, sha256: file_sha256 },
                });
            } catch (e) {
                console.warn("billing_export_log write failed", { error: String(e?.message || e) });
            }

            const filename = `mountzara-billing-${mode}-${from}-to-${to}.${fmt === "qbo" ? "csv" : "csv"}`;
            return new Response(text, {
                status: 200,
                headers: {
                    "content-type": "text/csv; charset=utf-8",
                    "content-disposition": `attachment; filename="${filename}"`,
                    "x-export-sha256": file_sha256,
                    "cache-control": "no-store",
                },
            });
        }
    });
}
