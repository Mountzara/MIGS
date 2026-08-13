// test_credentialing_wizard.mjs — proves the BCBS IL enrollment plan is real.
//
// Two kinds of proof:
//   1. STRUCTURAL — the wizard produces a complete, ordered plan, separates
//      payer-published steps from unverified assumptions, and never invents a
//      turnaround.
//   2. EVIDENTIARY — every source URL the plan cites is FETCHED LIVE. This is
//      the check that distinguishes researched data from hallucinated data: a
//      fabricated bcbsil.com path 404s.
//
// Run: node scripts/test_credentialing_wizard.mjs [--live]
//      --live performs the network verification (slower).

import { readFileSync } from "node:fs";
import { buildPlan, planUrls, readiness, TASK_KIND } from "../functions/_lib/credentialing_wizard.js";

const LIVE = process.argv.includes("--live");
let pass = 0, fail = 0;
const check = (n, ok, d = "") => {
    if (ok) { pass++; console.log(`  ok   ${n}`); }
    else { fail++; console.log(`  FAIL ${n}${d ? " — " + d : ""}`); }
};

const db = JSON.parse(readFileSync(new URL("../data/payer_credentialing.json", import.meta.url), "utf8"));
// Select the COMMERCIAL BCBSIL record specifically. Several other payer names
// contain the string "Blue Cross and Blue Shield of Illinois" — notably
// "Blue Cross Community Health Plans (BCCHP) — Blue Cross and Blue Shield of
// Illinois" (the Medicaid MCO) and the BlueCard record. A loose match silently
// tested the Medicaid plan instead of the commercial one.
const rec = db.payers.find((p) => /^Blue Cross and Blue Shield of Illinois \(BCBSIL\)/i.test(p.name))
    || db.payers.find((p) => /Blue Cross and Blue Shield of Illinois/i.test(p.name) && !/BCCHP|BlueCard|Community/i.test(p.name));

console.log("BCBS IL credentialing wizard\n");
check("BCBSIL record present in the payer catalog", Boolean(rec), "not found");
if (!rec) { console.log("\n0 passed, 1 failed"); process.exit(1); }

const plan = buildPlan(rec);

// --- structural -------------------------------------------------------------
check("plan builds with prerequisites, steps and confirmations",
    plan.counts.prerequisites > 0 && plan.counts.steps > 0 && plan.counts.confirm > 0,
    JSON.stringify(plan.counts));
check("every published step carries a source URL",
    plan.sourced_ratio === 1, `sourced_ratio=${plan.sourced_ratio.toFixed(2)}; warnings=${plan.warnings.join(" | ")}`);
check("no unsourced-step warnings", plan.warnings.length === 0, plan.warnings.join(" | "));
check("tasks are sequentially ordered",
    plan.tasks.every((t, i) => t.seq === i + 1));
check("enrollment portal captured", Boolean(plan.payer.portal), "no portal URL");

// The anti-fabrication rule: BCBSIL publishes no decision turnaround.
check("turnaround is not invented",
    /not publish/i.test(plan.turnaround), plan.turnaround.slice(0, 90));

// Unverified assumptions must be surfaced as confirm tasks, never as requirements.
const confirms = plan.tasks.filter((t) => t.kind === TASK_KIND.CONFIRM);
check("unverified claims become explicit confirm tasks", confirms.length > 0);
check("confirm tasks are never marked sourced",
    confirms.every((t) => t.sourced === false));

// Readiness gate must block before prerequisites are met.
const r0 = readiness(plan);
check("readiness blocks while prerequisites are open",
    r0.ready_to_apply === false && r0.open_prerequisites === plan.counts.prerequisites);
for (const t of plan.tasks) if (t.kind === TASK_KIND.PREREQ) t.status = "done";
const r1 = readiness(plan);
check("readiness clears once prerequisites are done", r1.ready_to_apply === true);

// Domain sanity — the plan must reference the real gates for this payer.
const all = JSON.stringify(plan).toLowerCase();
check("plan references CAQH", all.includes("caqh"));
check("plan references the Provider Onboarding Form", all.includes("onboarding form"));
check("plan references the Illinois/Lake County service-area gate",
    all.includes("lake county") || all.includes("illinois or lake"));
check("plan references credentialing before participation", all.includes("credential"));

// --- evidentiary ------------------------------------------------------------
const urls = planUrls(plan);
console.log(`\n  ${urls.length} distinct source URLs cited by this plan`);
if (!LIVE) {
    console.log("  (run with --live to fetch and verify each one)");
} else {
    console.log("  verifying live…\n");
    let okCount = 0, badCount = 0;
    const bad = [];
    for (const u of urls) {
        let status = 0;
        try {
            let res = await fetch(u, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(20000) });
            if (res.status === 405 || res.status === 403 || res.status === 501) {
                res = await fetch(u, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(25000) });
            }
            status = res.status;
        } catch { status = 0; }
        if (status >= 200 && status < 400) { okCount++; }
        else { badCount++; bad.push(`${status || "ERR"}  ${u}`); }
    }
    console.log(`  live: ${okCount} resolved, ${badCount} failed`);
    if (bad.length) console.log("  failures:\n" + bad.map((b) => "    " + b).join("\n"));
    check("at least 80% of cited sources resolve live",
        urls.length > 0 && okCount / urls.length >= 0.8,
        `${okCount}/${urls.length}`);
    check("the enrollment portal itself resolves",
        !bad.some((b) => b.includes(plan.payer.portal)), plan.payer.portal);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
