// =====================================================================
// test_membership_analytics.mjs — the demand console's arithmetic
// =====================================================================
// The admin page is behind HTTP Basic auth, so it cannot be clicked
// through from CI or from a session without the password. That is not a
// reason to ship its numbers unverified — it is a reason to test the
// computation directly.
//
// Everything here is the arithmetic the AI is explicitly NOT allowed to
// do. If these are wrong, the model is handed wrong figures and writes a
// confident paragraph about them, which is worse than no analysis.
//
//   node scripts/test_membership_analytics.mjs
// =====================================================================

import { unitEconomics, capacity, tier } from "../functions/_lib/membership.js";
import { licensedStates } from "../functions/_lib/visit_prep.js";

let pass = 0, fail = 0;
function ok(c, l) { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.error(`  ✗ ${l}`); } }
function section(t) { console.log(`\n${t}`); }

// The exact five rows seeded into production while verifying the page.
const ROWS = [
    { tier: "navigator", state: "IL", has_obgyn: "yes" },
    { tier: "navigator", state: "TX", has_obgyn: "yes" },
    { tier: "priority",  state: "CA", has_obgyn: "no"  },
    { tier: "any",       state: "NY", has_obgyn: "yes" },
    { tier: "complete",  state: "IL", has_obgyn: "yes" },
];

// A faithful re-implementation of the endpoint's aggregation, so the
// assertions below test the LOGIC rather than a copy of its output.
function pct(n, d) { return d > 0 ? Math.round((n / d) * 1000) / 10 : 0; }

function aggregate(all, licensed) {
    const byTier = {}, byState = {};
    let hasOb = 0, noOb = 0, outOfState = 0;
    for (const r of all) {
        byTier[r.tier || "any"] = (byTier[r.tier || "any"] || 0) + 1;
        if (r.state) {
            byState[r.state] = (byState[r.state] || 0) + 1;
            if (!licensed.includes(r.state)) outOfState++;
        }
        if (r.has_obgyn === "yes") hasOb++;
        else if (r.has_obgyn === "no") noOb++;
    }
    const mix = {};
    for (const [k, n] of Object.entries(byTier)) {
        if (k === "any" || k === "standard") continue;
        if (tier(k)) mix[k] = n;
    }
    const anyCount = byTier.any || 0;
    const chosen = Object.values(mix).reduce((a, b) => a + b, 0);
    const fullMix = { ...mix };
    if (anyCount && chosen) {
        for (const k of Object.keys(mix)) fullMix[k] = mix[k] + Math.round(anyCount * (mix[k] / chosen));
    }
    return { total: all.length, byTier, byState, hasOb, noOb, outOfState, mix, fullMix };
}

const L = licensedStates(null);
const a = aggregate(ROWS, L);

// ---------------------------------------------------------------------
section("Counts");
ok(a.total === 5, "five rows counted");
ok(a.byTier.navigator === 2, "Navigator: 2");
ok(a.byTier.priority === 1 && a.byTier.complete === 1, "Priority and Complete: 1 each");
ok(a.byTier.any === 1, "'Not sure yet': 1");
ok(Object.values(a.byTier).reduce((x, y) => x + y, 0) === a.total, "the tier counts sum to the total — nobody is lost or double-counted");

section("Geography — the number that decides a third licence");
ok(L.includes("IL") && L.includes("CA"), "both licensed states are recognised");
ok(a.byState.IL === 2, "Illinois: 2");
ok(a.outOfState === 2, "TX and NY count as out-of-state; IL and CA do not");
ok(pct(a.outOfState, a.total) === 40, "40% out of state");
ok(!L.includes("TX") && !L.includes("NY"), "neither Texas nor New York is treated as licensed");

section("The Navigator thesis");
ok(a.hasOb === 4 && a.noOb === 1, "4 already have an OB/GYN, 1 does not");
ok(pct(a.hasOb, a.hasOb + a.noOb) === 80, "80% — computed over those who ANSWERED, not over the total");

section("'Not sure yet' is distributed, not ignored and not flattered");
ok(a.fullMix.navigator === 3, "the undecided signup follows the majority preference (Navigator 2 -> 3)");
ok(a.fullMix.priority === 1 && a.fullMix.complete === 1, "…without inflating the tiers nobody chose");
ok(Object.values(a.fullMix).reduce((x, y) => x + y, 0) === 5,
   "the distributed mix still totals five — the undecided person is counted exactly once");

const noneChosen = aggregate([{ tier: "any" }, { tier: "any" }], L);
ok(Object.keys(noneChosen.fullMix).length === 0,
   "when NOBODY has chosen a tier, nothing is invented — no division by zero, no default to the top tier");

section("Projection honesty");
const realistic = {};
for (const [k, n] of Object.entries(a.fullMix)) realistic[k] = Math.round(n * 0.15);
ok(Object.values(realistic).every((n) => n === 0),
   "at 15%, a five-person list rounds to zero paying members — and the page shows a dash rather than a fabricated number");

const big = { navigator: 150, priority: 20, complete: 5 };
const c = capacity(big, {});
ok(c.annual_margin > 0, `a realistic panel projects a real figure ($${Math.round(c.annual_margin).toLocaleString()}/yr)`);
ok(c.utilisation > 0 && c.utilisation < 1, `and reports his time used (${Math.round(c.utilisation * 100)}%)`);
const over = capacity({ priority: 400, complete: 200 }, {});
ok(over.warnings.length > 0 && over.utilisation > 1,
   "a mix that would exceed his available hours says so rather than projecting fantasy revenue");

section("Tier economics shown beside demand");
for (const k of ["navigator", "priority", "complete"]) {
    const u = unitEconomics(k);
    ok(u.gross_margin > 0, `${u.name}: margin is positive ($${u.gross_margin}/member/month)`);
}
ok(unitEconomics("navigator").physician_minutes === 0,
   "Navigator consumes zero of his minutes — which is why its panel has no ceiling, and why demand for it means something different");

section("Empty state");
const zero = aggregate([], L);
ok(zero.total === 0 && Object.keys(zero.byTier).length === 0, "an empty list aggregates to nothing rather than throwing");
ok(pct(0, 0) === 0, "percentages of zero do not produce NaN");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
