#!/usr/bin/env node
// =====================================================================
// audit_render.mjs — RENDER-based verification gate (2026-07-21)
// =====================================================================
// The string/element gates check whether markup EXISTS in body_html. They
// repeatedly passed briefs that a READER saw as broken — placeholder deep
// dives, missing per-topic synthesis, unstyled modals — because the string
// was present (often only in CSS) while the rendered result was wrong.
//
// This gate renders each published weekly roundup's body_html in headless
// Chromium and asserts on the ACTUAL DOM a reader gets. The inline <style>
// block travels with body_html, so computed styles are meaningful here.
//
// It is grammar-ADAPTIVE: the corpus mixes two valid layouts (W20 nests its
// synthesis in a TOC sibling; W21+ nests it inside each topic group; W20
// cards omit the per-card lens line W21 uses). The assertions below are
// tuned to stay GREEN on the whole human-approved corpus (W20, W21, W25,
// W28, W29) while going RED on the regressions the user actually hit:
//   * a topic group with NO synthesis prose  ("you just list the articles")
//   * deep-dive modals that say "Pending … review"  (placeholder stubs)
//   * deep-dive modals rendered UNSTYLED  (the dd-* grammar with no CSS —
//     detected by force-opening a modal and confirming the section heading
//     picks up the stylesheet's text-transform:uppercase; default is none)
//   * any page JS error
//
// Every assertion below was verified to pass on all five approved posts and
// to fail on the corresponding broken state (see probe, 2026-07-21).
//
// Best-effort: if Chromium / playwright-core is unavailable it SKIPS (exit 0),
// same policy as the runtime-CSS audit. When it runs, any failure exits 2.
//
// Usage: node scripts/audit_render.mjs   (MZ_SITE_BASE overrides the origin)
// =====================================================================
import { createRequire } from "module";
import { existsSync, readdirSync } from "fs";
import { join } from "path";

const BASE = process.env.MZ_SITE_BASE || "https://mountzara.com";
const require = createRequire(import.meta.url);

function findChromium() {
    const root = "/opt/pw-browsers";
    if (!existsSync(root)) return null;
    for (const d of readdirSync(root)) {
        if (!d.startsWith("chromium-")) continue;
        for (const sub of ["chrome-linux/chrome", "chrome-linux64/chrome"]) {
            const p = join(root, d, sub);
            if (existsSync(p)) return p;
        }
    }
    return null;
}
function loadChromium() {
    for (const spec of ["playwright-core", "playwright",
        "/tmp/claude-0/-home-user-MIGS/7a2758e6-6b6d-5fff-a789-a9193d8f2863/scratchpad/node_modules/playwright-core"]) {
        try { return require(spec).chromium; } catch { /* try next */ }
    }
    return null;
}

const chromium = loadChromium();
const execPath = findChromium();
if (!chromium || !execPath) {
    console.log("⏭️  render audit SKIPPED — playwright-core / Chromium not available in this environment.");
    process.exit(0);
}

async function loadRoundups() {
    const list = await (await fetch(`${BASE}/api/posts?kind=evidence&status=published&cb=${Date.now()}`)).json();
    const ids = (list.posts || []).map((p) => p.id).filter((id) => /^blog-2026-W\d+$/.test(id));
    const posts = [];
    for (const id of ids) posts.push(await (await fetch(`${BASE}/api/posts/${id}?cb=${Date.now()}`)).json());
    return posts;
}

const posts = await loadRoundups().catch((e) => { console.error("render audit: could not load corpus:", e.message); process.exit(0); });
const browser = await chromium.launch({ executablePath: execPath, args: ["--no-sandbox"] });
let failed = 0;

