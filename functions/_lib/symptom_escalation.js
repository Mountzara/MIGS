// =====================================================================
// symptom_escalation.js — decide when a diary entry needs attention
// =====================================================================
// This module exists because the inline version of this logic was wrong
// in three ways at once, and every one of them was silent.
//
//   1. THE BLEEDING TRIGGERS NEVER FIRED. They tested for the keys
//      `bleeding_pad_hour`, `bleeding_flooding` and
//      `bleeding_clots_quarter`. None of those exist. The real keys are
//      `bleeding_pads_per_hour`, `flooding_episodes` and
//      `clots_quarter_size_plus`. A patient logging twelve soaked pads an
//      hour with quarter-sized clots produced an event bucketed as
//      routine "info", sitting in the clinician's panel next to "Patient
//      logged symptom diary".
//
//   2. THE PHQ-2 TRIGGERS NEVER FIRED EITHER, for the same reason —
//      `mood_phq_q1` and `mood_phq_q2` are not in the catalogue.
//
//   3. THE GENERIC RULE WAS BACKWARDS FOR HALF THE SCALES. It escalated
//      any numeric_0_10 value >= 9. But `mood_0_10` is documented "0 =
//      very low, 10 = great", and so are sleep quality and sexual desire.
//      So a patient having a genuinely good day raised an URGENT alert,
//      and a patient reporting mood 1/10 raised nothing at all. Wrong in
//      both directions: false alarms that teach the clinician to ignore
//      the panel, and silence exactly where silence is dangerous.
//
// THE FIX IS TO MAKE DIRECTION EXPLICIT. Every 0-10 scale is classified
// as HIGH_IS_WORSE or LOW_IS_WORSE, and `assertCatalogCoverage()` fails
// the test suite if the catalogue ever gains a scale nobody classified —
// so the next symptom added cannot quietly inherit the wrong direction.
// Same for the named keys: they are checked against the live catalogue
// rather than trusted, because that is precisely what went wrong.
// =====================================================================

/** 0-10 scales where a HIGH number is the concerning end. */
export const HIGH_IS_WORSE = new Set([
    "pelvic_pain_0_10",
    "dyspareunia_0_10",
    "anxiety_0_10",
    "bloating_0_10",
    "urinary_urgency_0_10",
    "work_school_impact_0_10",
]);

/** 0-10 scales where a LOW number is the concerning end. */
export const LOW_IS_WORSE = new Set([
    "mood_0_10",
    "sleep_quality_0_10",
    "sexual_desire_0_10",
]);

/**
 * Bleeding thresholds, in the catalogue's real keys.
 *
 * Clinical anchors, deliberately conservative — these decide whether a
 * clinician's attention is drawn, not a diagnosis:
 *   * Soaking through 1 pad per hour is the usual definition of heavy
 *     menstrual bleeding; 2+ per hour sustained is the level at which
 *     patients are told to seek same-day care.
 *   * Any flooding episode is worth seeing; several in a day is urgent.
 *   * Clots larger than a quarter are a recognised red flag.
 */
export const BLEEDING_RULES = [
    { key: "bleeding_pads_per_hour", urgent_at: 2, warn_at: 1, kind: "heavy_menstrual_bleeding",
      why: "Soaking a pad an hour is heavy bleeding; two or more an hour warrants same-day contact." },
    { key: "flooding_episodes", urgent_at: 3, warn_at: 1, kind: "flooding",
      why: "Sudden gushing bleeding. Repeated episodes in one day warrant same-day contact." },
    { key: "clots_quarter_size_plus", boolean: true, warn_at: true, kind: "large_clots",
      why: "Clots larger than a quarter are a recognised marker of heavy bleeding." },
];

/** Mood, using the key that actually exists, in the correct direction. */
export const MOOD_RULES = [
    { key: "mood_0_10", urgent_at_or_below: 2, warn_at_or_below: 4, kind: "low_mood",
      why: "Mood is scored 0 = very low, 10 = great. A low score is the concerning end." },
];

const SEV_ORDER = { info: 0, warning: 1, urgent: 2 };
function raise(current, next) {
    return SEV_ORDER[next] > SEV_ORDER[current] ? next : current;
}

/**
 * Evaluate one day's diary values.
 *
 * @param values  { key: value } as saved
 * @param catalog Map(key -> definition) from the live symptom catalogue
 * @returns {{severity, triggers}}
 */
