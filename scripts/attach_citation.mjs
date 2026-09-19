#!/usr/bin/env node
// =====================================================================
// attach_citation.mjs — put a verified reference back behind a claim
// =====================================================================
// Stripping the orphan references left some genuine claims uncited while
// the paper that supports them sat in the removed set. This re-attaches
// one, by hand, one claim at a time:
//
//   node scripts/attach_citation.mjs <guide> <pmid> "<exact text to cite>"
//
// It recovers the reference block from git (label, what-it-shows, PMID
// link and abstract, all previously verified against PubMed), appends it
// to the guide's list, and inserts the inline marker immediately after
// the quoted text. Both copies of the guide — public and portal — are
// edited together, because a mirror-drift gate requires byte-identity.
//
// It refuses when the quoted text is not found or is ambiguous. Nothing
// here decides WHICH paper supports a claim; that judgement is made by
// reading both, and this only executes it.
// =====================================================================
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";

const ROOT = dirname(new URL(import.meta.url).pathname).replace(/\/scripts$/, "");
const [guide, pmid, anchor] = process.argv.slice(2);
if (!guide || !pmid || !anchor) {
    console.error('usage: attach_citation.mjs <guide> <pmid> "<exact text to cite>"');
    process.exit(1);
}

// Recover the reference block from the last revision that still had it.
function recoverBlock() {
    const shas = execSync(`git log --format=%H -6 -- education/${guide}/index.html`, { cwd: ROOT })
        .toString().trim().split("\n");
    for (const sha of shas) {
        let html;
        try { html = execSync(`git show ${sha}:education/${guide}/index.html`, { cwd: ROOT, maxBuffer: 64e6 }).toString(); }
        catch { continue; }
        const re = new RegExp(`<li id="ref-\\d+">([\\s\\S]*?)</li>`, "g");
        for (const m of html.matchAll(re)) {
            if (m[1].includes(`/${pmid}/`) || m[1].includes(`>${pmid}<`)) return m[1];
        }
    }
    return null;
}

const block = recoverBlock();
if (!block) { console.error(`PMID ${pmid} not found in any recent revision of ${guide}`); process.exit(1); }
const labelM = block.match(/<div class="ref-label">\s*<strong>([\s\S]*?)<\/strong>/);
const label = (labelM ? labelM[1] : "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

for (const tree of ["education", "portal/education"]) {
    const p = join(ROOT, tree, guide, "index.html");
    if (!existsSync(p)) { console.error(`missing ${p}`); process.exit(1); }
    let html = readFileSync(p, "utf8");

    // Already cited here? Then this is a second claim pointing at the same
    // reference — reuse its number rather than duplicating the entry.
    const existing = [...html.matchAll(/<li id="(ref-\d+)">([\s\S]*?)<\/li>/g)]
        .find((m) => m[2].includes(`/${pmid}/`));
    let refId, refNum;
    if (existing) {
        refId = existing[1]; refNum = refId.slice(4);
    } else {
        const ids = [...html.matchAll(/<li id="ref-(\d+)">/g)].map((m) => Number(m[1]));
        refNum = String((ids.length ? Math.max(...ids) : 0) + 1);
        refId = `ref-${refNum}`;
        const lastClose = html.lastIndexOf("</li>");
        html = html.slice(0, lastClose + 5) + `\n<li id="${refId}">${block}</li>` + html.slice(lastClose + 5);
    }

    const occurrences = html.split(anchor).length - 1;
    if (occurrences === 0) { console.error(`anchor text not found in ${tree}/${guide}: "${anchor.slice(0, 60)}"`); process.exit(1); }
    if (occurrences > 1) { console.error(`anchor text appears ${occurrences} times in ${tree}/${guide} — make it unique`); process.exit(1); }

    const sup = `<sup class="mz-ref" data-r="${refId}" tabindex="0"><a href="#${refId}">[${refNum}]</a>` +
                `<span class="mz-ref-pop" role="tooltip">${label} &middot; PMID ${pmid}</span></sup>`;
    html = html.replace(anchor, anchor + sup);
    writeFileSync(p, html);
}
console.log(`  ${guide}: [${pmid}] attached — ${label.slice(0, 76)}`);
