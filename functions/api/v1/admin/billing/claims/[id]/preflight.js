// =====================================================================
// POST /api/v1/admin/billing/claims/:id/preflight
// =====================================================================
// AI PRE-FLIGHT REVIEW — the same assemble + scrub the submit endpoint
// runs, PLUS an AI denial-prevention second opinion, WITHOUT submitting.
// Call this before /submit to catch the judgment-call denial patterns the
// deterministic scrub can't (medical-necessity, NCCI bundling, modifier
// 25, payer-specific risks), each tagged with the CARC it would draw.
//
// Body (JSON, optional): { insurance: {...}, frequency_code: '1'|'7' } —
//   same override fields as /submit, so the review matches what you'd send.
//
// Returns: { ok, scrub:{clean,blocks,warnings,summary}, review:{...},
//            ready_to_submit, total_charge_cents }.
//   ready_to_submit = scrub.clean && review.ready_to_submit.
//
// No PHI leaves the building: the AI reviewer receives a de-identified,
// codes-only projection. Auth: adminRoute.
// =====================================================================

import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../../../../_lib/admin_api.js";
import { logAudit } from "../../../../../../_lib/audit.js";
import { scrubClaim } from "../../../../../../_lib/claim_scrub.js";
import { assembleClaim } from "../../../../../../_lib/claim_assembler.js";
import { aiPreflightReview } from "../../../../../../_lib/billing_ai_preflight.js";
import { newId } from "../../../../../../_lib/db.js";

export async function onRequestPost(ctx) {
    return adminRoute(ctx, async ({ env, params, request, admin }) => {
        const id = params && params.id ? String(params.id) : "";
        if (!id) return jsonError("missing_claim_id", 400);
        const body = (await readJsonBody(request)) || {};

        const claimRow = await env.DB.prepare(`SELECT * FROM billing_claims WHERE id = ?`).bind(id).first();
        if (!claimRow) return jsonError("claim_not_found", 404);

        // Assemble the exact artifact /submit would send, then scrub + AI review.
        const { norm, payer } = await assembleClaim(env, claimRow, body);
        norm.payer = norm.payer || (payer ? { name: payer.payer_name, payerId: payer.payer_id, kind: payer.payer_kind } : { kind: "commercial" });
        const scrub = scrubClaim(norm);
        const review = await aiPreflightReview(env, { norm, scrub });

        const readyToSubmit = scrub.clean && review.ready_to_submit !== false;
        const now = Date.now();

        // Persist the review (best-effort; advisory record for the coach + audit trail).
        try {
            await env.DB.prepare(
                `INSERT INTO billing_preflight_reviews (id, claim_id, risk_level, ready, scrub_clean, issues_json, ai_used, model, prompt_version, created_by, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
                newId(), id, review.risk_level || null, readyToSubmit ? 1 : 0, scrub.clean ? 1 : 0,
                JSON.stringify({ issues: review.issues || [], summary: review.summary || "", blocks: scrub.blocks, warnings: scrub.warnings }),
                review.ai_used ? 1 : 0, review.model || null, review.prompt_version || null,
                (admin && admin.user) || "admin", now,
            ).run();
        } catch (e) { /* table may not exist yet on first deploy; non-fatal */ }

        try {
            await logAudit(env, {
                user_id: (admin && admin.user) || "admin", user_role: "staff", action: "claim_ai_preflight",
                record_type: "billing_claim", record_id: id, success: true,
                details: { ai_used: review.ai_used, risk_level: review.risk_level, ready_to_submit: readyToSubmit, scrub_clean: scrub.clean, issue_count: (review.issues || []).length, model: review.model },
            }, ctx);
        } catch {}

        return jsonResponse({
            ok: true,
            claim_id: id,
            ready_to_submit: readyToSubmit,
            scrub: { clean: scrub.clean, blocks: scrub.blocks, warnings: scrub.warnings, summary: scrub.summary },
            total_charge_cents: scrub.total_charge_cents,
            review,
        });
    });
}
