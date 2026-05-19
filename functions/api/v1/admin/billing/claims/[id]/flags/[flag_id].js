// =====================================================================
// PATCH /api/v1/admin/billing/claims/:id/flags/:flag_id
// =====================================================================
// Phase 8 Round C. Clinician resolves (or un-resolves) a compliance flag
// on a claim — e.g., they've added the missing modifier to the
// underlying note and the warning no longer applies.
//
// Body (JSON):
//   { resolved: true|false, resolved_note: "..." }
//
// Side effects:
//   * billing_compliance_flags.resolved, resolved_at, resolved_by, resolved_note
//   * billing_claims.status flips pending_review → edited (so the
//     dashboard surfaces that work has been done since first ingestion)
//   * billing_audit_log row 'flag_resolved' or 'flag_unresolved'
//
// Note: this does NOT alter the underlying clinical claim — modifier
// changes happen in the SOAP note, which the Transcription app re-sends
// on the next save. This endpoint records that the CLINICIAN has
// reviewed the flag.
//
// Auth: admin Basic Auth via adminRoute.
// =====================================================================

import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../../../../../_lib/admin_api.js";
import { newId } from "../../../../../../../_lib/db.js";

export async function onRequestPatch(ctx) {
    return adminRoute(ctx, async ({ env, params, request, admin }) => {
        const claim_id = params && params.id ? String(params.id) : "";
        const flag_id  = params && params.flag_id ? String(params.flag_id) : "";
        if (!claim_id || !flag_id) return jsonError("missing_ids", 400);

        const body = await readJsonBody(request);
        const resolved = body.resolved !== false;   // default true on PATCH
        const resolved_note = body.resolved_note ? String(body.resolved_note).slice(0, 1000) : null;

        const flag = await env.DB.prepare(`
            SELECT id, claim_id, severity, title, resolved
            FROM billing_compliance_flags
            WHERE id = ? AND claim_id = ?
        `).bind(flag_id, claim_id).first();
        if (!flag) return jsonError("flag_not_found", 404);

        const now = Date.now();
        await env.DB.prepare(`
            UPDATE billing_compliance_flags
            SET resolved = ?, resolved_at = ?, resolved_by = ?, resolved_note = ?
            WHERE id = ?
        `).bind(resolved ? 1 : 0, resolved ? now : null, resolved ? admin.user : null, resolved_note, flag_id).run();

        // Flip claim status from pending_review → edited so the queue
        // shows "the clinician has touched this."
        await env.DB.prepare(`
            UPDATE billing_claims
            SET status = CASE WHEN status = 'pending_review' THEN 'edited' ELSE status END,
                updated_at = ?
            WHERE id = ?
        `).bind(now, claim_id).run();

        await env.DB.prepare(`
            INSERT INTO billing_audit_log
                (id, claim_id, ts, actor_id, actor_role, action, details_json, ip, user_agent)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
            newId(), claim_id, now, admin.user, admin.role || "clinician",
            resolved ? "flag_resolved" : "flag_unresolved",
            JSON.stringify({ flag_id, severity: flag.severity, title: flag.title, note: resolved_note }),
            request.headers.get("CF-Connecting-IP") || "",
            (request.headers.get("User-Agent") || "").slice(0, 256),
        ).run();

        return jsonResponse({ ok: true, flag_id, resolved, resolved_at: resolved ? now : null });
    });
}
