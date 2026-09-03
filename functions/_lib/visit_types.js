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
        requires_chaperone: true,
        chaperone_rationale: "Complex CBG/MIGS new-patient visits routinely include pelvic-area history and may include physical examination components. If telehealth is requested, an adult chaperone must be present in the room during any examination portion.",
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
        requires_chaperone: false,
        chaperone_rationale: "Standard new-patient visits are history-focused; physical examination components, if any, are deferred to a clearly indicated in-person follow-up.",
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
        requires_chaperone: true,
        chaperone_rationale: "Complex pelvic-pain evaluation may require tender-point assessment of the pelvic floor and abdominal wall; tenderness assessment over telehealth requires another person in the room.",
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
        requires_chaperone: false,
        chaperone_rationale: "Routine follow-up on a stable management plan is symptom-tracking and counseling; physical examination is not the primary diagnostic lever and is deferred to a clearly indicated in-person re-evaluation visit.",
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
        requires_chaperone: true,
        chaperone_rationale: "OMT (osteopathic manipulative treatment) involves hands-on physical contact and is in-person only. Where intimate-region techniques are part of the protocol, clinical workflow requires a chaperone.",
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
        requires_chaperone: false,
        chaperone_rationale: "AUB evaluation is history-focused (bleeding pattern, products used, cycle characteristics, anemia screen). Pelvic exam, if indicated, is deferred to a separate in-person follow-up visit.",
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
        requires_chaperone: false,
        chaperone_rationale: "Pre-operative visits confirm ERAS perioperative protocols, review consent, and answer surgical questions. Physical examination is not the purpose of the visit.",
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
        requires_chaperone: false,
        chaperone_rationale: "Early post-operative follow-up is a recovery-tracking check-in (incision check via video, symptom screen, medication confirmation). No GU exam is performed; if symptoms warrant intimate examination, a separate in-person visit is scheduled.",
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
        requires_chaperone: true,
        chaperone_rationale: "Six-week post-operative visit may include pelvic examination to confirm healing after gynecologic surgery; a chaperone is required for any GU exam component.",
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
        requires_chaperone: false,
        chaperone_rationale: "Routine follow-up is symptom-tracking and counseling for a stable management plan. Physical examination, if newly indicated, prompts conversion to an in-person evaluation visit.",
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
        requires_chaperone: true,
        chaperone_rationale: "Endometrial biopsy, colposcopy, and IUD insertion/removal are all intimate-region office procedures. Clinical workflow always involves a chaperone; this visit type is in-person only.",
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
        requires_chaperone: false,
        chaperone_rationale: "Quick-concern visits are single-issue history-and-counseling encounters. If physical examination is indicated by the conversation, the visit is converted to in-person and the chaperone rule applies to the new visit.",
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
        requires_chaperone: true,
        chaperone_rationale: "Annual gynecologic exam includes breast and pelvic examination; chaperone is required and the visit is in-person only.",
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
        requires_chaperone: false,
        chaperone_rationale: "Telehealth-only consult is by definition history-and-counseling. Any physical-examination indication that surfaces during the visit prompts conversion to a separate in-person visit.",
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
 * fields the client UI needs (no internal flags). Includes the chaperone
 * fields so the patient-booking flow can present the chaperone-required
 * confirmation step at the right moment.
 */
export function visitTypeOptions() {
    return VISIT_TYPES.map(({ key, label, duration_min, modality_preferred, category, time_of_day, description, requires_chaperone, chaperone_rationale }) => ({
        key, label, duration_min, modality_preferred, category, time_of_day, description,
        requires_chaperone: !!requires_chaperone,
        chaperone_rationale: chaperone_rationale || "",
    }));
}

/**
 * Convenience predicate for booking + triage code paths.
 * Returns true if the visit type requires a chaperone, false otherwise
 * (including for unknown keys — caller should validate the key first).
 */
export function requiresChaperone(key) {
    const v = KEY_INDEX.get(key);
    return !!(v && v.requires_chaperone);
}

/**
 * What AI triage writes when it cannot decide. It is deliberately NOT a
 * member of VISIT_TYPES, so `isValidVisitTypeKey()` rejects it — that is
 * the property every guard depends on.
 *
 * It lives here rather than in a cron endpoint because three unrelated
 * places need it: the triage writer, the auto-release hold, and the
 * release validator. Reaching across the tree for it is how one of them
 * ends up with a stale copy.
 */
export const MANUAL_REVIEW_PLACEHOLDER = "manual_review_required";