export function evaluateDiary(values = {}, catalog = new Map()) {
    const triggers = [];
    let severity = "info";

    for (const [k, v] of Object.entries(values)) {
        const def = catalog.get ? catalog.get(k) : catalog[k];
        if (!def) continue;
        const kind = def.kind || def.scale_kind;

        if (kind === "numeric_0_10" && typeof v === "number") {
            if (HIGH_IS_WORSE.has(k)) {
                if (v >= 9) { triggers.push({ key: k, value: v, threshold: 9, direction: "high" }); severity = raise(severity, "urgent"); }
                else if (v >= 8) { triggers.push({ key: k, value: v, threshold: 8, direction: "high" }); severity = raise(severity, "warning"); }
            } else if (LOW_IS_WORSE.has(k)) {
                // The bug this replaces escalated a GOOD mood and ignored a
                // bad one. Direction is explicit now, and unclassified
                // scales escalate nothing rather than guessing.
                if (v <= 2) { triggers.push({ key: k, value: v, threshold: 2, direction: "low" }); severity = raise(severity, "urgent"); }
                else if (v <= 4) { triggers.push({ key: k, value: v, threshold: 4, direction: "low" }); severity = raise(severity, "warning"); }
            }
        }
    }

    for (const rule of BLEEDING_RULES) {
        const v = values[rule.key];
        if (v === undefined || v === null) continue;
        if (rule.boolean) {
            if (v === true || v === 1 || v === "true") {
                triggers.push({ key: rule.key, value: v, kind: rule.kind, why: rule.why });
                severity = raise(severity, "warning");
            }
            continue;
        }
        const n = Number(v);
        if (!Number.isFinite(n) || n <= 0) continue;
        if (rule.urgent_at !== undefined && n >= rule.urgent_at) {
            triggers.push({ key: rule.key, value: n, threshold: rule.urgent_at, kind: rule.kind, why: rule.why });
            severity = raise(severity, "urgent");
        } else if (rule.warn_at !== undefined && n >= rule.warn_at) {
            triggers.push({ key: rule.key, value: n, threshold: rule.warn_at, kind: rule.kind, why: rule.why });
            severity = raise(severity, "warning");
        }
    }

    for (const rule of MOOD_RULES) {
        const v = values[rule.key];
        if (typeof v !== "number") continue;
        if (v <= rule.urgent_at_or_below) {
            triggers.push({ key: rule.key, value: v, threshold: rule.urgent_at_or_below, kind: rule.kind, why: rule.why });
            severity = raise(severity, "urgent");
        } else if (v <= rule.warn_at_or_below) {
            triggers.push({ key: rule.key, value: v, threshold: rule.warn_at_or_below, kind: rule.kind, why: rule.why });
            severity = raise(severity, "warning");
        }
    }

    // De-duplicate BY KEY. mood_0_10 matches both the generic
    // LOW_IS_WORSE rule and its named rule, which produced two entries
    // for one finding — the clinician's panel would list the same symptom
    // twice and the count would overstate how much was wrong that day.
    // The named rule wins because it carries the clinical reason.
    const byKey = new Map();
    for (const t of triggers) {
        const existing = byKey.get(t.key);
        if (!existing || (t.why && !existing.why)) byKey.set(t.key, t);
    }
    const unique = [...byKey.values()];

    return { severity, triggers: unique };
}

/**
 * Every key this module names must exist in the catalogue, and every
 * 0-10 scale in the catalogue must be classified. Run in the test suite.
 *
 * This is the check that would have caught the original bug on the day it
 * was written, instead of leaving hemorrhage filed under "info".
 */
export function assertCatalogCoverage(catalogKeys, catalogDefs = []) {
    const keys = new Set(catalogKeys);
    const problems = [];

    for (const k of [...HIGH_IS_WORSE, ...LOW_IS_WORSE]) {
        if (!keys.has(k)) problems.push(`classified key "${k}" is not in the catalogue`);
    }
    for (const r of [...BLEEDING_RULES, ...MOOD_RULES]) {
        if (!keys.has(r.key)) problems.push(`rule key "${r.key}" is not in the catalogue — this rule can never fire`);
    }
    for (const d of catalogDefs) {
        const kind = d.kind || d.scale_kind;
        if (kind !== "numeric_0_10") continue;
        if (!HIGH_IS_WORSE.has(d.key) && !LOW_IS_WORSE.has(d.key)) {
            problems.push(`0-10 scale "${d.key}" is classified in neither direction — it would silently escalate nothing`);
        }
    }
    return { ok: problems.length === 0, problems };
}

export default {
    HIGH_IS_WORSE, LOW_IS_WORSE, BLEEDING_RULES, MOOD_RULES,
    evaluateDiary, assertCatalogCoverage,
};
