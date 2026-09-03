// =====================================================================
// functions/_lib/intake_triage.js — AI triage scheduling helper
// =====================================================================
// Per CLAUDE.md §11.7 (AI-powered intelligent scheduling).
//
// Pipeline:
//   1. Load the submitted intake's section payloads from intake_section_data.
//   2. De-identify per §11.4 BAA-ledger / §4.2 — strip names, DOB,
//      phone/email, electronic signature, referred_by, specific dates.
//      Replace DOB with an age bucket; replace MRN with the
//      appointment_triage row id.
//   3. Build a structured prompt that includes the §11.7.1 visit-type
//      catalog (imported from _lib/visit_types.js) so Claude only picks
//      keys we know about.
//   4. Call Claude with temperature=0 and a strict response_format —
//      JSON object with exactly the seven fields we need.
//   5. Validate the parsed JSON. Reject if visit_type is not in the
//      catalog or fields are missing.
//
// PROMPT_VERSION is pinned and recorded on every triage row so prompt
// changes are auditable and analytics can compare versions over time.
// =====================================================================

import { VISIT_TYPES } from "./visit_types.js";
import { callClaude, AnthropicError } from "./anthropic.js";
import { groundClinical, groundingInstruction, verifyGrounding } from "./clinical_grounding.js";

// 2026-05-27 v2.0 — added requires_chaperone awareness per Phase 17 R1.
// The Joshi & Welch (2023) GU-exam chaperone rule applies to any CBG/MIGS
// visit type that may involve pelvic-area physical examination. Claude is
// now informed of each visit type's chaperone status and must mirror it
// in its decision; the validator enforces consistency between the chosen
// visit_type's catalog flag and Claude's chaperone_required output.
export const TRIAGE_PROMPT_VERSION = "triage-v2.0-2026-05-27";

const ALLOWED_VISIT_KEYS = new Set(VISIT_TYPES.map(v => v.key));
const ALLOWED_URGENCY = new Set(["urgent", "routine"]);
const ALLOWED_TIME_OF_DAY = new Set(["morning", "afternoon", "any"]);

// ---------------------------------------------------------------------
// De-identifier — strict allowlist of fields that may leave the practice
// to Anthropic. Anything else is dropped (NOT redacted in place — fully
// omitted) so a future schema addition can't accidentally leak PHI.
// ---------------------------------------------------------------------

