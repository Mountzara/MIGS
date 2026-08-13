// test_appeal_phi_gate.mjs — pins the 2026-08-12 PHI-egress fix.
//
// The appeal drafter used to send patient NAME, DOB, and MEMBER ID to the
// Anthropic API, which has no signed BAA. This test fails if that ever comes
// back: the payload the model sees must contain placeholders only, and the
// finished letter must still carry the real identifiers after local merge.
//
// Run: node scripts/test_appeal_phi_gate.mjs

import { mergeIdentity } from "../functions/_lib/billing_appeal.js";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`); }
};

console.log("appeal PHI gate\n");

const src = readFileSync(new URL("../functions/_lib/billing_appeal.js", import.meta.url), "utf8");

// 1. The outbound payload must not read identity fields off the record.
const payloadBlock = src.slice(src.indexOf("const userPayload"), src.indexOf("let result;"));
check("outbound payload uses placeholder tokens, not patient fields",
    payloadBlock.includes("{{PATIENT_NAME}}") &&
    payloadBlock.includes("{{MEMBER_ID}}") &&
    payloadBlock.includes("{{PATIENT_DOB}}"));
check("outbound payload does not interpolate patient.first_name/last_name",
    !/patient\s*&&\s*patient\.first_name/.test(payloadBlock),
    "found a first_name interpolation in the model payload");
check("outbound payload does not send member_id from insurance",
    !/insurance\s*&&\s*insurance\.member_id/.test(payloadBlock),
    "found member_id in the model payload");
check("outbound payload does not send a real date of service",
    !/claim\.visit_date/.test(payloadBlock),
    "found claim.visit_date in the model payload");

// 2. The local merge must restore the real values in the finished letter.
const letter = "Re: {{PATIENT_NAME}} (DOB {{PATIENT_DOB}}), member {{MEMBER_ID}}, claim {{CLAIM_NUMBER}} for DOS {{DATE_OF_SERVICE}}.";
const merged = mergeIdentity(letter, {
    patient: { first_name: "Jane", last_name: "Roe", dob: "1984-02-11" },
    insurance: { member_id: "XYZ123456" },
    claim: { clearinghouse_claim_id: "CLM-0009", visit_date: "2026-07-15" },
});
check("merge restores patient name", merged.includes("Jane Roe"));
check("merge restores DOB", merged.includes("1984-02-11"));
check("merge restores member id", merged.includes("XYZ123456"));
check("merge restores claim number + DOS",
    merged.includes("CLM-0009") && merged.includes("2026-07-15"));
check("no placeholder tokens survive the merge", !/\{\{[A-Z_]+\}\}/.test(merged), merged);

// 3. Missing data must not leave a raw token in a letter that gets mailed.
const sparse = mergeIdentity("Patient {{PATIENT_NAME}} member {{MEMBER_ID}}.", {});
check("absent identity degrades gracefully, no tokens left",
    !/\{\{[A-Z_]+\}\}/.test(sparse), sparse);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
