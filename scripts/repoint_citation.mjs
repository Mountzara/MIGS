#!/usr/bin/env node
// =====================================================================
// repoint_citation.mjs — move one claim's citation to the right paper
// =====================================================================
// A citation that resolves perfectly and does not support its sentence is
// the failure the structural gate cannot see. When
// check_citation_support.mjs flags one and a human confirms it, this
// re-points that single marker at the paper that DOES support it,
// recovering the reference block (label, what-it-shows, abstract) from
// git if it is not already on the page.
//
//   node scripts/repoint_citation.mjs <guide> "<claim text>" <correct-pmid>
//
// Both trees are edited together. It refuses on an ambiguous anchor, and
// it never decides which paper is right — that judgement is made by
// reading the sentence against the abstract.
// =====================================================================
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";

const ROOT = dirname(new URL(import.meta.url).pathname).replace(/\/scripts$/, "");
const [guide, anchor, pmid] = process.argv.slice(2);
if (!guide || !anchor || !pmid) {
    console.error('usage: repoint_citation.mjs <guide> "<claim text>" <pmid>'); process.exit(1);
}

function recover(pm) {
    const shas = execSync(`git log --format=%H -8 -- education/${guide}/index.html`, { cwd: ROOT }).toString().trim().split("\n");
    for (const sha of shas) {
        let html;
        try { html = execSync(`git show ${sha}:education/${guide}/index.html`, { cwd: ROOT, maxBuffer: 64e6 }).toString(); } catch { continue; }
        for (const m of html.matchAll(/<li id="ref-\d+">([\s\S]*?)<\/li>/g)) if (m[1].includes(`/${pm}/`)) return m[1];
    }
    return null;
}

for (const tree of ["education", "portal/education"]) {
    const p = join(ROOT, tree, guide, "index.html");
    if (!existsSync(p)) continue;
    let html = readFileSync(p, "utf8");

    const at = html.indexOf(anchor);
    if (at < 0) { console.error(`anchor not found in ${tree}/${guide}`); process.exit(1); }
    if (html.indexOf(anchor, at + 1) >= 0) { console.error(`anchor is ambiguous in ${tree}/${guide}`); process.exit(1); }

    // The marker immediately following the claim.
    const after = html.slice(at + anchor.length);
    const supM = after.match(/^([\s\S]{0,80}?)<sup class="mz-ref"[\s\S]*?<\/sup>/);
    if (!supM) { console.error(`no citation marker directly after that claim in ${tree}/${guide}`); process.exit(1); }

    // Ensure the correct reference exists on the page.
    let refId = null;
    for (const m of html.matchAll(/<li id="(ref-\d+)">([\s\S]*?)<\/li>/g)) if (m[2].includes(`/${pmid}/`)) { refId = m[1]; break; }
    if (!refId) {
        const block = recover(pmid);
        if (!block) { console.error(`PMID ${pmid} not found in history for ${guide}`); process.exit(1); }
        const nums = [...html.matchAll(/<li id="ref-(\d+)">/g)].map((m) => Number(m[1]));
        refId = `ref-${(nums.length ? Math.max(...nums) : 0) + 1}`;
        const last = html.lastIndexOf("</li>");
        html = html.slice(0, last + 5) + `\n<li id="${refId}">${block}</li>` + html.slice(last + 5);
    }
    const num = refId.slice(4);
    const block = [...html.matchAll(/<li id="ref-\d+">([\s\S]*?)<\/li>/g)].find((m) => m[1].includes(`/${pmid}/`))[1];
    const label = (block.match(/<strong>([\s\S]*?)<\/strong>/) || [, ""])[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

    const sup = `<sup class="mz-ref" data-r="${refId}" tabindex="0"><a href="#${refId}">[${num}]</a>` +
                `<span class="mz-ref-pop" role="tooltip">${label} &middot; PMID ${pmid}</span></sup>`;
    const start = at + anchor.length + supM[1].length;
    const oldSup = supM[0].slice(supM[1].length);
    html = html.slice(0, start) + sup + html.slice(start + oldSup.length);
    writeFileSync(p, html);
}
console.log(`  repointed → PMID ${pmid}  («${anchor.slice(0, 58)}»)`);