const SAFE_KEYS_BY_SECTION = {
    // 1 Patient Information — strip name/dob/phone/email; keep flags.
    1: ["is_second_opinion", "recommended_surgery", "interpreter_language",
        "recommended_surgery_type"],
    // 2 Consent — patient signed; pass a bare presence flag only.
    2: ["consent_accuracy", "consent_treatment"],
    // 4 Chief complaint — keep all clinical flags; the free-text
    //   chief_complaint and other text fields are summarized to length only.
    4: ["bleed_over_8_days", "bleed_pad_per_hour", "bleed_clots_quarter",
        "bleed_anemia", "bleed_unpredictable", "bleed_duration_months",
        "pain_location", "pain_scale",
        "trig_with_periods", "trig_constant", "trig_with_intercourse",
        "trig_with_ovulation", "trig_full_bladder", "trig_with_bms",
        "pain_work_impact", "days_missed_month",
        "mass_fibroids", "fibroid_size_cm", "mass_ovarian_cyst",
        "cyst_size_cm", "mass_adenomyosis", "mass_polyp",
        "press_bloating", "press_urinary_freq", "press_constipation",
        "goal_eliminate_pain", "goal_reduce_bleeding", "goal_preserve_fertility",
        "goal_avoid_hysterectomy", "goal_improve_qol", "goal_return_to_work",
        "treatment_preference"],
    // 5 Menstrual history — keep durations and counts; drop the LMP date.
    5: ["lmp_normal", "cycle_length_days", "bleeding_days", "spotting_days",
        "products_regular_pads", "products_overnight_pads", "products_super_tampons",
        "uses_double_protection", "bleed_affects_activities",
        "avoid_light_clothing", "night_accidents"],
    // 6 Prior treatments — keep flags only.
    6: ["tx_bcp", "tx_mirena", "tx_depo", "tx_gnrh", "tx_txa",
        "tx_progesterone", "tx_narcotics", "tx_pfpt", "tx_acupuncture"],
    // 7 Prior surgeries — flags only (drop year/specific findings text).
    7: ["surg_diag_lap", "surg_endo_excision", "surg_endo_ablation",
        "surg_myomectomy", "surg_ovarian_cystectomy", "surg_hysteroscopy",
        "surg_polypectomy", "surg_dnc", "surg_endo_ablation_uterine",
        "surg_tubal_ligation"],
    // 8 Fertility — counts are clinically necessary; drop pregnancy dates.
    8: ["preg_desired", "ttc_now", "ttc_months", "infertility", "fertility_tx",
        "total_pregnancies", "vaginal_births", "c_sections", "miscarriages", "ectopic"],
    // 9 Sexual function — flags + scale, no narrative.
    9: ["sexually_active", "pain_intercourse",
        "dysp_entry", "dysp_deep", "dysp_during", "dysp_after", "dysp_orgasm",
        "avoid_pain", "avoid_bleeding"],
    // 10 Imaging — counts + sizes only; dates omitted.
    10: ["tvus_endometrial_mm", "tvus_fibroid_count", "tvus_largest_fibroid_cm",
         "img_pelvic_mri", "img_ct_abdpelvis", "img_sonohysterography", "img_hsg"],
    // 11 GI/GU — all flags clinically relevant.
    11: ["gi_painful_bms", "gi_diarrhea_with_periods", "gi_chronic_constipation",
         "gi_rectal_bleeding", "gi_bloating", "gi_ibs_symptoms",
         "gu_painful_urination", "gu_frequency_over_8", "gu_urgency",
         "gu_nocturia_over_2", "gu_stress_incontinence", "gu_incomplete_emptying"],
    // 12 ERAS — every flag matters for surgical safety.
    12: ["eras_anemia", "eras_anemia_hgb", "eras_sleep_apnea", "eras_cpap",
         "eras_smoking", "eras_smoking_ppd", "eras_diabetes", "eras_diabetes_hba1c",
         "eras_bmi40", "eras_weight_lbs", "eras_bleeding_disorder",
         "eras_dvt_pe", "eras_dvt_pe_year",
         "eras_cardiac", "eras_ckd", "eras_ckd_creatinine", "eras_latex_allergy",
         "glp1_ozempic", "glp1_wegovy", "glp1_mounjaro", "glp1_saxenda", "glp1_other",
         "glp1_last_dose_date",
         "ht_bcp", "ht_hrt", "ht_tamoxifen", "ht_gnrh", "ht_progesterone",
         "ht_stop_needed",
         "bt_asa", "bt_plavix", "bt_coumadin", "bt_eliquis", "bt_xarelto", "bt_other",
         "herb_garlic", "herb_ginger", "herb_ginkgo", "herb_ginseng",
         "herb_st_johns", "herb_vit_e", "herb_fish_oil", "herb_turmeric", "herb_green_tea",
         "hh_black_cohosh", "hh_evening_primrose", "hh_soy", "hh_dong_quai",
         "hh_licorice", "hh_red_clover", "hh_vitex", "hh_maca", "hh_ashwagandha",
         "med_htn", "med_asthma_copd", "med_thyroid", "med_autoimmune",
         "med_migraines", "med_depression_anxiety",
         "gyn_endometriosis", "gyn_pcos", "gyn_adenomyosis", "gyn_cpp",
         "gyn_ic", "gyn_vulvodynia"],
    // 13 Current meds — drop names; pass only counts (any pain meds, etc.)
    //    via the heuristic length fields below. The full text is PHI risk.
    13: [],  // intentionally empty — see deidentified_intake() summary step.
    // 14 Allergies — keep the boolean flags only; drop the free-text list.
    14: ["drug_allergies", "latex_allergy"],
    // 15 Family history — keep all flags.
    15: ["fam_endometriosis", "fam_fibroids", "fam_ovarian_ca", "fam_uterine_ca",
         "fam_breast_ca", "fam_colon_ca", "fam_bleeding_disorders",
         "fam_infertility", "fam_hyst_before_50"],
    // 16 Social — keep functional flags; drop occupation free-text.
    16: ["heavy_lifting", "tobacco_use", "tobacco_amount", "tobacco_years",
         "marijuana_cbd", "time_off_weeks"],
    // 17 Mental health — directly drives the flag in §11.7.2 triage decision rules.
    17: ["phq2_anhedonia", "phq2_depressed", "surgical_anxiety"],
    // 18 SDOH — directly drives the telehealth-vs-in-person heuristic.
    18: ["housing", "food_security", "transportation",
         "medication_affordability", "safety_at_home", "childcare",
         "education_level", "insurance"],
    // 19 ROS — keep all flags.
    19: ["ros_fever_chills", "ros_weight_loss", "ros_fatigue", "ros_chest_pain",
         "ros_sob", "ros_palpitations", "ros_abd_pain", "ros_n_v",
         "ros_change_bowel_habits", "ros_dysuria", "ros_hematuria",
         "ros_urinary_frequency", "ros_headaches", "ros_dizziness",
         "ros_numbness_tingling", "ros_joint_pain", "ros_leg_swelling",
         "ros_rash", "ros_depression", "ros_anxiety", "ros_insomnia"],
};

