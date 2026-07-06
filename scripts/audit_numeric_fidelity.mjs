#!/usr/bin/env node
// =====================================================================
// audit_numeric_fidelity.mjs — deploy gate for effect-estimate accuracy.
// =====================================================================
// Every decimal effect estimate (OR/RR/HR/AUC/CI bound, shape d.dd) shown in
// a deep-dive modal's Key-Findings section MUST be traceable to that modal's
// own EMBEDDED verbatim PubMed abstract — literally or within 2-decimal
// rounding (see functions/_lib/post_format.js::auditNumericFidelity for the
// rationale). This blocks a generator misextraction or an authored fabrication
// from presenting an unverifiable number as a clinical finding.
//
// Runs against the LIVE published corpus (post bodies live in R2, updated
// independently of code deploys), or a local file with --file.
//
// Usage:
//   node scripts/audit_numeric_fidelity.mjs                 # audit live corpus
//   node scripts/audit_numeric_fidelity.mjs --file a.json   # audit one post JSON
//   MZ_SITE_BASE=https://mountzara.com node scripts/audit_numeric_fidelity.mjs
// Exit: 0 = clean, 2 = at least one untraceable effect number.
// =====================================================================
import { readFileSync } from "fs";
import { auditNumericFidelity } from "../functions/_lib/post_format.js";

const BASE = process.env.MZ_SITE_BASE || "https://mountzara.com";
const args = process.argv.slice(2);
const fileIdx = args.indexOf("--file");

async function loadLive() {
    const cb = `?cb=${Date.now()}`;
    const list = await (await fetch(`${BASE}/api/posts${cb}`)).json();
    const posts = [];
    for (const p0 of list.posts || []) {
        const p = await (await fetch(`${BASE}/api/posts/${p0.id}?cb=${Date.now()}`)).json();
        posts.push(p);
    }
    return posts;
}

const posts = fileIdx >= 0
    ? [JSON.parse(readFileSync(args[fileIdx + 1], "utf8"))]
    : await loadLive().catch((e) => { console.error("could not load live corpus:", e.message); process.exit(0); /* network-flaky = skip, not block */ });

let failed = 0, checked = 0;
for (const p of posts) {
    const a = auditNumericFidelity(p);
    checked++;
    if (a.ok) {
        console.log(`  ✓  ${p.id}: effect estimates traceable to embedded abstracts`);
    } else {
        failed++;
        console.error(`  ✗  ${p.id}: ${a.problems.length} untraceable effect number(s)`);
        a.problems.slice(0, 8).forEach((pr) => console.error(`        ${pr}`));
    }
}
if (failed) {
    console.error(`\nnumeric-fidelity gate: ${failed}/${checked} post(s) present an unverifiable effect number as a finding.`);
    process.exit(2);
}
console.log(`\nnumeric-fidelity gate: CLEAN — all ${checked} post(s) traceable.`);
process.exit(0);
