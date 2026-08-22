// =====================================================================
// test_clinical_grounding.mjs
// =====================================================================
// The owner's rule: clinical answers come from HIS KB, never from the
// model's general knowledge. verifyGrounding() is where that is enforced,
// so these tests are written adversarially — each one is output that TRIES
// to pass while smuggling ungrounded medicine through.
//
// The pre-flight coverage gate is deliberately NOT tested as a gate,
// because it is not one: scripts/calibrate_kb_grounding.mjs showed
// in-scope questions score 98% mean coverage and out-of-scope score 98%
// too. Coverage is advisory. Citation verification is the control.
// =====================================================================

import {
    significantTerms, coverageOf, policyFor, GROUNDING_POLICY,
    groundingInstruction, isClinicalAssertion, verifyGrounding,
    refusalMessage, provenanceLine,
} from "../functions/_lib/clinical_grounding.js";

let pass = 0, fail = 0;
const failures = [];
const ok = (c, n) => c ? pass++ : (fail++, failures.push(n));
const eq = (a, b, n) => ok(a === b, `${n} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

// A fake KB result, shaped exactly like groundClinical() returns.
function kbFixture(kind = "visit_summary", docs = null) {
    const d = docs || [
        { doc_id: "acog-pb-228", source: "ACOG · Practice Bulletin", title: "Management of Symptomatic Uterine Leiomyomas",
          text: "Uterine leiomyomas commonly cause heavy menstrual bleeding. Levonorgestrel intrauterine device reduces menstrual blood loss. Myomectomy preserves the uterus for patients desiring future fertility. Uterine artery embolization is an alternative to surgery." },
        { doc_id: "kb-endo-2024", source: "KB · Review Article", title: "Endometriosis and Pelvic Pain",
          text: "Endometriosis is associated with dysmenorrhea and dyspareunia. Hormonal suppression with combined oral contraceptives is first-line therapy. Laparoscopic excision is indicated when medical management fails." },
        { doc_id: "kb-periop-glp1", source: "KB · Clinical Document", title: "Perioperative GLP-1 Receptor Agonists",
          text: "GLP-1 receptor agonists delay gastric emptying and increase aspiration risk during anesthesia. Holding the medication before elective surgery is recommended." },
    ];
    return {
        grounded: true, reason: "ok", kind, policy: policyFor(kind),
        docs: d,
        citations: d.map(({ text, ...r }) => r),
        allowed_doc_ids: d.map((x) => x.doc_id),
        context: d.map((x) => `[KB:${x.doc_id}] ${x.source} — ${x.title}\n${x.text}\n`).join("\n---\n"),
        coverage: 0.9, covered_terms: [], missing_terms: [],
    };
}

// ---------------------------------------------------------------------
// term extraction
// ---------------------------------------------------------------------
{
    const t = significantTerms("heavy menstrual bleeding with fibroids in a patient");
    ok(t.includes("menstrual"), "keeps a clinical term");
    ok(t.includes("fibroids"), "keeps the entity");
    ok(!t.includes("patient"), "drops the generic word 'patient'");
    ok(!t.includes("with"), "drops stopwords");
    ok(t.every((x) => x.length >= 4), "drops very short tokens");
}
{
    const c = coverageOf(["fibroids", "myomectomy"], "Myomectomy is offered for fibroid disease.");
    eq(Math.round(c.coverage * 100), 100, "stemming-tolerant coverage matches fibroid/fibroids");
}
eq(coverageOf([], "anything").coverage, 0, "no terms is zero coverage, not a divide by zero");

// ---------------------------------------------------------------------
// clinical-assertion detection: must fire on medicine, not on logistics
// ---------------------------------------------------------------------
for (const s of [
    "Levonorgestrel IUD reduces menstrual blood loss substantially.",
    "Myomectomy is indicated when fertility preservation is desired.",
    "This medication increases the risk of aspiration during anesthesia.",
    "Laparoscopic excision is first-line for this presentation.",
    "About 30% of patients experience recurrence.",
    "Ibuprofen 600 mg every six hours is typical.",
]) ok(isClinicalAssertion(s), `flags clinical assertion: "${s.slice(0, 45)}"`);

for (const s of [
    "Your appointment is on Tuesday at 2pm.",
    "Hi Sarah,",
    "Thank you for writing in.",
    "Please call the office if you need to reschedule.",
    "We talked about how you have been feeling since the last visit.",
    "What happens next",
]) ok(!isClinicalAssertion(s), `does not flag non-clinical: "${s.slice(0, 45)}"`);

// ---------------------------------------------------------------------
// THE ADVERSARIAL CASES — output trying to pass while ungrounded
// ---------------------------------------------------------------------
{
    // Clean: every clinical claim cited, and supported by what the doc says.
    const kb = kbFixture();
    const v = verifyGrounding(
        "We talked about your heavy menstrual bleeding. A levonorgestrel intrauterine device reduces menstrual blood loss [KB:acog-pb-228]. Myomectomy preserves the uterus for patients desiring future fertility [KB:acog-pb-228]. Your appointment is on Tuesday.",
        kb);
    ok(v.ok, "clean grounded output passes");
    eq(v.fabricated.length, 0, "no fabricated citations");
    eq(v.uncited_count, 0, "no uncited clinical claims");
    eq(v.unsupported_count, 0, "no unsupported citations");
    ok(!v.blocked, "clean output is not blocked");
}
{
    // INVENTED CITATION — the highest-value catch. A model with no support
    // will produce a plausible-looking id before admitting it has nothing.
    const kb = kbFixture();
    const v = verifyGrounding(
        "Tranexamic acid reduces menstrual blood loss by 40% [KB:acog-pb-999].", kb);
    ok(!v.ok, "invented citation fails verification");
    ok(v.fabricated.includes("acog-pb-999"), "names the invented id");
    ok(v.blocked, "invented citation BLOCKS patient-facing output");
    ok(/invented citation/i.test(v.summary), "summary says a citation was invented");
}
{
    // UNCITED CLINICAL CLAIM — the general-knowledge leak this exists to stop.
    const kb = kbFixture();
    const v = verifyGrounding(
        "A levonorgestrel IUD reduces menstrual blood loss [KB:acog-pb-228]. Endometrial ablation is also highly effective and has a shorter recovery than hysterectomy.",
        kb);
    ok(!v.ok, "an uncited clinical claim fails verification");
    eq(v.uncited_count, 1, "counts exactly the uncited claim");
    ok(v.uncited[0].includes("ablation"), "names the offending sentence");
    ok(v.blocked, "uncited clinical claim blocks patient-facing output");
}
{
    // REAL ID, WRONG DOCUMENT — cites something that exists but does not
    // say this. Pattern-matching the id alone would wave it through.
    const kb = kbFixture();
    const v = verifyGrounding(
        "Metformin improves ovulation rates in polycystic ovary syndrome and reduces insulin resistance [KB:kb-periop-glp1].", kb);
    ok(!v.ok, "citing a document that does not support the claim fails");
    eq(v.unsupported_count, 1, "counts the unsupported citation");
    ok(v.unsupported[0].cited.includes("kb-periop-glp1"), "names which id was misused");
    ok(v.unsupported[0].not_in_cited_doc.length > 0, "reports which terms are absent from that doc");
}
{
    // Non-clinical sentences need no citation.
    const kb = kbFixture();
    const v = verifyGrounding(
        "Hi Sarah. Thank you for writing in. Your surgery is scheduled for the 14th and the office will call you the day before. GLP-1 receptor agonists delay gastric emptying and increase aspiration risk [KB:kb-periop-glp1].",
        kb);
    ok(v.ok, "logistics sentences do not need citations");
    eq(v.uncited_count, 0, "scheduling text is not counted as an uncited claim");
}
{
    // An honest refusal is a PASS. If it were not, the model would be
    // punished for the behaviour we want most.
    const kb = kbFixture();
    const v = verifyGrounding(
        "I cannot address the question about thyroid medication from the practice's references — there is nothing in the library covering it.",
        kb);
    ok(v.ok, "an honest 'not in the library' answer passes");
    eq(v.uncited_count, 0, "a refusal is not an uncited clinical claim");
}
{
    // Triage tolerates a couple of uncited lines and does not block, because
    // he reviews every triage row before release.
    const kb = kbFixture("intake_triage");
    const v = verifyGrounding(
        "Complex pelvic pain presentation. Endometriosis is associated with dysmenorrhea [KB:kb-endo-2024]. Symptoms suggest a longer visit. Recommend in-person evaluation.",
        kb);
    eq(v.policy.max_uncited, 2, "triage policy tolerates 2 uncited lines");
    ok(!v.blocked, "triage never blocks — he reviews it anyway");
}
{
    // …but a patient-facing kind with the same text WOULD block.
    const kb = kbFixture("visit_summary");
    const v = verifyGrounding(
        "Endometrial ablation is highly effective for heavy bleeding and recovery is quick.", kb);
    ok(!v.ok && v.blocked, "the same uncited claim blocks a visit summary");
}
{
    // Multiple invented ids are all reported, not just the first.
    const kb = kbFixture();
    const v = verifyGrounding(
        "Claim one [KB:fake-1] is treated with surgery. Claim two [KB:fake-2] is also indicated.", kb);
    eq(v.fabricated.length, 2, "reports every invented id");
}
{
    // Empty output must not silently pass as "nothing wrong".
    const kb = kbFixture();
    const v = verifyGrounding("", kb);
    eq(v.cited_count, 0, "empty output cites nothing");
    ok(v.ok, "empty output has no violations to report (the caller checks emptiness)");
}

// ---------------------------------------------------------------------
// prompt construction
// ---------------------------------------------------------------------
{
    const kb = kbFixture();
    const p = groundingInstruction(kb);
    ok(p.includes("OVERRIDES EVERYTHING ELSE"), "instruction asserts precedence");
    ok(/never from your training data|not from your training data/i.test(p), "forbids training data explicitly");
    for (const id of kb.allowed_doc_ids) ok(p.includes(`[KB:${id}]`), `allowed id ${id} is listed`);
    ok(p.includes("discards the entire response"), "tells the model it will be checked");
    ok(/CANNOT ADDRESS IT FROM THE PRACTICE'S REFERENCES/i.test(p), "gives it the refusal it is supposed to use");
    ok(p.includes(kb.context), "the excerpts are actually in the prompt");
}

// ---------------------------------------------------------------------
// policy shape — every clinical kind must be covered, patient-facing ones strict
// ---------------------------------------------------------------------
for (const kind of ["visit_summary", "message_draft", "visit_prep", "intake_triage", "prom_recommender"]) {
    ok(GROUNDING_POLICY[kind], `policy exists for ${kind}`);
}
for (const kind of ["visit_summary", "message_draft", "visit_prep"]) {
    const p = policyFor(kind);
    eq(p.max_uncited, 0, `${kind} tolerates zero uncited clinical claims`);
    eq(p.block_on_failure, true, `${kind} blocks on failure — a patient reads it`);
}
{
    const p = policyFor("something_new_nobody_classified");
    eq(p.max_uncited, 0, "an unknown task defaults to the strict policy");
    eq(p.block_on_failure, true, "an unknown task defaults to blocking");
}

// ---------------------------------------------------------------------
// refusal + provenance are written for a human
// ---------------------------------------------------------------------
{
    const r = refusalMessage({ reason: "kb_returned_nothing", found_docs: 0, policy: policyFor("visit_summary") });
    ok(r.includes("0 document"), "refusal says how many documents were found");
    ok(/patient reads this/.test(r), "refusal says why it refused rather than guessing");
    ok(!/error|exception|null/i.test(r), "refusal reads as prose, not a stack trace");
}
{
    const kb = kbFixture();
    const line = provenanceLine(kb, { cited: ["acog-pb-228"] });
    ok(line.includes("practice library"), "provenance names the library");
    ok(line.includes("ACOG"), "provenance names the source");
    eq(provenanceLine({ grounded: false }), "Not grounded in the practice library.", "ungrounded provenance is explicit");
}

// ---------------------------------------------------------------------
// FIELD-AWARE RETRIEVAL — the app's own structure, carried through
// ---------------------------------------------------------------------
// The KB chunks are structured records. Flattening them lost the
// distinction that makes retrieval correct: the first live run grounded a
// draft reply to a PATIENT in a JMIG paper about robotic device
// malfunctions, because in a concatenated blob "what to say to a patient"
// and "device failure modes" are the same field.
{
    const { KB_FIELDS, TASK_FIELDS, fieldsForTask, fieldLabel } =
        await import("../functions/_lib/kb_fields.js");

    // Every field the loader extracts must be described here, or the
    // mapping is working from a stale idea of the KB's shape.
    for (const f of ["abstract", "clinicalSummary", "backgroundSummary",
                     "summaryOfRecommendations", "complications", "keyPoints",
                     "clinicalPearls", "teachingPoints", "patientCounselingPoints",
                     "oralBoardPearls", "criticalThresholds", "decisionPoints",
                     "clinicalTopics", "safetyConsiderations", "managementAlgorithm"]) {
        ok(KB_FIELDS[f], `KB field '${f}' is described`);
    }

    // The mappings that matter, stated as assertions rather than intentions.
    eq(fieldsForTask("message_draft")[0], "patientCounselingPoints",
       "a reply TO a patient retrieves counseling points first");
    eq(fieldsForTask("visit_summary")[0], "patientCounselingPoints",
       "the summary a patient reads retrieves counseling points first");
    eq(fieldsForTask("intake_triage")[0], "criticalThresholds",
       "triage retrieves the numbers that change management first");
    eq(fieldsForTask("visit_prep")[0], "summaryOfRecommendations",
       "a pack for another clinician leads with recommendations");

    ok(fieldsForTask("intake_triage").includes("safetyConsiderations"),
       "triage also searches safety considerations");
    ok(!fieldsForTask("message_draft").includes("oralBoardPearls"),
       "board-exam framing is not what you say to a patient");
    ok(!fieldsForTask("visit_summary").includes("complications"),
       "an after-visit summary is not a complications list");
    ok(fieldsForTask("intake_triage").includes("complications"),
       "…but triage does look at complications");

    // An unknown task must still retrieve something sensible.
    const fallback = fieldsForTask("some_task_added_later");
    ok(fallback.length > 0, "an unmapped task still has fields to search");
    ok(fallback.includes("clinicalSummary"), "and they are general-purpose ones");

    // Every mapped field must be a real field, or the IN(...) clause
    // silently matches nothing and retrieval quietly returns empty.
    for (const [task, fields] of Object.entries(TASK_FIELDS)) {
        for (const f of fields) {
            ok(KB_FIELDS[f], `${task} maps to a real KB field: ${f}`);
        }
    }
    ok(fieldLabel("patientCounselingPoints").includes("PATIENT"),
       "the label says plainly what the field is for");
    eq(fieldLabel("somethingUnknown"), "somethingUnknown", "an unknown field labels as itself");
}

console.log(`\nclinical grounding: ${pass} passed, ${fail} failed`);
if (fail) {
    console.log("\nFAILED:");
    for (const f of failures) console.log("  · " + f);
    process.exit(1);
}
