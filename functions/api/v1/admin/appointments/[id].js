// PATCH /api/v1/admin/appointments/<id> — update status, reschedule, log Doxy join.
//
// Allowed fields:
//   status                 : 'scheduled' | 'completed' | 'no_show' | 'cancelled' | 'rescheduled'
//   cancellation_reason    : string (only when status = 'cancelled')
//   starts_at              : ms epoch (reschedule)
//   duration_min           : integer (reschedule)
//   modality               : 'in_person' | 'telehealth'
//   chief_complaint_summary: string
//   doxy_join_logged_at    : ms epoch (set when patient clicks Join)

import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../../_lib/admin_api.js";
import { logAudit } from "../../../../_lib/audit.js";

const ALLOWED_STATUSES = new Set(["scheduled", "completed", "no_show", "cancelled", "rescheduled"]);
const ALLOWED_MODALITIES = new Set(["in_person", "telehealth"]);

export async function onRequestPatch(ctx) {
    return adminRoute(ctx, async ({ env, request, admin, ctx }) => {
        const { id } = ctx.params;
        if (!id) return jsonError("missing_id", 400);
        const body = await readJsonBody(request);

        const existing = await env.DB.prepare(`
            SELECT id, starts_at, duration_min, modality, status FROM appointments WHERE id = ?
        `).bind(id).first();
        if (!existing) return jsonError("appointment_not_found", 404);

        const sets = [];
        const binds = [];
        const auditDetails = {};
        let action_for_audit = "appointment_reschedule";

        if (body.status !== undefined) {
            if (!ALLOWED_STATUSES.has(body.status)) return jsonError("invalid_status", 400);
            sets.push("status = ?"); binds.push(body.status);
            auditDetails.status = body.status;
            if (body.status === "cancelled") action_for_audit = "appointment_cancel";
            else if (body.status === "completed") action_for_audit = "appointment_complete";
            else if (body.status === "no_show") action_for_audit = "appointment_no_show";
        }
        if (body.cancellation_reason !== undefined) {
            if (typeof body.cancellation_reason !== "string") return jsonError("invalid_cancellation_reason", 400);
            sets.push("cancellation_reason = ?"); binds.push(body.cancellation_reason.slice(0, 240));
        }
        if (body.starts_at !== undefined) {
            if (!Number.isInteger(body.starts_at)) return jsonError("invalid_starts_at", 400);
            sets.push("starts_at = ?"); binds.push(body.starts_at);
            // recompute ends_at from updated duration_min or existing one
            const dur = Number.isInteger(body.duration_min) && body.duration_min > 0
                ? body.duration_min : existing.duration_min;
            sets.push("ends_at = ?"); binds.push(body.starts_at + dur * 60_000);
            sets.push("duration_min = ?"); binds.push(dur);
            auditDetails.rescheduled_to_ms = body.starts_at;
        } else if (body.duration_min !== undefined) {
            if (!Number.isInteger(body.duration_min) || body.duration_min <= 0) return jsonError("invalid_duration_min", 400);
            sets.push("duration_min = ?"); binds.push(body.duration_min);
            sets.push("ends_at = ?"); binds.push(existing.starts_at + body.duration_min * 60_000);
        }
        if (body.modality !== undefined) {
            if (!ALLOWED_MODALITIES.has(body.modality)) return jsonError("invalid_modality", 400);
            sets.push("modality = ?"); binds.push(body.modality);
            auditDetails.modality = body.modality;
        }
        if (body.chief_complaint_summary !== undefined) {
            if (typeof body.chief_complaint_summary !== "string") return jsonError("invalid_chief_complaint_summary", 400);
            sets.push("chief_complaint_summary = ?"); binds.push(body.chief_complaint_summary.slice(0, 500));
        }
        if (body.doxy_join_logged_at !== undefined) {
            if (!Number.isInteger(body.doxy_join_logged_at)) return jsonError("invalid_doxy_join_logged_at", 400);
            sets.push("doxy_join_logged_at = ?"); binds.push(body.doxy_join_logged_at);
            action_for_audit = "doxy_join";
            auditDetails.doxy_join_at = body.doxy_join_logged_at;
        }

        if (!sets.length) return jsonError("no_fields_to_update", 400);

        sets.push("updated_at = ?"); binds.push(Date.now());
        binds.push(id);

        const sql = `UPDATE appointments SET ${sets.join(", ")} WHERE id = ?`;
        await env.DB.prepare(sql).bind(...binds).run();

        await logAudit(env, {
            user_id: admin.user, user_role: admin.role,
            action: action_for_audit,
            record_type: "appointment",
            record_id: id,
            ip: request.headers.get("CF-Connecting-IP") || "",
            user_agent: request.headers.get("User-Agent") || "",
            success: true,
            details: auditDetails,
        });

        const row = await env.DB.prepare(`SELECT * FROM appointments WHERE id = ?`).bind(id).first();
        return jsonResponse({ ok: true, appointment: row });
    });
}
