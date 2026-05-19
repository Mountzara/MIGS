// =====================================================================
// POST /api/v1/admin/feedback/<id>/approve — approve AI recommendation
// =====================================================================
// Marks status='approved'. The approved recommendation enters my Cowork
// implementation queue (I check status='approved' rows when starting a
// new session and execute the proposed_change).
// =====================================================================

import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../../../_lib/admin_api.js";
import { logAudit } from "../../../../../_lib/audit.js";
import { newId } from "../../../../../_lib/db.js";

export async function onRequestPost(ctx) {
    return adminRoute(ctx, async ({ env, request, params, admin }) => {
        if (!env.DB) return jsonError("server_error: DB binding missing", 500);
        const id = String(params?.id || "");
        if (!id) return jsonError("bad_id", 400);

        const body = await readJsonBody(request);
        const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : null;

        const row = await env.DB.prepare(
            "SELECT id, status, ai_recommendation_json FROM member_feedback WHERE id = ?"
        ).bind(id).first();
        if (!row) return jsonError("not_found", 404);
        if (!row.ai_recommendation_json) {
            return jsonError("no_ai_recommendation: cannot approve without a recommendation", 409);
        }
        if (row.status === "approved") {
            return jsonResponse({ ok: true, already_approved: true });
        }
        if (row.status === "rejected" || row.status === "wont_fix") {
            return jsonError(`cannot_approve: feedback is ${row.status}`, 409);
        }

        const now = Date.now();
        await env.DB.prepare(`
            UPDATE member_feedback
            SET status = 'approved', approved_at = ?, approved_by = ?, status_reason = ?, updated_at = ?
            WHERE id = ?
        `).bind(now, admin.user, note, now, id).run();

        await env.DB.prepare(`
            INSERT INTO feedback_audit_events (id, feedback_id, ts, actor, actor_label, event_kind, detail_json)
            VALUES (?, ?, ?, 'admin', ?, 'approved', ?)
        `).bind(newId(), id, now, admin.user, JSON.stringify({ note })).run();

        await logAudit(env, {
            user_id: admin.user, user_role: admin.role,
            action: "admin_override",
            record_type: "member_feedback",
            record_id: id,
            success: true,
            details: { op: "feedback_approved" },
        });

        return jsonResponse({ ok: true, status: "approved", approved_at: now });
    });
}
