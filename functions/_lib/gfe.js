// =====================================================================
// gfe.js — Good Faith Estimates under the No Surprises Act
// =====================================================================
// WHY THIS IS NOT OPTIONAL. The practice takes self-pay patients. Since
// 1 Jan 2022, 45 CFR 149.610 requires a provider to give every uninsured
// or self-pay patient a WRITTEN Good Faith Estimate — on scheduling, or
// on request — and the patient may use the federal patient-provider
// dispute resolution process if the actual bill exceeds the estimate by
// $400 or more for any single provider. A practice that quotes a price
// verbally and bills more has handed the patient a dispute it will lose.
//
// Two things are encoded here because both are commonly got wrong:
//
//  1. THE DEADLINE, which depends on how far out the service is from the
//     day it was scheduled — not from today, and not a flat "3 days".
//  2. THE REQUIRED CONTENT, as a checklist that a draft is measured
//     against. `validateGfe()` names what is missing rather than
//     returning a bare false, so the UI can show the physician exactly
//     which element the regulation wants.
//
// The third thing — grouping items by the provider furnishing them, and
// saying plainly that the outside lab/imaging/specialist bills
// separately — is the one that protects a self-pay patient from thinking
// the consult price covered the ultrasound.
//
// Deliberately NOT asserted: state-law estimate rules beyond the federal
// floor. Those belong to counsel; nothing here claims to satisfy them.
// =====================================================================

export const DISCLAIMER_VERSION = "2026-08-18";
export const DISPUTE_THRESHOLD_CENTS = 40000;   // $400, 45 CFR 149.620

// Business-day arithmetic: the regulation counts business days, and a
// Friday booking for a Tuesday service is not "3 days" in the sense the
// rule means. Federal holidays are not modelled — erring on the short
// side is the safe direction for a deadline.
export function addBusinessDays(dateStr, n) {
    const d = new Date(`${dateStr}T12:00:00Z`);
    if (isNaN(d.getTime())) return null;
    let added = 0;
    while (added < n) {
        d.setUTCDate(d.getUTCDate() + 1);
        const day = d.getUTCDay();
        if (day !== 0 && day !== 6) added++;
    }
    return d.toISOString().slice(0, 10);
}

export function businessDaysBetween(fromStr, toStr) {
    const a = new Date(`${fromStr}T12:00:00Z`), b = new Date(`${toStr}T12:00:00Z`);
    if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
    if (b < a) return -1;
    let count = 0;
    const cur = new Date(a);
    while (cur < b) {
        cur.setUTCDate(cur.getUTCDate() + 1);
        const day = cur.getUTCDay();
        if (day !== 0 && day !== 6) count++;
    }
    return count;
}

/**
 * When the written estimate must be in the patient's hands.
 *   * scheduled at least 10 business days out → within 3 business days of scheduling
 *   * scheduled 3–9 business days out         → within 1 business day of scheduling
 *   * scheduled fewer than 3 business days out→ the rule does not require one
 *   * patient REQUESTED an estimate           → within 3 business days of the request
 */
export function gfeDueBy({ trigger_kind = "scheduled", scheduled_on, service_date }) {
    if (!scheduled_on) return { due_by: null, required: false, reason: "no scheduling date" };
    if (trigger_kind === "request") {
        return { due_by: addBusinessDays(scheduled_on, 3), required: true, reason: "patient request — 3 business days" };
    }
    const lead = service_date ? businessDaysBetween(scheduled_on, service_date) : null;
    if (lead === null) return { due_by: null, required: false, reason: "no service date" };
    if (lead >= 10) return { due_by: addBusinessDays(scheduled_on, 3), required: true, reason: "scheduled 10+ business days out — 3 business days" };
    if (lead >= 3)  return { due_by: addBusinessDays(scheduled_on, 1), required: true, reason: "scheduled 3–9 business days out — 1 business day" };
    return { due_by: null, required: false, reason: "scheduled fewer than 3 business days out — no GFE required, but one may still be given" };
}

