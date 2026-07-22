#!/usr/bin/env node
// =====================================================================
// audit_reader_path.mjs — FULL READER-PATH verification (2026-07-22)
// =====================================================================
// audit_render.mjs renders body_html in ISOLATION, which verifies the post
// content but not the path a reader actually takes: the /evidence/ and
// /trending/ page shells fetch the post over the API, inject body_html,
// re-execute its inline <script>, and wire the deep-dive modal handlers.
// A break anywhere on that path (shell JS error, script re-execution
// failure, dead trigger buttons, listing page not listing) is invisible
// to the isolated render. This audit walks the REAL path for EVERY
// published post — not just weekly roundups:
//
//   * /evidence/ and /trending/ listing pages: cards render, one per
//     published post of that shell's kind, each linking to ?id=
//   * every post detail page loads through the shell: real title (not
//     "Brief not found"), body injected with visible text
//   * roundups: topic groups + synthesis prose VISIBLE (offsetHeight>0,
//     styled by the page's CSS), references section present
//   * deep-dive modals opened BY CLICKING the reader's trigger button —
//     dialog.open, authored content visible, section headings styled
//   * zero page JS errors on every page (asset/network noise filtered)
//   * mobile pass (390px): the page must not scroll horizontally
//
// Best-effort skip (exit 0) without playwright/Chromium; failures exit 2.
// Usage: node scripts/audit_reader_path.mjs   (MZ_SITE_BASE overrides)
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
    console.log("⏭️  reader-path audit SKIPPED — playwright-core / Chromium not available.");
    process.exit(0);
}

// Same launch policy as scripts/_lib_pw_launch.py: env proxy + TLS1.2 cap in
// proxied containers (the egress MITM resets Chromium's TLS1.3 hello; cert
// verification stays ON via the proxy CA in the NSS store).
const proxyServer = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || null;
const launchOpts = { executablePath: execPath, args: ["--no-sandbox"] };
if (proxyServer) {
    launchOpts.proxy = { server: proxyServer };
    launchOpts.args.push("--ssl-version-max=tls1.2");
}

async function apiList(kind) {
    const r = await (await fetch(`${BASE}/api/posts?kind=${kind}&status=published&cb=${Date.now()}`)).json();
    return (r.posts || []);
}

const evidencePosts = await apiList("evidence");   // shown on /evidence/
const blogPosts = await apiList("blog");            // shown on /trending/
const SHELLS = [
    { shell: "/evidence/", posts: evidencePosts },
    { shell: "/trending/", posts: blogPosts },
];

const browser = await chromium.launch(launchOpts);
let failures = [];
const note = (id, msg) => failures.push(`${id}: ${msg}`);

async function newPage(viewport) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e.message)));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::ERR|CORS|favicon/.test(m.text())) errs.push(m.text()); });
    // block heavy media; we assert on DOM/behavior, not pixels
    await page.route("**/*", (r) => {
        const u = r.request().url();
        if (/\.(png|jpe?g|webp|svg|gif|woff2?|ttf|otf|mp4|webm|ico)(\?|$)/i.test(u)) return r.abort();
        return r.continue();
    });
    return { ctx, page, errs };
}

