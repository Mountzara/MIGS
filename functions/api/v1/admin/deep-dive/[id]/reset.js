// =====================================================================
// POST /api/v1/admin/deep-dive/<id>/reset
// =====================================================================
// Admin reverts the row to 'pending' so it can be re-authored.  Does
// NOT delete the content_json or content R2 artifact — those persist
// as a recoverable archive.  Only the status + the in-flight artifacts
// (bundle_r2_key, patch_r2_key) are cleared.
// =====================================================================

import {
    adminRoute, jsonResponse, jsonError, readJsonBody,
} from "../../../../../_lib/admin_api.js";
import {
    appendAuditEvent, auditAdminAction,
} from "../../../../../_lib/deep_dive.js";

export async function onRequestPost(ctx) {
    return adminRoute(ctx, async ({ env, request, params, admin }) => {
        if (!env.DB) return jsonError("server_error: DB binding missing", 500);
        const id = decodeURIComponent(String(params?.id || ""));
        if (!id) return jsonError("bad_id", 400);

        const row = await env.DB.prepare(
            "SELECT id, status FROM deep_dive_authoring WHERE id = ?"
        ).bind(id).first();
        if (!row) return jsonError("not_found", 404);

        const body = await readJsonBody(request).catch(() => ({}));
        const reason = (typeof body.reason === "string" ? body.reason.trim() : "")
            .slice(0, 500) || "admin reset";

        const now = Date.now();
        try {
            await env.DB.prepare(`
                UPDATE deep_dive_authoring SET
                    status = 'pending',
                    status_reason = ?,
                    bundle_requested_at = NULL,
                    bundle_requested_by = NULL,
                    bundle_ready_at = NULL,
                    bundle_r2_key = NULL,
                    patch_uploaded_at = NULL,
                    patch_uploaded_by = NULL,
                    patch_r2_key = NULL,
                    authored_at = NULL,
                    updated_at = ?
                WHERE id = ?
            `).bind(reason, now, id).run();
        } catch (e) {
            console.error("reset D1 update failed", { id, error: String(e) });
            return jsonError("d1_update_failed: " + String(e), 500);
        }

        ctx.waitUntil(appendAuditEvent(env, ctx, id, {
            ts: now, actor: "admin", actor_label: admin.user,
            event_kind: "reset",
            detail: { reason, prev_status: row.status },
        }));
        ctx.waitUntil(auditAdminAction(env, ctx, admin, "deep_dive_reset", id, {
            prev_status: row.status, reason,
        }));

        return jsonResponse({ ok: true, id, status: "pending" });
    });
}
