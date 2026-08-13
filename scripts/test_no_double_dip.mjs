// =====================================================================
// test_no_double_dip.mjs — the separation must hold in both directions
// =====================================================================
// "I will be taking NO chances with 'double dipping' and this
// infrastructure better be designed so this is impossible."
//
// Impossible means enforced, and enforced means tested. Two directions:
//
//   CLAIM SIDE — a service the membership fee already paid for must be
//   refused when a claim is built for that member. Not warned about.
//
//   OFFER SIDE — a membership benefit must never describe a service that
//   carries a billing code, so the offer cannot drift into the claim's
//   territory either.
//
// And one guarantee that matters as much as both: legitimate care must
// NEVER be suppressed. A member who is under-billed has still been
// failed, and a guard that blocks surgery would be switched off within a
// day — taking the real protection with it.
//
//   node scripts/test_no_double_dip.mjs
// =====================================================================

import {
    TIER_PAID_FOR, NEVER_BLOCKED, canBill, screenClaim,
    screenTierBenefits, separationStatement,
    BILLABLE_SERVICE_NOUNS, PROVISION_VERBS, DISCLOSURE_PHRASES,
} from "../functions/_lib/no_double_dip.js";
import { TIERS, tier } from "../functions/_lib/membership.js";

let pass = 0, fail = 0;
function ok(c, l) { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.error(`  ✗ ${l}`); } }
function section(t) { console.log(`\n${t}`); }

// ---------------------------------------------------------------------
section("CLAIM SIDE — a paid-for service cannot be billed again");

ok(!canBill("99421", "priority").allowed,
   "a Priority member's online digital E/M (99421) is REFUSED — their fee already bought the messaging");
ok(!canBill("99423", "priority").allowed, "…and 99423, the longest one");
ok(!canBill("99422", "complete").allowed, "Complete blocks it too");
ok(!canBill("99358", "complete").allowed,
   "Complete also blocks prolonged non-face-to-face service — its fee covers the review sessions");
ok(!canBill("99367", "complete").allowed, "…and care-team conference codes, which its coordination benefit covers");

ok(canBill("99421", "standard").allowed,
   "a STANDARD patient's 99421 is allowed — the free tier bought nothing, so billing it is correct, not double dipping");
ok(canBill("99421", "navigator").allowed,
   "Navigator allows it too: Navigator buys documents, not messaging with him");

section("…and the refusal explains itself to whoever hits it");
const r = canBill("99422", "priority");
ok(/already paid for/.test(r.reason), "the reason says the fee already covered it");
ok(/twice/.test(r.reason), "…and names the actual harm");

// ---------------------------------------------------------------------
section("LEGITIMATE CARE IS NEVER SUPPRESSED");
let conflicts = [];
for (const code of NEVER_BLOCKED) {
    for (const t of Object.keys(TIER_PAID_FOR)) {
        if (!canBill(code, t).allowed) conflicts.push(`${code}@${t}`);
    }
}
ok(conflicts.length === 0,
   `no protected code is blocked at any tier (${NEVER_BLOCKED.length} codes x ${Object.keys(TIER_PAID_FOR).length} tiers)${conflicts.length ? " — " + conflicts.join(", ") : ""}`);

ok(canBill("58571", "complete").allowed, "a laparoscopic hysterectomy is billed normally for the top tier");
ok(canBill("99214", "complete").allowed, "so is a real office visit");
ok(canBill("76830", "priority").allowed, "so is a pelvic ultrasound");
ok(canBill("58300", "priority").allowed, "so is an IUD insertion");

section("Whole-claim screening");
let s = screenClaim([{ cpt: "58571" }, { cpt: "99422" }, { cpt: "99214" }], "priority");
ok(!s.ok, "a mixed claim with one offending line fails");
ok(s.blocked.length === 1 && s.blocked[0].code === "99422", "…and only the offending line is blocked");
ok(s.allowed.length === 2, "…while the surgery and the office visit pass through");
ok(/cannot be billed/.test(s.summary) && /twice/.test(s.summary), "the summary is written for a human, not a log");

s = screenClaim([{ cpt: "58571" }, { cpt: "99422" }], "standard");
ok(s.ok, "the same claim is entirely fine for a Standard patient");

s = screenClaim([{ procedure_code: "99421" }], "priority");
ok(!s.ok, "the screener reads procedure_code as well as cpt — field naming varies across the pipeline");
s = screenClaim([{ cpt: "99421-25" }], "priority");
ok(!s.ok, "a modifier suffix does not smuggle a blocked code through");
s = screenClaim([{ cpt: " 99421 " }], "priority");
ok(!s.ok, "…nor does whitespace");
ok(screenClaim([], "priority").ok, "an empty claim is not an error");

// ---------------------------------------------------------------------
section("OFFER SIDE — no shipped benefit describes a billable service");
for (const t of TIERS) {
    const v = screenTierBenefits(t);
    ok(v.ok, `${t.name}${v.ok ? "" : " :: " + v.problems.map((p) => p.benefit).join("; ")}`);
}

section("…and the screener still catches a real drift");
for (const bad of [
    "Your annual exam included at no cost",
    "Unlimited office visits",
    "Free ultrasound with every membership",
    "We cover your biopsy",
    "Surgery included",
]) {
    ok(!screenTierBenefits({ benefits: [{ label: bad }] }).ok, `rejected: "${bad}"`);
}

section("…without flagging the disclosures, which say the opposite");
for (const good of [
    "Your visits, procedures and surgery billed to your health plan",
    "Care coordination — imaging, labs and outside records chased on your behalf",
    "A written second opinion on the records and imaging you already have",
    "An index of your records — what exists, when, and what your doctor may not have seen",
    "No membership fee, and no charge from this practice beyond your plan's cost-sharing",
]) {
    ok(screenTierBenefits({ benefits: [{ label: good }] }).ok, `allowed: "${good.slice(0, 58)}…"`);
}

// ---------------------------------------------------------------------
section("What the patient is told");
const std = separationStatement("standard");
ok(/billed to your health plan/.test(std), "Standard says care is billed to the plan");
ok(/pay this practice nothing beyond/.test(std), "…and that there is no other charge");

const pri = separationStatement("priority");
ok(/still billed to your health plan/.test(pri), "a paid tier says insurance is UNCHANGED");
ok(/blocked from submitting a claim/.test(pri), "…and that the separation is enforced in software, not just promised");
ok(/cannot be billed twice/.test(pri), "…in those words");

const nav = separationStatement("navigator");
ok(/nothing that could be billed twice/.test(nav),
   "Navigator says the truer thing for it: nothing it sells has a billing code at all");

section("Every paid tier states the insurance position on the tier itself");
for (const t of TIERS.filter((x) => x.price_month > 0)) {
    ok(Boolean(t.insurance_note), `${t.name} carries an insurance_note, so it survives into every rendering`);
    ok(/health plan/.test(t.insurance_note || ""), `${t.name}: it names the health plan explicitly`);
}
ok(/no membership fee/i.test(tier("standard").summary),
   "Standard's own summary says there is no fee and never will be");
ok(/do not add care/i.test(tier("standard").summary),
   "…and that the paid tiers add access, not care");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