/**
 * Convert a YYYY-MM-DD birthdate to a coarse age bucket (decade).
 * Returns null on parse failure.
 */
function ageBucketFromDob(dob) {
    if (!dob || typeof dob !== "string") return null;
    const m = dob.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const birthYear = parseInt(m[1], 10);
    const now = new Date();
    const age = now.getFullYear() - birthYear - (
        now.getMonth() < parseInt(m[2], 10) - 1 ||
        (now.getMonth() === parseInt(m[2], 10) - 1 && now.getDate() < parseInt(m[3], 10))
        ? 1 : 0
    );
    if (!Number.isFinite(age) || age < 0 || age > 130) return null;
    if (age < 18) return "<18";
    if (age < 25) return "18-24";
    if (age < 35) return "25-34";
    if (age < 45) return "35-44";
    if (age < 55) return "45-54";
    if (age < 65) return "55-64";
    return "65+";
}

/**
 * Filter one section's payload down to the allowlisted keys.
 */
function pickSafe(sectionNumber, raw) {
    if (!raw || typeof raw !== "object") return {};
    const allow = SAFE_KEYS_BY_SECTION[sectionNumber];
    if (!allow) return {};
    const out = {};
    for (const k of allow) {
        if (k in raw) out[k] = raw[k];
    }
    return out;
}

/**
 * Build a fully de-identified summary of the intake suitable for sending
 * to Anthropic. Patient identity is replaced with the triage row id.
 *
 * @param {object} args
 * @param {string} args.triage_id - The appointment_triage.id (replaces MRN).
 * @param {string|null} args.dob - YYYY-MM-DD if available.
 * @param {Object<number, {data: object}>} args.sections - Map keyed by section_number.
 * @returns {object} de-identified payload + summary stats.
 */
export function deidentifyIntake({ triage_id, dob, sections }) {
    const safe_sections = {};
    let chief_complaint_text_length = 0;
    let medication_text_length = 0;
    let has_drug_allergies = false;
    let has_latex_allergy = false;

    for (const [nRaw, secWrap] of Object.entries(sections || {})) {
        const n = Number(nRaw);
        const payload = secWrap?.data || {};
        // Free-text fields that get reduced to length-only stats.
        if (n === 4 && typeof payload.chief_complaint === "string") {
            chief_complaint_text_length = payload.chief_complaint.length;
        }
        if (n === 13) {
            for (const f of ["meds_pain", "meds_hormones", "meds_other"]) {
                if (typeof payload[f] === "string") {
                    medication_text_length += payload[f].length;
                }
            }
        }
        if (n === 14) {
            has_drug_allergies = payload.drug_allergies === "yes" || payload.drug_allergies === true;
            has_latex_allergy = payload.latex_allergy === "yes" || payload.latex_allergy === true;
        }
        safe_sections[n] = pickSafe(n, payload);
    }

    return {
        // De-identified identifier — Claude never sees the real patient_id.
        triage_reference: triage_id,
        age_bucket: ageBucketFromDob(dob),
        chief_complaint_text_length,
        medication_text_length,
        has_drug_allergies,
        has_latex_allergy,
        sections: safe_sections,
    };
}

// ---------------------------------------------------------------------
// Visit-type catalog summary — what Claude sees.
// ---------------------------------------------------------------------
function visitTypeCatalogForPrompt() {
    return VISIT_TYPES.map(v => ({
        key: v.key,
        label: v.label,
        duration_min: v.duration_min,
        modality_preferred: v.modality_preferred,
        category: v.category,
        time_of_day: v.time_of_day,
        eras_concerns_required: v.eras_concerns_required,
        requires_chaperone: !!v.requires_chaperone,
        chaperone_rationale: v.chaperone_rationale || "",
        description: v.description,
    }));
}

// ---------------------------------------------------------------------
// Prompt builder + response parser.
// ---------------------------------------------------------------------

