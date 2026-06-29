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

const SUBMITTABLE = new Set(["pending_review", "edited", "ready_to_submit", "rejected", "denied"]);

function billingProvider(env) {
    return {
        orgName: env.BILLING_PROVIDER_NAME || "Mount Zara, LLC",
        npi: (env.BILLING_PROVIDER_NPI || "").replace(/\D/g, ""),
        taxId: env.BILLING_PROVIDER_TIN || "",
        taxonomy: env.BILLING_PROVIDER_TAXONOMY || "207V00000X", // OB/GYN
        address: {
            line1: env.BILLING_PROVIDER_ADDR1 || "PRIME Healthcare St. Francis Hospital",
            city: env.BILLING_PROVIDER_CITY || "Evanston",
            state: env.BILLING_PROVIDER_STATE || "IL",
            zip: env.BILLING_PROVIDER_ZIP || "60202",
        },
    };
}

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

        const [lines, diags, patient, storedIns] = await Promise.all([
            env.DB.prepare(`SELECT * FROM billing_claim_lines WHERE claim_id = ? ORDER BY line_number`).bind(id).all().then((r) => r.results || []),
            env.DB.prepare(`SELECT * FROM billing_claim_diagnoses WHERE claim_id = ? ORDER BY diagnosis_index`).bind(id).all().then((r) => r.results || []),
            env.DB.prepare(`SELECT first_name, last_name, dob FROM patients WHERE id = ?`).bind(claimRow.patient_id).first().catch(() => null),
            env.DB.prepare(`SELECT * FROM patient_insurance WHERE patient_id = ? AND active = 1 AND rank = 'primary' ORDER BY updated_at DESC LIMIT 1`).bind(claimRow.patient_id).first().catch(() => null),
        ]);
        // Payer: the claim's own payer wins; else the patient's stored insurance payer.
        const payerId = claimRow.payer_id || (storedIns && storedIns.payer_id) || null;
        const payer = payerId ? await env.DB.prepare(`SELECT * FROM billing_payers WHERE id = ?`).bind(payerId).first().catch(() => null) : null;
        // Merge stored patient_insurance with any per-request override (body.insurance wins).
        const bi = body.insurance || {}, si = storedIns || {};
        const isSelf = !(bi.relationship || si.relationship) || (bi.relationship || si.relationship) === "self";
        const ins = {
            memberId: bi.member_id || si.member_id, groupNumber: bi.group_number || si.group_number,
            gender: bi.gender || si.patient_gender, dob: bi.dob || si.subscriber_dob,
            subFirst: bi.subscriber_first_name || si.subscriber_first_name, subLast: bi.subscriber_last_name || si.subscriber_last_name,
            address: bi.address || { line1: si.address_line1, city: si.address_city, state: si.address_state, zip: si.address_zip },
        };
        const norm = {
            control: { usageIndicator: env.CLEARINGHOUSE_LIVE === "1" ? "P" : "T" },
            submitter: { name: env.BILLING_PROVIDER_NAME || "Mount Zara, LLC", id: env.SUBMITTER_ID || "MZBILL", contactName: "Billing", contactPhone: env.BILLING_CONTACT_PHONE || "" },
            receiver: { name: (payer && payer.clearinghouse_vendor) || clearinghouseVendor(env), id: env.RECEIVER_ID || "CLEARINGHOUSE" },
            billingProvider: billingProvider(env),
            payer: payer ? { name: payer.payer_name, payerId: payer.payer_id, kind: payer.payer_kind } : { name: "", payerId: "", kind: "commercial" },
            subscriber: isSelf ? {
                firstName: patient && patient.first_name, lastName: patient && patient.last_name,
                memberId: ins.memberId, groupNumber: ins.groupNumber,
                dob: (ins.dob || (patient && patient.dob) || "").replace(/-/g, ""),
                gender: ins.gender, address: ins.address || {},
            } : {
                firstName: ins.subFirst, lastName: ins.subLast, memberId: ins.memberId, groupNumber: ins.groupNumber,
                dob: (ins.dob || "").replace(/-/g, ""), gender: ins.gender, address: ins.address || {},
            },
            patient: isSelf ? null : { firstName: patient && patient.first_name, lastName: patient && patient.last_name, dob: ((patient && patient.dob) || "").replace(/-/g, ""), gender: ins.gender, address: ins.address || {} },
            claim: {
                patientControlNumber: id,
                placeOfService: claimRow.place_of_service || (lines[0] && lines[0].place_of_service) || "11",
                frequencyCode: body.frequency_code || (claimRow.status === "denied" || claimRow.status === "rejected" ? "7" : "1"),
                diagnoses: diags.map((d) => d.user_override_code || d.icd10_code),
                patientIsSubscriber: isSelf,
                patientRelationship: bi.relationship || si.relationship || "self",   // PAT01 for non-self dependents (spouse/child)
                serviceDate: (claimRow.visit_date || "").replace(/-/g, ""),
            },
            lines: lines.map((l) => ({
                procedureCode: l.user_override_code || l.code,
                modifiers: [l.modifier_1, l.modifier_2, l.modifier_3, l.modifier_4].filter(Boolean),
                chargeCents: l.charge_cents, units: l.units || 1,
                serviceDate: (claimRow.visit_date || "").replace(/-/g, ""),
                placeOfService: l.place_of_service,
                diagnosisPointers: (l.diagnosis_pointers || "1").split(",").map((x) => parseInt(x, 10)).filter(Boolean),
            })),
        };

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
