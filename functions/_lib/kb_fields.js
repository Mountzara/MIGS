// =====================================================================
// kb_fields.js — the KB's own structure, and which part answers which task
// =====================================================================
// THIS IS NOT A NEW DESIGN. It is the structure the MedicalTranscription
// app's KB chunks already have, carried through to the website instead of
// being thrown away.
//
// ---------------------------------------------------------------------
// WHAT WAS LOST
// ---------------------------------------------------------------------
// Each KB document in the app is a structured record — an abstract, a
// clinical summary, counseling points written FOR PATIENTS, critical
// thresholds, decision points, safety considerations, a management
// algorithm. Different fields exist because they answer different
// questions, and the app uses them accordingly.
//
// `scripts/kb_load_d1.py::build_text()` concatenated all fifteen fields
// into one unlabelled blob, truncated at 8,000 characters, and loaded that
// single `text` column into the D1 FTS index. Every distinction was gone.
//
// The consequence was visible the first time grounding ran against live
// data: a draft reply to a PATIENT retrieved "Device-related malfunctions
// and associated patient harm in robotic-assisted surgery" — a JMIG device-
// safety paper. Perfectly real, perfectly in the library, and exactly the
// wrong part of it. What a patient reply needs is
// `patientCounselingPoints`; what a triage safety flag needs is
// `criticalThresholds`. Bag-of-words over a flattened blob cannot tell
// those apart, because in the blob they are the same field.
//
// ---------------------------------------------------------------------
// THE MAPPING
// ---------------------------------------------------------------------
// Each clinical task retrieves from the fields that actually answer it,
// in priority order. This is the app's own semantics, not an invention:
// the field names carry their purpose.
// =====================================================================

/** Every field the app's KB chunks carry, and what it is for. */
export const KB_FIELDS = {
    abstract:                 "the source document's own abstract",
    clinicalSummary:          "the clinical bottom line",
    backgroundSummary:        "background and pathophysiology",
    summaryOfRecommendations: "what the guideline actually recommends",
    complications:            "what can go wrong",
    keyPoints:                "the points worth remembering",
    clinicalPearls:           "practical points from practice",
    teachingPoints:           "how it is taught",
    patientCounselingPoints:  "what to say TO A PATIENT",
    oralBoardPearls:          "board-examination framing",
    criticalThresholds:       "the numbers that change management",
    decisionPoints:           "where the decision forks",
    clinicalTopics:           "the topics this document covers",
    safetyConsiderations:     "safety caveats",
    managementAlgorithm:      "the stepwise plan",
};

/**
 * Which fields answer which task, most relevant first.
 *
 * The ordering matters: retrieval takes the earlier fields preferentially,
 * so a patient-facing draft is built out of counseling language rather
 * than out of an abstract that happens to share vocabulary.
 */
export const TASK_FIELDS = {
    // What we say TO a patient. Counseling points first — they are
    // literally the field for this — then the clinical bottom line, then
    // background for explaining what something is.
    message_draft: [
        "patientCounselingPoints", "clinicalSummary", "summaryOfRecommendations",
        "backgroundSummary", "keyPoints",
    ],

    // The after-visit summary the patient reads. Same shape, but
    // `managementAlgorithm` matters more because the summary states a plan.
    visit_summary: [
        "patientCounselingPoints", "clinicalSummary", "managementAlgorithm",
        "backgroundSummary", "summaryOfRecommendations",
    ],

    // Goes to ANOTHER CLINICIAN under his name, so it speaks their
    // language: recommendations, decision points, thresholds.
    visit_prep: [
        "summaryOfRecommendations", "decisionPoints", "keyPoints",
        "criticalThresholds", "clinicalTopics", "clinicalSummary",
    ],

    // Triage is a safety net before it is a scheduler. The fields that
    // matter are the ones that say "this needs attention now".
    intake_triage: [
        "criticalThresholds", "safetyConsiderations", "decisionPoints",
        "complications", "managementAlgorithm", "clinicalSummary",
    ],

    // Instrument selection is a topical question.
    prom_recommender: [
        "clinicalTopics", "keyPoints", "clinicalSummary",
    ],
};

/** Fields for a task, falling back to a sane general set. */
export function fieldsForTask(kind) {
    return TASK_FIELDS[kind] || [
        "clinicalSummary", "summaryOfRecommendations", "keyPoints", "abstract",
    ];
}

/**
 * Human-readable label for a field, used when a citation is shown to him
 * so "where did this come from" has an answer more useful than a doc id.
 */
export function fieldLabel(field) {
    return KB_FIELDS[field] || field;
}

/**
 * Is the structured index available? The website can run against either:
 *   * `kb_sections` — one row per (document, field), which is what makes
 *     field-aware retrieval possible;
 *   * `kb_docs` — the original flattened index, which still works but
 *     cannot distinguish counseling language from a device-safety paper.
 *
 * Checked at runtime rather than assumed, because loading `kb_sections`
 * requires running scripts/kb_load_d1.py from the machine that holds the
 * KB chunks, and the site must not break in the interval.
 */
export async function hasSectionIndex(env) {
    if (!env?.DB) return false;
    try {
        const r = await env.DB.prepare(
            "SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name = 'kb_sections' LIMIT 1"
        ).first();
        return Boolean(r);
    } catch {
        return false;
    }
}

export default { KB_FIELDS, TASK_FIELDS, fieldsForTask, fieldLabel, hasSectionIndex };