// ---------- 1. listing pages ----------
for (const { shell, posts } of SHELLS) {
    const { ctx, page, errs } = await newPage({ width: 1200, height: 1400 });
    try {
        await page.goto(`${BASE}${shell}?cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForFunction(() => document.querySelectorAll("a.brief-card, a.post-card").length > 0, { timeout: 20000 })
            .catch(() => {});
        const got = await page.evaluate(() => [...document.querySelectorAll("a.brief-card, a.post-card")]
            .map((a) => ({ href: a.getAttribute("href") || "", title: (a.textContent || "").trim().slice(0, 40) })));
        if (got.length < posts.length)
            note(shell, `listing renders ${got.length} cards for ${posts.length} published posts`);
        for (const p of posts) {
            if (!got.some((g) => g.href.includes(encodeURIComponent(p.id)) || g.href.includes(p.id)))
                note(shell, `published post ${p.id} has NO card on the listing`);
        }
        const dead = got.filter((g) => !/\?id=./.test(g.href));
        if (dead.length) note(shell, `${dead.length} card(s) with no ?id= link`);
        if (errs.length) note(shell, `page JS error(s): ${errs.slice(0, 2).join(" | ").slice(0, 140)}`);
        if (!failures.some((f) => f.startsWith(shell)))
            console.log(`  ✓  ${shell} lists ${got.length}/${posts.length} posts, links valid, no JS errors`);
    } catch (e) {
        note(shell, `listing failed to load: ${String(e.message).slice(0, 120)}`);
    }
    await ctx.close();
}

// ---------- 2. every post through the real shell ----------
for (const { shell, posts } of SHELLS) {
    for (const meta of posts) {
        const id = meta.id;
        const url = `${BASE}${shell}?id=${encodeURIComponent(id)}&cb=${Date.now()}`;
        const { ctx, page, errs } = await newPage({ width: 1200, height: 1400 });
        try {
            await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
            await page.waitForFunction(() => {
                const el = document.querySelector(".brief-detail-body, .post-detail-body, #detailContent .empty");
                return el && (el.textContent || "").trim().length > 0;
            }, { timeout: 30000 });

            const r = await page.evaluate(() => {
                const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
                const vis = (el) => !!el && el.offsetHeight > 0;
                const out = {};
                out.notFound = !!document.querySelector("#detailContent .empty");
                out.title = norm(document.querySelector(".brief-detail-title, .post-detail-title")?.textContent);
                out.bodyChars = norm(document.querySelector(".brief-detail-body, .post-detail-body")?.textContent).length;
                const groups = [...document.querySelectorAll(".topic-section, .mz-topic-group")];
                out.groups = groups.length;
                out.synthsVisible = [...document.querySelectorAll(".mz-toc-group-synthesis")]
                    .filter((s) => vis(s) && norm(s.textContent).length >= 60).length;
                out.refs = vis(document.querySelector(".mz-references-list"));
                out.triggers = document.querySelectorAll("button.mz-deepdive-trigger").length;
                out.dialogs = document.querySelectorAll("dialog").length;
                return out;
            });

            if (r.notFound) { note(id, `shell shows "Brief not found"`); await ctx.close(); continue; }
            if (!r.title || r.title.length < 15) note(id, `title missing/too short: "${r.title}"`);
            if (r.bodyChars < 500) note(id, `body renders only ${r.bodyChars} chars of text`);
            const isRoundup = /^blog-2026-W\d+$/.test(id);
            if (isRoundup) {
                if (r.groups < 2) note(id, `only ${r.groups} topic groups render through the shell`);
                if (r.synthsVisible < r.groups)
                    note(id, `only ${r.synthsVisible}/${r.groups} topic syntheses VISIBLE to the reader`);
                if (!r.refs) note(id, `references list not visible`);
            }

            // open the first + last deep-dive modal by CLICKING, like a reader
            if (r.triggers > 0) {
                for (const pick of r.triggers > 1 ? ["first", "last"] : ["first"]) {
                    const m = await page.evaluate((which) => {
                        const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
                        const btns = document.querySelectorAll("button.mz-deepdive-trigger");
                        const btn = which === "first" ? btns[0] : btns[btns.length - 1];
                        btn.click();
                        const dlg = [...document.querySelectorAll("dialog")].find((d) => d.open);
                        if (!dlg) return { open: false };
                        const h = dlg.querySelector(".mz-jc-section h3, h3");
                        const res = {
                            open: true,
                            chars: norm(dlg.textContent).length,
                            visible: dlg.offsetHeight > 0,
                            styled: h ? getComputedStyle(h).textTransform === "uppercase" : false,
                            pending: /pending\b[^.]{0,25}\breview/i.test(norm(dlg.textContent)),
                        };
                        dlg.close();
                        return res;
                    }, pick);
                    if (!m.open) { note(id, `clicking a deep-dive trigger opens NO dialog (handler dead)`); break; }
                    if (!m.visible) note(id, `opened deep-dive dialog has zero height`);
                    if (m.chars < 400) note(id, `opened deep-dive dialog has only ${m.chars} chars`);
                    if (!m.styled) note(id, `opened deep-dive dialog headings unstyled`);
                    if (m.pending) note(id, `opened deep-dive still says "Pending review"`);
                }
            } else if (isRoundup && r.dialogs > 0) {
                note(id, `${r.dialogs} dialogs but ZERO trigger buttons — readers cannot open deep dives`);
            }

            if (errs.length) note(id, `page JS error(s): ${errs.slice(0, 2).join(" | ").slice(0, 140)}`);
        } catch (e) {
            note(id, `reader path failed: ${String(e.message).slice(0, 140)}`);
        }
        await ctx.close();

        // mobile: no horizontal scroll
        const { ctx: mctx, page: mpage } = await newPage({ width: 390, height: 844 });
        try {
            await mpage.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
            await mpage.waitForFunction(() => {
                const el = document.querySelector(".brief-detail-body, .post-detail-body");
                return el && (el.textContent || "").trim().length > 0;
            }, { timeout: 30000 }).catch(() => {});
            const over = await mpage.evaluate(() =>
                Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
            if (over > 2) note(id, `mobile (390px) horizontal overflow of ${over}px`);
        } catch { /* load issues already reported on desktop pass */ }
        await mctx.close();

        if (!failures.some((f) => f.startsWith(`${id}:`)))
            console.log(`  ✓  ${id} via ${shell} — reader path clean (desktop + mobile)`);
    }
}

// ---------- 3. static pages + listings: no mobile horizontal overflow ----------
for (const path of ["/", "/about/", "/evidence/", "/trending/"]) {
    const { ctx, page } = await newPage({ width: 390, height: 844 });
    try {
        await page.goto(`${BASE}${path}?cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForTimeout(2500);
        const over = await page.evaluate(() =>
            Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
        if (over > 2) note(path, `mobile (390px) horizontal overflow of ${over}px`);
        else console.log(`  ✓  ${path} mobile — no horizontal overflow`);
    } catch (e) {
        note(path, `mobile load failed: ${String(e.message).slice(0, 120)}`);
    }
    await ctx.close();
}

await browser.close();

if (failures.length) {
    console.error(`\nreader-path audit: ${failures.length} failure(s):`);
    for (const f of failures) console.error(`  ✗  ${f}`);
    process.exit(2);
}
console.log(`\nreader-path audit: CLEAN — every published post renders and works end-to-end exactly as a reader experiences it.`);
process.exit(0);
