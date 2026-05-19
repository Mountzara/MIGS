// =====================================================================
// /api/v1/admin/billing/invoices
// =====================================================================
// GET   ?status=&from=&to=&patient_id=  — list invoices
// POST  body: {
//   patient_id, appointment_id?, encounter_id?,
//   issue_date, due_date?,
//   line_items: [{ service_code, description, quantity, unit_price_cents }],
//   public_memo?, tax_export_summary?,
//   send_immediately?: bool
// } — create (and optionally mark sent)
// =====================================================================

import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../../_lib/admin_api.js";
import { createInvoice, markInvoiceSent, listServiceCatalog } from "../../../../_lib/billing.js";

function todayIso() {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
}

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env, request }) => {
        const url = new URL(request.url);
        const status = url.searchParams.get("status");
        const from = url.searchParams.get("from");
        const to = url.searchParams.get("to");
        const patient_id = url.searchParams.get("patient_id");

        const where = [];
        const binds = [];
        if (status) { where.push("status = ?"); binds.push(status); }
        if (from)   { where.push("issue_date >= ?"); binds.push(from); }
        if (to)     { where.push("issue_date <= ?"); binds.push(to); }
        if (patient_id) { where.push("patient_id = ?"); binds.push(patient_id); }
        const sql = `
            SELECT i.id, i.patient_id, i.invoice_number, i.issue_date, i.due_date,
                   i.currency, i.subtotal_cents, i.total_cents,
                   i.amount_paid_cents, i.amount_refunded_cents,
                   i.status, i.tax_export_summary,
                   i.sent_at, i.paid_at, i.created_at,
                   p.first_name, p.last_name, p.email
            FROM invoices i
            LEFT JOIN patients p ON p.id = i.patient_id
            ${where.length ? "WHERE " + where.join(" AND ") : ""}
            ORDER BY i.issue_date DESC, i.created_at DESC
            LIMIT 200
        `;
        const res = await env.DB.prepare(sql).bind(...binds).all();
        return jsonResponse({
            invoices: (res?.results || []).map(r => ({
                ...r,
                balance_cents: r.total_cents - r.amount_paid_cents,
                patient_name: [r.first_name, r.last_name].filter(Boolean).join(" "),
            })),
        });
    });
}

export async function onRequestPost(ctx) {
    return adminRoute(ctx, async ({ env, request, admin }) => {
        const body = await readJsonBody(request);
        if (!body || !body.patient_id) return jsonError("missing_patient_id", 400);
        if (!Array.isArray(body.line_items) || !body.line_items.length) return jsonError("missing_line_items", 400);

        // Hydrate any line items that came in as just { service_code, quantity? }
        const catalog = await listServiceCatalog(env);
        const cat = new Map(catalog.map(c => [c.code, c]));
        const items = body.line_items.map(li => {
            if (li.unit_price_cents !== undefined && li.description) return li;
            const c = cat.get(li.service_code);
            if (!c) throw new Error("unknown_service_code:" + li.service_code);
            return {
                service_code: li.service_code,
                description: li.description || c.display_name,
                quantity: li.quantity || 1,
                unit_price_cents: li.unit_price_cents ?? c.default_unit_price_cents,
            };
        });

        try {
            const inv = await createInvoice(env, {
                patient_id: body.patient_id,
                appointment_id: body.appointment_id || null,
                encounter_id: body.encounter_id || null,
                line_items: items,
                public_memo: body.public_memo || null,
                tax_export_summary: body.tax_export_summary || null,
                currency: body.currency || "usd",
                issue_date: body.issue_date || todayIso(),
                due_date: body.due_date || null,
                created_by_user_id: admin.user,
            });
            if (body.send_immediately) {
                await markInvoiceSent(env, inv.id, admin.user);
            }
            return jsonResponse({ ok: true, ...inv, sent: !!body.send_immediately }, { status: 201 });
        } catch (e) {
            return jsonError(String(e?.message || e), 400);
        }
    });
}
