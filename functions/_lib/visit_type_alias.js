// =====================================================================
// visit_type_alias.js — the app's words, the catalog's keys
// =====================================================================
// The transcription app labels visits the way a person speaks —
// "Problem Visit", "New Patient Telehealth" — while the practice service
// catalog is keyed by slug: routine_followup, telehealth_consult. They
// never matched, so every claim the app synced sat at $0 and every
// billing figure understated the practice.
//
// WHAT THIS IS NOT: a fee schedule. billing_service_catalog holds the
// practice's CASH prices (schema/0010 calls them "patient-direct-pay
// categories"). Using one as an insurance expectation is only sound
// while every patient is self-pay, which is true today because no payer
// contract is signed and no claim has ever been submitted. The moment a
// contract exists, the contracted rate must supersede this — which is
// why every price sourced here is labelled `cash_catalog` rather than
// quietly becoming "expected collection".
// =====================================================================

export function normalize(raw) {
    return String(raw || "").trim().toLowerCase()
        .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

// Spoken label → catalog key. Extend as the app's vocabulary grows;
// an unmapped label must stay unmapped rather than guess.
export const ALIASES = {
    problem_visit: "routine_followup",
    follow_up: "routine_followup",
    followup: "routine_followup",
    follow_up_visit: "routine_followup",
    established_patient: "routine_followup",
    new_patient: "new_patient_standard",
    new_patient_visit: "new_patient_standard",
    new_patient_complex: "new_patient_complex",
    new_patient_telehealth: "telehealth_consult",
    telehealth: "telehealth_consult",
    telehealth_visit: "telehealth_consult",
    video_visit: "telehealth_consult",
    endo_pain_evaluation: "complex_pelvic_pain_evaluation",
    pelvic_pain: "complex_pelvic_pain_evaluation",
    pelvic_pain_followup: "complex_pelvic_pain_followup",
    aub: "aub_evaluation",
    abnormal_uterine_bleeding: "aub_evaluation",
    preop: "preop_visit",
    pre_op: "preop_visit",
    post_op: "postop_early",
    postop: "postop_early",
    annual: "annual_exam",
    well_woman: "annual_exam",
    omt: "omt_treatment",
    procedure: "office_procedure",
};

/**
 * Resolve a visit label to a catalog key.
 * Returns { key, via } where via is 'exact' | 'alias' | null.
 */
export function toCatalogKey(rawVisitType, knownKeys = []) {
    const n = normalize(rawVisitType);
    if (!n) return { key: null, via: null };
    const known = new Set(knownKeys.filter(Boolean));
    if (known.has(n)) return { key: n, via: "exact" };
    const aliased = ALIASES[n];
    if (aliased && (known.size === 0 || known.has(aliased))) return { key: aliased, via: "alias" };
    return { key: null, via: null };
}

// E/M code as a last resort. Deliberately coarse and deliberately
// labelled: a 99214 for a complex pelvic pain follow-up is not priced
// the same as a routine one, so this is a floor, not an answer.
export const EM_FALLBACK = {
    "99202": "new_patient_standard", "99203": "new_patient_standard",
    "99204": "new_patient_complex",  "99205": "new_patient_complex",
    "99212": "routine_followup", "99213": "routine_followup",
    "99214": "routine_followup", "99215": "routine_followup",
};

export function fromEmCode(code, knownKeys = []) {
    const key = EM_FALLBACK[String(code || "").trim()];
    if (!key) return { key: null, via: null };
    const known = new Set(knownKeys.filter(Boolean));
    if (known.size && !known.has(key)) return { key: null, via: null };
    return { key, via: "em_code" };
}

export default { normalize, ALIASES, toCatalogKey, EM_FALLBACK, fromEmCode };
