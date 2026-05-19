// =====================================================================
// functions/_lib/care_goals_mapper.js
// =====================================================================
// Maps the intake Section 4 (chief_gynecologic_complaint) payload's
// "Treatment Goals & Expectations" sub-fields into the canonical
// care_goals_json shape stored on patients.care_goals_json.
//
// Section 4 schema (observed against a real Jane Doe intake, 2026-05-19):
//   {
//     ...complaint + bleeding + pain + mass fields...
//     goal_eliminate_pain:      bool,
//     goal_reduce_bleeding:     bool,
//     goal_preserve_fertility:  bool,
//     goal_avoid_hysterectomy:  bool,
//     goal_improve_qol:         bool,
//     goal_return_to_work:      bool,
//     treatment_preference:     'conservative' | 'definitive' | 'unsure',
//     treatments_avoid_text:    string?,   // §11.6 spec field; optional in wizard
//     questions_for_surgeon:    string?,   // §11.6 spec field; optional in wizard
//   }
// =====================================================================

// Human-readable labels for each goal flag.
const GOAL_LABELS = {
    goal_eliminate_pain:      "Eliminate pain",
    goal_reduce_bleeding:     "Reduce bleeding",
    goal_preserve_fertility:  "Preserve fertility",
    goal_avoid_hysterectomy:  "Avoid hysterectomy if possible",
    goal_improve_qol:         "Improve quality of life",
    goal_return_to_work:      "Return to work / school",
};

const TREATMENT_PREFERENCE_LABEL = {
    conservative: "Prefers conservative management first",
    definitive:   "Prefers definitive surgical management",
    unsure:       "Treatment preference: unsure / wants to discuss",
};


/**
 * Build a care_goals_json object from a Section 4 data_json blob.
 * Returns null if no goal-related fields were captured (so callers can skip
 * patching the row when intake didn't touch goals).
 *
 * @param {object} section4 - parsed Section 4 data_json
 * @returns {object|null} - shape: { goals[], preferences[], avoid[], notes }
 */
export function buildCareGoalsFromSection4(section4) {
    if (!section4 || typeof section4 !== "object") return null;

    const goals = [];
    for (const [key, label] of Object.entries(GOAL_LABELS)) {
        if (section4[key] === true) goals.push(label);
    }

    const preferences = [];
    const tp = section4.treatment_preference;
    if (typeof tp === "string" && TREATMENT_PREFERENCE_LABEL[tp]) {
        preferences.push(TREATMENT_PREFERENCE_LABEL[tp]);
    }

    const avoid = [];
    if (typeof section4.treatments_avoid_text === "string"
        && section4.treatments_avoid_text.trim()) {
        // Split on commas / semicolons / newlines so multi-item entries become
        // separate items the briefing UI can chip-render.
        const items = section4.treatments_avoid_text
            .split(/[,;\n]+/)
            .map((s) => s.trim())
            .filter(Boolean);
        avoid.push(...items.slice(0, 20));
    }

    const notes = typeof section4.questions_for_surgeon === "string"
        ? section4.questions_for_surgeon.trim().slice(0, 1200)
        : "";

    // Nothing captured → return null so caller can skip the write.
    if (!goals.length && !preferences.length && !avoid.length && !notes) return null;

    return { goals, preferences, avoid, notes };
}


/**
 * Decide whether to overwrite an existing care_goals_json on a patient row
 * with a freshly-derived value from intake.
 *
 * Rule: if the clinician has manually edited care_goals AFTER the intake was
 * submitted (care_goals_updated_at > intake.submitted_at), DO NOT overwrite.
 * Otherwise the intake-derived value wins.
 *
 * @param {object} opts
 * @param {number|null} opts.care_goals_updated_at — ms epoch from patients row
 * @param {number|null} opts.intake_submitted_at  — ms epoch from intake row
 * @returns {boolean}
 */
export function shouldOverwriteCareGoals({ care_goals_updated_at, intake_submitted_at }) {
    if (!care_goals_updated_at) return true;         // patient row empty → overwrite
    if (!intake_submitted_at)   return false;        // can't decide → don't clobber
    return intake_submitted_at >= care_goals_updated_at;
}
