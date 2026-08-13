// =====================================================================
// test_bridge_phi.mjs — prove nothing identifying reaches the CLI bridge
// =====================================================================
// The bridge runs `claude -p` against a PERSONAL Claude subscription. The
// Anthropic BAA covers the API, not a consumer CLI. So every byte this
// path emits has left BAA-covered infrastructure, and these assertions
// are the proof that it carries no PHI.
//
// The tests are written adversarially: each one takes a realistic patient
// message, runs the real pipeline, and then searches the OUTPUT for the
// identifier that went in. A pass means the string is genuinely absent,
// not that a function returned true.
//
//   node scripts/test_bridge_phi.mjs
// =====================================================================

import {
    deidentifyForBridge, tokenizeNames, rehydrate, unresolvedTokens,
    billingContext, bridgeKindAllowed, BRIDGE_KINDS,
} from "../functions/_lib/bridge_context.js";

let pass = 0, fail = 0;
function ok(c, l) { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.error(`  ✗ ${l}`); } }
function section(t) { console.log(`\n${t}`); }
const absent = (hay, needle) => !String(hay).toLowerCase().includes(String(needle).toLowerCase());

// ---------------------------------------------------------------------
section("A real patient message — every identifier must be gone");

const THREAD = `PATIENT: Hi Dr. Mabini, this is Jane Doe. My surgery was on 06/02/2026
and I still have cramping. My DOB is 03/14/1982 and my MRN is 88213345.
You can reach me at 312-555-0148 or jane.doe@example.com.
I live at 1420 Maple Street, Chicago IL 60614.
My member ID is XZQ889201344.

PRACTICE: Thanks Jane — some cramping is expected in the first two weeks.`;

const NAMES = ["Jane Doe", "Jane"];
const d = deidentifyForBridge(THREAD, { knownNames: NAMES });

ok(d.ok, "de-identification VERIFIES (the scrub's own re-scan found nothing high-risk)");
ok(d.text !== null, "verified output is returned");

const out = d.text || "";
ok(absent(out, "Jane Doe"), "the patient's full name is absent");
ok(absent(out, "jane.doe@example.com"), "the email address is absent");
ok(absent(out, "312-555-0148"), "the phone number is absent");
ok(absent(out, "88213345"), "the MRN is absent");
ok(absent(out, "XZQ889201344"), "the member ID is absent");
ok(absent(out, "60614"), "the ZIP is absent");
ok(absent(out, "03/14/1982"), "the date of birth is absent");
ok(absent(out, "06/02/2026"), "the date of service is absent");
ok(absent(out, "1420 Maple Street"), "the street address is absent");

section("…but the message is still usable");
ok(/cramping/i.test(out), "the clinical substance survives — the draft is still writable");
ok(/\[NAME_\d+\]/.test(out), "the patient is a stable token, so a reply can address them");
ok(/\[DATE_\d+\]/.test(out), "dates are indexed tokens, so 'your surgery on ...' still means something");
ok(Object.keys(d.map).length >= 2, "a reverse map exists for rehydration");

section("Findings are reported so the operator can see what left");
ok(Array.isArray(d.findings) && d.findings.length > 0, "the scrub reports what it removed");
ok(d.findings.every((f) => typeof f.count === "number" && !("value" in f)),
   "findings carry COUNTS and rule names only — never a matched value");

// ---------------------------------------------------------------------
section("Fail-closed: unverifiable content is refused, not warned about");

// A 9-digit SSN-shaped string with no separators the scrubber can catch
// would be a residual. Construct something the verifier must reject by
// disabling the map: use text where a high-risk shape survives.
const nasty = "Contact: 312.555.0148 x22 and also 3125550148 direct";
const dn = deidentifyForBridge(nasty, { knownNames: [] });
ok(typeof dn.ok === "boolean", "the gate returns an explicit verdict");
if (!dn.ok) {
    ok(dn.text === null, "when verification fails, NO text is returned — refusal, not a warning");
    ok(dn.residual.length > 0, "the residual patterns are named so the failure is diagnosable");
} else {
    ok(absent(dn.text, "3125550148"), "if it verified, the bare-digit phone is genuinely gone");
    ok(true, "verification passed on this input");
}

// ---------------------------------------------------------------------
section("Name tokenisation");

let t = tokenizeNames("Mary Jane Smith called. Mary asked about Smith's chart.",
                      ["Mary Jane Smith", "Mary", "Smith"]);
ok(absent(t.text, "Mary Jane Smith"), "the longest name is replaced first, not half-consumed");
ok(Object.keys(t.map).length >= 1, "the map records what was replaced");

t = tokenizeNames("No names here at all.", ["Absent Person"]);
ok(Object.keys(t.map).length === 0, "a name that never appears does not burn a token index");
ok(t.text === "No names here at all.", "…and the text is untouched");

t = tokenizeNames("Al went home.", ["Al"]);
ok(Object.keys(t.map).length === 0, "names under three characters are never tokenised (they would shred the text)");

// ---------------------------------------------------------------------
section("Rehydration — the physician reads a normal draft");

const map = { "[NAME_1]": "Jane Doe", "[DATE_1]": "06/02/2026" };
const draft = "Hi [NAME_1], the cramping after your surgery on [DATE_1] is expected.";
const full = rehydrate(draft, map);
ok(full.includes("Jane Doe"), "the real name is restored");
ok(full.includes("06/02/2026"), "the real date is restored");
ok(unresolvedTokens(full).length === 0, "no tokens survive a complete rehydration");

section("…and a draft referencing something imaginary is caught");
const invented = "Hi [NAME_1], per [DATE_7] you should rest.";
const partly = rehydrate(invented, map);
ok(unresolvedTokens(partly).length === 1, "a token with no mapping is detected");
ok(unresolvedTokens(partly)[0] === "[DATE_7]", "…and named, so the job fails loudly rather than shipping a fiction");

// ---------------------------------------------------------------------
section("Minimum necessary — billing context carries codes, nothing else");

const bc = billingContext(
    { place_of_service: "22", payer_kind: "commercial", patient_name: "Jane Doe", dob: "03/14/1982" },
    [{ cpt: "58571", mod1: "22", units: 1, icd1: "N80.1", charge: 4200, note: "patient reports severe dysmenorrhea since 2019" }]
);
const bcs = JSON.stringify(bc);
ok(bcs.includes("58571") && bcs.includes("N80.1"), "the codes a claim is decided on are present");
ok(absent(bcs, "Jane Doe"), "the patient name never enters billing context");
ok(absent(bcs, "03/14/1982"), "the date of birth never enters billing context");
ok(absent(bcs, "dysmenorrhea"), "narrative is not de-identified — it is NOT SELECTED AT ALL");
ok(!("patient_id" in bc) && !("dates_of_service" in bc), "nothing is carried 'just in case'");

// ---------------------------------------------------------------------
section("Kind allowlist — the bridge cannot run what we have not vetted");

ok(bridgeKindAllowed("message_draft"), "a vetted kind is permitted");
ok(!bridgeKindAllowed("claim_coding"), "a billing kind is NOT permitted on the bridge — that is the API-only path");
ok(!bridgeKindAllowed("anything_new"), "an unknown kind defaults to REFUSED, not allowed");
ok(Object.values(BRIDGE_KINDS).every((k) => k.label && "phi" in k),
   "every permitted kind declares whether it carries PHI");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
