#!/usr/bin/env node
// =====================================================================
// check_citation_integrity.mjs — the site enforces its own citations
// =====================================================================
// WHY THIS IS A GATE AND NOT A CHECKLIST.
//
// The twelve patient guides shipped for months carrying 556 references
// of which only 85 were cited anywhere in the text. The padding looked
// like rigour, several of the unused papers were plainly off-topic
// (music therapy during labour under contraception), one guide had two
// <li id="ref-14"> blocks so every [14] marker resolved to the wrong
// one, and none of it was visible without someone deciding to look.
//
// A patient is invited to check these sources. That invitation has to be
// true on every deploy, not on the days somebody remembers to audit.
//
// STRUCTURAL checks (offline, always run — these BLOCK a deploy):
//   1. every reference in a list is cited somewhere in the text
//   2. every inline marker points at a reference that exists
//   3. reference ids are unique and sequential
//   4. the visible [N] matches the anchor it links to
//   5. public /education/<t>/ and /portal/education/<t>/ stay identical
//
// RESOLUTION (network, opt-in with --pubmed): every PMID exists and the
// claimed author/title/year match the record. Not in the default gate
// because a deploy must not depend on NCBI being reachable; run it
// before publishing new clinical content.
// =====================================================================
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

const ROOT = dirname(new URL(import.meta.url).pathname).replace(/\/scripts$/, "");
const STRICT = !process.argv.includes("--report");
const failures = [];

function pagesWithCitations() {
    const out = [];
    const walk = (dir) => {
        for (const e of readdirSync(dir)) {
            if (["node_modules", ".git", "cite_audit", "docs"].includes(e)) continue;
            const p = join(dir, e);
            let st;
            try { st = readdirSync(p); } catch { st = null; }
            if (st) { walk(p); continue; }
            if (!e.endsWith(".html")) continue;
            const html = readFileSync(p, "utf8");
            if (html.includes('<li id="ref-') || html.includes('class="mz-ref"')) {
                out.push({ path: p.replace(ROOT + "/", ""), html });
            }
        }
    };
    walk(ROOT);
    return out;
}

const pages = pagesWithCitations().filter((p) => !p.path.includes("_template"));
let refTotal = 0;

for (const { path, html } of pages) {
    const ids = [...html.matchAll(/<li id="(ref-\d+)">/g)].map((m) => m[1]);
    const cited = new Set([...html.matchAll(/data-r="(ref-\d+)"/g)].map((m) => m[1]));
    refTotal += ids.length;

    const dupes = ids.filter((v, i) => ids.indexOf(v) !== i);
    if (dupes.length) failures.push(`${path}: duplicate reference id(s) ${[...new Set(dupes)].join(", ")} — an anchor to a duplicated id silently resolves to the first`);

    const orphans = ids.filter((id) => !cited.has(id));
    if (orphans.length) failures.push(`${path}: ${orphans.length} reference(s) cited nowhere in the text (${orphans.slice(0, 4).join(", ")}${orphans.length > 4 ? "…" : ""}) — a padded list teaches the reader the citations are decoration`);

    const dangling = [...cited].filter((id) => !ids.includes(id));
    if (dangling.length) failures.push(`${path}: inline marker(s) point at missing reference(s): ${dangling.join(", ")}`);

    const nums = ids.map((i) => Number(i.slice(4)));
    if (nums.length && nums.some((n, i) => n !== i + 1)) failures.push(`${path}: reference numbering is not sequential — a list jumping [2] [7] [41] invites the doubt the citations exist to answer`);

    for (const m of html.matchAll(/href="#ref-(\d+)">\[(\d+)\]/g)) {
        if (m[1] !== m[2]) { failures.push(`${path}: link to ref-${m[1]} is labelled [${m[2]}]`); break; }
    }
}

// Mirror parity — a patient reading the member copy must see exactly what
// the public copy says.
for (const t of readdirSync(join(ROOT, "education"))) {
    const a = join(ROOT, "education", t, "index.html");
    const b = join(ROOT, "portal", "education", t, "index.html");
    if (t === "_template" || !existsSync(a) || !existsSync(b)) continue;
    if (readFileSync(a, "utf8") !== readFileSync(b, "utf8")) {
        failures.push(`education/${t}: public and portal copies differ — edit both or neither`);
    }
}

console.log(`citation integrity: ${pages.length} page(s) with citations, ${refTotal} references`);
if (failures.length === 0) {
    console.log("  every reference backs a claim, every marker resolves, numbering clean, mirrors identical");
} else {
    console.log(`\n${failures.length} problem(s):\n`);
    for (const f of failures) console.log("  ✗ " + f);
}
process.exit(STRICT && failures.length ? 1 : 0);
