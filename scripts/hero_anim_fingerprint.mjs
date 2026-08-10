#!/usr/bin/env node
// =====================================================================
// hero_anim_fingerprint.mjs — LOCK on the opening hero animation.
// =====================================================================
// Extracts the exact animation-critical regions of index.html (the reveal
// choreography JS + the reveal/word-stagger/Ken-Burns/loader CSS) and hashes
// them. Committed hash lives in scripts/hero_animation.lock.
//
// deploy-prod.sh runs this as a HARD gate: if the fingerprint no longer
// matches the lock, the deploy is BLOCKED. This makes it impossible to ship
// a change that touches the opening animation without deliberately
// acknowledging it (and re-verifying the animation) first.
//
// Usage:
//   node scripts/hero_anim_fingerprint.mjs            # print current hash
//   node scripts/hero_anim_fingerprint.mjs --check    # exit 2 if != lock
//   node scripts/hero_anim_fingerprint.mjs --update   # rewrite the lock
//                                                      # (do this ONLY after
//                                                      # visually verifying the
//                                                      # opening animation)
import { readFileSync, writeFileSync } from "fs";
import { createHash } from "crypto";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX = join(HERE, "..", "index.html");
const HOME_JS = join(HERE, "..", "assets", "js", "home.js");
const HOME_CSS = join(HERE, "..", "assets", "css", "home.css");
const LOCK = join(HERE, "hero_animation.lock");
// 2026-08-08 — the homepage's 249 KB of animation JS moved OUT of index.html
// into assets/js/home.js (inline, Safari had to parse it all before the
// opening could start — measured 9s to first movement). The animation-critical
// regions now live across both files, so fingerprint the pair. Reading them
// concatenated keeps every existing extractor working unchanged.
let js = "", css = "";
try { js = readFileSync(HOME_JS, "utf8"); } catch { /* still inline */ }
try { css = readFileSync(HOME_CSS, "utf8"); } catch { /* still inline */ }
// The homepage's CSS moved out too (2026-08-08): 266 KB of inline styles sat
// ahead of the hero markup, so on a cold visit nothing painted until all of it
// had arrived. Fingerprint index.html + the extracted JS + the extracted CSS
// together so the animation lock still covers every region it used to.
const html = readFileSync(INDEX, "utf8")
    + "\n/* --- assets/js/home.js --- */\n" + js
    + "\n<style>\n" + css + "\n</style>\n";

// --- balanced-block extraction (string/comment-naive, fine for this file) ---
function block(startIdx, open, close) {
    if (startIdx < 0) return null;
    let depth = 0, i = startIdx;
    for (; i < html.length; i++) {
        if (html[i] === open) depth++;
        else if (html[i] === close) { depth--; if (depth === 0) return html.slice(startIdx, i + 1); }
    }
    return null;
}
// A named JS function body: from `function NAME(` to its matching `}`.
function fn(name) {
    const m = html.indexOf(`function ${name}(`);
    if (m < 0) return `MISSING:function ${name}`;
    const brace = html.indexOf("{", m);
    return block(brace, "{", "}") || `UNBALANCED:function ${name}`;
}
// A CSS/keyframes rule body: from the FIRST occurrence of `SELECTOR {` (or
// `SELECTOR{`) to its matching `}`. `selector` is matched verbatim.
function rule(selector) {
    let idx = html.indexOf(selector + " {");
    if (idx < 0) idx = html.indexOf(selector + "{");
    if (idx < 0) idx = html.indexOf(selector + " ");   // keyframes may have a name after
    if (idx < 0) return `MISSING:${selector}`;
    const brace = html.indexOf("{", idx);
    return selector + block(brace, "{", "}") || `UNBALANCED:${selector}`;
}
// A single anchored line (constants).
function line(anchor) {
    const i = html.indexOf(anchor);
    if (i < 0) return `MISSING:${anchor}`;
    return html.slice(i, html.indexOf("\n", i));
}
// The loader Promise.race(...).then(...) chain that gates the hero start.
function loaderChain() {
    const i = html.indexOf("Promise.race([");
    if (i < 0) return "MISSING:loaderChain";
    // capture through the closing `});` of the .then()
    const end = html.indexOf("setTimeout(startHeroSequence", i);
    if (end < 0) return "MISSING:loaderChain.then";
    const close = html.indexOf("});", end);
    return html.slice(i, close + 3);
}

