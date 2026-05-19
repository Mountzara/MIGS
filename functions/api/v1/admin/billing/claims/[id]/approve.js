// =====================================================================
// POST /api/v1/admin/billing/claims/:id/approve
// =====================================================================
// Phase 8 Round C. Transitions a claim from pending_review or edited →
// ready_to_submit. After this, the claim is queued for the EDI 837P
// generator (Round D — not yet built); until then, ready_to_submit
// claims sit in /admin/billing/ under the "Ready to submit" filter.
//
// Body (JSON, all optional):
//   { notes: "...", force: false }
//
// `force=true` allows approving a claim that still has unresolved
// `error`-severity compliance flags. Without force, those errors block
// the transition with HTTP 409.
//
// Side effects:
//   * billing_claims.status = 'ready_to_submit'
//   * .clinician_reviewed_at = now
//   * .clinician_reviewer_id = admin user
//   * .clinician_review_action = 'approved_as_is' | 'edited_and_approved'
//     (set to 'edited_and_approved' if any line/flag was modified since
//     the snapshot was first ingested; otherwise 'approved_as_is')
//   * billing_audit_log row 'claim_approved'
//
// Auth: admin Basic Auth via adminRoute.
// =====================================================================

import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../../../../_lib/admin_api.js";
import { newId } from "../../../../../../_lib/db.js";

const APPROVABLE_FROM = new Set(["pending_review", "edited"]);

export async function onRequestPost(ctx) {
    return adminRoute(ctx, async ({ env, params, request, admin }) => {
        const claim_id = params && params.id ? String(params.id) : "";
        if (!claim_id) return jsonError("missing_claim_id", 400);

        const body = await readJsonBody(request);
        const notes = body.notes ? String(body.notes).slice(0, 2000) : null;
        const force = !!body.force;

        const claim = await env.DB.prepare(`
            SELECT id, status, source_app, source_session_id
            FROM billing_claims
            WHERE id = ?
        `).bind(claim_id).first();
        if (!claim) return jsonError("claim_not_found", 404);
        if (!APPROVABLE_FROM.has(claim.status)) {
            return jsonError("invalid_status_for_approve", 409, {
                current_status: claim.status,
                approvable_from: Array.from(APPROVABLE_FROM),
            });
        }

        // Block on unresolved error-severity flags unless force=true.
        const errCount = await env.DB.prepare(`
            SELECT COUNT(*) AS n FROM billing_compliance_flags
            WHERE claim_id = ? AND severity = 'error' AND resolved = 0
        `).bind(claim_id).first();
        if (errCount && errCount.n > 0 && !force) {
            return jsonError("unresolved_errors_block_approval", 409, {
                unresolved_errors: errCount.n,
                hint: "Pass { force: true } to override after clinician review.",
            });
        }

        // Detect prior edits — if any line was overridden, any flag was
        // resolved, any upcoding accepted, any doc suggestion applied,
        // mark action as edited_and_approved.
        const editProbe = await env.DB.prepare(`
            SELECT
                (SELECT COUNT(*) FROM billing_claim_lines WHERE claim_id = ? AND (user_override_code IS NOT NULL OR is_accepted IS NOT NULL))
              + (SELECT COUNT(*) FROM billing_compliance_flags WHERE claim_id = ? AND resolved = 1)
              + (SELECT COUNT(*) FROM billing_upcoding_opportunities WHERE claim_id = ? AND accepted = 1)
              + (SELECT COUNT(*) FROM billing_documentation_suggestions WHERE claim_id = ? AND applied = 1)
            AS edits
        `).bind(claim_id, claim_id, claim_id, claim_id).first();
        const action = (editProbe && editProbe.edits > 0) ? "edited_and_approved" : "approved_as_is";

        const now = Date.now();
        await env.DB.prepare(`
            UPDATE billing_claims
            SET status = 'ready_to_submit',
                clinician_reviewed_at = ?,
                clinician_reviewer_id = ?,
                clinician_review_action = ?,
                clinician_review_notes = ?,
                status_reason = NULL,
                updated_at = ?
            WHERE id = ?
        `).bind(now, admin.user, action, notes, now, claim_id).run();

        await env.DB.prepare(`
            INSERT INTO billing_audit_log
                (id, claim_id, ts, actor_id, actor_role, action, details_json, ip, user_agent)
            VALUES (?, ?, ?, ?, ?, 'claim_approved', ?, ?, ?)
        `).bind(
            newId(), claim_id, now, admin.user, admin.role || "clinician",
            JSON.stringify({
                review_action: action,
                forced_over_errors: force && errCount && errCount.n > 0,
                unresolved_errors_at_approval: errCount ? errCount.n : 0,
            }),
            request.headers.get("CF-Connecting-IP") || "",
            (request.headers.get("User-Agent") || "").slice(0, 256),
        ).run();

        return jsonResponse({
            ok: true,
            claim_id,
            status: "ready_to_submit",
            review_action: action,
            reviewer: admin.user,
            reviewed_at: now,
        });
    });
}
