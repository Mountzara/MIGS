// =====================================================================
// POST /api/v1/admin/billing/claims/:id/reject
// =====================================================================
// Phase 8 Round C. Clinician dismisses the AI's coding analysis entirely
// for this encounter (e.g., the AI miscoded a procedure that was never
// performed, or the documentation simply isn't billable). Transition:
// pending_review | edited → rejected.
//
// Body (JSON):
//   { reason: "...", notes: "..." }
//
// `reason` is a short code (e.g., "miscoded", "not_billable",
// "duplicate_session"); `notes` is the long-form free text shown on the
// audit row. Reason is required.
//
// Auth: admin Basic Auth via adminRoute.
// =====================================================================

import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../../../../_lib/admin_api.js";
import { newId } from "../../../../../../_lib/db.js";

const REJECTABLE_FROM = new Set(["pending_review", "edited"]);

export async function onRequestPost(ctx) {
    return adminRoute(ctx, async ({ env, params, request, admin }) => {
        const claim_id = params && params.id ? String(params.id) : "";
        if (!claim_id) return jsonError("missing_claim_id", 400);

        const body = await readJsonBody(request);
        const reason = body.reason ? String(body.reason).slice(0, 64) : "";
        const notes = body.notes ? String(body.notes).slice(0, 2000) : null;
        if (!reason) return jsonError("missing_reason", 400, { hint: "Short code like 'miscoded' or 'not_billable'." });

        const claim = await env.DB.prepare(`SELECT id, status FROM billing_claims WHERE id = ?`).bind(claim_id).first();
        if (!claim) return jsonError("claim_not_found", 404);
        if (!REJECTABLE_FROM.has(claim.status)) {
            return jsonError("invalid_status_for_reject", 409, {
                current_status: claim.status,
                rejectable_from: Array.from(REJECTABLE_FROM),
            });
        }

        const now = Date.now();
        await env.DB.prepare(`
            UPDATE billing_claims
            SET status = 'rejected',
                clinician_reviewed_at = ?,
                clinician_reviewer_id = ?,
                clinician_review_action = 'rejected',
                clinician_review_notes = ?,
                status_reason = ?,
                updated_at = ?
            WHERE id = ?
        `).bind(now, admin.user, notes, reason, now, claim_id).run();

        await env.DB.prepare(`
            INSERT INTO billing_audit_log
                (id, claim_id, ts, actor_id, actor_role, action, details_json, ip, user_agent)
            VALUES (?, ?, ?, ?, ?, 'claim_rejected', ?, ?, ?)
        `).bind(
            newId(), claim_id, now, admin.user, admin.role || "clinician",
            JSON.stringify({ reason, notes }),
            request.headers.get("CF-Connecting-IP") || "",
            (request.headers.get("User-Agent") || "").slice(0, 256),
        ).run();

        return jsonResponse({
            ok: true,
            claim_id,
            status: "rejected",
            reason,
            reviewer: admin.user,
            reviewed_at: now,
        });
    });
}
