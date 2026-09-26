#!/usr/bin/env node
// =====================================================================
// strip_orphan_citations.mjs — every reference must back a claim
// =====================================================================
// The twelve patient guides carried 556 references and cited only 85 of
// them inline. The other 471 sat in the lists supporting nothing, and
// several were plainly off-topic for their guide (music therapy during
// labour under contraception). A patient is invited to check these
// sources; a padded list teaches her the citations are decoration.
//
// This removes any <li id="ref-N"> that no inline marker points at, then
// RENUMBERS what remains so the visible numbers stay sequential — a list
// jumping [2] [7] [41] looks broken and invites the same doubt.
//
//   node scripts/strip_orphan_citations.mjs --dry
//   node scripts/strip_orphan_citations.mjs
// =====================================================================
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

const ROOT = dirname(new URL(import.meta.url).pathname).replace(/\/scripts$/, "");
const DRY = process.argv.includes("--dry");

function citedIds(html) {
    const s = new Set();
    for (const m of html.matchAll(/data-r="(ref-\d+)"/g)) s.add(m[1]);
    for (const m of html.matchAll(/href="#(ref-\d+)"/g)) s.add(m[1]);
    return s;
}

// Split the reference list into whole <li id="ref-N">…</li> blocks.
function listBlocks(html) {
    const blocks = [];
    const re = /<li id="(ref-\d+)">/g;
    let m;
    while ((m = re.exec(html))) {
        const start = m.index;
        const close = html.indexOf("</li>", start);
        if (close < 0) continue;
        blocks.push({ id: m[1], start, end: close + "</li>".length });
    }
    return blocks;
}

let totalBefore = 0, totalAfter = 0;
const report = [];

// The guides live in TWO trees — the public /education/<topic>/ and the
// member /portal/education/<topic>/ — and a mirror-drift gate enforces
// that they stay byte-identical. Editing one and not the other blocks the
// deploy, correctly: a patient reading the portal copy must see exactly
// what the public copy says.
const TREES = ["education", "portal/education"];
const pages = [];
for (const tree of TREES) {
    for (const g of readdirSync(join(ROOT, tree))) {
        const p = join(ROOT, tree, g, "index.html");
        if (g === "_template" || !existsSync(p)) continue;
        pages.push({ tree, g, p });
    }
}

for (const { tree, g, p } of pages) {
    let html = readFileSync(p, "utf8");
    const cited = citedIds(html);
    const blocks = listBlocks(html);
    if (!blocks.length) continue;

    const keep = blocks.filter((b) => cited.has(b.id));
    const drop = blocks.filter((b) => !cited.has(b.id));
    totalBefore += blocks.length;
    totalAfter += keep.length;
    report.push({ guide: `${tree === "education" ? "public" : "portal"}/${g}`, before: blocks.length, after: keep.length, removed: drop.length });
    if (DRY || drop.length === 0) continue;

    // Remove from the end so earlier offsets stay valid.
    for (const b of [...drop].sort((a, z) => z.start - a.start)) {
        html = html.slice(0, b.start) + html.slice(b.end);
    }

    // Renumber what survives, in document order, and rewrite every pointer.
    const survivors = listBlocks(html).map((b) => b.id);
    const map = new Map(survivors.map((old, i) => [old, `ref-${i + 1}`]));
    // Two passes via a placeholder so ref-2 -> ref-1 cannot collide with an
    // existing ref-1 that has not been rewritten yet.
    for (const [oldId, newId] of map) {
        const n = oldId.slice(4);
        html = html.replaceAll(`<li id="${oldId}">`, `<li id="@@${newId}@@">`);
        html = html.replaceAll(`data-r="${oldId}"`, `data-r="@@${newId}@@"`);
        html = html.replaceAll(`href="#${oldId}">[${n}]`, `href="#@@${newId}@@">[${newId.slice(4)}]`);
        html = html.replaceAll(`href="#${oldId}"`, `href="#@@${newId}@@"`);
    }
    html = html.replaceAll("@@ref-", "ref-").replaceAll("@@", "");
    writeFileSync(p, html);
}

console.log(`${DRY ? "[dry] " : ""}reference lists:\n`);
for (const r of report) {
    console.log(`  ${r.guide.padEnd(36)} ${String(r.before).padStart(3)} → ${String(r.after).padStart(3)}   (${r.removed} removed)`);
}
console.log(`\n  TOTAL ${totalBefore} → ${totalAfter}   (${totalBefore - totalAfter} references removed)`);
if (DRY) console.log("\n--dry: nothing written.");
