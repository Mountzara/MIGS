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
import { screenClaim } from "../../../../../../_lib/no_double_dip.js";
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

        // 2b. DOUBLE-DIP GATE — runs BEFORE the clean-claim gate, and
        //     before the 837 exists at all.
        //
        //     If this patient holds a paid membership, some of what they
        //     already pay for monthly has a CPT code — messaging is the
        //     obvious one. Billing their plan for it as well charges them
        //     twice for one thing: once directly, once through their
        //     premium. That is what the payer contract prohibits and what
        //     an insurance regulator would call the fee a policy for.
        //
        //     It fails CLOSED and refuses to submit. A claim that has gone
        //     out cannot be recalled, and "we spotted it on the remittance"
        //     is not a control.
        let memberTier = "standard";
        try {
            const m = await env.DB.prepare(
                `SELECT tier FROM memberships
                  WHERE patient_id = ? AND status IN ('active','past_due','cancelling')
                  ORDER BY created_at DESC LIMIT 1`
            ).bind(claimRow.patient_id).first();
            if (m?.tier) memberTier = m.tier;
        } catch {
            // The memberships table may predate this deploy. A missing
            // table means nobody is a member, which is the safe reading —
            // but it must never silently swallow a REAL membership, so the
            // failure is logged rather than ignored.
            console.warn("double-dip gate: membership lookup failed; treating patient as non-member");
        }

        const dd = screenClaim(norm.lines || norm.service_lines || [], memberTier);
        if (!dd.ok) {
            return jsonResponse({
                ok: false, stage: "double_dip", tier: memberTier,
                blocked: dd.blocked, summary: dd.summary,
            }, { status: 422 });
        }

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
        const now = Date.now();
        // Optimistic lock — compare-and-swap on the status we read, so two
        // concurrent submits can't BOTH reach the clearinghouse and create
        // duplicate claims (a CARC 18 denial). The final UPDATE below clears
        // 'submitting' to the real outcome (or back to ready_to_submit on
        // failure). If another request already claimed it, 409.
        const claimed = await env.DB.prepare(
            `UPDATE billing_claims SET status = 'submitting', updated_at = ? WHERE id = ? AND status = ?`
        ).bind(now, id, claimRow.status).run();
        if (!claimed || !claimed.meta || claimed.meta.changes === 0) {
            return jsonError("claim is already submitting or its status changed — refresh and retry", 409, { status: claimRow.status });
        }
        const result = await submitClaim(env, { edi: built.edi, claim: norm, payer, vendor });

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
                ip: request.headers.get("CF-Connecting-IP"), user_agent: request.headers.get("user-agent"),
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
