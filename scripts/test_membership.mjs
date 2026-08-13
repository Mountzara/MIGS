// =====================================================================
// test_membership.mjs — the membership model's legal and economic guards
// =====================================================================
// Two things must never silently break here.
//
//   1. NO TIER MAY SELL A COVERED MEDICAL SERVICE. That is what turns a
//      membership into unlicensed insurance and, for an insured patient,
//      into duplicate billing. The failure mode is not a crash — it is a
//      line of marketing copy added a year from now that reads
//      "includes your annual visit". So the check runs over the real
//      tier definitions, and over the WORDING, not just a flag.
//
//   2. A TIER MUST NOT LOSE MONEY. For a solo surgeon the binding
//      constraint is minutes, not dollars: a tier priced above its cash
//      cost still destroys the practice if it crowds out operating time.
//
//   node scripts/test_membership.mjs
// =====================================================================

import {
    TIERS, tier, validateTierLegality, eligibility, unitEconomics,
    capacity, maxPanel, COMPLIANCE_REVIEW, SELF_PAY_PRINCIPLES,
    DEFAULT_ASSUMPTIONS,
} from "../functions/_lib/membership.js";

let pass = 0, fail = 0;
function ok(c, l) { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.error(`  ✗ ${l}`); } }
function section(t) { console.log(`\n${t}`); }

// ---------------------------------------------------------------------
section("Every shipped tier is lawful in this structure");
for (const t of TIERS) {
    const v = validateTierLegality(t);
    ok(v.ok, `${t.name} sells no covered medical service${v.ok ? "" : " — " + v.problems.join("; ")}`);
}
ok(TIERS.every((t) => (t.benefits || []).every((b) => b.covered_service === false)),
   "every benefit on every tier is explicitly flagged as a non-covered service");

section("…and the validator actually catches the mistake it exists for");
let bad = validateTierLegality({
    name: "Bad", tagline: "", summary: "",
    benefits: [{ label: "Your annual visit", covered_service: true }],
});
ok(!bad.ok, "a benefit flagged as a covered service fails");
ok(/insurance/i.test(bad.problems[0]), "…and says why it matters");

bad = validateTierLegality({
    name: "Bad", tagline: "Covers your surgery", summary: "",
    benefits: [{ label: "Access", covered_service: false }],
});
ok(!bad.ok, "WORDING that promises to cover surgery fails even when every flag is correct");

for (const [copy, why] of [
    ["Free consult with every membership", "free covered service"],
    ["Unlimited visits included", "unlimited covered services"],
    ["No copay for members", "absorbing cost-sharing"],
]) {
    const r = validateTierLegality({ name: "X", tagline: copy, summary: "", benefits: [] });
    ok(!r.ok, `"${copy}" is rejected (${why})`);
}

// ---------------------------------------------------------------------
section("Federal beneficiaries are excluded by default");
let e = eligibility({ payerKind: "medicare", tierKey: "priority" });
ok(!e.eligible && e.requires_override, "a Medicare patient cannot be enrolled without an override");
ok(/1320a-7a/.test(e.reason), "…and the reason cites the inducement CMP, so it is checkable");

e = eligibility({ payerKind: "medicaid", tierKey: "surgical" });
ok(!e.eligible, "Medicaid is excluded too");
e = eligibility({ payerKind: "tricare", tierKey: "priority" });
ok(!e.eligible, "TRICARE is treated as federal");

e = eligibility({ payerKind: "medicare", tierKey: "priority", override: { rationale: "x" } });
ok(!e.eligible, "a half-filled override does NOT unlock enrolment");
e = eligibility({ payerKind: "medicare", tierKey: "priority",
                  override: { rationale: "counsel reviewed 2026-08-13", approved_by: "counsel" } });
ok(e.eligible && e.disclosures.length > 0, "a complete, attributed override enrols — and attaches disclosures");

section("…while commercial and self-pay flow normally");
e = eligibility({ payerKind: "commercial", tierKey: "priority" });
ok(e.eligible && !e.requires_override, "a commercial patient may enrol");
ok(e.disclosures.some((d) => /not insurance/i.test(d)), "the 'not insurance' disclosure is attached");
ok(e.disclosures.some((d) => /cancel/i.test(d)), "cancellation terms are disclosed");
ok(eligibility({ payerKind: "self_pay", tierKey: "surgical" }).eligible, "a self-pay patient may enrol");

