// =====================================================================
// test_visit_prep.mjs — the line between organising and practising
// =====================================================================
// The Navigator tier prepares a patient for a visit with THEIR OWN
// doctor. That is patient navigation, which needs no licence in their
// state and is not a covered service — so it can be a membership
// benefit.
//
// The moment the output says what a scan MEANS, or what the patient
// SHOULD do, it becomes the practice of medicine: it needs licensure
// where the patient is, it creates a physician-patient relationship, and
// as a second opinion it is usually a COVERED service that must be billed
// rather than bundled.
//
// A model asked to be helpful will cross that line. These assertions are
// the enforcement, run against the OUTPUT rather than trusting the prompt.
//
//   node scripts/test_visit_prep.mjs
// =====================================================================

import {
    DELIVERABLES, checkScope, buildPrompt, PATIENT_DISCLAIMER,
    canConsult, escalation, LICENSED_STATES, licensedStates, SCOPE_RULES,
    LICENSES, licenceWarnings, daysUntilExpiry,
} from "../functions/_lib/visit_prep.js";

let pass = 0, fail = 0;
function ok(c, l) { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.error(`  ✗ ${l}`); } }
function section(t) { console.log(`\n${t}`); }

// ---------------------------------------------------------------------
section("Output that practises medicine is REJECTED, not softened");
const MUST_FAIL = [
    ["Your ultrasound shows a 4 cm endometrioma.", "interprets imaging"],
    ["This is consistent with adenomyosis.", "implied diagnosis"],
    ["You likely have endometriosis.", "diagnosis"],
    ["You should ask for an MRI and start norethindrone.", "recommendation"],
    ["I recommend a laparoscopy.", "recommendation"],
    ["The next step is surgery.", "recommendation"],
    ["Your labs indicate anaemia.", "interprets a result"],
    ["This is likely to worsen without treatment.", "prognosis"],
    ["Stop taking the ibuprofen.", "directs treatment"],
];
for (const [text, why] of MUST_FAIL) {
    const r = checkScope(text);
    ok(!r.ok, `rejected (${why}): "${text}"`);
}

section("…including the hedged forms, because a hedged diagnosis is still a diagnosis");
for (const text of [
    "This could suggest adenomyosis.",
    "This may be adenomyosis.",
    "This might indicate a fibroid.",
    "This represents a submucosal fibroid.",
    "Findings are consistent with a fibroid.",
    "You may have endometriosis.",
]) ok(!checkScope(text).ok, `rejected: "${text}"`);

section("…without blocking ordinary sentences, or the tool is uninstalled on day one");
for (const text of [
    "You have tried ibuprofen and a combined pill.",
    "You have had a pelvic ultrasound on 12 March 2026.",
    "You have been seen by two other clinicians.",
    "You have not tried hormonal treatment.",
    "You have stopped the pill.",
    "This appointment is with your own OB/GYN.",
    "This is your timeline.",
    "This document is a preparation tool.",
    "This page summarises what you told us.",
    "Bring the report from March — your doctor may not have seen it.",
]) ok(checkScope(text).ok, `not blocked: "${text}"`);

// ---------------------------------------------------------------------
section("Legitimate preparation language PASSES");
const MUST_PASS = [
    "Ask whether adenomyosis has been considered, and what would distinguish it from fibroids.",
    "You had a pelvic ultrasound on 12 March 2026. Bring the report — your doctor may not have it.",
    "Endometrioma: a cyst on the ovary formed by endometriosis. Ask what yours means for your options.",
    "Symptoms began around 2019 with pain in the week before each period.",
    "You have tried ibuprofen and a combined pill. Note what each did and did not change.",
    "Questions to bring: what are my options besides surgery? What happens if I wait?",
];
for (const text of MUST_PASS) {
    const r = checkScope(text);
    ok(r.ok, `allowed: "${text.slice(0, 62)}…"${r.ok ? "" : " — blocked by " + r.violations.map((v) => v.key)}`);
}

section("Violations are reported usefully, not just flagged");
const r = checkScope("Your MRI shows adenomyosis and you should have surgery.");
ok(r.violations.length >= 2, "multiple distinct violations are found in one sentence");
ok(r.violations.every((v) => v.why && v.sample), "each names what it did and quotes the text that did it");
ok(SCOPE_RULES.length >= 5, "the rule set covers diagnosis, recommendation, interpretation, prognosis and treatment");

// ---------------------------------------------------------------------
section("The prompt itself carries the constraint");
const p = buildPrompt("questions", "Pain since 2019.", { specialty: "OB/GYN" });
ok(/NO diagnosis/.test(p), "the prompt forbids diagnosis");
ok(/hedged/i.test(p) || /could suggest/i.test(p), "…and closes the hedging loophole explicitly");
ok(/NO interpretation/.test(p), "it forbids interpreting results");
ok(/Questions are how you stay in scope/.test(p), "it gives the model the SAFE form to use instead of only prohibitions");
ok(/THEIR OWN/.test(p), "it establishes that the patient's doctor is someone else");
ok(/Add no clinical facts/.test(p), "it forbids inventing history");

