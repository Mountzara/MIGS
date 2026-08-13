// test_denial_router.mjs — safety tests for the tiered-autonomy router.
//
// These are not style tests. Each one pins a rule that, if it regressed,
// would let a machine submit a claim under Dr. Mabini's NPI that he never
// attested to. Run: node scripts/test_denial_router.mjs
//
// Every failure mode below was a deliberate design constraint, so the test
// names read as the rule they protect.

import { routeDenial, TIER_A_FIXES } from "../functions/_lib/denial_router.js";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`); }
}
const okDeadline = { due: "2026-11-01", days: 120, source: "https://example.org/policy", reason: "ok" };

console.log("denial_router safety rules\n");

// 1. Federal payer + clinical remedy must NEVER auto-execute.
for (const kind of ["medicare", "medicaid", "tricare"]) {
    const r = routeDenial({ carcCodes: ["50"], payerKind: kind, changesClinical: true, deadline: okDeadline });
    check(`${kind} + clinical change is held for physician`,
        r.tier === "C_hold" && r.approval_state === "awaiting_physician", `got ${r.tier}`);
}

// 2. Medical-necessity denials are clinical even on commercial payers.
{
    const r = routeDenial({ carcCodes: ["50"], payerKind: "commercial", deadline: okDeadline });
    check("commercial medical-necessity → physician approval, never auto",
        r.tier === "B_physician_approve", `got ${r.tier}`);
}

// 3. An unverified/absent deadline blocks and escalates — never a guess.
{
    const r = routeDenial({ carcCodes: ["4"], payerKind: "commercial",
        proposedFixes: ["dx_pointer_range"], deadline: { due: null, reason: "unverified" } });
    check("unverified appeal window → C_hold and blocking",
        r.tier === "C_hold" && r.blocking === true, `got ${r.tier} blocking=${r.blocking}`);
}

// 4. Unknown CARC can never reach Tier A.
{
    const r = routeDenial({ carcCodes: ["99999"], payerKind: "commercial",
        proposedFixes: ["dx_pointer_range"], deadline: okDeadline });
    check("unrecognized CARC never auto-executes", r.tier !== "A_auto", `got ${r.tier}`);
}

// 5. A fix outside the whitelist disqualifies the whole action from Tier A.
{
    const r = routeDenial({ carcCodes: ["16"], payerKind: "commercial",
        proposedFixes: ["dx_pointer_range", "rewrite_clinical_note"], deadline: okDeadline });
    check("non-whitelisted fix drops out of Tier A", r.tier !== "A_auto", `got ${r.tier}`);
}

// 6. The intended Tier A path DOES work (or the tier is useless).
{
    const r = routeDenial({ carcCodes: ["16"], payerKind: "commercial",
        proposedFixes: ["dx_pointer_range"], deadline: okDeadline });
    check("pure clerical + whitelisted fix auto-executes",
        r.tier === "A_auto" && r.strategy === "corrected_claim", `got ${r.tier}/${r.strategy}`);
}

// 7. Patient-responsibility / contractual is not a fight to pick.
{
    const r = routeDenial({ carcCodes: ["1", "2"], payerKind: "commercial", deadline: okDeadline });
    check("deductible/coinsurance routes to patient_bill, not appeal",
        r.strategy === "patient_bill" && r.appealable === false, `got ${r.strategy}`);
    const w = routeDenial({ carcCodes: ["45"], payerKind: "commercial", deadline: okDeadline });
    check("contractual adjustment routes to write_off", w.strategy === "write_off", `got ${w.strategy}`);
}

// 8. No fix identified → physician, never silent auto.
{
    const r = routeDenial({ carcCodes: ["16"], payerKind: "commercial", proposedFixes: [], deadline: okDeadline });
    check("no deterministic fix → physician approval", r.tier === "B_physician_approve", `got ${r.tier}`);
}

// 9. Every whitelisted Tier-A fix documents why it is safe.
{
    const missing = Object.entries(TIER_A_FIXES).filter(([, v]) => !v.why_safe);
    check("every Tier-A fix carries a why_safe justification", missing.length === 0,
        missing.map(([k]) => k).join(", "));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
