#!/usr/bin/env node
// =====================================================================
// strip_html_comments.mjs — remove authoring comments from STAGED HTML
// =====================================================================
// Owner directive (2026-08-06): nobody browsing the site — person, crawler
// or agent — should be able to read how it is built.
//
// deploy-prod.sh already stripped the §0.8 / kb_doc_id provenance comments.
// That covered the knowledge-base leak and nothing else. Everything else
// this repo writes into markup was still being served: which deploy gate
// enforces which invariant, where the hero fingerprint lock lives, why a
// given breakpoint is the number it is, what each data- attribute drives,
// and the reasoning behind every fix. That is a design document, published.
//
// This removes ALL HTML comments from the staged copy. The repo keeps every
// one of them — they are how the next session avoids re-breaking things —
// and the deployed bytes carry none.
//
// WHAT IT DELIBERATELY DOES NOT TOUCH
//   * anything inside <script> or <style>. A JS string may contain the
//     characters "<!--" (the legacy script-hiding idiom, or just a template
//     that builds markup), and a naive global regex over the whole file
//     would swallow live code from there to the next "-->" — which could be
//     the end of the file. The scanner walks the document and skips those
//     regions entirely.
//   * conditional comments (<!--[if ...), which are markup, not commentary.
//   * comments opening with <!--! — the conventional "keep this" marker,
//     reserved for licence headers.
//
// Usage:  node scripts/strip_html_comments.mjs <dir> [--dry-run]
//         node scripts/strip_html_comments.mjs --self-test
// =====================================================================
import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

/** Remove HTML comments outside <script>/<style>. Returns [text, removed]. */
export function stripComments(src) {
    let out = "";
    let i = 0;
    let removed = 0;
    const lower = src.toLowerCase();

    while (i < src.length) {
        // Skip over raw-text elements wholesale.
        if (lower.startsWith("<script", i) || lower.startsWith("<style", i)) {
            const tag = lower.startsWith("<script", i) ? "script" : "style";
            const openEnd = src.indexOf(">", i);
            if (openEnd === -1) { out += src.slice(i); break; }
            const close = lower.indexOf(`</${tag}`, openEnd);
            if (close === -1) { out += src.slice(i); break; }
            const closeEnd = src.indexOf(">", close);
            const end = closeEnd === -1 ? src.length : closeEnd + 1;
            out += src.slice(i, end);
            i = end;
            continue;
        }

        if (src.startsWith("<!--", i)) {
            // Keep conditional comments and explicit <!--! keep markers.
            if (src.startsWith("<!--[", i) || src.startsWith("<!--!", i)) {
                const end = src.indexOf("-->", i);
                const to = end === -1 ? src.length : end + 3;
                out += src.slice(i, to);
                i = to;
                continue;
            }
            const end = src.indexOf("-->", i);
            if (end === -1) { i = src.length; removed++; break; }
            i = end + 3;
            removed++;
            // Collapse the blank line the comment used to occupy so the
            // stripped file does not gain a run of empty lines.
            while (i < src.length && (src[i] === " " || src[i] === "\t")) i++;
            if (src[i] === "\n" && out.endsWith("\n")) i++;
            continue;
        }

        out += src[i];
        i++;
    }
    return [out, removed];
}

function selfTest() {
    const cases = [
        ["<p>a</p><!-- gone --><p>b</p>", "<p>a</p><p>b</p>", 1],
        // A comment-looking string inside a script must survive untouched.
        ['<script>var s = "<!-- not a comment -->";</script><!-- gone -->',
         '<script>var s = "<!-- not a comment -->";</script>', 1],
        // Style blocks likewise.
        ["<style>/* <!-- */ .a{color:red}</style><!-- gone -->",
         "<style>/* <!-- */ .a{color:red}</style>", 1],
        // Conditional comments are markup and stay.
        ["<!--[if IE]><p>x</p><![endif]--><!-- gone -->", "<!--[if IE]><p>x</p><![endif]-->", 1],
        // Licence keep-marker stays.
        ["<!--! (c) 2026 --><!-- gone -->", "<!--! (c) 2026 -->", 1],
        // A comment whose body contains '>' (JSON, markup examples) must be
        // consumed whole — this is the bug that leaked the KB manifest.
        ['<!-- {"a": 1, "b": "<div>"} --><p>k</p>', "<p>k</p>", 1],
        // Nothing to do.
        ["<p>plain</p>", "<p>plain</p>", 0],
    ];
    let bad = 0;
    for (const [input, want, wantN] of cases) {
        const [got, n] = stripComments(input);
        if (got !== want || n !== wantN) {
            console.error(`  ✗ ${JSON.stringify(input)}\n     want ${JSON.stringify(want)} (${wantN})\n     got  ${JSON.stringify(got)} (${n})`);
            bad++;
        }
    }
    if (bad) { console.error(`self-test: ${bad} failure(s)`); process.exit(2); }
    console.log(`strip_html_comments self-test: ${cases.length} case(s) pass`);
}

const args = process.argv.slice(2);
if (args.includes("--self-test")) { selfTest(); process.exit(0); }

const dir = args.find((a) => !a.startsWith("--"));
if (!dir) { console.error("usage: strip_html_comments.mjs <dir> [--dry-run]"); process.exit(1); }
const dry = args.includes("--dry-run");

let files = 0, comments = 0, bytes = 0;
(function walk(d) {
    for (const e of readdirSync(d)) {
        const p = join(d, e);
        const st = statSync(p);
        if (st.isDirectory()) { if (e !== "node_modules" && e !== ".git") walk(p); continue; }
        if (!/\.html$/.test(e)) continue;
        const src = readFileSync(p, "utf8");
        const [out, n] = stripComments(src);
        if (!n) continue;
        files++; comments += n; bytes += src.length - out.length;
        if (!dry) writeFileSync(p, out);
    }
})(dir);
console.log(`html-comment strip: ${comments} comment(s) removed from ${files} page(s) — ${bytes.toLocaleString()} bytes${dry ? " (dry run)" : ""}`);
