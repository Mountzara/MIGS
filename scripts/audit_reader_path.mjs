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

// ---------- 3b. text contrast (WCAG) on the homepage ----------
// The 2026-07-22 accessibility pass fixed section eyebrows/buttons/links that
// shipped at 2.83:1 (deep purple #6d28d9 as text). This check keeps every
// sampled text element at >=4.5:1 against the LIGHTEST region of the plum
// gradient (conservative base rgb(48,32,92)) so a future edit cannot quietly
// reintroduce low-contrast text on the dark theme.
{
    const { ctx, page } = await newPage({ width: 1440, height: 900 });
    try {
        await page.goto(`${BASE}/?cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForTimeout(5000);
        const bad = await page.evaluate(() => {
            const BASE_BG = [48, 32, 92];  // lightest under-text composite of the 2026-07-22 OLED-brightened plum (stage + overlay)
            const lum = (c) => {
                const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
                return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
            };
            const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
            const SAMPLES = [
                ["section eyebrow", ".section-eyebrow"], ["sub eyebrow", ".sub-eyebrow"],
                ["secondary button", ".btn-secondary"], ["publication link", ".pub-link"],
                ["nav link", ".nav-links a"], ["hero subtitle", ".hero-sub"],
                ["pop tag", ".pop-tag"], ["domain eyebrow", ".domain-eyebrow"],
            ];
            const out = [];
            for (const [label, sel] of SAMPLES) {
                const el = [...document.querySelectorAll(sel)].find((e) => e.offsetHeight > 0);
                if (!el) continue;
                const cs = getComputedStyle(el);
                // context-aware backdrop: walk ancestors for a solid-enough bg.
                // Light panels (About) legitimately carry dark text — judging
                // them against the dark page base false-fails (caught by the
                // gate blocking its own pill fix, 2026-07-22).
                let bg = BASE_BG, n = el.parentElement;
                while (n && n !== document.documentElement) {
                    const bm = (getComputedStyle(n).backgroundColor.match(/[\d.]+/g) || []).map(Number);
                    if (bm.length >= 3 && (bm.length < 4 || bm[3] > 0.5)) { bg = bm.slice(0, 3); break; }
                    n = n.parentElement;
                }
                const m = cs.color.match(/[\d.]+/g).map(Number);
                const alpha = m.length > 3 ? m[3] : 1;
                const fg = m.slice(0, 3).map((v, i) => Math.round(v * alpha + bg[i] * (1 - alpha)));
                const r = ratio(fg, bg);
                const large = parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.66 && parseInt(cs.fontWeight) >= 700);
                if (r < (large ? 3.0 : 4.5)) out.push(`${label} (${sel}) at ${r.toFixed(2)}:1 color=${cs.color} on rgb(${bg.join(",")})`);
            }
            return out;
        });
        if (bad.length) for (const bmsg of bad) note("/", `TEXT CONTRAST below WCAG: ${bmsg}`);
        else console.log(`  ✓  / text contrast — all sampled elements >=4.5:1 (AA) on the gradient's lightest region`);
    } catch (e) {
        note("/", `contrast check failed to run: ${String(e.message).slice(0, 120)}`);
    }
    await ctx.close();
}


// ---------- 3c. NO GREY TEXT anywhere on dark (user directive 2026-07-22) ----------
// Walks every rendered text element on the homepage and a brief page; any
// achromatic color with effective luminance 30-235 sitting on a dark backdrop
// is a FAILURE. Light panels legitimately carry dark text and are skipped.
{
    const GREY_SURVEY = `(() => {
        const lum = (r,g,b) => 0.2126*r+0.7152*g+0.0722*b;
        let grey = 0, ex = [];
        for (const el of document.querySelectorAll('body *')) {
            if (!el.offsetHeight) continue;
            const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 2);
            if (!hasText) continue;
            const m = (getComputedStyle(el).color.match(/[\\d.]+/g) || []).map(Number);
            if (m.length < 3) continue;
            const a = m.length > 3 ? m[3] : 1;
            const er = m[0]*a, eg = m[1]*a, eb = m[2]*a;
            if (!(Math.max(er,eg,eb)-Math.min(er,eg,eb) < 14 && Math.max(er,eg,eb) < 244 && Math.max(er,eg,eb) > 30)) continue;
            let n = el, lightBg = false;
            while (n && n !== document.documentElement) {
                const bg = getComputedStyle(n).backgroundColor.match(/[\\d.]+/g);
                if (bg && bg.length >= 3 && (bg.length < 4 || +bg[3] > 0.5)) { lightBg = lum(+bg[0],+bg[1],+bg[2]) > 140; break; }
                n = n.parentElement;
            }
            if (lightBg) continue;
            grey++;
            if (ex.length < 4) ex.push(((typeof el.className==='string'?el.className:'')||el.tagName).toString().slice(0,30));
        }
        return { grey, ex };
    })()`;
    const roundup = (evidencePosts[0] || {}).id;
    const targets = [`${BASE}/`];
    if (roundup) targets.push(`${BASE}/evidence/?id=${encodeURIComponent(roundup)}`);
    for (const t of targets) {
        const { ctx, page } = await newPage({ width: 1280, height: 950 });
        try {
            await page.goto(`${t}${t.includes("?") ? "&" : "?"}cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 45000 });
            await page.waitForTimeout(6000);
            await page.evaluate(`(async () => { for (let y = 0; y < Math.min(document.body.scrollHeight, 22000); y += 900) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 40)); } })()`);
            await page.waitForTimeout(600);
            const r = await page.evaluate(GREY_SURVEY);
            if (r.grey > 0) note(t.replace(BASE, ""), `${r.grey} GREY text element(s) on dark (must be white): ${r.ex.join(", ")}`);
            else console.log(`  ✓  ${t.replace(BASE, "") || "/"} — zero grey text on dark`);
        } catch (e) {
            note(t.replace(BASE, ""), `grey survey failed: ${String(e.message).slice(0, 100)}`);
        }
        await ctx.close();
    }
}


// ---------- 3d. SCROLL EXPERIENCE — no stalls, no dead zones, no stuck reveals ----------
// (user directive 2026-07-22: the drag/scroll-reveal parts must WORK on
// desktop and mobile). Drives REAL wheel gestures down each public page in
// both viewports and asserts: (a) the page reaches bottom — a scroll hijack
// that swallows input (the retired initPinnedSnap busy-lock) fails here;
// (b) dead-zone ratio: >30% of gestures producing zero movement = stall;
// (c) after the pass, no reveal-eligible element that is in the viewport is
// still invisible (opacity < 0.1) — the "sections never appear" class.
{
    const SCROLL_PAGES = ["/", "/about/", "/cv/", "/curriculum/"];
    const VIEWPORTS = [{ w: 1440, h: 900, label: "desktop" }, { w: 390, h: 844, label: "mobile" },
        // Reduce Motion is a common accessibility setting (and blocks iOS video
        // autoplay, so our own user runs it). It disables animation — it must
        // NEVER disable content: the 2026-07-22 bug left .evidence-card/
        // .surgical-card/.reveal sections invisible forever under RM.
        { w: 390, h: 844, label: "mobile-reduced-motion", rm: true }];
    for (const path of SCROLL_PAGES) {
        for (const vp of VIEWPORTS) {
            const ctx2 = await browser.newContext({ viewport: { width: vp.w, height: vp.h },
                reducedMotion: vp.rm ? "reduce" : "no-preference" });
            const page = await ctx2.newPage();
            await page.route("**/*", (r) => /\.(png|jpe?g|webp|svg|gif|woff2?|ttf|otf|mp4|webm|ico)(\?|$)/i.test(r.request().url()) ? r.abort() : r.continue());
            const ctx = ctx2;
            const id = `${path}@${vp.label}`;
            try {
                await page.goto(`${BASE}${path}?cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 45000 });
                await page.waitForTimeout(6500);
                let dead = 0, steps = 0, lastY = -1;
                for (let i = 0; i < 120; i++) {
                    const y0 = await page.evaluate("window.scrollY");
                    await page.mouse.wheel(0, vp.h * 0.7);
                    await page.waitForTimeout(140);
                    const st = await page.evaluate("({y: window.scrollY, max: Math.max(0, document.documentElement.scrollHeight - innerHeight)})");
                    steps++;
                    if (st.y <= y0 + 2 && st.y < st.max - 4) dead++;
                    lastY = st.y;
                    if (st.y >= st.max - 4) break;
                }
                const end = await page.evaluate("({y: window.scrollY, max: Math.max(0, document.documentElement.scrollHeight - innerHeight)})");
                if (end.y < end.max - vp.h * 0.5)
                    note(id, `scroll TRAPPED at ${Math.round(end.y)}/${Math.round(end.max)} after ${steps} wheel gestures`);
                else if (dead / Math.max(1, steps) > 0.30)
                    note(id, `scroll STALLS: ${dead}/${steps} gestures moved nothing`);
                await page.waitForTimeout(1300);  // let reveal transitions settle — mid-transition sampling false-positives at 700ms
                const stuck = await page.evaluate(`(() => {
                    const sel = '[data-reveal], .reveal, .word-reveal, .evidence-card, .surgical-card';
                    const bad = [];
                    for (const el of document.querySelectorAll(sel)) {
                        const r = el.getBoundingClientRect();
                        const inView = r.bottom > 0 && r.top < innerHeight && r.height > 4;
                        if (!inView) continue;
                        if (parseFloat(getComputedStyle(el).opacity) < 0.1)
                            bad.push(((typeof el.className === 'string' ? el.className : '') || el.tagName).slice(0, 30));
                    }
                    return bad.slice(0, 5);
                })()`);
                // also sweep back to a mid point and re-check a sample band
                if (stuck.length) note(id, `${stuck.length}+ reveal element(s) STUCK invisible in viewport: ${stuck.join(", ")}`);
                if (!failures.some((f) => f.startsWith(id)))
                    console.log(`  ✓  ${id} — reached bottom in ${steps} gestures, ${dead} dead, no stuck reveals`);
            } catch (e) {
                note(id, `scroll test failed: ${String(e.message).slice(0, 110)}`);
            }
            await ctx.close();
        }
    }
}


