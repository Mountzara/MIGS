#!/usr/bin/env node
// =====================================================================
// check_inline_scripts.mjs — every inline <script> must actually parse
// =====================================================================
// WHY THIS EXISTS.
//
// The public /portal/ page is generated from a JS TEMPLATE LITERAL inside
// functions/portal/_middleware.js. One line read:
//
//     show(j.message + (j.note ? "\n\n" + j.note : ""), true);
//
// Inside a template literal `\n` is EVALUATED, so what reached the browser
// was a real newline in the middle of a "..." string — a hard syntax error.
//
// A script that does not parse does not run ANY of its lines. So the whole
// IIFE died at load, and with it the membership tier cards, the comparison
// table, the evidence section, the disclosures and the tier picker. The
// page still rendered its static HTML perfectly, the API was healthy and
// returned all four tiers, and every element the script needed was present
// — it simply never ran. The owner reported the model details were
// "left out". Nothing in the repo could have told him otherwise: the source
// was correct-looking, the deploy passed, and the failure existed only in
// the GENERATED output.
//
// That is the class this gate closes: source that looks right, output that
// does not parse. It extracts every inline <script> from both the static
// HTML files and the Function-GENERATED pages, and parses each one.
//
// Two hazards it also catches, both specific to generating HTML from
// template literals:
//   * a literal </script> inside a JS string, which the HTML parser ends
//     the script at regardless of JS context — truncating it mid-statement;
//   * an unescaped ${...}, which the template literal interpolates away.
//
// Run: node scripts/check_inline_scripts.mjs
// =====================================================================

import { readFileSync, readdirSync, statSync, writeFileSync, mkdtempSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const TMP = mkdtempSync(join(tmpdir(), "mz-inline-"));

// Static HTML surfaces. Education pages are excluded: they are generated
// prose with no inline script logic and there are dozens of them.
const HTML_DIRS = ["portal", "admin"];

function htmlFiles(dir) {
    const out = [];
    let entries;
    try { entries = readdirSync(dir); } catch { return out; }
    for (const e of entries) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) { if (e !== "node_modules") out.push(...htmlFiles(p)); }
        else if (e.endsWith(".html")) out.push(p);
    }
    return out;
}

/** Inline <script> bodies — src= scripts have nothing to parse here. */
function inlineScripts(html) {
    const out = [];
    const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
    let m;
    while ((m = re.exec(html))) {
        const attrs = m[1] || "";
        if (/\bsrc\s*=/.test(attrs)) continue;
        if (/\btype\s*=\s*["']?(?!text\/javascript|module|application\/javascript)/i.test(attrs)) continue;
        const body = m[2];
        if (!body.trim()) continue;
        out.push({ body, index: m.index, attrs: attrs.trim() });
    }
    return out;
}

function lineOf(src, index) {
    return src.slice(0, index).split("\n").length;
}

let checked = 0;
const problems = [];

function check(label, html, sourceHint) {
    for (const s of inlineScripts(html)) {
        checked++;
        const f = join(TMP, `s${checked}.mjs`);
        writeFileSync(f, s.body);
        try {
            execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
        } catch (e) {
            const err = String(e.stderr || e.message).split("\n").slice(0, 6).join("\n    ");
            problems.push(
                `${label} (inline script at line ~${lineOf(html, s.index)})\n` +
                `    ${err}\n` +
                (sourceHint ? `    ${sourceHint}\n` : ""));
        }
    }
}

// ---------------------------------------------------------------------
// 1. Static HTML
// ---------------------------------------------------------------------
for (const d of HTML_DIRS) {
    for (const f of htmlFiles(join(ROOT, d))) {
        check(relative(ROOT, f), readFileSync(f, "utf8"));
    }
}

// ---------------------------------------------------------------------
// 2. The Function-GENERATED pages — where the real bug lived
// ---------------------------------------------------------------------
// The Coming Soon page only exists after the template literal is
// evaluated, so checking the source file would have found nothing. Import
// the module and check what it actually produces.
const GENERATED = [
    { module: "functions/portal/_middleware.js", label: "functions/portal/_middleware.js → COMING_SOON_HTML",
      hint: "This page is a TEMPLATE LITERAL: write \\\\n for a literal \\n in the emitted script, and \\\\${ for a literal ${." },
];

for (const g of GENERATED) {
    let src;
    try { src = readFileSync(join(ROOT, g.module), "utf8"); }
    catch { continue; }
    // Pull the template literal out by evaluating just its assignment,
    // rather than importing the module (which pulls in Workers globals).
    const m = src.match(/const\s+COMING_SOON_HTML\s*=\s*`([\s\S]*?)`;\s*$/m);
    if (!m) {
        problems.push(`${g.module}: could not locate COMING_SOON_HTML to check its output.\n` +
                      `    If it was renamed, update scripts/check_inline_scripts.mjs in the same commit.`);
        continue;
    }
    let rendered;
    try {
        // eslint-disable-next-line no-new-func
        rendered = new Function(`return \`${m[1]}\`;`)();
    } catch (e) {
        problems.push(`${g.module}: the COMING_SOON_HTML template itself does not evaluate — ${String(e).slice(0, 200)}`);
        continue;
    }
    check(g.label, rendered, g.hint);

    // A literal </script> inside a JS string ends the script early, in the
    // HTML parser, no matter what the JS means.
    const scriptOpens = (rendered.match(/<script\b/gi) || []).length;
    const scriptCloses = (rendered.match(/<\/script\s*>/gi) || []).length;
    if (scriptOpens !== scriptCloses) {
        problems.push(`${g.label}: ${scriptOpens} <script> vs ${scriptCloses} </script> — ` +
                      `a stray </script> inside a JS string truncates the script.`);
    }
}

console.log(`inline script gate: ${checked} inline script(s) parsed`);
if (problems.length) {
    console.log(`\n${problems.length} inline script(s) will not parse in a browser:\n`);
    for (const p of problems) console.log("  " + p);
    console.log("A script that does not parse runs NONE of its lines — the page renders,");
    console.log("the API is healthy, and the feature is simply absent with no error anywhere.");
    process.exit(1);
}
console.log("every inline script parses");
