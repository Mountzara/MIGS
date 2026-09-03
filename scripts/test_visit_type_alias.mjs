#!/usr/bin/env node
// Deploy gate: the app's spoken visit labels resolve to catalog keys.
// Every miss here is a real claim sitting at $0 in the billing queue.
import a from "../functions/_lib/visit_type_alias.js";

let pass = 0, fail = 0;
const t = (n, c) => { if (c) pass++; else { fail++; console.error("FAIL:", n); } };
const KEYS = ["new_patient_complex","new_patient_standard","routine_followup",
  "complex_pelvic_pain_evaluation","complex_pelvic_pain_followup","aub_evaluation",
  "preop_visit","postop_early","postop_late","annual_exam","telehealth_consult",
  "omt_treatment","office_procedure"];

// --- normalization ---------------------------------------------------
t("spaces become underscores", a.normalize("Problem Visit") === "problem_visit");
t("case folded", a.normalize("NEW Patient") === "new_patient");
t("punctuation stripped", a.normalize("Pre-Op / Visit") === "pre_op_visit");
t("empty is empty", a.normalize("") === "");
t("null safe", a.normalize(null) === "");

// --- the labels the app actually sent (from production) --------------
t("'Problem Visit' resolves", a.toCatalogKey("Problem Visit", KEYS).key === "routine_followup");
t("...and is marked as an alias", a.toCatalogKey("Problem Visit", KEYS).via === "alias");
t("'new_patient_telehealth' resolves", a.toCatalogKey("new_patient_telehealth", KEYS).key === "telehealth_consult");
t("'endo_pain_evaluation' resolves", a.toCatalogKey("endo_pain_evaluation", KEYS).key === "complex_pelvic_pain_evaluation");

// --- exact keys pass straight through --------------------------------
t("exact catalog key wins", a.toCatalogKey("aub_evaluation", KEYS).via === "exact");
t("exact key returned unchanged", a.toCatalogKey("routine_followup", KEYS).key === "routine_followup");

// --- unknowns must NOT guess -----------------------------------------
t("unknown label resolves to nothing", a.toCatalogKey("Interpretive Dance", KEYS).key === null);
t("unknown label reports no route", a.toCatalogKey("Interpretive Dance", KEYS).via === null);
t("empty label resolves to nothing", a.toCatalogKey("", KEYS).key === null);
t("alias pointing outside the catalog is refused",
  a.toCatalogKey("omt", ["routine_followup"]).key === null);

// --- E/M fallback ----------------------------------------------------
t("99204 falls back to new complex", a.fromEmCode("99204", KEYS).key === "new_patient_complex");
t("99213 falls back to followup", a.fromEmCode("99213", KEYS).key === "routine_followup");
t("fallback is labelled as such", a.fromEmCode("99213", KEYS).via === "em_code");
t("a procedure code has no fallback", a.fromEmCode("58558", KEYS).key === null);
t("garbage code has no fallback", a.fromEmCode("banana", KEYS).key === null);
t("fallback refused when key absent from catalog",
  a.fromEmCode("99204", ["routine_followup"]).key === null);

// --- the ordering the endpoint relies on -----------------------------
t("label beats E/M code when both resolve",
  a.toCatalogKey("Problem Visit", KEYS).key !== a.fromEmCode("99204", KEYS).key);

console.log(`visit type alias: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