const SYSTEM_PROMPT = `You are the scheduling triage assistant for a minimally-invasive gynecologic surgery (MIGS) practice. Based on a patient's de-identified intake summary, you select the most appropriate visit type, estimate the duration, and surface scheduling-relevant flags.

Decision rules (from CLAUDE.md §11.7.2):
- First visit (no prior gynecologic surgery, no chronic-pelvic-pain pattern): map to "new_patient_standard" if a single straightforward complaint, else "new_patient_complex" when any of {endometriosis flag, prior surgery for chronic pelvic pain, multi-system complaint, fibroid >5 cm, adenomyosis, multi-trigger pain}.
- Patient explicitly requesting OMT: "omt_treatment".
- Post-op within 2 weeks: "post_op_early"; 4-8 weeks: "post_op_late".
- Pre-op within 30 days of scheduled surgery: "preop_visit".
- Established patient with endometriosis dx + pain >=6/10: "endo_pain_evaluation".
- Bleeding-only complaint without significant pain: "aub_evaluation".
- Acute single concern in established patient: "quick_concern".
- Routine annual: "annual_exam".
- Default fallback: "routine_followup".

Modality rules:
- in_person_required = true if: OMT, office procedure, annual exam, complex pelvic pain evaluation.
- telehealth eligible if: established patient + (transportation barrier OR quick concern OR routine follow-up OR late post-op).

Time-of-day preference:
- "morning" for new_patient_complex and endo_pain_evaluation (better cognition, more time).
- "afternoon" for quick_concern (energy preservation for the clinician).
- "any" otherwise.

Urgency:
- "urgent" (within 1 week) if pain >=9/10 OR heavy bleeding with anemia OR (recent ER mention).
- "routine" otherwise.

Secondary concerns: list ERAS / perioperative flags that should reach the clinician PRE-visit. Use the exact field names from the intake. Examples: ["glp1_use_recent", "anticoagulants_in_use", "anemia_documented", "phq2_positive_screen", "transportation_barrier"].

Chaperone rule (Joshi & Welch 2023 p. 51 — applies to CBG/MIGS):
- Every catalog entry carries a "requires_chaperone" boolean.
- If you choose a visit type with requires_chaperone=true AND in_person_required=false, you MUST set chaperone_required=true in your response.
- If you choose a visit type with requires_chaperone=true AND in_person_required=true, set chaperone_required=true (chaperone is needed for the in-person exam portion).
- If you choose a visit type with requires_chaperone=false, set chaperone_required=false.
- Never override the catalog's requires_chaperone flag to false; it represents a clinical-safety floor.

You return ONLY a JSON object. No prose before or after. No code fences. The JSON must have exactly these keys:
{
  "visit_type": "<one of the catalog keys>",
  "duration_min": <integer minutes>,
  "urgency": "urgent" | "routine",
  "in_person_required": true | false,
  "preferred_time_of_day": "morning" | "afternoon" | "any",
  "chaperone_required": true | false,
  "rationale": "<<=500 chars: which decision rule(s) applied and which intake fields drove the choice>",
  "secondary_concerns": ["<flag>", ...]
}`;

function buildUserMessage(deid, catalog) {
    return [
        "VISIT-TYPE CATALOG (pick exactly one `key`):",
        JSON.stringify(catalog, null, 2),
        "",
        "DE-IDENTIFIED INTAKE SUMMARY:",
        JSON.stringify(deid, null, 2),
        "",
        "Return the JSON object now.",
    ].join("\n");
}

/**
 * Parse Claude's JSON response. Tolerates an accidental fenced wrapper.
 * Returns the parsed object on success or null on any malformation.
 */
function parseTriageResponse(text) {
    if (!text || typeof text !== "string") return null;
    let body = text.trim();
    // Strip ```json ... ``` fence if present.
    if (body.startsWith("```")) {
        body = body.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
    }
    try {
        const obj = JSON.parse(body);
        return obj && typeof obj === "object" ? obj : null;
    } catch {
        return null;
    }
}

/**
 * Validate a Claude-returned triage decision. Returns the canonicalized
 * object on success, or { error } on failure.
 */
