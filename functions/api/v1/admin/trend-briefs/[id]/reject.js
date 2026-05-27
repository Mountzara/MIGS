// =====================================================================
// POST /api/v1/admin/trend-briefs/<id>/reject
// =====================================================================
// Admin rejects a brief.  Rejected briefs persist in D1 for audit but
// are not pulled by the Mac orchestrator.  R2 artifacts (body_html,
// sidecar, override if any) are kept so the row remains diagnosable
// later — but the override is cleared so the brief cannot be
// approved-then-rejected-then-pulled with a stale override.
// =====================================================================

import {
    adminRoute, jsonResponse, jsonError, readJsonBody,
} from "../../../../../_lib/admin_api.js";
import {
    appendAuditEvent, auditAdminAction,
} from "../../../../../_lib/trend_briefs.js";

export async function onRequestPost(ctx) {
    return adminRoute(ctx, async ({ env, request, params, admin }) => {
        if (!env.DB) return jsonError("server_error: DB binding missing", 500);

        const id = decodeURIComponent(String(params?.id || ""));
        if (!id) return jsonError("bad_id", 400);

        const row = await env.DB.prepare(
            "SELECT id, status FROM trend_brief_pending WHERE id = ?"
        ).bind(id).first();
        if (!row) return jsonError("not_found", 404);

        const body = await readJsonBody(request);
        const reason = (typeof body.reason === "string" ? body.reason.trim() : "")
            .slice(0, 1000);
        if (!reason) {
            return jsonError("reason required (free-text rejection note)", 400);
        }

        const now = Date.now();
        try {
            await env.DB.prepare(`
                UPDATE trend_brief_pending SET
                    status = 'rejected',
                    status_reason = ?,
                    rejected_at = ?, rejected_by = ?,
                    approved_at = NULL, approved_by = NULL,
                    override_json = NULL, override_r2_key = NULL,
                    updated_at = ?
                WHERE id = ?
            `).bind(reason, now, admin.user, now, id).run();
        } catch (e) {
            console.error("reject D1 update failed", { id, error: String(e) });
            return jsonError("d1_update_failed: " + String(e), 500);
        }

        ctx.waitUntil(appendAuditEvent(env, ctx, id, {
            ts: now, actor: "admin", actor_label: admin.user,
            event_kind: "rejected",
            detail: { reason_preview: reason.slice(0, 120) },
        }));
        ctx.waitUntil(auditAdminAction(env, ctx, admin, "trend_brief_rejected", id, {
            reason_preview: reason.slice(0, 120),
        }));

        return jsonResponse({
            ok: true,
            id,
            status: "rejected",
            rejected_at: now,
            rejected_by: admin.user,
        });
    });
}