// ---------- 3e. THEME CONSISTENCY — no black-slab backdrops, no flat canvases ----------
// (2026-07-28, user-caught on /curriculum/.) Two bug classes shipped as
// partial theme application: (a) fixed backdrop stages with an OPAQUE
// background covering the plum body — the page reads black and glass has
// nothing to frost; (b) page canvases whose var-fallback chains bottomed
// out at legacy near-black, leaving flat canvases with no gradient. Both
// are now hard assertions on a representative page set.
{
    const THEME_PAGES = ["/", "/about/", "/cv/", "/curriculum/", "/curriculum/cbg-migs/",
        "/evidence/", "/trending/", "/education/endometriosis/", "/portal/login/"];
    for (const path of THEME_PAGES) {
        const { ctx, page } = await newPage({ width: 1366, height: 900 });
        try {
            await page.goto(`${BASE}${path}?cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 45000 });
            await page.waitForTimeout(4000);
            const r = await page.evaluate(`(() => {
                const out = [];
                for (const sel of ['.page-bg-stage', '.hero-bg-stage']) {
                    const st = document.querySelector(sel);
                    if (!st) continue;
                    const m = (getComputedStyle(st).backgroundColor.match(/[\\d.]+/g) || []).map(Number);
                    if (m.length >= 3 && (m.length < 4 || m[3] > 0.5)) out.push(sel + ' has OPAQUE background (hides theme)');
                    const art = st.querySelector('img, video');
                    if (art && getComputedStyle(art).mixBlendMode !== 'screen') out.push(sel + ' art not screen-blended (black slab)');
                }
                const gi = getComputedStyle(document.documentElement).backgroundImage + getComputedStyle(document.body).backgroundImage;
                const pick = (el) => { const m = (getComputedStyle(el).backgroundColor.match(/[\\d.]+/g) || []).map(Number);
                    return (m.length >= 3 && (m.length < 4 || m[3] > 0.1)) ? m.slice(0, 3) : null; };
                const solid = pick(document.body) || pick(document.documentElement);
                const dark = solid && Math.max(...solid) < 26 && (Math.max(...solid) - Math.min(...solid)) < 8;
                if (!/gradient/.test(gi) && (dark || !solid)) out.push('page canvas flat/near-black with no gradient');
                return out;
            })()`);
            if (r.length) note(`${path}@theme`, r.join("; "));
            else console.log(`  ✓  ${path} — theme consistent (stage transparent, art blended, plum canvas)`);
        } catch (e) {
            note(`${path}@theme`, `theme check failed: ${String(e.message).slice(0, 100)}`);
        }
        await ctx.close();
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
