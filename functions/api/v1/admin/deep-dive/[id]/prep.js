// =====================================================================
// POST /api/v1/admin/deep-dive/<id>/prep
// =====================================================================
// Admin clicks "Materialize Cowork bundle" — flips status to
// 'bundle_requested'.  Mac orchestrator polls /pull and runs
// prep_deep_dive_bundle.py with (surface_kind, surface_key, pmid),
// which materializes the .bundle.md + pbcopies the Cowork trigger
// string + macOS notify, then POSTs back to /<id>/bundle-ready.
//
// Per §3.9 NO-heuristic + §12.1 Cowork-as-orchestrator: NO Anthropic
// API call from this endpoint.
// =====================================================================

import { adminRoute, jsonResponse, jsonError } from "../../../../../_lib/admin_api.js";
import {
    appendAuditEvent, auditAdminAction,
} from "../../../../../_lib/deep_dive.js";

export async function onRequestPost(ctx) {
    return adminRoute(ctx, async ({ env, request, params, admin }) => {
        if (!env.DB) return jsonError("server_error: DB binding missing", 500);

        const id = decodeURIComponent(String(params?.id || ""));
        if (!id) return jsonError("bad_id", 400);

        const row = await env.DB.prepare(
            "SELECT id, surface_kind, surface_key, pmid, status FROM deep_dive_authoring WHERE id = ?"
        ).bind(id).first();
        if (!row) return jsonError("not_found", 404);

        // Allow re-request from any non-authored state.  If already
        // authored, refuse — the admin should explicitly use /reset
        // first if they want to re-author.
        if (row.status === "authored") {
            return jsonError("already_authored — POST /reset first to re-author", 409);
        }

        const now = Date.now();
        try {
            await env.DB.prepare(`
                UPDATE deep_dive_authoring SET
                    status = 'bundle_requested',
                    status_reason = NULL,
                    bundle_requested_at = ?,
                    bundle_requested_by = ?,
                    bundle_ready_at = NULL,
                    bundle_r2_key = NULL,
                    updated_at = ?
                WHERE id = ?
            `).bind(now, admin.user, now, id).run();
        } catch (e) {
            console.error("prep D1 update failed", { id, error: String(e) });
            return jsonError("d1_update_failed: " + String(e), 500);
        }

        ctx.waitUntil(appendAuditEvent(env, ctx, id, {
            ts: now, actor: "admin", actor_label: admin.user,
            event_kind: "prep_requested",
            detail: { surface_kind: row.surface_kind, surface_key: row.surface_key, pmid: row.pmid },
        }));
        ctx.waitUntil(auditAdminAction(env, ctx, admin, "deep_dive_prep_requested", id, {
            surface_kind: row.surface_kind, pmid: row.pmid,
        }));

        return jsonResponse({
            ok: true,
            id,
            status: "bundle_requested",
            bundle_requested_at: now,
            next_step: "Mac orchestrator will materialize the Cowork bundle on next pull (next run_trend_tracker.sh or manual scripts/pull_approved_overrides.py). A clipboard-ready trigger string + macOS notification will surface when ready.",
        });
    });
}
