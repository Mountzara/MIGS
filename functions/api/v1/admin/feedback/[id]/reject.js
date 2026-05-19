// =====================================================================
// POST /api/v1/admin/feedback/<id>/reject — reject (won't fix)
// =====================================================================
// Body: { reason?: string, kind?: "rejected" | "wont_fix" }
//   kind defaults to "rejected" (we considered it but won't act).
//   "wont_fix" is for items that are out of scope or working as designed.
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
        const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 1000) : null;
        const kind = body.kind === "wont_fix" ? "wont_fix" : "rejected";

        const row = await env.DB.prepare(
            "SELECT id, status FROM member_feedback WHERE id = ?"
        ).bind(id).first();
        if (!row) return jsonError("not_found", 404);
        if (row.status === "approved" || row.status === "implemented") {
            return jsonError(`cannot_reject: feedback is ${row.status}`, 409);
        }

        const now = Date.now();
        await env.DB.prepare(`
            UPDATE member_feedback
            SET status = ?, status_reason = ?, updated_at = ?
            WHERE id = ?
        `).bind(kind, reason, now, id).run();

        await env.DB.prepare(`
            INSERT INTO feedback_audit_events (id, feedback_id, ts, actor, actor_label, event_kind, detail_json)
            VALUES (?, ?, ?, 'admin', ?, ?, ?)
        `).bind(newId(), id, now, admin.user, kind, JSON.stringify({ reason })).run();

        await logAudit(env, {
            user_id: admin.user, user_role: admin.role,
            action: "admin_override",
            record_type: "member_feedback",
            record_id: id,
            success: true,
            details: { op: `feedback_${kind}`, reason_preview: reason ? reason.slice(0, 120) : null },
        });

        return jsonResponse({ ok: true, status: kind });
    });
}
