// =====================================================================
// /api/v1/admin/orders/<id>/prior-auth — the payer gate on an order
// =====================================================================
// GET   → the current authorization record plus non-binding ADVICE from
//         _lib/referrals.js on whether this order type usually needs one.
//         The advice always carries a confidence and never claims to know
//         a specific plan's rules — a tool that guesses confidently gets
//         someone a denied MRI.
// POST  → create / replace the authorization record for this order.
// PATCH → move it (submitted → approved / denied) and stamp the decision.
// =====================================================================

import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../../../_lib/admin_api.js";
import { newId } from "../../../../../_lib/db.js";
import { priorAuthAdvice } from "../../../../../_lib/referrals.js";

const PA_STATUSES = ["not_required", "needed", "submitted", "approved", "denied", "expired"];

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env }) => {
        const order_id = String(ctx.params?.id || "");
        const order = await env.DB.prepare(
            `SELECT id, order_type, modality FROM clinical_orders WHERE id = ?`).bind(order_id).first();
        if (!order) return jsonError("order_not_found", 404);
        const row = await env.DB.prepare(
            `SELECT * FROM prior_authorizations WHERE order_id = ? ORDER BY created_at DESC LIMIT 1`).bind(order_id).first();
        return jsonResponse({
            ok: true,
            prior_authorization: row || null,
            advice: priorAuthAdvice({ order_type: order.order_type, modality: order.modality || "",
                                      plan_type: row?.plan_type || "unknown" }),
        });
    });
}

export async function onRequestPost(ctx) {
    return adminRoute(ctx, async ({ env, request }) => {
        const order_id = String(ctx.params?.id || "");
        const body = await readJsonBody(request);
        if (!body) return jsonError("invalid_json_body", 400);
        const order = await env.DB.prepare(
            `SELECT id, patient_id FROM clinical_orders WHERE id = ?`).bind(order_id).first();
        if (!order) return jsonError("order_not_found", 404);
        const status = PA_STATUSES.includes(body.status) ? body.status : "needed";
        const id = newId(), now = Date.now();
        await env.DB.prepare(`
            INSERT INTO prior_authorizations
                (id, order_id, patient_id, payer_name, plan_type, status, auth_number,
                 submitted_at, notes, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(id, order_id, order.patient_id, body.payer_name || null, body.plan_type || null,
                status, body.auth_number || null, status === "submitted" ? now : null,
                String(body.notes || "").slice(0, 1000), now, now).run();
        await env.DB.prepare(
            `UPDATE clinical_orders SET prior_auth_status = ?, updated_at = ? WHERE id = ?`
        ).bind(status, now, order_id).run();
        await env.DB.prepare(
            `INSERT INTO order_events (id, order_id, at, actor, event, detail) VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(newId(), order_id, now, "admin", `prior_auth:${status}`, JSON.stringify({ payer: body.payer_name || null })).run();
        return jsonResponse({ ok: true, id, status }, { status: 201 });
    });
}

export async function onRequestPatch(ctx) {
    return adminRoute(ctx, async ({ env, request }) => {
        const order_id = String(ctx.params?.id || "");
        const body = await readJsonBody(request);
        if (!body) return jsonError("invalid_json_body", 400);
        const row = await env.DB.prepare(
            `SELECT * FROM prior_authorizations WHERE order_id = ? ORDER BY created_at DESC LIMIT 1`).bind(order_id).first();
        if (!row) return jsonError("prior_auth_not_found", 404);
        if (body.status && !PA_STATUSES.includes(body.status)) return jsonError("bad_status", 400);

        const now = Date.now();
        const sets = ["updated_at = ?"], binds = [now];
        if (body.status) {
            sets.push("status = ?"); binds.push(body.status);
            if (body.status === "submitted") { sets.push("submitted_at = COALESCE(submitted_at, ?)"); binds.push(now); }
            if (["approved", "denied"].includes(body.status)) { sets.push("decision_at = ?"); binds.push(now); }
        }
        for (const [k, col] of [["auth_number", "auth_number"], ["valid_from", "valid_from"], ["valid_to", "valid_to"],
                                ["denial_reason", "denial_reason"], ["notes", "notes"], ["payer_name", "payer_name"],
                                ["plan_type", "plan_type"]]) {
            if (typeof body[k] === "string") { sets.push(`${col} = ?`); binds.push(body[k].slice(0, 500)); }
        }
        if (Number.isInteger(body.units_approved)) { sets.push("units_approved = ?"); binds.push(body.units_approved); }

        await env.DB.prepare(`UPDATE prior_authorizations SET ${sets.join(", ")} WHERE id = ?`).bind(...binds, row.id).run();
        if (body.status) {
            await env.DB.prepare(`UPDATE clinical_orders SET prior_auth_status = ?, updated_at = ? WHERE id = ?`)
                .bind(body.status, now, order_id).run();
            await env.DB.prepare(
                `INSERT INTO order_events (id, order_id, at, actor, event, detail) VALUES (?, ?, ?, ?, ?, ?)`
            ).bind(newId(), order_id, now, "admin", `prior_auth:${body.status}`, "{}").run();
        }
        return jsonResponse({ ok: true });
    });
}
