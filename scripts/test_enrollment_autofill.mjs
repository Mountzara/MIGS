// =====================================================================
// test_enrollment_autofill.mjs
// =====================================================================
// The two autofill paths, tested where they can fail dangerously:
//
//   * the PATIENT-DOCUMENT GATE. This pipeline deliberately does NOT
//     de-identify, so the gate is the only thing standing between a
//     misrouted chart and an AI processor. It must refuse on structural
//     markers, and it must NOT refuse a legitimate W-9 — a gate that
//     blocks everything is uninstalled within a day.
//   * the EXTRACTION VALIDATOR. A proposed value with no traceable quote
//     is worse than a blank box, because a blank box gets checked.
//
//   node scripts/test_enrollment_autofill.mjs
// =====================================================================

import {
    looksLikePatientDocument, validateExtraction, buildPrompt,
    EXTRACTABLE_FIELDS, DOC_TYPES,
} from "../functions/_lib/enrollment_extract.js";

let pass = 0, fail = 0;
function ok(c, l) { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.error(`  ✗ ${l}`); } }
function section(t) { console.log(`\n${t}`); }

// ---------------------------------------------------------------------
section("Patient-document gate — must REFUSE");

const chart = `Patient Name: Jane Doe
DOB: 03/14/1982
MRN: 88213345
Diagnosis: N80.1 endometriosis of ovary
Date of Service: 06/02/2026`;
let g = looksLikePatientDocument(chart);
ok(g.patient, "a chart note is refused");
ok(g.reasons.length >= 1, "…with a stated reason");

g = looksLikePatientDocument("Member ID: XZQ889201344\nSubscriber: Jane Doe\nPlan: BCBS IL");
ok(g.patient, "a member/subscriber ID is refused");

g = looksLikePatientDocument("Explanation of Benefits\nClaim Number: 2026155000123\nAllowed: 412.00");
ok(g.patient, "an EOB is refused");

g = looksLikePatientDocument("Operative report: laparoscopic hysterectomy performed without complication.");
ok(g.patient, "an operative report is refused");

// ---------------------------------------------------------------------
section("Patient-document gate — must ADMIT the practice's own paperwork");

const w9 = `Form W-9 Request for Taxpayer Identification Number
Name: Christopher Mabini DO PC
Business name/disregarded entity name: Mount Zara
Federal tax classification: C Corporation
Address: 1 N State St, Suite 400
City, state, ZIP: Chicago, IL 60602-3300
Employer identification number: 36-1234567`;
g = looksLikePatientDocument(w9);
ok(!g.patient, "a W-9 is ADMITTED — its ZIP, address and TIN are expected here, not disqualifying");

const ptan = `Dear Provider,
Your Medicare enrollment application has been approved.
Provider Transaction Access Number (PTAN): 14X9928
NPI: 1245319599
Effective date of billing privileges: 07/01/2026`;
g = looksLikePatientDocument(ptan);
ok(!g.patient, "a Medicare PTAN letter is admitted");

const welcome = `Welcome to Claim.MD
Your submitter ID is MZ88214.
Account contact: billing@mountzara.com
Phone: 312-555-0100`;
g = looksLikePatientDocument(welcome);
ok(!g.patient, "a clearinghouse welcome letter is admitted");

const license = `State of Illinois Department of Financial and Professional Regulation
Physician and Surgeon License
License Number: 036-123456
Expires: 07/31/2027`;
g = looksLikePatientDocument(license);
ok(!g.patient, "a state medical licence is admitted");

// ---------------------------------------------------------------------
section("Extraction validation — evidence or it does not ship");

let r = validateExtraction({
    legal_name: { value: "Christopher Mabini DO PC", quote: "Name: Christopher Mabini DO PC", confidence: "high" },
});
ok(r.accepted.legal_name, "a quoted value is accepted");
ok(r.accepted.legal_name.confidence === "high", "confidence is carried through");

r = validateExtraction({ legal_name: { value: "Christopher Mabini DO PC", confidence: "high" } });
ok(!r.accepted.legal_name, "a value with NO quote is dropped");
ok(r.rejected.some((x) => /quote/.test(x.why)), "…and says why");

r = validateExtraction({ legal_name: { value: "", quote: "x", confidence: "high" } });
ok(!r.accepted.legal_name, "an empty value is dropped");

section("Extraction validation — format checks catch OCR damage");

r = validateExtraction({ npi_individual: { value: "1245319599", quote: "NPI: 1245319599", confidence: "high" } });
ok(r.accepted.npi_individual, "a valid NPI is accepted");

r = validateExtraction({ npi_individual: { value: "1245319598", quote: "NPI: 1245319598", confidence: "high" } });
ok(!r.accepted.npi_individual, "an NPI failing the check digit is dropped — this is what an OCR misread looks like");
ok(r.rejected.some((x) => /check digit/.test(x.why)), "…and names the reason");

r = validateExtraction({ tin: { value: "3612345", quote: "EIN 3612345", confidence: "high" } });
ok(!r.accepted.tin, "a short TIN is dropped");

r = validateExtraction({ taxonomy_code: { value: "207V0", quote: "Taxonomy 207V0", confidence: "low" } });
ok(!r.accepted.taxonomy_code, "a malformed taxonomy code is dropped");

r = validateExtraction({ entity_type: { value: "S-Corp-ish", quote: "S-Corp-ish", confidence: "low" } });
ok(!r.accepted.entity_type, "an entity type outside the four allowed values is dropped");

section("Extraction validation — ZIP warns rather than blocks");
r = validateExtraction({ practice_zip: { value: "60602", quote: "Chicago IL 60602", confidence: "high" } });
ok(r.accepted.practice_zip, "a five-digit ZIP is still accepted");
ok(/ZIP\+4/.test(r.accepted.practice_zip.warn || ""), "…but warns that Medicare needs ZIP+4");
r = validateExtraction({ practice_zip: { value: "60602-3300", quote: "60602-3300", confidence: "high" } });
ok(!r.accepted.practice_zip.warn, "a full ZIP+4 warns about nothing");

section("Extraction validation — the model cannot invent a field");
r = validateExtraction({
    bank_account: { value: "123456789", quote: "Account 123456789", confidence: "high" },
    legal_name: { value: "Mount Zara", quote: "Mount Zara", confidence: "high" },
});
ok(!r.accepted.bank_account, "a field outside the allowlist is refused even with a quote");
ok(r.accepted.legal_name, "…while the legitimate field on the same document still lands");
ok(r.rejected.some((x) => x.key === "bank_account"), "the refusal is reported, not silent");

section("Prompt + doc types");
const prompt = buildPrompt("w9", "Name: Test");
ok(prompt.includes("VERBATIM"), "the prompt demands verbatim quotes");
ok(prompt.includes("not_practice_document"), "the prompt gives the model a way to flag a patient document");
ok(prompt.includes("Never infer, complete or correct"), "the prompt forbids guessing");
ok(DOC_TYPES.every((d) => d.key && d.label), "every doc type has a key and a label");
ok(!DOC_TYPES.some((d) => /patient|chart|operative|encounter/i.test(d.label)),
   "no clinical document type is offered — this pipeline must not invite one");
ok(EXTRACTABLE_FIELDS.has("legal_name") && !EXTRACTABLE_FIELDS.has("diagnosis"),
   "the allowlist covers identity fields and nothing clinical");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
