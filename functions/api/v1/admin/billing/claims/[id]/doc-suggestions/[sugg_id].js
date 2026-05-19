// =====================================================================
// PATCH /api/v1/admin/billing/claims/:id/doc-suggestions/:sugg_id
// =====================================================================
// Phase 8 Round C. Clinician marks a documentation suggestion as
// applied — meaning they've gone back to the SOAP note and added the
// suggested content. The note itself doesn't change from here; the
// Transcription app handles note edits and re-syncs. This endpoint
// just records the clinician's acknowledgement so the dashboard can
// stop nagging.
//
// Body (JSON):
//   { applied: true|false }
//
// Auth: admin Basic Auth via adminRoute.
// =====================================================================

import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../../../../../_lib/admin_api.js";
import { newId } from "../../../../../../../_lib/db.js";

export async function onRequestPatch(ctx) {
    return adminRoute(ctx, async ({ env, params, request, admin }) => {
        const claim_id = params && params.id ? String(params.id) : "";
        const sugg_id  = params && params.sugg_id ? String(params.sugg_id) : "";
        if (!claim_id || !sugg_id) return jsonError("missing_ids", 400);

        const body = await readJsonBody(request);
        const applied = body.applied !== false;

        const sugg = await env.DB.prepare(`
            SELECT id, claim_id, priority, section, issue
            FROM billing_documentation_suggestions
            WHERE id = ? AND claim_id = ?
        `).bind(sugg_id, claim_id).first();
        if (!sugg) return jsonError("doc_suggestion_not_found", 404);

        const now = Date.now();
        await env.DB.prepare(`
            UPDATE billing_documentation_suggestions
            SET applied = ?, applied_at = ?
            WHERE id = ?
        `).bind(applied ? 1 : 0, applied ? now : null, sugg_id).run();

        // Flip claim status.
        await env.DB.prepare(`
            UPDATE billing_claims
            SET status = CASE WHEN status = 'pending_review' THEN 'edited' ELSE status END,
                updated_at = ?
            WHERE id = ?
        `).bind(now, claim_id).run();

        await env.DB.prepare(`
            INSERT INTO billing_audit_log
                (id, claim_id, ts, actor_id, actor_role, action, details_json, ip, user_agent)
            VALUES (?, ?, ?, ?, ?, 'doc_suggestion_applied', ?, ?, ?)
        `).bind(
            newId(), claim_id, now, admin.user, admin.role || "clinician",
            JSON.stringify({ sugg_id, priority: sugg.priority, section: sugg.section, applied }),
            request.headers.get("CF-Connecting-IP") || "",
            (request.headers.get("User-Agent") || "").slice(0, 256),
        ).run();

        return jsonResponse({ ok: true, sugg_id, applied, applied_at: applied ? now : null });
    });
}