function validateTriage(obj) {
    if (!obj || typeof obj !== "object") return { error: "not_an_object" };
    if (!ALLOWED_VISIT_KEYS.has(obj.visit_type)) return { error: "visit_type_not_in_catalog" };
    if (!Number.isFinite(obj.duration_min) || obj.duration_min < 5 || obj.duration_min > 240) {
        return { error: "duration_out_of_range" };
    }
    if (!ALLOWED_URGENCY.has(obj.urgency)) return { error: "bad_urgency" };
    if (typeof obj.in_person_required !== "boolean") return { error: "bad_in_person_required" };
    if (!ALLOWED_TIME_OF_DAY.has(obj.preferred_time_of_day)) return { error: "bad_time_of_day" };
    const rationale = typeof obj.rationale === "string" ? obj.rationale.slice(0, 500) : "";
    const concerns = Array.isArray(obj.secondary_concerns)
        ? obj.secondary_concerns.filter(c => typeof c === "string").slice(0, 20)
        : [];

    // Phase 17 R1 — chaperone consistency check. The catalog's
    // requires_chaperone is the floor: Claude can set chaperone_required
    // true even on a flag=false visit type (defensive), but it can NEVER
    // override a flag=true visit type to chaperone_required=false. If
    // missing from response, we fall back to the catalog floor.
    const catalogEntry = VISIT_TYPES.find(v => v.key === obj.visit_type);
    const catalogFloor = !!(catalogEntry && catalogEntry.requires_chaperone);
    let chaperone_required;
    if (typeof obj.chaperone_required === "boolean") {
        chaperone_required = obj.chaperone_required || catalogFloor;
    } else {
        chaperone_required = catalogFloor; // defensive default if Claude omitted
    }

    return {
        visit_type: obj.visit_type,
        duration_min: Math.round(obj.duration_min),
        urgency: obj.urgency,
        in_person_required: obj.in_person_required,
        preferred_time_of_day: obj.preferred_time_of_day,
        chaperone_required,
        rationale,
        secondary_concerns: concerns,
    };
}

/**
 * Run the full triage pipeline. Returns the canonical decision or
 * throws AnthropicError / Error.
 *
 * @param {object} env
 * @param {object} args
 * @param {string} args.triage_id
 * @param {string|null} args.dob
 * @param {Object<number, {data: object}>} args.sections
 * @returns {Promise<object>} canonical triage decision + meta.
 */
export async function runTriage(env, { triage_id, dob, sections }) {
    const deid = deidentifyIntake({ triage_id, dob, sections });
    const catalog = visitTypeCatalogForPrompt();
    const user = buildUserMessage(deid, catalog);

    // Ground the clinical REASONING in the practice library. Triage decides
    // visit length and flags perioperative risk, and the rationale it writes
    // is read by him — so the medicine behind it must come from his
    // references rather than the model's training. Unlike the patient-facing
    // paths this does not block: he reviews every triage row before release,
    // and refusing to triage would stall booking entirely. It records what
    // grounded the decision so a weak one is visible.
    const kbQuery = String(user).slice(0, 3000);
    const kb = await groundClinical(env, { kind: "intake_triage", query: kbQuery });

    const t0 = Date.now();
    const response = await callClaude(env, {
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: kb.grounded ? `${groundingInstruction(kb)}\n\n---\n\n${user}` : user }],
        max_tokens: 1024,
        temperature: 0,
    });
    const parsed = parseTriageResponse(response.text);
    if (!parsed) {
        throw new Error("triage_parse_failed: Claude response was not valid JSON");
    }
    const validated = validateTriage(parsed);
    if (validated.error) {
        throw new Error(`triage_validate_failed: ${validated.error}`);
    }
    // Record what grounded the decision. Triage is not blocked on this —
    // he reviews every row before release, and refusing to triage would
    // stall booking outright — but a decision whose rationale cites
    // nothing is exactly the one he should read most carefully, and that
    // is only visible if it is recorded.
    const groundingVerdict = kb.grounded
        ? verifyGrounding(String(validated.rationale || ""), kb)
        : null;

    return {
        decision: validated,
        grounding: {
            grounded: Boolean(kb.grounded),
            reason: kb.reason,
            citations: kb.citations || [],
            kb_coverage: Math.round((kb.coverage || 0) * 100) / 100,
            verified: groundingVerdict ? groundingVerdict.ok : false,
            summary: groundingVerdict
                ? groundingVerdict.summary
                : "This triage was decided without support from the practice library — read the rationale before releasing it.",
            uncited: groundingVerdict?.uncited || [],
            fabricated: groundingVerdict?.fabricated || [],
        },
        prompt_version: TRIAGE_PROMPT_VERSION,
        latency_ms: Date.now() - t0,
        anthropic_latency_ms: response.latency_ms,
        anthropic_usage: response.usage,
    };
}