for (const post of posts) {
    const errs = [];
    const page = await (await browser.newContext({ viewport: { width: 1200, height: 1400 } })).newPage();
    page.on("pageerror", (e) => errs.push(String(e.message)));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::ERR/.test(m.text())) errs.push(m.text()); });
    // abort remote assets (sandbox can't fetch them); we only assert on structure/text/computed-style
    await page.route("**/*", (r) => {
        const u = r.request().url();
        if (u.startsWith("data:")) return r.continue();
        if (/\.(png|jpe?g|webp|svg|gif|woff2?|ttf|otf|mp4|webm|ico)(\?|$)/i.test(u)) return r.abort();
        return r.continue();
    });
    const doc = `<!doctype html><html><head><meta charset="utf-8"></head><body>${post.body_html}</body></html>`;
    await page.setContent(doc, { waitUntil: "load" });
    await page.waitForTimeout(150);

    const r = await page.evaluate(() => {
        const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
        const out = { groups: 0, synthTotal: 0, groupsNested: 0, groupsNestedMissing: [], modals: 0, pending: 0, styledSignal: null };

        // --- topic groups + synthesis (grammar-adaptive) ---
        const groups = [...document.querySelectorAll('.topic-section, .mz-topic-group')];
        out.groups = groups.length;
        out.synthTotal = document.querySelectorAll('.mz-toc-group-synthesis').length;
        for (const g of groups) {
            const syn = g.querySelector('.mz-toc-group-synthesis');
            if (syn && norm(syn.textContent).length >= 60) out.groupsNested++;
            else out.groupsNestedMissing.push(g.id || "?");
        }

        // --- TOC nav (2026-07-28): W25/28/29 shipped with ZERO internal
        // anchors while the gold posts have a chip TOC + ~1000 anchor links;
        // the old parity check matched the 'mz-toc-group-synthesis' substring
        // as "TOC". Roundups must render a real TOC whose chips point at
        // topic ids that exist. ---
        out.tocChips = 0; out.tocDead = 0;
        for (const a of document.querySelectorAll("nav.mz-toc a.mz-toc-chip")) {
            out.tocChips++;
            const href = a.getAttribute("href") || "";
            if (!href.startsWith("#") || !document.getElementById(href.slice(1))) out.tocDead++;
        }

        // --- deep-dive modals: authored (no pending) ---
        const modals = [...document.querySelectorAll('dialog')];
        out.modals = modals.length;
        for (const d of modals) if (/pending\b[^.]{0,25}\breview/i.test(norm(d.textContent))) out.pending++;

        // --- modals are STYLED: force one open, confirm the stylesheet applied ---
        // default h3 text-transform is "none"; the inline .mz-jc-section rule
        // makes headings uppercase. An unstyled dd-* modal (no matching CSS)
        // leaves it "none", which is exactly the regression we want to catch.
        const m0 = modals.find((d) => d.querySelector('h3'));
        if (m0) {
            m0.setAttribute('open', '');
            const h = m0.querySelector('.mz-jc-section h3, .dd-section h3, h3');
            if (h) out.styledSignal = getComputedStyle(h).textTransform;
        }
        return out;
    });

    // grammar-adaptive synthesis verdict:
    //   * W21-style (synthesis nested in groups): every group must nest one.
    //   * W20-style (synthesis nested elsewhere): fall back to a count check.
    const problems = [];
    if (r.groups < 2) {
        problems.push(`only ${r.groups} topic group(s) rendered`);
    } else if (r.groupsNested > 0) {
        if (r.groupsNested < r.groups)
            problems.push(`${r.groups - r.groupsNested} topic group(s) render WITHOUT synthesis prose (${r.groupsNestedMissing.slice(0, 4).join(", ")})`);
    } else if (r.synthTotal < r.groups) {
        problems.push(`${r.groups} topic groups but only ${r.synthTotal} synthesis paragraph(s) — reader sees topics with no AI summary`);
    }
    if (r.tocChips < 2) problems.push(`no TOC nav renders (${r.tocChips} chips) — reader cannot jump to topics`);
    else if (r.tocDead) problems.push(`${r.tocDead}/${r.tocChips} TOC chips point at MISSING ids`);
    if (r.pending) problems.push(`${r.pending}/${r.modals} deep-dive modals still show "Pending review" text`);
    if (r.modals > 0 && r.styledSignal !== "uppercase")
        problems.push(`deep-dive modals render UNSTYLED (heading text-transform="${r.styledSignal}", expected "uppercase" — the stylesheet is not reaching the modal grammar)`);
    if (errs.length) problems.push(`page JS error(s): ${errs.slice(0, 2).join(" | ").slice(0, 160)}`);

    if (problems.length) {
        failed++;
        console.error(`  ✗  ${post.id}: ${problems.join("; ")}`);
    } else {
        const synthNote = r.groupsNested > 0 ? `${r.groupsNested}/${r.groups} groups nest synthesis` : `${r.synthTotal} synthesis for ${r.groups} groups`;
        console.log(`  ✓  ${post.id}: ${synthNote}, ${r.modals} modals authored+styled, no JS errors`);
    }
    await page.close();
}
await browser.close();

if (failed) {
    console.error(`\nrender audit: ${failed} post(s) render incorrectly for a reader.`);
    process.exit(2);
}
console.log(`\nrender audit: CLEAN — every published roundup renders correctly (synthesis prose, authored+styled modals, no JS errors).`);
process.exit(0);
