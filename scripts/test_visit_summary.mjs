// =====================================================================
// test_visit_summary.mjs — "reviewed and signed off" must be a GATE
// =====================================================================
// The portal advertises: "an AI-generated summary ... reviewed and signed
// off by Dr. Mabini." That is a clinical safety claim, not a description
// of a workflow. An unreviewed AI summary of a medical visit reaching a
// patient is exactly the harm the sentence prevents.
//
// The table for this feature has existed since schema 0003 — complete
// with the pending -> approved status column — and nothing ever wrote to
// it. The feature was advertised and not built.
//
//   node scripts/test_visit_summary.mjs
// =====================================================================

import {
    STATUS, patientMayRead, checkPatientTone, PATIENT_TONE_RULES,
    buildPrompt, splitSummaries, extractDenormalised,
    REVIEW_ACTIONS, applyReview,
} from "../functions/_lib/visit_summary.js";
import { bridgeKindAllowed } from "../functions/_lib/bridge_context.js";

let pass = 0, fail = 0;
function ok(c, l) { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.error(`  ✗ ${l}`); } }
function section(t) { console.log(`\n${t}`); }

// ---------------------------------------------------------------------
section("THE GATE — a patient sees approved summaries and nothing else");
ok(patientMayRead({ status: STATUS.APPROVED }), "approved: visible");
ok(!patientMayRead({ status: STATUS.PENDING }), "pending review: NOT visible");
ok(!patientMayRead({ status: STATUS.REJECTED }), "rejected: NOT visible");
ok(!patientMayRead({ status: STATUS.ARCHIVED }), "archived: NOT visible");
ok(!patientMayRead({ status: "" }), "no status: NOT visible");
ok(!patientMayRead(null), "a missing row is not visible — no crash, no leak");
ok(!patientMayRead({ status: "Approved" }), "a near-miss status string does not pass — comparison is exact");

section("Review actions map to the right visibility");
ok(applyReview("approved_as_is").status === STATUS.APPROVED, "approve as-is -> approved");
ok(applyReview("edited_and_approved").status === STATUS.APPROVED, "approve with edits -> approved");
ok(applyReview("rejected").status === STATUS.REJECTED, "reject -> rejected");
ok(!applyReview("rejected").ok === false && REVIEW_ACTIONS.rejected.patient_sees === false,
   "a rejected summary is explicitly marked as never patient-visible");
ok(!applyReview("publish").ok, "an invented action is refused rather than defaulting to approve");
ok(!applyReview("").ok && !applyReview(null).ok, "empty and null actions are refused");
ok(Object.values(REVIEW_ACTIONS).filter((a) => a.patient_sees).length === 2,
   "exactly two of the three actions make it visible — reject never does");

// ---------------------------------------------------------------------
section("Patient-facing tone — the model must not invent comfort");
for (const [text, why] of [
    ["You will be fine after this heals.", "promises an outcome"],
    ["This is nothing to worry about.", "minimises"],
    ["Don't worry about the bleeding.", "minimises"],
    ["I recommend you start norethindrone.", "introduces advice"],
    ["This may also be developing into adenomyosis.", "speculates"],
    ["The pain could be a sign of something else.", "speculates"],
]) ok(!checkPatientTone(text).ok, `flagged (${why}): "${text}"`);

section("…while the honest sentences pass");
for (const text of [
    "We talked about the pain you have had since 2019 and what has and has not helped.",
    "The plan is an ultrasound before your next visit, then we decide together.",
    "We do not know yet what is causing this. That is what the scan is for.",
    "Dr. Mabini prescribed amitriptyline 25 mg at night, as discussed.",
    "You will see him again in six weeks.",
    "Your bleeding has been heavier since March, and that is what we are investigating.",
]) ok(checkPatientTone(text).ok, `allowed: "${text.slice(0, 58)}…"`);

ok(PATIENT_TONE_RULES.every((r) => r.key && r.why), "every tone rule explains itself");
ok(checkPatientTone("You will be fine and don't worry").violations.length >= 2,
   "multiple violations in one sentence are all reported, not just the first");

// ---------------------------------------------------------------------
section("Two summaries, split reliably");
const raw = `What we talked about
Your pelvic pain since 2019.

The plan
An ultrasound, then review together.

Your medicines
amitriptyline 25 mg at night
ibuprofen as needed

What happens next
Follow up in six weeks.
---CLINICIAN---
A/P: chronic pelvic pain, suspected adenomyosis. TVUS ordered.
UNCERTAIN: none`;
const sp = splitSummaries(raw);
ok(sp.ok, "the two halves split on the marker");
ok(/pelvic pain since 2019/.test(sp.patient) && !/A\/P:/.test(sp.patient),
   "the patient half contains no clinician shorthand");
ok(/UNCERTAIN/.test(sp.clinician), "the clinician half keeps the uncertainty flag he reviews against");
ok(!splitSummaries("only one summary here").ok, "a missing marker is an error, not a silent half-summary");
ok(!splitSummaries("").ok, "empty output is an error");
ok(!splitSummaries("patient text\n---CLINICIAN---\n   ").ok, "an empty clinician half is an error");

section("Denormalised fields for the portal list view");
const d = extractDenormalised(sp.patient);
ok(/ultrasound/i.test(d.plan_summary || ""), "the plan is extracted");
ok(/six weeks/i.test(d.next_step_summary || ""), "the next step is extracted");
ok(d.medications.length === 2, `both medicines are extracted (got ${d.medications.length})`);
ok(d.medications.some((m) => /amitriptyline/i.test(m)), "…including the one with a dose");
ok((d.plan_summary || "").length <= 200, "the plan fits the column it is stored in");
const empty = extractDenormalised("");
ok(empty.plan_summary === null && empty.medications.length === 0,
   "an empty summary yields nulls rather than the string 'undefined'");

// ---------------------------------------------------------------------
section("The prompt carries the constraints");
const p = buildPrompt("note text", { visitDate: "2026-08-13", visitType: "follow-up" });
ok(/---CLINICIAN---/.test(p), "it asks for both summaries with the split marker");
ok(/Add no clinical fact/.test(p), "it forbids inventing facts");
ok(/Do not promise an outcome/.test(p), "it forbids promising outcomes");
ok(/Do not minimise/.test(p), "it forbids minimising");
ok(/we do not know yet/.test(p), "it explicitly licenses honest uncertainty");
ok(/UNCERTAIN:/.test(p), "it requires the clinician half to flag what was ambiguous");
ok(/2026-08-13/.test(p) && /follow-up/.test(p), "the visit context is passed through");

section("PHI: the bridge path is permitted and de-identified");
ok(bridgeKindAllowed("visit_summary"),
   "visit_summary is a vetted bridge kind, so its note is de-identified server-side before it leaves");
ok(!bridgeKindAllowed("claim_coding"), "…and billing work is still refused on the bridge");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
