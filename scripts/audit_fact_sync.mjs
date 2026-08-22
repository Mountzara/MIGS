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
    // 2026-08-08 user directive: Dr. Kothari is NOT final faculty — must not
    // appear anywhere on the site (source PDFs in docs/ mention her; docs/
    // are excluded from deploys, but page content must never quote her in).
    if (/Kothari/i.test(s)) fail(`${f}: contains 'Kothari' — not final faculty, forbidden on site`);
    let i = -1;
    while ((i = s.indexOf("Riley Lloyd", i + 1)) !== -1) {
        if (!/depart/i.test(s.slice(Math.max(0, i - 250), i + 250))) { fail(`${f}: 'Riley Lloyd' without departure context`); break; }
    }
}
// ---------------------------------------------------------------------
// Operative-record reconciliation (2026-08-11). The owner caught stale
// surgical metrics TWICE after a "complete" CV reconciliation: once in
// the curriculum page's DETAIL_DATA modal blob, once in
// assets/js/domain-modals.js — both JS string blobs that markup-oriented
// sweeps missed, plus a ">95% same-day" claim that OVERCLAIMED against
// his CV's 90.4%. His directive: stop journaling lessons, enforce them.
// These regexes run against the RAW BYTES of every deployable html/json/
// js file above — markup, JS blobs, modal content, JSON alike.
// Canonical source: cite_audit/authoritative-cv-2026-08.txt + SYSTEM_MAP §7.10.
const STALE_RECORD = [
    [/\b435 (?:operative )?cases\b/, "435 cases (canonical: 444, Sept 2023 – May 2026)"],
    [/\b760 (?:distinct )?procedures\b/, "760 procedures (canonical: 1,511)"],
    [/2\.1%[^\n]{0,40}complication/i, "2.1% complication rate (canonical: ClassIntra 2.9% / Clavien–Dindo 0.2%)"],
    [/243% of the required/i, "243%-of-required-volume claim (not in the CV)"],
    [/grew 63%/i, "63% year-over-year growth claim (not in the CV)"],
    [/February 2026 the running total/i, "Feb-2026 running-total phrasing (log runs through May 2026)"],
    [/(?:>|&gt;)\s*95%[^\n]{0,80}[Ss]ame.?[Dd]ay/, ">95% same-day discharge (canonical: 90.4% MIS)"],
    [/[Ss]ame.?[Dd]ay[^\n]{0,80}(?:>|&gt;)\s*95%/, "same-day >95% (canonical: 90.4% MIS)"],
    [/\b(?:Ten|Nine) peer-reviewed publications/i, "stale publications count (canonical: 15 = 4 journal + 11 presentations)"],
    [/\b(?:4|four) active IRB/i, "4 active IRB studies (canonical: 2 — owner directive 2026-08-11)"],
    [/five native macOS applications/i, "five apps (canonical: six)"],
    [/zero complications/i, "'zero complications' phrasing (canonical claim: zero MAJOR ADVERSE EVENTS against a stated 3.15% rate)"],
    [/completing his Complex Benign Gynecology/i, "present-tense fellowship (he FINISHED the fellowship — owner directive 2026-08-12)"],
];
for (const f of files) {
    let s; try { s = readFileSync(f, "utf8"); } catch { continue; }
    for (const [re, why] of STALE_RECORD) {
        if (re.test(s)) fail(`${f}: stale operative-record claim — ${why}`);
    }
}
// Required canonical presence — the pages that state the record must state
// the CURRENT record. A page that silently dropped a figure is drift too.
const cvPage = readFileSync("cv/index.html", "utf8");
for (const need of ["444", "1,511", "1,475", "2.9", "0.2", "3.15", "90.4"]) {
    if (!cvPage.includes(need)) fail(`cv/index.html: canonical figure '${need}' missing from the operative log`);
}
const idxRaw = readFileSync("index.html", "utf8");
if (!idxRaw.includes("90.4")) fail("index.html: same-day discharge must state the canonical 90.4%");
if (!/stat-num">15</.test(idxRaw)) fail("index.html: publications stat must be 15");
const curRaw = readFileSync("curriculum/cbg-migs/index.html", "utf8");
if (!curRaw.includes("444") || !/1,?511/.test(curRaw)) fail("curriculum/cbg-migs: canonical 444 / 1,511 volumes missing");

const cur = readFileSync("curriculum/cbg-migs/index.html", "utf8");
if (!/three-year/i.test(cur) || !/thirty-six months|36 months|Each of 36/i.test(cur)) fail("curriculum/cbg-migs: missing three-year / 36-month structure");
if (/\btwo-year\b|twenty-four months/i.test(cur)) fail("curriculum/cbg-migs: stale two-year phrasing");
const idx = readFileSync("index.html", "utf8");
if (!idx.includes("Excellence in Minimally Invasive Gynecology")) fail("index: award name drifted from CV canonical");
if (!/15:297/.test(idx)) fail("index: GMIT citation missing volume/pages (2026;15:297–299)");
const dep = readFileSync("scripts/deploy-prod.sh", "utf8");
// The exclude must be ANCHORED to the repo root, and this gate must
// require the anchored form rather than merely permit it.
//
// The unanchored patterns (`--exclude='docs'` / `--exclude='docs/'`) mean
// "any directory named docs, at ANY depth" — which silently matched
// functions/api/v1/admin/compliance/docs/ and dropped both of its handlers
// from every deploy since that endpoint shipped. It 404'd in production
// while existing, complete, in the repo, and nothing reported it.
//
// rsync anchors with a leading slash; tar anchors with a leading ./ against
// the archive root. Both are required, because the two staging paths must
// produce the same byte set.
if (!/--exclude='\/docs\/'/.test(dep)) {
    fail("deploy-prod.sh: rsync path must use the ANCHORED --exclude='/docs/' — an unanchored 'docs' also matches functions/api/v1/admin/compliance/docs/");
}
if (!/--exclude='\.\/docs'/.test(dep)) {
    fail("deploy-prod.sh: tar path must use the ANCHORED --exclude='./docs' — an unanchored 'docs' also matches functions/api/v1/admin/compliance/docs/");
}
// And the unanchored forms must be gone, not merely accompanied.
if (/--exclude='docs\/?'/.test(dep)) {
    fail("deploy-prod.sh: an UNANCHORED docs exclude is still present — it matches any directory named docs at any depth, including Pages Functions");
}
if (failed) { console.error(`\nfact-sync gate: ${failed} violation(s)`); process.exit(2); }
console.log(`fact-sync gate: CLEAN — ${files.length} deployable files agree with canonical facts; docs/ excluded from staging`);
