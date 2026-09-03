#!/usr/bin/env node
// =====================================================================
// calibrate_kb_grounding.mjs — are the grounding thresholds real?
// =====================================================================
// A refusal threshold picked by intuition is a guess with a number on it.
// This runs realistic clinical questions against the LIVE kb_docs index
// and reports what coverage each one actually achieves, so the thresholds
// in _lib/clinical_grounding.js are set from the corpus rather than from
// how confident the number looks.
//
// Two classes of question are run deliberately:
//   IN-SCOPE   — CBG/MIGS topics the library is built for. These must
//                pass, or the system refuses everything and gets switched
//                off, which is the real failure mode of a strict gate.
//   OUT-OF-SCOPE — real medicine that is NOT this practice's subspecialty.
//                These must FAIL, because answering them is precisely the
//                general-knowledge leak the rule exists to stop.
//
// Usage: node scripts/calibrate_kb_grounding.mjs
// Requires ~/.config/mountzara/scoped-tokens.env (read-only SELECTs).
// =====================================================================

import { execFileSync } from "node:child_process";
import { significantTerms, coverageOf, policyFor } from "../functions/_lib/clinical_grounding.js";
import { toFtsQuery } from "../functions/_lib/kb.js";

const ACCOUNT = "8fbe127f640681ddd813aaf33b95507f";

function d1(sql, params = []) {
    const payload = JSON.stringify({ sql, params });
    const out = execFileSync("bash", ["-c", `
        set -a; . ~/.config/mountzara/scoped-tokens.env; set +a
        curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/$MZ_D1_ID/query" \
          -H "Authorization: Bearer $CF_D1_TOKEN" -H "Content-Type: application/json" \
          --data-binary @-
    `], { input: payload, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const j = JSON.parse(out);
    if (!j.success) throw new Error(JSON.stringify(j.errors));
    return j.result[0].results;
}

const IN_SCOPE = [
    "heavy menstrual bleeding with fibroids, options short of hysterectomy",
    "endometriosis pelvic pain management after failed hormonal suppression",
    "adenomyosis diagnosis on MRI versus ultrasound",
    "laparoscopic myomectomy versus uterine artery embolization for fibroids",
    "postoperative recovery after laparoscopic hysterectomy, activity restrictions",
    "polycystic ovary syndrome diagnosis criteria and metabolic screening",
    "abnormal uterine bleeding evaluation in a premenopausal patient",
    "chronic pelvic pain workup including musculoskeletal contributors",
    "contraception options for a patient with migraine with aura",
    "menopause vasomotor symptoms hormone therapy risks and benefits",
    "ovarian cyst characterization and when surgery is indicated",
    "dysmenorrhea first line treatment in an adolescent",
    "vNOTES hysterectomy candidacy and contraindications",
    "uterosacral ligament suspension for apical prolapse",
    "GLP-1 agonist use before surgery and anesthesia aspiration risk",
    "early pregnancy loss management options",
];

const OUT_OF_SCOPE = [
    "acute coronary syndrome antiplatelet therapy after stent placement",
    "pediatric asthma inhaled corticosteroid step up therapy",
    "diabetic ketoacidosis insulin infusion protocol",
    "rheumatoid arthritis biologic selection after methotrexate failure",
    "acute ischemic stroke thrombolysis window and exclusion criteria",
    "chronic obstructive pulmonary disease exacerbation antibiotic choice",
];

function score(question, topK = 8) {
    const match = toFtsQuery(question);
    if (!match) return { question, coverage: 0, docs: 0, missing: [], note: "no searchable terms" };
    const rows = d1(
        `SELECT doc_id, source, title, text FROM kb_docs WHERE kb_docs MATCH ?1 ORDER BY rank LIMIT ?2`,
        [match, topK]
    );
    const terms = significantTerms(question);
    const corpus = rows.map((r) => `${r.title || ""} ${r.text || ""}`).join(" ");
    const cov = coverageOf(terms, corpus);
    return {
        question, docs: rows.length, coverage: cov.coverage,
        missing: cov.missing, terms: terms.length,
        top: rows.slice(0, 2).map((r) => `${r.source} — ${String(r.title || "").slice(0, 60)}`),
    };
}

console.log("Calibrating clinical grounding against the live kb_docs index\n");

const results = { in: [], out: [] };
console.log("IN-SCOPE (CBG/MIGS — these MUST pass, or the gate refuses everything)");
console.log("-".repeat(92));
for (const q of IN_SCOPE) {
    const r = score(q);
    results.in.push(r);
    console.log(`  ${(r.coverage * 100).toFixed(0).padStart(3)}%  ${String(r.docs).padStart(2)} docs  ${q.slice(0, 62)}`);
    if (r.missing.length) console.log(`         not in KB: ${r.missing.slice(0, 6).join(", ")}`);
}

console.log("\nOUT-OF-SCOPE (not this subspecialty — these MUST fail, or general knowledge leaks)");
console.log("-".repeat(92));
for (const q of OUT_OF_SCOPE) {
    const r = score(q);
    results.out.push(r);
    console.log(`  ${(r.coverage * 100).toFixed(0).padStart(3)}%  ${String(r.docs).padStart(2)} docs  ${q.slice(0, 62)}`);
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const inCov = results.in.map((r) => r.coverage);
const outCov = results.out.map((r) => r.coverage);
const minIn = Math.min(...inCov);
const maxOut = Math.max(...outCov);

console.log("\n" + "=".repeat(92));
console.log(`IN-SCOPE     mean ${(mean(inCov) * 100).toFixed(0)}%   min ${(minIn * 100).toFixed(0)}%`);
console.log(`OUT-OF-SCOPE mean ${(mean(outCov) * 100).toFixed(0)}%   max ${(maxOut * 100).toFixed(0)}%`);
console.log(`SEPARATION   ${((minIn - maxOut) * 100).toFixed(0)} points between the worst in-scope and the best out-of-scope`);

for (const kind of ["visit_summary", "message_draft", "visit_prep", "intake_triage", "prom_recommender"]) {
    const p = policyFor(kind);
    const falseRefusals = results.in.filter((r) => r.coverage < p.min_coverage || r.docs < p.min_docs);
    const leaks = results.out.filter((r) => r.coverage >= p.min_coverage && r.docs >= p.min_docs);
    console.log(`\n${kind}  (min_coverage ${p.min_coverage}, min_docs ${p.min_docs})`);
    console.log(`   would refuse ${falseRefusals.length}/${results.in.length} in-scope questions` +
        (falseRefusals.length ? ` ← ${falseRefusals.map((r) => r.question.slice(0, 40)).join(" | ")}` : ""));
    console.log(`   would ANSWER ${leaks.length}/${results.out.length} out-of-scope questions` +
        (leaks.length ? `  ← LEAK: ${leaks.map((r) => r.question.slice(0, 40)).join(" | ")}` : "  (correct)"));
}

if (minIn <= maxOut) {
    console.log("\n⚠️  No clean separation: some out-of-scope question scores as well as the worst in-scope one.");
    console.log("    Coverage alone cannot separate them — tighten min_docs or narrow the retrieval.");
}
