// =====================================================================
// /api/v1/admin/orders/<id> — one order, its results, its trail
// =====================================================================
// GET   → order + results + prior auth + append-only event history.
// PATCH → status moves, clinician review, cancellation.
//
// Review is the close of the loop: `reviewed` means a human looked at
// what came back. It is refused unless a result actually exists, because
// "reviewed" on an order with nothing in it is a false record.
// =====================================================================

import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../../_lib/admin_api.js";
import { newId } from "../../../../_lib/db.js";
import { logAudit } from "../../../../_lib/audit.js";
import { canTransition, escalationLevel, isOverdue, daysOverdue } from "../../../../_lib/orders.js";

function safeJson(s, f) { try { return s ? JSON.parse(s) : f; } catch { return f; } }

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env }) => {
        const id = String(ctx.params?.id || "");
        const order = await env.DB.prepare(`
            SELECT o.*, p.first_name AS patient_first_name, p.last_name AS patient_last_name,
                   p.email AS patient_email
              FROM clinical_orders o LEFT JOIN patients p ON p.id = o.patient_id
             WHERE o.id = ?`).bind(id).first();
        if (!order) return jsonError("order_not_found", 404);

        const results = (await env.DB.prepare(
            `SELECT * FROM order_results WHERE order_id = ? ORDER BY received_at DESC`).bind(id).all())?.results || [];
        const events = (await env.DB.prepare(
            `SELECT * FROM order_events WHERE order_id = ? ORDER BY at DESC LIMIT 100`).bind(id).all())?.results || [];
        const auth = await env.DB.prepare(
            `SELECT * FROM prior_authorizations WHERE order_id = ? ORDER BY created_at DESC LIMIT 1`).bind(id).first();

        const now = Date.now();
        return jsonResponse({
            ok: true,
            order: { ...order, tests: safeJson(order.tests_json, []), icd10: safeJson(order.icd10_json, []) },
            results, events, prior_authorization: auth || null,
            escalation: escalationLevel(order, results, now),
            overdue: isOverdue(order, now), days_overdue: daysOverdue(order, now),
        });
    });
}

export async function onRequestPatch(ctx) {
    return adminRoute(ctx, async ({ env, request, admin }) => {
        const id = String(ctx.params?.id || "");
        const body = await readJsonBody(request);
        if (!body) return jsonError("invalid_json_body", 400);
        const order = await env.DB.prepare(`SELECT * FROM clinical_orders WHERE id = ?`).bind(id).first();
        if (!order) return jsonError("order_not_found", 404);

        const now = Date.now();
        const sets = ["updated_at = ?"], binds = [now];
        let event = "updated", detail = {};

        if (body.status && body.status !== order.status) {
            if (!canTransition(order.status, body.status)) {
                return jsonError("illegal_status_transition", 409, { from: order.status, to: body.status });
            }
            if (body.status === "reviewed") {
                const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM order_results WHERE order_id = ?`).bind(id).first();
                if (!n || !n.n) return jsonError("cannot_review_without_result", 409,
                    { message: "Nothing has come back for this order yet — chase the result rather than closing it." });
                sets.push("reviewed_at = ?", "reviewed_by = ?"); binds.push(now, admin.user || "admin");
            }
            if (body.status === "cancelled") {
                sets.push("cancelled_at = ?", "cancel_reason = ?");
                binds.push(now, String(body.cancel_reason || "").slice(0, 300));
            }
            sets.push("status = ?"); binds.push(body.status);
            event = `status:${body.status}`; detail = { from: order.status, to: body.status };
        }
        if (typeof body.review_note === "string") { sets.push("review_note = ?"); binds.push(body.review_note.slice(0, 2000)); }
        if (body.patient_notified === true) { sets.push("patient_notified_at = ?"); binds.push(now); }
        if (typeof body.facility_name === "string") { sets.push("facility_name = ?"); binds.push(body.facility_name.slice(0, 200)); }
        if (typeof body.prior_auth_status === "string") { sets.push("prior_auth_status = ?"); binds.push(body.prior_auth_status); }

        await env.DB.prepare(`UPDATE clinical_orders SET ${sets.join(", ")} WHERE id = ?`).bind(...binds, id).run();
        await env.DB.prepare(
            `INSERT INTO order_events (id, order_id, at, actor, event, detail) VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(newId(), id, now, admin.user || "admin", event, JSON.stringify(detail)).run();
        await logAudit(env, {
            user_id: admin.user, user_role: "staff", action: "order_update",
            record_type: "clinical_order", record_id: id, success: true, details: detail,
        }, ctx);
        return jsonResponse({ ok: true, id, event });
    });
}
