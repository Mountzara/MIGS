// =====================================================================
// functions/_lib/visit_types.js — canonical visit-type catalog
// =====================================================================
// Per CLAUDE.md §11.7.1. The single source of truth for visit categories
// across:
//   * AI triage (Phase 2.5) — Claude picks one of these keys for each
//     completed intake.
//   * Admin scheduling UI — `allowed_visit_types_json` on availability
//     blocks references these keys.
//   * Patient booking flow (Phase 1+) — slot offerings are filtered by
//     visit type.
//   * Analytics (Phase 5+) — case-mix breakdown groups appointments by
//     visit_type.
//
// Adding/renaming a key requires changing this file (and any code that
// hardcodes a key, ideally none — always import VISIT_TYPES). The order
// below is the recommended display order in the admin UI.
// =====================================================================

export const VISIT_TYPES = [
    {
        key: "new_patient_complex",
        label: "New Patient — Complex",
        duration_min: 60,
        modality_preferred: "in_person",
        category: "new_patient",
        time_of_day: "morning",
        eras_concerns_required: true,
        description: "First visit with any of: endometriosis flag, prior surgery for chronic pelvic pain, multi-system complaint, imaging showing DIE / large fibroids / adenomyosis."
    },
    {
        key: "new_patient_standard",
        label: "New Patient — Standard",
        duration_min: 45,
        modality_preferred: "in_person",
        category: "new_patient",
        time_of_day: "any",
        eras_concerns_required: false,
        description: "First visit, single straightforward complaint, no prior gyn surgery."
    },
    {
        key: "endo_pain_evaluation",
        label: "Complex Pelvic Pain / Endometriosis Evaluation",
        duration_min: 45,
        modality_preferred: "in_person",
        category: "established",
        time_of_day: "morning",
        eras_concerns_required: true,
        description: "Established patient, pain ≥6/10, multi-trigger pain, prior endo surgery, or imaging-suggestive."
    },
    {
        key: "endo_pain_followup",
        label: "Complex Pelvic Pain / Endometriosis Follow-up",
        duration_min: 30,
        modality_preferred: "any",
        category: "established",
        time_of_day: "any",
        eras_concerns_required: false,
        description: "Established patient with endo diagnosis, routine follow-up."
    },
    {
        key: "omt_treatment",
        label: "OMT Treatment",
        duration_min: 30,
        modality_preferred: "in_person",
        category: "procedure",
        time_of_day: "any",
        eras_concerns_required: false,
        description: "In-person osteopathic manipulative treatment session. Clusters preferred — room prep efficiency."
    },
    {
        key: "aub_eval",
        label: "AUB / Heavy Bleeding Evaluation",
        duration_min: 30,
        modality_preferred: "any",
        category: "established",
        time_of_day: "any",
        eras_concerns_required: false,
        description: "Bleeding-dominant complaint, no major pain."
    },
    {
        key: "pre_op",
        label: "Pre-Operative Visit",
        duration_min: 30,
        modality_preferred: "any",
        category: "procedure",
        time_of_day: "any",
        eras_concerns_required: true,
        description: "Within 30 days of scheduled surgery date. Confirms ERAS perioperative hold protocols (GLP-1, anticoagulants)."
    },
    {
        key: "post_op_early",
        label: "Post-Operative Visit — Early (1–2 weeks)",
        duration_min: 20,
        modality_preferred: "any",
        category: "established",
        time_of_day: "any",
        eras_concerns_required: false,
        description: "Within 2 weeks of OR date."
    },
    {
        key: "post_op_late",
        label: "Post-Operative Visit — Late (6 weeks)",
        duration_min: 30,
        modality_preferred: "in_person",
        category: "established",
        time_of_day: "any",
        eras_concerns_required: false,
        description: "4–8 weeks of OR date."
    },
    {
        key: "routine_followup",
        label: "Routine Follow-up",
        duration_min: 20,
        modality_preferred: "any",
        category: "established",
        time_of_day: "afternoon",
        eras_concerns_required: false,
        description: "Established patient, stable on current management, check-in."
    },
    {
        key: "office_procedure",
        label: "Procedure — Office (EMB / Colpo / IUD)",
        duration_min: 30,
        modality_preferred: "in_person",
        category: "procedure",
        time_of_day: "any",
        eras_concerns_required: false,
        description: "Endometrial biopsy, colposcopy, IUD insertion or removal — requires procedure room."
    },
    {
        key: "quick_concern",
        label: "Quick Concern / Sick Visit",
        duration_min: 15,
        modality_preferred: "telehealth",
        category: "established",
        time_of_day: "afternoon",
        eras_concerns_required: false,
        description: "Single acute concern, established patient."
    },
    {
        key: "annual_exam",
        label: "Annual Exam",
        duration_min: 30,
        modality_preferred: "in_person",
        category: "preventive",
        time_of_day: "any",
        eras_concerns_required: false,
        description: "Routine annual gynecologic exam."
    },
    {
        key: "telehealth_consult",
        label: "Telehealth Consult",
        duration_min: 30,
        modality_preferred: "telehealth",
        category: "telehealth",
        time_of_day: "any",
        eras_concerns_required: false,
        description: "Telehealth-only visit; transportation-barrier flag from SDOH."
    },
];

const KEY_INDEX = new Map(VISIT_TYPES.map((v) => [v.key, v]));

export function getVisitType(key) {
    return KEY_INDEX.get(key) || null;
}

export function isValidVisitTypeKey(key) {
    return KEY_INDEX.has(key);
}

/**
 * For UI dropdowns + JSON API responses. Returns an array with only the
 * fields the client UI needs (no internal flags).
 */
export function visitTypeOptions() {
    return VISIT_TYPES.map(({ key, label, duration_min, modality_preferred, category, time_of_day, description }) => ({
        key, label, duration_min, modality_preferred, category, time_of_day, description,
    }));
}
