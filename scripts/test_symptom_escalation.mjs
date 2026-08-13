// =====================================================================
// test_symptom_escalation.mjs — a hemorrhage must not file as "info"
// =====================================================================
// The logic this replaces was wrong three ways, all silent:
//   * bleeding triggers named keys that do not exist, so heavy bleeding
//     produced a routine event
//   * PHQ triggers named keys that do not exist, so nothing fired
//   * the generic rule escalated ANY 0-10 value >= 9, which on mood,
//     sleep quality and sexual desire — where HIGH IS GOOD — raised an
//     URGENT alert for a patient having a good day, while mood 1/10
//     raised nothing
//
// Alert fatigue and missed depression from one bug. These assertions are
// what should have existed when it was written.
//
//   node scripts/test_symptom_escalation.mjs
// =====================================================================

import {
    evaluateDiary, assertCatalogCoverage,
    HIGH_IS_WORSE, LOW_IS_WORSE, BLEEDING_RULES, MOOD_RULES,
} from "../functions/_lib/symptom_escalation.js";

let pass = 0, fail = 0;
function ok(c, l) { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.error(`  ✗ ${l}`); } }
function section(t) { console.log(`\n${t}`); }

// The live catalogue, fetched from production while writing this.
const CATALOG_KEYS = ["pelvic_pain_0_10","pain_location","pain_triggers","dyspareunia_0_10",
 "bleeding_pads_per_hour","bleeding_days_in_cycle","clots_quarter_size_plus","flooding_episodes",
 "cycle_day","hot_flashes_count","night_sweats_count","mood_0_10","anxiety_0_10","sleep_quality_0_10",
 "sleep_hours","sexual_desire_0_10","bm_pain_with","diarrhea_episodes","constipation_days",
 "bloating_0_10","urinary_urgency_0_10","urinary_frequency_count","nocturia_count",
 "work_school_impact_0_10","medication_taken_today"];

const DEFS = [
 { key: "pelvic_pain_0_10", kind: "numeric_0_10" }, { key: "dyspareunia_0_10", kind: "numeric_0_10" },
 { key: "mood_0_10", kind: "numeric_0_10" }, { key: "anxiety_0_10", kind: "numeric_0_10" },
 { key: "sleep_quality_0_10", kind: "numeric_0_10" }, { key: "sexual_desire_0_10", kind: "numeric_0_10" },
 { key: "bloating_0_10", kind: "numeric_0_10" }, { key: "urinary_urgency_0_10", kind: "numeric_0_10" },
 { key: "work_school_impact_0_10", kind: "numeric_0_10" },
 { key: "bleeding_pads_per_hour", kind: "count_per_day" }, { key: "flooding_episodes", kind: "count_per_day" },
 { key: "clots_quarter_size_plus", kind: "boolean" },
];
const CAT = new Map(DEFS.map((d) => [d.key, d]));

// ---------------------------------------------------------------------
section("EVERY RULE KEY EXISTS — the check that would have caught the bug");
const cov = assertCatalogCoverage(CATALOG_KEYS, DEFS);
ok(cov.ok, `no rule names a key outside the catalogue${cov.ok ? "" : " — " + cov.problems.join("; ")}`);
ok(!CATALOG_KEYS.includes("bleeding_pad_hour"), "the old key bleeding_pad_hour genuinely does not exist");
ok(!CATALOG_KEYS.includes("mood_phq_q1"), "…nor mood_phq_q1");
ok(BLEEDING_RULES.every((r) => CATALOG_KEYS.includes(r.key)), "every bleeding rule uses a real key");
ok(MOOD_RULES.every((r) => CATALOG_KEYS.includes(r.key)), "every mood rule uses a real key");

section("…and an unclassified 0-10 scale fails the build");
const bad = assertCatalogCoverage(CATALOG_KEYS.concat(["new_score_0_10"]),
                                  DEFS.concat([{ key: "new_score_0_10", kind: "numeric_0_10" }]));
ok(!bad.ok && /neither direction/.test(bad.problems.join(" ")),
   "a newly added 0-10 scale nobody classified is caught, not silently ignored");

