// =====================================================================
// PATCH /api/v1/admin/billing/claims/:id/upcoding/:op_id
// =====================================================================
// Phase 8 Round C. Clinician accepts (or un-accepts) an AI-identified
// upcoding opportunity. When accepted AND the current_code/potential_code
// pair targets the E/M line, the claim's em_code is bumped to the new
// code and total_wrvu / total_charge_cents / expected_collection_cents
// are re-summed (best-effort — relies on the line wRVU already set).
//
// Body (JSON):
//   { accepted: true|false, apply_to_line: true }
//
// `apply_to_line` (default true) — when accepted, also overrides the
// matching billing_claim_lines row's user_override_code to the new code.
// Set false if the clinician wants to track the acceptance without
// yet rewriting the billed line (rare — usually approve+apply together).
//
// Auth: admin Basic Auth via adminRoute.
// =====================================================================

import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../../../../../_lib/admin_api.js";
import { newId } from "../../../../../../../_lib/db.js";

export async function onRequestPatch(ctx) {
    return adminRoute(ctx, async ({ env, params, request, admin }) => {
        const claim_id = params && params.id ? String(params.id) : "";
        const op_id    = params && params.op_id ? String(params.op_id) : "";
        if (!claim_id || !op_id) return jsonError("missing_ids", 400);

        const body = await readJsonBody(request);
        const accepted = body.accepted !== false;
        const apply_to_line = body.apply_to_line !== false;

        const op = await env.DB.prepare(`
            SELECT id, claim_id, current_code, potential_code, wrvu_delta, revenue_delta_cents, accepted
            FROM billing_upcoding_opportunities
            WHERE id = ? AND claim_id = ?
        `).bind(op_id, claim_id).first();
        if (!op) return jsonError("upcoding_op_not_found", 404);

        const now = Date.now();
        await env.DB.prepare(`
            UPDATE billing_upcoding_opportunities
            SET accepted = ?, accepted_at = ?, accepted_by = ?
            WHERE id = ?
        `).bind(accepted ? 1 : 0, accepted ? now : null, accepted ? admin.user : null, op_id).run();

        let em_bumped = false;
        let line_overridden = false;

        if (accepted && apply_to_line) {
            // Find the matching line (current_code → potential_code).
            const line = await env.DB.prepare(`
                SELECT id, code_type, code, wrvu, charge_cents, expected_cents
                FROM billing_claim_lines
                WHERE claim_id = ? AND code = ?
                ORDER BY line_number ASC LIMIT 1
            `).bind(claim_id, op.current_code).first();
            if (line) {
                await env.DB.prepare(`
                    UPDATE billing_claim_lines
                    SET user_override_code = ?, is_accepted = 1
                    WHERE id = ?
                `).bind(op.potential_code, line.id).run();
                line_overridden = true;
                if (line.code_type === "em") {
                    // Bump claim em_code denormalized field.
                    await env.DB.prepare(`
                        UPDATE billing_claims
                        SET em_code = ?,
                            em_wrvu = COALESCE(em_wrvu, 0) + ?,
                            total_wrvu = COALESCE(total_wrvu, 0) + ?,
                            expected_collection_cents = COALESCE(expected_collection_cents, 0) + ?,
                            updated_at = ?
                        WHERE id = ?
                    `).bind(
                        op.potential_code,
                        Number(op.wrvu_delta) || 0,
                        Number(op.wrvu_delta) || 0,
                        Number(op.revenue_delta_cents) || 0,
                        now, claim_id,
                    ).run();
                    em_bumped = true;
                }
            }
        }

        // Mark claim 'edited' so the queue surfaces clinician touch.
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
            accepted ? "upcoding_accepted" : "upcoding_reverted",
            JSON.stringify({
                op_id,
                current_code: op.current_code,
                potential_code: op.potential_code,
                wrvu_delta: op.wrvu_delta,
                revenue_delta_cents: op.revenue_delta_cents,
                em_bumped,
                line_overridden,
            }),
            request.headers.get("CF-Connecting-IP") || "",
            (request.headers.get("User-Agent") || "").slice(0, 256),
        ).run();

        return jsonResponse({
            ok: true,
            op_id,
            accepted,
            em_bumped,
            line_overridden,
            new_em_code: em_bumped ? op.potential_code : null,
        });
    });
}
