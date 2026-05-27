// =====================================================================
// POST /api/v1/admin/trend-briefs/<id>/suggest
// =====================================================================
// Admin types free-text suggestions and clicks "Refine in Cowork".
// This endpoint records the suggestions on the row + emits a
// `suggestions_set` audit event.  The actual inference happens in a
// Cowork CLI session — per CLAUDE.md §12.1 (Cowork is the orchestrator)
// and the user's 2026-05-26 directive ("this is still powered by claude
// cli through cowork ... no claude API to be built with this app at
// this time").  NO Anthropic API call from this endpoint.
//
// The Mac-side pull_approved_overrides.py detects rows with
// suggestions_text set and materializes a peer-review bundle via
// prep_peer_review.py, then surfaces a clipboard-ready Cowork trigger
// string + macOS Notification so Chris can open Cowork, paste, and
// have the session emit a patch JSON.
// =====================================================================

import {
    adminRoute, jsonResponse, jsonError, readJsonBody,
} from "../../../../../_lib/admin_api.js";
import {
    appendAuditEvent, auditAdminAction,
} from "../../../../../_lib/trend_briefs.js";

const MAX_SUGGESTIONS_BYTES = 12_000;  // 12 KB ≈ 3 dense pages of notes

export async function onRequestPost(ctx) {
    return adminRoute(ctx, async ({ env, request, params, admin }) => {
        if (!env.DB) return jsonError("server_error: DB binding missing", 500);

        const id = decodeURIComponent(String(params?.id || ""));
        if (!id) return jsonError("bad_id", 400);

        const row = await env.DB.prepare(
            "SELECT id, slug, brief_date, status FROM trend_brief_pending WHERE id = ?"
        ).bind(id).first();
        if (!row) return jsonError("not_found", 404);

        const body = await readJsonBody(request);
        const suggestions = String(body.suggestions || "").trim();
        if (!suggestions) {
            return jsonError("suggestions required (free-text refinement notes)", 400);
        }
        if (suggestions.length > MAX_SUGGESTIONS_BYTES) {
            return jsonError(`suggestions_too_large (>${MAX_SUGGESTIONS_BYTES} bytes)`, 413);
        }

        const now = Date.now();
        try {
            await env.DB.prepare(`
                UPDATE trend_brief_pending SET
                    suggestions_text = ?,
                    suggestions_set_at = ?,
                    updated_at = ?
                WHERE id = ?
            `).bind(suggestions, now, now, id).run();
        } catch (e) {
            console.error("suggest D1 update failed", { id, error: String(e) });
            return jsonError("d1_update_failed: " + String(e), 500);
        }

        ctx.waitUntil(appendAuditEvent(env, ctx, id, {
            ts: now, actor: "admin", actor_label: admin.user,
            event_kind: "suggestions_set",
            detail: {
                suggestions_bytes: suggestions.length,
                suggestions_preview: suggestions.slice(0, 200),
            },
        }));
        ctx.waitUntil(auditAdminAction(env, ctx, admin, "trend_brief_suggestions_set", id, {
            suggestions_bytes: suggestions.length,
        }));

        return jsonResponse({
            ok: true,
            id,
            status: row.status,
            suggestions_set_at: now,
            next_step: "Mac orchestrator will materialize a Cowork peer-review bundle on next pull. Open Cowork and paste the trigger string that appears in your clipboard, then re-approve once the patch is applied.",
        });
    });
}