// ---------------------------------------------------------------------
section("HEAVY BLEEDING — the case that filed as routine");
let r = evaluateDiary({ bleeding_pads_per_hour: 12, flooding_episodes: 10, clots_quarter_size_plus: true }, CAT);
ok(r.severity === "urgent", `hemorrhage-level bleeding is URGENT (was "info")`);
ok(r.triggers.some((t) => t.kind === "heavy_menstrual_bleeding"), "the pads-per-hour rule fires");
ok(r.triggers.some((t) => t.kind === "flooding"), "the flooding rule fires");
ok(r.triggers.some((t) => t.kind === "large_clots"), "the clot rule fires");
ok(r.triggers.every((t) => t.why), "each trigger carries the clinical reason, so the panel explains itself");

r = evaluateDiary({ bleeding_pads_per_hour: 1 }, CAT);
ok(r.severity === "warning", "soaking one pad an hour is a warning — the standard definition of heavy bleeding");
r = evaluateDiary({ bleeding_pads_per_hour: 2 }, CAT);
ok(r.severity === "urgent", "two an hour is urgent — the same-day-contact threshold");
r = evaluateDiary({ bleeding_pads_per_hour: 0, flooding_episodes: 0, clots_quarter_size_plus: false }, CAT);
ok(r.severity === "info", "a day with no bleeding raises nothing");

// ---------------------------------------------------------------------
section("MOOD — the direction that was backwards");
r = evaluateDiary({ mood_0_10: 9 }, CAT);
ok(r.severity === "info", "mood 9/10 raises NOTHING (previously an URGENT alert on a good day)");
r = evaluateDiary({ mood_0_10: 10 }, CAT);
ok(r.severity === "info", "mood 10/10 raises nothing");
r = evaluateDiary({ mood_0_10: 1 }, CAT);
ok(r.severity === "urgent", "mood 1/10 is URGENT (previously silent)");
r = evaluateDiary({ mood_0_10: 4 }, CAT);
ok(r.severity === "warning", "mood 4/10 is a warning");
r = evaluateDiary({ mood_0_10: 6 }, CAT);
ok(r.severity === "info", "mood 6/10 raises nothing");

section("…and the same inversion on the other feel-good scales");
ok(evaluateDiary({ sleep_quality_0_10: 9 }, CAT).severity === "info", "sleeping well raises nothing");
ok(evaluateDiary({ sleep_quality_0_10: 1 }, CAT).severity === "urgent", "sleeping terribly is urgent");
ok(evaluateDiary({ sexual_desire_0_10: 10 }, CAT).severity === "info", "high desire raises nothing");

section("…while the high-is-worse scales still escalate upward");
ok(evaluateDiary({ pelvic_pain_0_10: 9 }, CAT).severity === "urgent", "pain 9/10 is urgent");
ok(evaluateDiary({ pelvic_pain_0_10: 8 }, CAT).severity === "warning", "pain 8/10 is a warning");
ok(evaluateDiary({ pelvic_pain_0_10: 2 }, CAT).severity === "info", "pain 2/10 raises nothing");
ok(evaluateDiary({ anxiety_0_10: 10 }, CAT).severity === "urgent", "anxiety 10/10 is urgent");
ok(evaluateDiary({ dyspareunia_0_10: 9 }, CAT).severity === "urgent", "dyspareunia 9/10 is urgent");

section("Mixed days take the worst finding");
r = evaluateDiary({ mood_0_10: 9, pelvic_pain_0_10: 9 }, CAT);
ok(r.severity === "urgent", "a good mood does not soften severe pain");
ok(!r.triggers.some((t) => t.key === "mood_0_10"), "…and the good mood is not itself listed as a trigger");
r = evaluateDiary({ pelvic_pain_0_10: 8, bleeding_pads_per_hour: 2 }, CAT);
ok(r.severity === "urgent", "a warning plus an urgent resolves to urgent");

section("Robustness");
ok(evaluateDiary({}, CAT).severity === "info", "an empty entry raises nothing");
ok(evaluateDiary({ unknown_key: 99 }, CAT).severity === "info", "a key absent from the catalogue is ignored, not guessed at");
ok(evaluateDiary({ pelvic_pain_0_10: "9" }, CAT).severity === "info", "a string where a number belongs does not escalate");
ok(evaluateDiary({ bleeding_pads_per_hour: null }, CAT).severity === "info", "a null value does not escalate");
const dup = evaluateDiary({ mood_0_10: 1 }, CAT);
ok(dup.triggers.filter((t) => t.key === "mood_0_10").length === 1, "mood is not double-counted by the generic and named rules");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