export function isGfeOverdue(gfe, todayStr) {
    if (!gfe || gfe.status === "issued" || gfe.status === "void") return false;
    if (!gfe.due_by) return false;
    return String(todayStr) > String(gfe.due_by);
}

// The content the regulation actually enumerates. Anything missing here
// is a defect in the estimate, not a cosmetic gap.
export function validateGfe(gfe, lines) {
    const L = Array.isArray(lines) ? lines : [];
    const missing = [];
    if (!gfe?.patient_name) missing.push("patient name");
    if (!gfe?.patient_dob) missing.push("patient date of birth");
    if (!gfe?.primary_service) missing.push("description of the primary item or service");
    if (!gfe?.service_date) missing.push("expected service date");
    const dx = Array.isArray(gfe?.diagnosis) ? gfe.diagnosis.filter(Boolean) : [];
    if (dx.length === 0) missing.push("diagnosis code(s)");
    if (L.length === 0) missing.push("itemized list of items and services");
    // Every line must name who furnishes it and carry a service code —
    // "grouped by provider" is the requirement, and an unattributed line
    // cannot be grouped.
    if (L.some(l => !l.description)) missing.push("description on every line");
    if (L.some(l => !l.service_code)) missing.push("service code on every line");
    if (L.some(l => !l.provider_name)) missing.push("provider/facility name on every line");
    const practice = L.filter(l => l.kind !== "outside");
    if (practice.some(l => !l.provider_npi)) missing.push("NPI for practice-furnished items");
    if (practice.some(l => !l.provider_tin)) missing.push("TIN for practice-furnished items");
    if (practice.some(l => !l.provider_state)) missing.push("state of practice for practice-furnished items");
    return { ok: missing.length === 0, missing };
}

export function totals(lines) {
    const L = Array.isArray(lines) ? lines : [];
    const sum = (arr) => arr.reduce((a, l) => a + (Number(l.total_cents) || 0), 0);
    const practice = L.filter(l => l.kind !== "outside");
    const outside = L.filter(l => l.kind === "outside");
    return {
        practice_cents: sum(practice),
        outside_cents: sum(outside),
        total_cents: sum(L),
        outside_count: outside.length,
    };
}

// Whether a later actual charge crosses the dispute threshold. Per the
// rule the comparison is PER PROVIDER, not against the grand total —
// getting that wrong understates exposure.
export function disputeExposure(estimatedCents, billedCents) {
    const diff = (Number(billedCents) || 0) - (Number(estimatedCents) || 0);
    return {
        difference_cents: diff,
        disputable: diff >= DISPUTE_THRESHOLD_CENTS,
        threshold_cents: DISPUTE_THRESHOLD_CENTS,
    };
}

// The four disclaimers the estimate must carry, in plain language.
export const DISCLAIMERS = [
    "This Good Faith Estimate shows the costs of items and services that are reasonably expected for your health care needs. The estimate is based on information known at the time it was created.",
    "The Good Faith Estimate does not include any unknown or unexpected costs that may arise during treatment. You could be charged more if complications or special circumstances occur.",
    "Some items or services may need to be scheduled separately and are not included in this estimate. Items and services furnished by another provider or facility are billed by that provider or facility, not by this practice.",
    "If you are billed for more than this Good Faith Estimate, you have the right to dispute the bill. You may start a patient-provider dispute resolution process with the U.S. Department of Health and Human Services if the billed amount is at least $400 more than this estimate for any provider listed. You must start the process within 120 calendar days of the date on your bill. Call 1-800-985-3059 or visit www.cms.gov/nosurprises for more information. This Good Faith Estimate is not a contract and does not require you to obtain the items or services listed.",
];

export default {
    DISCLAIMER_VERSION, DISPUTE_THRESHOLD_CENTS, DISCLAIMERS,
    addBusinessDays, businessDaysBetween, gfeDueBy, isGfeOverdue,
    validateGfe, totals, disputeExposure,
};