section("Deliverables are all educational");
ok(DELIVERABLES.length >= 5, "there is a real pack, not one document");
ok(DELIVERABLES.every((d) => d.educational === true), "every deliverable is educational — none is a clinical opinion");
ok(DELIVERABLES.every((d) => d.what && d.why), "each says what it is AND why it helps");
ok(!DELIVERABLES.some((d) => /diagnos|recommend|interpret/i.test(d.what)),
   "no deliverable is described in terms that would make it medical advice");

section("The disclaimer says the true thing");
ok(/not medical advice/i.test(PATIENT_DISCLAIMER), "it says it is not medical advice");
ok(/not your treating physician/i.test(PATIENT_DISCLAIMER), "it says he is not their treating physician");
ok(/no diagnosis/i.test(PATIENT_DISCLAIMER), "it says there is no diagnosis in it");

// ---------------------------------------------------------------------
section("Licensure gates the clinical offer, not the tools");
ok(canConsult("IL"), "he can consult in Illinois");
ok(canConsult("CA"), "he can consult in California — he holds both licences");
ok(LICENSED_STATES.includes("IL") && LICENSED_STATES.includes("CA"),
   "both licences are recorded, and the payer directory is built around both states");
ok(!canConsult("TX"), "Texas is not a licensed state");
ok(!canConsult(""), "an unknown state is treated as not licensed");
ok(canConsult(" ca "), "the check tolerates whitespace and case, so a form entry does not silently fail");

section("Both licences are recorded with their real numbers");
ok(LICENSES.length === 2, "two licences on file");
const ca = LICENSES.find((l) => l.state === "CA");
const il = LICENSES.find((l) => l.state === "IL");
ok(ca && ca.number === "20A24823", "the California licence number is recorded");
ok(ca.expires === "2027-11-30", "…with its expiry date from the licence itself");
ok(/Osteopathic Medical Board of California/.test(ca.board), "…and the issuing board");
ok(il && il.number === "125075291", "the Illinois licence number is recorded");

section("Expiry is a GATE, not a note — a lapsed licence makes consultation unlawful");
const afterCA = new Date("2027-12-01T00:00:00Z");
ok(!canConsult("CA", null, afterCA), "after 30 Nov 2027 California consultation is refused automatically");
ok(canConsult("IL", null, afterCA), "…while Illinois is unaffected");
ok(!licensedStates(null, afterCA).includes("CA"), "the expired state drops out of the licensed list");
ok(escalation({ state: "CA", now: afterCA }).offer === "referral",
   "escalation stops offering a consultation in an expired state");

const beforeCA = new Date("2027-11-01T00:00:00Z");
ok(canConsult("CA", null, beforeCA), "a licence in its final month still works");
ok(licenceWarnings(beforeCA).some((w) => w.severity === "warning" && /expires in \d+ days/.test(w.message)),
   "…and warns with days remaining, ninety days out");
ok(licenceWarnings(afterCA).some((w) => w.severity === "critical" && /EXPIRED/.test(w.message)),
   "an expired licence raises a CRITICAL warning naming the state and number");
ok(licenceWarnings().some((w) => w.state === "IL" && w.severity === "info"),
   "a licence with no recorded expiry is flagged so the gap is visible");
ok(daysUntilExpiry(il) === null, "a missing expiry returns null rather than a bogus date");
ok(daysUntilExpiry(ca) > 0, "the California licence is current today");

section("…and a new licence is configuration, not a deploy");
ok(licensedStates({ LICENSED_STATES: "IL,CA,NY" }).includes("NY"),
   "env.LICENSED_STATES adds a state");
ok(canConsult("NY", { LICENSED_STATES: "IL, CA, NY" }),
   "…and canConsult honours it, tolerating spaces");
ok(!canConsult("NY", null), "without the override, New York is still refused");
ok(licensedStates({ LICENSED_STATES: "" }).join() === LICENSED_STATES.join(),
   "an empty override falls back to the real licences rather than locking him out of everywhere");

let e = escalation({ state: "IL" });
ok(e.offer === "consultation" && e.billable, "in a licensed state, escalation offers a BILLED consultation");
ok(/never will be/.test(e.body), "…and states plainly that it is not part of the membership fee");

e = escalation({ state: "CA" });
ok(e.offer === "consultation" && e.billable, "California patients can be escalated to a real consultation");

e = escalation({ state: "TX" });
ok(e.offer === "referral" && !e.billable, "outside a licensed state, no consultation is offered");
ok(/licensed in/.test(e.body) && /IL and CA/.test(e.body),
   "…and it says why, naming BOTH states");
ok(/continue to work/.test(e.body), "…while making clear the preparation tools still work");
ok(/covered service/i.test(e.note), "escalation restates that covered services are billed, never bundled");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
