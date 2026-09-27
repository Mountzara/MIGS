// =====================================================================
// /api/v1/admin/orders/<id>/results — what came back, and who was told
// =====================================================================
// POST  → record a result. Recording one stops the order's overdue clock
//         and starts the review clock. A `critical` result starts its own
//         four-hour acknowledgment clock (see _lib/orders.js).
// PATCH → acknowledge a result, and/or record that the PATIENT WAS TOLD.
//         These are separate fields on purpose: seeing a result and
//         communicating it are two duties, and only one of them is what
//         the patient experiences.
// =====================================================================

import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../../../_lib/admin_api.js";
import { newId } from "../../../../../_lib/db.js";
import { logAudit } from "../../../../../_lib/audit.js";

const RESULT_STATUSES = ["normal", "abnormal", "critical", "incomplete"];

export async function onRequestPost(ctx) {
    return adminRoute(ctx, async ({ env, request, admin }) => {
        const order_id = String(ctx.params?.id || "");
        const body = await readJsonBody(request);
        if (!body) return jsonError("invalid_json_body", 400);
        const order = await env.DB.prepare(`SELECT id, patient_id, status FROM clinical_orders WHERE id = ?`).bind(order_id).first();
        if (!order) return jsonError("order_not_found", 404);
        const status = RESULT_STATUSES.includes(body.result_status) ? body.result_status : "normal";

        const id = newId(), now = Date.now();
        const received = Number(body.received_at) || now;
        await env.DB.prepare(`
            INSERT INTO order_results
                (id, order_id, patient_id, received_at, result_status, summary, document_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(id, order_id, order.patient_id, received, status,
                String(body.summary || "").slice(0, 2000), body.document_id || null, now).run();

        // The order moves to `resulted` unless it was already reviewed and
        // this is a later addendum, which reopens it.
        const nextStatus = order.status === "reviewed" ? "in_progress" : "resulted";
        await env.DB.prepare(
            `UPDATE clinical_orders SET status = ?, resulted_at = COALESCE(resulted_at, ?), updated_at = ? WHERE id = ?`
        ).bind(nextStatus, received, now, order_id).run();
        await env.DB.prepare(
            `INSERT INTO order_events (id, order_id, at, actor, event, detail) VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(newId(), order_id, now, admin.user || "admin", `result:${status}`, JSON.stringify({ result_id: id })).run();

        await logAudit(env, {
            user_id: admin.user, user_role: "staff", action: "order_result_record",
            record_type: "order_result", record_id: id, success: true,
            details: { order_id, result_status: status },
        }, ctx);
        return jsonResponse({ ok: true, id, order_status: nextStatus, result_status: status }, { status: 201 });
    });
}

export async function onRequestPatch(ctx) {
    return adminRoute(ctx, async ({ env, request, admin }) => {
        const order_id = String(ctx.params?.id || "");
        const body = await readJsonBody(request);
        if (!body || !body.result_id) return jsonError("result_id_required", 400);
        const row = await env.DB.prepare(
            `SELECT * FROM order_results WHERE id = ? AND order_id = ?`).bind(body.result_id, order_id).first();
        if (!row) return jsonError("result_not_found", 404);

        const now = Date.now();
        const sets = [], binds = [];
        if (body.acknowledge === true && !row.acknowledged_at) {
            sets.push("acknowledged_at = ?", "acknowledged_by = ?"); binds.push(now, admin.user || "admin");
        }
        if (body.patient_communicated === true) {
            sets.push("patient_communicated_at = ?", "communication_method = ?", "communication_note = ?");
            binds.push(now, String(body.communication_method || "portal").slice(0, 40),
                       String(body.communication_note || "").slice(0, 1000));
        }
        if (sets.length === 0) return jsonError("nothing_to_update", 400);

        await env.DB.prepare(`UPDATE order_results SET ${sets.join(", ")} WHERE id = ?`).bind(...binds, body.result_id).run();
        await env.DB.prepare(
            `INSERT INTO order_events (id, order_id, at, actor, event, detail) VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(newId(), order_id, now, admin.user || "admin",
               body.patient_communicated ? "result_communicated" : "result_acknowledged",
               JSON.stringify({ result_id: body.result_id })).run();
        await logAudit(env, {
            user_id: admin.user, user_role: "staff", action: "order_result_update",
            record_type: "order_result", record_id: body.result_id, success: true,
            details: { order_id, acknowledged: !!body.acknowledge, communicated: !!body.patient_communicated },
        }, ctx);
        return jsonResponse({ ok: true });
    });
}