section("The free tier is open to everyone, including federal beneficiaries");
ok(eligibility({ payerKind: "medicare", tierKey: "standard" }).eligible,
   "Standard has no fee, so there is nothing of value to induce with");

// ---------------------------------------------------------------------
section("Unit economics — every paid tier makes money");
for (const key of ["priority", "surgical"]) {
    const u = unitEconomics(key);
    ok(u.gross_margin > 0, `${u.name}: margin is positive ($${u.gross_margin}/member/month)`);
    ok(u.margin_pct >= 0.35, `${u.name}: margin is ${(u.margin_pct * 100).toFixed(0)}%, not thin`);
    ok(u.price_month > u.breakeven_price, `${u.name}: priced above its $${u.breakeven_price} break-even`);
}
const std = unitEconomics("standard");
ok(std.physician_minutes === 0,
   "the free tier consumes ZERO physician minutes — anything needing his judgement escalates to a billable online digital E/M rather than being absorbed");
ok(std.gross_margin > -5, `the free tier costs almost nothing ($${Math.abs(std.gross_margin).toFixed(2)}/member/month)`);
ok(unitEconomics("surgical").physician_minutes > unitEconomics("priority").physician_minutes,
   "Surgical inherits Priority's minutes — 'Everything in Priority' is costed, not free");

section("Automation is what makes the pricing work — and the model proves it");
for (const key of ["priority", "surgical"]) {
    const u = unitEconomics(key);
    ok(u.automated_minutes > u.physician_minutes,
       `${u.name}: most of the work is automated (${u.automated_minutes} auto vs ${u.physician_minutes} his)`);
    ok(u.cost_without_automation > u.price_month,
       `${u.name}: WITHOUT automation this tier would cost $${u.cost_without_automation.toFixed(0)} to deliver and lose money at $${u.price_month}`);
    ok(u.automation_saving > 0, `${u.name}: the saving is quantified ($${u.automation_saving.toFixed(0)}/member/month)`);
}

section("…and the model reports a loss when there is one");
const loss = unitEconomics("priority", { opportunity_cost_per_hour: 5000 });
ok(loss.gross_margin < 0, "an implausibly high opportunity cost produces a loss");
ok(/LOSS/.test(loss.verdict) && /\$\d+/.test(loss.verdict), "…and the verdict names the price it would need");

// ---------------------------------------------------------------------
section("Capacity — minutes are the binding constraint, not dollars");
let c = capacity({ priority: 20, surgical: 5 });
ok(c.monthly_revenue > 0 && c.monthly_margin > 0, "a modest panel is profitable");
ok(c.minutes_budgeted > 0, "the time budget is reported, not implied");

c = capacity({ priority: 500, surgical: 200 });
ok(c.utilisation > 1, "an oversized panel exceeds 100% utilisation");
ok(c.warnings.some((w) => /operating schedule/.test(w)),
   "…and the warning names what actually gets sacrificed for a solo surgeon");

c = capacity({ priority: 1, surgical: 0 });
ok(c.warnings.length === 0, "a small panel raises no warning");

section("Max panel");
const m = maxPanel();
ok(m.members > 0, `a realistic ceiling is computed (${m.members} members)`);
ok(m.utilisation <= 1.02, "the ceiling does not itself exceed the time budget");
ok(m.annual_margin > 0, `and it is worth having ($${Math.round(m.annual_margin).toLocaleString()}/yr)`);
const bigger = maxPanel({}, { weekly_capacity_hours: DEFAULT_ASSUMPTIONS.weekly_capacity_hours * 2 });
ok(bigger.members > m.members, "doubling the time budget roughly doubles the panel — the model is actually reading its inputs");

// ---------------------------------------------------------------------
section("Compliance material is present, not implied");
ok(COMPLIANCE_REVIEW.length >= 5, "the review checklist has real substance");
ok(COMPLIANCE_REVIEW.every((c) => c.topic && c.note), "every item states the topic and the concern");
ok(COMPLIANCE_REVIEW.some((c) => /1320a-7a/.test(c.cite || "")), "the inducement statute is cited");
ok(COMPLIANCE_REVIEW.some((c) => /insurance code/i.test(c.cite || "")), "the insurance-code risk is cited");
ok(SELF_PAY_PRINCIPLES.length >= 5, "self-pay guidance is separate from membership, as designed");
ok(SELF_PAY_PRINCIPLES.some((p) => /independent of the membership/i.test(p)),
   "…and explicitly warns against bundling the two");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