// A const arrow-function body: from `const NAME = ` to the matching `}` of
// its brace body (the in-body bootstrap and home.js reel logic use these).
function constFn(name) {
    const m = html.indexOf(`const ${name} = `);
    if (m < 0) return `MISSING:const ${name}`;
    const brace = html.indexOf("{", m);
    return block(brace, "{", "}") || `UNBALANCED:const ${name}`;
}

// The animation-critical surface. Adding/removing an item here is itself an
// intentional lock change (it'll shift the hash), which is correct.
const PARTS = [
    // --- the in-body bootstrap: the ONLY owner of the opening choreography
    //     since 2026-08-09 (startHeroSequence early-returns to it). The lock
    //     previously hashed none of these, so every choreography edit this
    //     week passed the gate unhashed. ---
    fn("runChoreography"),
    fn("anchorOnDrawing"),
    fn("toAnimatedImage"),
    fn("heroDrawUrl"),
    fn("settleLater"),
    fn("hideLoaderNow"),
    // --- autoplay-refusal machinery (hero swap + reel previews) ---
    fn("swapHeroToAnimatedWebp"),
    constFn("swapToPreview"),
    constFn("swapAll"),
    constFn("tryPlay"),
    constFn("wake"),
    // --- reveal choreography (JS) ---
    fn("startHeroSequence"),
    fn("splitWords"),
    fn("applyLineSpanGradient"),
    fn("recoverPausedVideos"),
    fn("hideLoader"),
    loaderChain(),
    line("const HERO_TEXT_DELAY_MS"),
    line("const ANIMATION_DURATION_MS"),
    // --- reveal + stagger + Ken Burns + loader (CSS) ---
    rule(".hero-content-delayed"),
    rule(".hero-content-delayed > *"),
    rule(".hero-content-delayed.visible > *"),
    rule(".word-reveal"),
    rule(".word-reveal .word-mask"),
    rule(".word-reveal .w"),
    rule(".word-reveal.in .w"),
    rule("@keyframes heroKenBurnsSlow"),
    rule(".hero-title"),
    rule(".hero-video"),
    rule(".page-loader"),
];

// Normalize whitespace so pure re-indentation doesn't trip the lock, but any
// semantic change (values, timings, selectors, added/removed rules) does.
const normalized = PARTS.map((p) => p.replace(/\s+/g, " ").trim()).join("\n");
const hash = createHash("sha256").update(normalized).digest("hex");
const missing = PARTS.filter((p) => p.startsWith("MISSING:") || p.startsWith("UNBALANCED:"));

const mode = process.argv[2];
if (mode === "--update") {
    if (missing.length) { console.error("refusing to update lock — extraction failed:\n" + missing.join("\n")); process.exit(1); }
    writeFileSync(LOCK, hash + "\n");
    console.log("hero animation lock updated:", hash);
    process.exit(0);
}
if (missing.length) {
    console.error("🛑 HERO ANIM FINGERPRINT: could not extract critical regions (index.html structure changed):");
    console.error("   " + missing.join("\n   "));
    process.exit(2);
}
if (mode === "--check") {
    let locked = null;
    try { locked = readFileSync(LOCK, "utf8").trim(); } catch { }
    if (!locked) { console.error("no hero_animation.lock present — run --update to create it"); process.exit(2); }
    if (locked !== hash) {
        console.error("🛑 HERO ANIMATION CHANGED — the opening-animation code no longer matches the lock.");
        console.error(`   locked : ${locked}`);
        console.error(`   current: ${hash}`);
        console.error("   If this change is INTENTIONAL: open the site, watch the opening animation");
        console.error("   end-to-end (loader → drawing video → word-stagger reveal → Ken Burns), then run");
        console.error("     node scripts/hero_anim_fingerprint.mjs --update && git add scripts/hero_animation.lock");
        console.error("   If it is NOT intentional, revert your change to the hero animation code.");
        process.exit(2);
    }
    console.log("hero animation lock OK:", hash);
    process.exit(0);
}
console.log(hash);
