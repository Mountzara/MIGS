// =====================================================================
// POST /api/v1/admin/billing/claims/:id/submit
// =====================================================================
// The OUTBOUND rail: scrub → X12 837P → clearinghouse → record.
// Pipeline:
//   1. Load the reviewed claim (+ lines, diagnoses, payer, patient).
//   2. Assemble a normalized claim. Insurance/demographics not yet modeled
//      in our schema (member id, gender, billing address) may be supplied in
//      the POST body `insurance` until an intake insurance-capture step lands.
//   3. scrubClaim() — the CLEAN-CLAIM gate. Hard BLOCKS → 422, do not submit.
//   4. generate837P() — the EDI claim.
//   5. submitClaim() via the clearinghouse adapter (mock by default until a
//      real vendor + payer enrollment is configured; usage indicator stays
//      'T' test unless CLEARINGHOUSE_LIVE=1).
//   6. Persist clearinghouse id + response, transition status, audit-log.
//
// Body (JSON, all optional):
//   { dry_run: true,                 // scrub + build 837, return it, DO NOT submit/persist
//     insurance: { member_id, group_number, gender, dob, relationship,
//                  address: { line1, city, state, zip } },
//     frequency_code: '1'|'7' }       // 7 = corrected/replacement claim
//
// Auth: admin via adminRoute.
// =====================================================================

import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../../../../_lib/admin_api.js";
import { logAudit } from "../../../../../../_lib/audit.js";
import { scrubClaim } from "../../../../../../_lib/claim_scrub.js";
import { generate837P } from "../../../../../../_lib/x12_837.js";
import { submitClaim, clearinghouseVendor } from "../../../../../../_lib/clearinghouse.js";
import { assembleClaim } from "../../../../../../_lib/claim_assembler.js";

const SUBMITTABLE = new Set(["pending_review", "edited", "ready_to_submit", "rejected", "denied"]);

export async function onRequestPost(ctx) {
    return adminRoute(ctx, async ({ env, params, request, admin }) => {
        const id = params && params.id ? String(params.id) : "";
        if (!id) return jsonError("missing_claim_id", 400);
        const body = (await readJsonBody(request)) || {};
        const dryRun = body.dry_run === true;

        const claimRow = await env.DB.prepare(`SELECT * FROM billing_claims WHERE id = ?`).bind(id).first();
        if (!claimRow) return jsonError("claim_not_found", 404);
        if (!dryRun && !SUBMITTABLE.has(claimRow.status)) {
            return jsonError(`claim status "${claimRow.status}" is not submittable`, 409, { status: claimRow.status });
        }

        // 2. Assemble the normalized claim (shared with the AI pre-flight path).
        const { norm, payer } = await assembleClaim(env, claimRow, body);

        // 3. Clean-claim gate
        const scrub = scrubClaim(norm);
        if (!scrub.clean) {
            return jsonResponse({ ok: false, stage: "scrub", clean: false, blocks: scrub.blocks, warnings: scrub.warnings, summary: scrub.summary }, { status: 422 });
        }

        // 4. Build the 837
        const built = generate837P(norm);

        if (dryRun) {
            return jsonResponse({ ok: true, dry_run: true, clean: true, warnings: scrub.warnings, control: built.controlNumbers, segment_count: built.segmentCount, total_charge_cents: built.totalChargeCents, edi: built.edi });
        }

        // 5. Submit — route to the payer's enrolled clearinghouse (multi-CH practices),
        //    else the global default.
        const vendor = (payer && payer.clearinghouse_vendor) || clearinghouseVendor(env);
        const result = await submitClaim(env, { edi: built.edi, claim: norm, payer, vendor });
        const now = Date.now();

        // 6. Persist + transition + audit
        const newStatus = result.ok ? result.status : "ready_to_submit";
        await env.DB.prepare(
            `UPDATE billing_claims SET status = ?, status_reason = ?, clearinghouse_claim_id = ?, clearinghouse_response_json = ?, submitted_at = COALESCE(submitted_at, ?), accepted_at = ?, updated_at = ? WHERE id = ?`
        ).bind(
            newStatus,
            result.ok ? (result.acknowledgment || "submitted") : (result.error || "submission failed"),
            result.clearinghouseClaimId || null,
            JSON.stringify({ provider: result.provider, status: result.status, acknowledgment: result.acknowledgment, error: result.error, raw: result.raw || null, control: built.controlNumbers }),
            result.ok ? now : null,
            result.status === "accepted_by_clearinghouse" ? now : null,
            now, id,
        ).run();

        try {
            await logAudit(env, {
                user_id: (admin && admin.user) || "admin", user_role: "staff", action: "claim_submit",
                record_type: "billing_claim", record_id: id, success: result.ok,
                details: { vendor, usage: built.controlNumbers.usageIndicator, ok: result.ok, status: newStatus, clearinghouse_claim_id: result.clearinghouseClaimId, warnings: scrub.warnings.length },
            }, ctx);
        } catch {}

        return jsonResponse({
            ok: result.ok, stage: "submit", vendor, status: newStatus,
            clearinghouse_claim_id: result.clearinghouseClaimId || null,
            acknowledgment: result.acknowledgment || null, error: result.error || null,
            warnings: scrub.warnings, control: built.controlNumbers, total_charge_cents: built.totalChargeCents,
        }, { status: result.ok ? 200 : 502 });
    });
}
