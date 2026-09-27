// =====================================================================
// /api/v1/admin/orders — the order board and the result-tracking sweep
// =====================================================================
// GET  → orders with their results attached and an escalation ranking,
//        so the most dangerous row (an unacknowledged critical result)
//        is first WITHOUT anyone having to scan a list.
//        ?view=open|overdue|critical|all  ?patient_id=  ?type=  ?limit=
// POST → place an order. Validated against orders.validateOrder() before
//        anything is written: an order with no indication or no diagnosis
//        code gets rejected by the performing facility anyway, and is
//        indefensible in the record if it somehow goes through.
// =====================================================================

import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../_lib/admin_api.js";
import { newId } from "../../../_lib/db.js";
import { logAudit } from "../../../_lib/audit.js";
import {
    validateOrder, resultDueAt, escalationLevel, isOverdue, daysOverdue, ORDER_TYPES, PRIORITIES,
} from "../../../_lib/orders.js";

async function attachResults(env, orders) {
    if (orders.length === 0) return new Map();
    const ph = orders.map(() => "?").join(",");
    const r = await env.DB.prepare(`
        SELECT id, order_id, received_at, result_status, summary, document_id,
               acknowledged_at, acknowledged_by, patient_communicated_at
          FROM order_results WHERE order_id IN (${ph})
         ORDER BY received_at DESC
    `).bind(...orders.map(o => o.id)).all();
    const by = new Map();
    for (const row of (r?.results || [])) {
        if (!by.has(row.order_id)) by.set(row.order_id, []);
        by.get(row.order_id).push(row);
    }
    return by;
}

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env, request }) => {
        const url = new URL(request.url);
        const view = url.searchParams.get("view") || "open";
        const patient_id = url.searchParams.get("patient_id");
        const type = url.searchParams.get("type");
        const limit = Math.max(1, Math.min(200, parseInt(url.searchParams.get("limit") || "100", 10) || 100));
        const now = Date.now();

        const conds = [], binds = [];
        if (view === "open" || view === "overdue" || view === "critical") {
            conds.push("o.status NOT IN ('reviewed','cancelled')");
        }
        if (patient_id) { conds.push("o.patient_id = ?"); binds.push(patient_id); }
        if (type) { conds.push("o.order_type = ?"); binds.push(type); }
        const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

        const rows = await env.DB.prepare(`
            SELECT o.*, p.first_name AS patient_first_name, p.last_name AS patient_last_name,
                   p.email AS patient_email
              FROM clinical_orders o
              LEFT JOIN patients p ON p.id = o.patient_id
              ${where}
             ORDER BY o.created_at DESC
             LIMIT ?
        `).bind(...binds, limit).all();

        const orders = rows?.results || [];
        const resultsBy = await attachResults(env, orders);
        let enriched = orders.map((o) => {
            const results = resultsBy.get(o.id) || [];
            const esc = escalationLevel(o, results, now);
            return {
                ...o,
                tests: safeJson(o.tests_json, []),
                icd10: safeJson(o.icd10_json, []),
                results,
                overdue: isOverdue(o, now),
                days_overdue: daysOverdue(o, now),
                escalation: esc,
            };
        });
        if (view === "overdue") enriched = enriched.filter(o => o.overdue);
        if (view === "critical") enriched = enriched.filter(o => o.escalation.level >= 4);
        // Most dangerous first — the whole point of the board.
        enriched.sort((a, b) => b.escalation.level - a.escalation.level || (a.result_due_at || 0) - (b.result_due_at || 0));

        return jsonResponse({
            ok: true, view, orders: enriched, count: enriched.length,
            counts: {
                open: enriched.filter(o => !["reviewed", "cancelled"].includes(o.status)).length,
                overdue: enriched.filter(o => o.overdue).length,
                critical: enriched.filter(o => o.escalation.level >= 4).length,
                awaiting_review: enriched.filter(o => o.escalation.level === 1).length,
            },
        });
    });
}

function safeJson(s, fallback) { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } }

export async function onRequestPost(ctx) {
    return adminRoute(ctx, async ({ env, request, admin }) => {
        const body = await readJsonBody(request);
        if (!body) return jsonError("invalid_json_body", 400);

        const check = validateOrder(body);
        if (!check.ok) return jsonError("order_incomplete", 400, { missing: check.missing });
        if (!ORDER_TYPES.includes(body.order_type)) return jsonError("bad_order_type", 400);
        const priority = PRIORITIES.includes(body.priority) ? body.priority : "routine";

        const id = newId();
        const now = Date.now();
        // An order placed straight away starts its result clock now; a
        // draft has no clock until it is placed, which is correct — a
        // draft was never sent anywhere.
        const placeNow = body.status !== "draft";
        const placed_at = placeNow ? now : null;
        const due = placeNow ? resultDueAt(body.order_type, priority, now) : null;

        await env.DB.prepare(`
            INSERT INTO clinical_orders
                (id, patient_id, clinician_id, encounter_id, order_type, status, priority,
                 tests_json, modality, body_site, specialty, consult_question,
                 indication, icd10_json, facility_name, facility_phone, facility_fax,
                 referral_target_id, result_routing, placed_at, result_due_at,
                 prior_auth_status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
            id, body.patient_id, body.clinician_id || null, body.encounter_id || null,
            body.order_type, placeNow ? "placed" : "draft", priority,
            JSON.stringify(body.tests || []), body.modality || null, body.body_site || null,
            body.specialty || null, body.consult_question || null,
            String(body.indication).slice(0, 1000), JSON.stringify(body.icd10 || []),
            body.facility_name || null, body.facility_phone || null, body.facility_fax || null,
            body.referral_target_id || null, body.result_routing || "portal",
            placed_at, due, body.prior_auth_status || "unknown", now, now
        ).run();

        await env.DB.prepare(
            `INSERT INTO order_events (id, order_id, at, actor, event, detail) VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(newId(), id, now, admin.user || "admin", placeNow ? "placed" : "created_draft",
               JSON.stringify({ type: body.order_type, priority })).run();

        await logAudit(env, {
            user_id: admin.user, user_role: "staff", action: "order_create",
            record_type: "clinical_order", record_id: id, success: true,
            details: { order_type: body.order_type, priority },
        }, ctx);

        return jsonResponse({ ok: true, id, status: placeNow ? "placed" : "draft", result_due_at: due }, { status: 201 });
    });
}
