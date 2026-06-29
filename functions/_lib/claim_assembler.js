// =====================================================================
// functions/_lib/claim_assembler.js — load + normalize a billing claim
// =====================================================================
// The single source of truth for turning a billing_claims row (plus its
// lines, diagnoses, patient, and stored insurance) into the NORMALIZED
// claim object consumed by claim_scrub.js, x12_837.js, and the AI
// pre-flight reviewer.
//
// Extracted from the submit endpoint so the OUTBOUND submit path and the
// AI PRE-FLIGHT path assemble byte-for-byte the SAME artifact — a
// pre-flight review of a claim that differs from what actually goes on
// the wire would be worthless. Both import this; neither re-derives it.
//
// Pure data assembly + the four DB reads. No EDI, no scrub, no network.
// =====================================================================

import { clearinghouseVendor } from "./clearinghouse.js";

export function billingProvider(env) {
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

/**
 * Load every row a claim needs and return the normalized claim plus the
 * raw context rows (so callers don't re-query).
 *
 * @param {object} env  - Pages env with .DB bound
 * @param {object} claimRow - the billing_claims row (already fetched)
 * @param {object} [body] - optional request body: { insurance, frequency_code }
 * @returns {Promise<{ norm, payer, patient, storedIns, lines, diags, payerId }>}
 */
export async function assembleClaim(env, claimRow, body = {}) {
    const id = String(claimRow.id);
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
    const bi = (body && body.insurance) || {}, si = storedIns || {};
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
            frequencyCode: (body && body.frequency_code) || (claimRow.status === "denied" || claimRow.status === "rejected" ? "7" : "1"),
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
    return { norm, payer, patient, storedIns, lines, diags, payerId };
}

export default { assembleClaim, billingProvider };
