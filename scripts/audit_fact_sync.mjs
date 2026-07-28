#!/usr/bin/env node
// =====================================================================
// audit_fact_sync.mjs — canonical-facts reconciliation gate (2026-07-28)
// =====================================================================
// Two worktrees (cloud + Mac) edit this site, and content facts diverged
// from their data sources: the curriculum JSON still carried the
// never-established UIC affiliation and departed faculty after the pages
// were corrected, and internal program documents (docs/) were publicly
// served. This gate makes the CANONICAL FACTS a single enforced list
// across every DEPLOYABLE file (html/json/js outside the deploy
// exclusions), hermetically (no network):
//   * forbidden tokens: "UIC", "University of Illinois" (affiliation never
//     happened — user directive 2026-07-28)
//   * "Riley Lloyd" may appear ONLY within 250 chars of "departed"
//     (Year 3 addendum: duties assumed by Dr. Sankey-Thomas)
//   * curriculum pages must state the three-year / 36-month structure
//   * homepage must carry the CV-canonical award name and full GMIT
//     citation (2026;15:297–299)
//   * deploy staging must exclude docs/ (internal program documents,
//     e.g. the SFH risk-management letter, must never be public)
// =====================================================================
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
const EXCLUDE_DIRS = new Set([".git", ".github", ".wrangler", "node_modules", "companion-app", "build", "DerivedData", ".build", "scripts", "schema", "docs"]);
const files = [];
(function walk(dir) {
    for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        const st = statSync(p);
        if (st.isDirectory()) { if (!EXCLUDE_DIRS.has(e)) walk(p); continue; }
        if (/\.(html|json|js)$/.test(e) && !/\.(doc|docx)$/.test(e)) files.push(p);
    }
})(".");
let failed = 0;
const fail = (m) => { console.error("  ✗ " + m); failed++; };
for (const f of files) {
    let s; try { s = readFileSync(f, "utf8"); } catch { continue; }
    if (/\bUIC\b|University of Illinois/.test(s)) fail(`${f}: contains forbidden UIC / University of Illinois`);
    let i = -1;
    while ((i = s.indexOf("Riley Lloyd", i + 1)) !== -1) {
        if (!/depart/i.test(s.slice(Math.max(0, i - 250), i + 250))) { fail(`${f}: 'Riley Lloyd' without departure context`); break; }
    }
}
const cur = readFileSync("curriculum/cbg-migs/index.html", "utf8");
if (!/three-year/i.test(cur) || !/thirty-six months|36 months|Each of 36/i.test(cur)) fail("curriculum/cbg-migs: missing three-year / 36-month structure");
if (/\btwo-year\b|twenty-four months/i.test(cur)) fail("curriculum/cbg-migs: stale two-year phrasing");
const idx = readFileSync("index.html", "utf8");
if (!idx.includes("Excellence in Minimally Invasive Gynecology")) fail("index: award name drifted from CV canonical");
if (!/15:297/.test(idx)) fail("index: GMIT citation missing volume/pages (2026;15:297–299)");
const dep = readFileSync("scripts/deploy-prod.sh", "utf8");
if (!/--exclude='docs'/.test(dep) || !/--exclude='docs\/'/.test(dep)) fail("deploy-prod.sh: docs/ not excluded from BOTH staging paths (internal documents would go public)");
if (failed) { console.error(`\nfact-sync gate: ${failed} violation(s)`); process.exit(2); }
console.log(`fact-sync gate: CLEAN — ${files.length} deployable files agree with canonical facts; docs/ excluded from staging`);
