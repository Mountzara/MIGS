// =====================================================================
// functions/portal/_middleware.js — public Coming Soon / admin preview
// =====================================================================
// Per user directive 2026-05-15: the patient-facing /portal/ surface is
// hidden from the public until the operator approves the design + drafts.
// The middleware:
//
//   * Lets admin Basic-Auth-authenticated requests through to the actual
//     /portal/* assets (so the operator can preview the live build).
//   * Serves a designed Coming Soon HTML page to every other request,
//     regardless of which /portal/ sub-path was requested. The Coming
//     Soon page styling matches §3.10 (purple Apple-glass, mzRise
//     animations, prefers-reduced-motion override, Nunito Sans /
//     Avenir Next typography).
//
// Once env.PORTAL_PUBLIC_LAUNCH = "true", the gate opens and traffic
// passes through to /portal/* for everyone. Default closed.
// =====================================================================

import { previewAccess } from "../_lib/preview_gate.js";
import { applyPortalHeaders } from "../_lib/portal_headers.js";

// HTMLRewriter that appends the Phase QB feedback widget AND the Phase
// QC onboarding wizard scripts before </body>. Single point of control:
// any new portal SPA gets both widgets without a per-SPA <script> tag.
class PortalScriptInjector {
    element(element) {
        // The script tags become the last children of <body>.
        element.append(
            `\n<!-- Phase QB beta-tester feedback widget — see /portal/_feedback.js -->\n` +
            `<script async src="/portal/_feedback.js"></script>\n` +
            `<!-- Phase QC onboarding wizard — see /portal/_wizard.js -->\n` +
            `<script async src="/portal/_wizard.js"></script>\n`,
            { html: true }
        );
    }
}

// ---------------------------------------------------------------------
// EVERY response leaves through here.
// ---------------------------------------------------------------------
// This middleware sits in front of the whole /portal/* surface, which
// makes it the one place where the security headers can be guaranteed.
// They are NOT guaranteed by `_headers`, for two independent reasons —
// `_headers` appends rather than replaces (so the path-specific
// Permissions-Policy and CSP were being ignored by the browser), and it is
// not applied at all to responses a Function constructs (the Coming Soon
// page below, the visit-launch interstitial, the NPS survey). Both are
// written up in full in _lib/portal_headers.js.
export async function onRequest(ctx) {
    const { request, env, next } = ctx;
    const path = new URL(request.url).pathname;
    const seal = (resp) => applyPortalHeaders(resp, path);

    const { allow } = await previewAccess(request, env);
    if (allow) {
        // Admin (or launched) — pass through to the real /portal/* asset,
        // and rewrite the HTML response to inject the feedback widget.
        const resp = await next();
        const ct = (resp.headers.get("content-type") || "").toLowerCase();
        if (!ct.startsWith("text/html")) return seal(resp);
        // Don't inject into the preview-grant landing page or coming-soon
        // (those are already self-contained and we want a clean handoff).
        if (path.startsWith("/portal/preview-grant")) return seal(resp);
        return seal(new HTMLRewriter()
            .on("body", new PortalScriptInjector())
            .transform(resp));
    }
    // Public, pre-launch — serve the Coming Soon HTML.
    // Note the cache header: this used to be `public, max-age=60`, which
    // applyPortalHeaders now replaces with the portal's no-store posture.
    // A 60-second public cache was fine for THIS page but wrong for the
    // surface, and the distinction was one deploy away from mattering.
    return seal(new Response(COMING_SOON_HTML, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
    }));
}

// ---------------------------------------------------------------------
// Coming Soon HTML
//
// This is the public /portal/ page: the portal AND the membership model,
// which is the detail a visitor is actually here for.
//
// REBUILT 2026-08-14. The previous version used FOUR different content
// widths — 760px for prose, 900px for the tier strip, 900px for the
// detail sections and 620px for the form — so nothing lined up with
// anything and the page read as a pile of unrelated blocks. It also led
// with eleven feature cards and put the tiers AFTER the signup form, so a
// visitor was asked to sign up before being told what for. On a 1440px
// screen the content sat in a ~420px column; on a phone it overflowed
// horizontally (902px of content in a 390px viewport).
//
// Now: one layout system (--w-page for structure, --w-prose for reading),
// one section rhythm, and an order that answers the visitor's questions in
// the order they have them — what is this, what does it cost, why does it
// exist, what do I get, what is it not, how do I hear about it.
//
// THIS IS A TEMPLATE LITERAL. A single-backslash escape written for the
// BROWSER is evaluated here instead — that is what put a real newline
// inside a string and killed the whole script. Write \\n, \\u2014 and
// \\${. scripts/check_inline_scripts.mjs parses the OUTPUT and blocks the
// deploy if any inline script would not run.
// ---------------------------------------------------------------------
const COMING_SOON_HTML = `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>Member Portal &amp; Membership — Coming Soon · Mount Zara</title>
    <meta name="description" content="The Mount Zara member portal and membership programme. Four tiers, what each includes, what it costs, and the evidence behind it.">
    <meta name="robots" content="noindex, nofollow">
    <link rel="icon" type="image/png" href="/favicon.png">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@200;300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
        /* =============================================================
           ONE LAYOUT SYSTEM.
           The previous version had four different content widths — 760px
           for prose, 900px for the tier strip, 900px for detail sections
           and 620px for the form — so nothing lined up with anything and
           the page read as a pile of unrelated blocks. There are now
           exactly two: --w-page for anything with structure, and
           --w-prose for reading text. Every section uses one or the other.
           ============================================================= */
        :root {
            --bg-base: #120b22;
            --fg: #ffffff;
            --accent: #6d28d9;
            --accent-soft: #a78bfa;
            --glow: 167, 139, 250;
            --line: rgba(255, 255, 255, 0.11);
            --card: rgba(255, 255, 255, 0.035);
            --card-hi: rgba(167, 139, 250, 0.07);
            --w-page: 1080px;
            --w-prose: 68ch;
            --gap: clamp(16px, 2.2vw, 22px);
            --sec: clamp(56px, 7vw, 96px);
        }
        * { box-sizing: border-box; }
        html { -webkit-text-size-adjust: 100%; }
        html, body {
            margin: 0; padding: 0;
            /* Horizontal overflow was 902px inside a 390px viewport. A
               single overflow-x:hidden would only have hidden the symptom;
               the real causes (an unconstrained table and a min-width grid)
               are fixed at each site below. This is the belt. */
            overflow-x: hidden;
            background:
                radial-gradient(ellipse 90% 55% at 50% -8%, rgba(var(--glow), 0.16), transparent 62%),
                var(--bg-base);
            color: var(--fg);
            font-family: 'Avenir Next', 'Avenir', 'Nunito Sans', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
            font-feature-settings: "ss01", "cv11";
            line-height: 1.6;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
        }
        a { color: var(--accent-soft); text-decoration: none; transition: color .2s; }
        a:hover { color: #fff; }
        img, table { max-width: 100%; }

        .page { max-width: var(--w-page); margin: 0 auto; padding: 0 clamp(18px, 4vw, 32px); }
        .prose { max-width: var(--w-prose); }

        /* ---- section rhythm: one pattern, used everywhere ---------- */
        section { padding-block: var(--sec); border-top: 1px solid var(--line); }
        section:first-of-type { border-top: 0; }
        .eyebrow {
            font-size: 11px; font-weight: 700; letter-spacing: .2em;
            text-transform: uppercase; color: rgba(var(--glow), .95);
            margin: 0 0 12px;
        }
        h2 {
            font-weight: 300; font-size: clamp(24px, 3.2vw, 34px);
            letter-spacing: -.02em; line-height: 1.2; color: #fff;
            margin: 0 0 12px;
        }
        .sub { font-size: 15.5px; opacity: .74; margin: 0 0 clamp(24px, 3vw, 34px); max-width: var(--w-prose); }

        /* ---- masthead --------------------------------------------- */
        header.mast { padding-top: clamp(28px, 5vw, 52px); }
        .back { display: inline-block; font-size: 13px; opacity: .7; margin-bottom: 26px; }
        .back::before { content: "\\2190"; margin-right: 7px; }
        .status {
            display: inline-flex; align-items: center; gap: 9px;
            font-size: 11px; font-weight: 700; letter-spacing: .2em;
            text-transform: uppercase; color: rgba(var(--glow), .95);
            margin-bottom: 20px;
        }
        .pulse {
            width: 7px; height: 7px; border-radius: 50%; background: var(--accent-soft);
            animation: mzPulse 2.4s cubic-bezier(.4,0,.6,1) infinite;
        }
        h1 {
            font-weight: 200; font-size: clamp(30px, 5.4vw, 56px);
            letter-spacing: -.026em; line-height: 1.06; color: #fff;
            margin: 0 0 20px; max-width: 20ch;
        }
        h1 em {
            font-style: normal;
            background: linear-gradient(180deg, rgba(var(--glow),1) 0%, var(--accent) 100%);
            -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
        }
        .lede { font-size: clamp(16px, 1.6vw, 18px); line-height: 1.62; opacity: .84; max-width: var(--w-prose); margin: 0; }

        /* ---- tiers: the thing this page is actually about ---------- */
        /* Equal-height columns that align row-for-row, because the whole
           point of four prices side by side is comparison. auto-fit with a
           220px floor collapses cleanly to 2-up then 1-up without ever
           forcing the page wider than the viewport. */
        .tiers {
            display: grid; gap: var(--gap);
            grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr));
            align-items: stretch;
        }
        .tier {
            display: flex; flex-direction: column;
            background: var(--card); border: 1px solid var(--line);
            border-radius: 15px; padding: 22px 20px 20px;
        }
        .tier.lead { border-color: rgba(var(--glow), .5); background: var(--card-hi); }
        .tier .badge {
            font-size: 10px; letter-spacing: .16em; text-transform: uppercase;
            color: rgba(var(--glow), .95); margin-bottom: 9px; min-height: 13px;
        }
        .tier h3 { margin: 0 0 4px; font-size: 19px; font-weight: 600; color: #fff; }
        .tier .tag { font-size: 13px; opacity: .66; margin: 0 0 16px; line-height: 1.45; min-height: 38px; }
        .tier .price { font-size: 30px; font-weight: 600; color: #fff; line-height: 1; }
        .tier .price small { font-size: 13px; opacity: .6; font-weight: 400; letter-spacing: 0; }
        .tier .yr { font-size: 12.5px; opacity: .5; margin: 6px 0 18px; min-height: 17px; }
        .tier ul { list-style: none; padding: 0; margin: 0 0 16px; flex: 1; }
        .tier li {
            font-size: 13.4px; line-height: 1.5; opacity: .86;
            padding: 0 0 9px 16px; position: relative;
        }
        .tier li::before {
            content: ""; position: absolute; left: 0; top: 8px;
            width: 5px; height: 5px; border-radius: 50%; background: var(--accent-soft);
        }
        .tier .worth {
            font-size: 12.4px; color: #6ee7b7; line-height: 1.45;
            padding-top: 13px; border-top: 1px solid var(--line); margin-top: auto;
        }

        /* ---- comparison ------------------------------------------- */
        .scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
        table.cmp { width: 100%; border-collapse: collapse; font-size: 14px; min-width: 560px; }
        table.cmp th {
            text-align: left; font-size: 10px; letter-spacing: .14em; text-transform: uppercase;
            opacity: .55; font-weight: 700; padding: 0 18px 11px 0;
            border-bottom: 1px solid var(--line); white-space: nowrap;
        }
        table.cmp td {
            padding: 15px 18px 15px 0; vertical-align: top; line-height: 1.55;
            border-bottom: 1px solid rgba(255,255,255,.055);
        }
        table.cmp td.k { font-weight: 600; width: 21%; }
        table.cmp td.was { opacity: .55; width: 38%; }
        table.cmp tr:last-child td { border-bottom: 0; }

        /* ---- generic card grid (prep, features) ------------------- */
        .grid {
            display: grid; gap: var(--gap);
            grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr));
        }
        .card {
            background: var(--card); border: 1px solid var(--line);
            border-radius: 14px; padding: 19px 19px 17px;
        }
        .card h4 { margin: 0 0 7px; font-size: 15.5px; font-weight: 600; color: #fff; line-height: 1.3; }
        .card p { margin: 0 0 8px; font-size: 13.6px; line-height: 1.55; opacity: .76; }
        .card p:last-child { margin-bottom: 0; }
        .card .why { color: #c4b5fd; opacity: .95; font-size: 13px; }
        .card .lab {
            font-size: 10px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase;
            color: rgba(var(--glow), .9); margin-bottom: 8px;
        }

        /* ---- evidence --------------------------------------------- */
        .ev {
            border-left: 2px solid rgba(var(--glow), .55);
            padding: 2px 0 2px 18px; margin-bottom: 22px; max-width: var(--w-prose);
        }
        .ev .claim { font-size: 16px; font-weight: 600; color: #fff; margin: 0 0 6px; line-height: 1.42; }
        .ev .det { font-size: 14px; opacity: .74; margin: 0 0 8px; line-height: 1.6; }
        .ev .src { font-size: 12.5px; opacity: .55; margin: 0; }
        .ev .cav { font-size: 12.5px; opacity: .45; font-style: italic; margin: 6px 0 0; }

        /* ---- plainly ---------------------------------------------- */
        ul.plain { margin: 0; padding-left: 20px; max-width: var(--w-prose); }
        ul.plain li { font-size: 14px; line-height: 1.62; opacity: .78; margin-bottom: 11px; }
        .note-box {
            background: rgba(var(--glow), .08); border: 1px solid rgba(var(--glow), .26);
            border-radius: 12px; padding: 15px 18px; font-size: 13.4px; line-height: 1.6;
            opacity: .92; margin-top: 20px; max-width: var(--w-prose);
        }

        /* ---- signup ------------------------------------------------ */
        .signup {
            background: var(--card); border: 1px solid rgba(var(--glow), .3);
            border-radius: 16px; padding: clamp(20px, 3vw, 28px); max-width: 640px;
        }
        .row2 { display: grid; grid-template-columns: 2fr 1fr; gap: 13px; margin-bottom: 15px; }
        @media (max-width: 560px) { .row2 { grid-template-columns: 1fr; } }
        .signup label {
            display: block; font-size: 10.5px; letter-spacing: .13em;
            text-transform: uppercase; opacity: .68; margin-bottom: 7px;
        }
        .signup input, .signup select {
            width: 100%; padding: 12px 13px; font-size: 16px; font-family: inherit;
            color: #fff; background: rgba(255,255,255,.06);
            border: 1px solid rgba(255,255,255,.16); border-radius: 10px;
        }
        .signup input:focus, .signup select:focus { outline: none; border-color: rgba(var(--glow), .65); }
        .signup input::placeholder { color: rgba(255,255,255,.4); }
        .signup select option { background: #1d1830; color: #fff; }
        .btn {
            background: linear-gradient(135deg, #8b5cf6, #7c3aed); color: #fff; border: 0;
            border-radius: 10px; padding: 13px 28px; font: 600 15px inherit; cursor: pointer;
        }
        .btn:disabled { opacity: .55; cursor: wait; }
        .msg { display: none; margin-top: 15px; font-size: 14px; line-height: 1.6; padding: 12px 14px; border-radius: 10px; white-space: pre-line; }
        .msg.ok { display: block; background: rgba(16,185,129,.15); color: #6ee7b7; }
        .msg.err { display: block; background: rgba(167,139,250,.15); color: #ddd0ff; }
        .fine { font-size: 12.5px; opacity: .58; margin: 15px 0 0; line-height: 1.55; }

        footer { padding: 30px 0 60px; font-size: 13px; opacity: .6; border-top: 1px solid var(--line); }
        footer a { margin-right: 14px; }

        @keyframes mzPulse {
            0%, 100% { box-shadow: 0 0 0 0 rgba(var(--glow), .55); }
            50%      { box-shadow: 0 0 0 8px rgba(var(--glow), 0); }
        }
        @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
        .skeleton { opacity: .4; font-size: 14px; }
    </style>
</head>
<body>
<div class="page">

    <header class="mast">
        <a class="back" href="/">Back to mountzara.com</a>
        <div class="status"><span class="pulse" aria-hidden="true"></span>Member portal &middot; opening soon</div>
        <h1>A place to take <em>care of you</em>, between visits and beyond.</h1>
        <p class="lede">Two things are being built: a member <strong>portal</strong> where your records,
        messages, intake and visit summaries live, and a <strong>membership</strong> for people who want
        more access than insurance alone buys. Everything below is real detail on both &mdash; what each
        tier includes, what it costs, and the evidence behind why it exists.</p>
    </header>

    <!-- THE MODEL FIRST. Previously eleven feature cards came first and the
         tiers appeared after the signup form, so a visitor was asked to
         sign up before being told what for. -->
    <section id="tiers">
        <p class="eyebrow">The membership</p>
        <h2>Four ways to be looked after.</h2>
        <p class="sub">Standard is ordinary insurance-billed care and always will be. The paid tiers buy
        access and preparation &mdash; never the clinical services your insurance already covers.</p>
        <div class="tiers" id="tier-strip"><p class="skeleton">Loading the tiers&hellip;</p></div>
    </section>

    <section id="difference">
        <p class="eyebrow">The difference</p>
        <h2>What the ordinary path costs you, and what changes.</h2>
        <div class="scroll"><table class="cmp"><tbody id="cmp-body"></tbody></table></div>
    </section>

    <section id="why">
        <p class="eyebrow">Why</p>
        <h2>The problem this is built against.</h2>
        <p class="sub">With the sources, so you can check them.</p>
        <div id="evidence"></div>
    </section>

    <section id="prep">
        <p class="eyebrow">Preparation</p>
        <h2>What arrives before your next appointment.</h2>
        <p class="sub">With any clinician &mdash; including the OB/GYN you already have and want to keep.</p>
        <div class="grid" id="prep-grid"></div>
        <div class="note-box" id="prep-note"></div>
    </section>

    <section id="portal">
        <p class="eyebrow">The portal</p>
        <h2>What lives inside, for every member.</h2>
        <p class="sub">Included at every tier, Standard included.</p>
        <div class="grid">
            <div class="card"><div class="lab">Intake</div><h4>A 19-section comprehensive intake</h4>
                <p>Bleeding history, pelvic pain mapping, perioperative risk factors including GLP-1 use, and treatment goals. Autosaves as you go.</p></div>
            <div class="card"><div class="lab">Symptom diary</div><h4>Track what you are actually feeling</h4>
                <p>Pain, bleeding, cycle, sleep, mood, bowel and bladder &mdash; charted over time, so visits start with data rather than memory.</p></div>
            <div class="card"><div class="lab">Visit summaries</div><h4>A clear recap of every visit</h4>
                <p>What was discussed, the plan, the medicines and the next steps &mdash; drawn from Dr.&nbsp;Mabini&rsquo;s own reference library and reviewed by him before you see it.</p></div>
            <div class="card"><div class="lab">Telehealth</div><h4>Doxy.me video when you need it</h4>
                <p>One tap to join when your appointment opens. No app to install.</p></div>
            <div class="card"><div class="lab">Messaging &amp; documents</div><h4>Secure, and on the record</h4>
                <p>A thread with the practice between visits. Upload imaging and records. Encrypted at rest with per-record keys.</p></div>
            <div class="card"><div class="lab">Education</div><h4>Reading that fits your care</h4>
                <p>Primers Dr.&nbsp;Mabini has written on endometriosis, adenomyosis, fibroids, recovery and more &mdash; sent when they are relevant to you.</p></div>
        </div>
    </section>

    <section id="plainly">
        <p class="eyebrow">Plainly</p>
        <h2>What membership is, and what it is not.</h2>
        <ul class="plain" id="disclosures"></ul>
    </section>

    <section id="join">
        <p class="eyebrow">Be first in</p>
        <h2>Tell me when it opens.</h2>
        <p class="sub">One email when it does, and nothing else. No card, no commitment. Telling us your
        state also tells us where to open next &mdash; Dr.&nbsp;Mabini is licensed in Illinois and
        California today.</p>
        <div class="signup">
            <div style="margin-bottom:15px">
                <label for="su-tier">Which would you want?</label>
                <select id="su-tier"><option value="any">Not sure yet &mdash; tell me more</option></select>
            </div>
            <div class="row2">
                <div>
                    <label for="su-email">Email</label>
                    <input id="su-email" type="email" autocomplete="email" placeholder="you@example.com">
                </div>
                <div>
                    <label for="su-state">State</label>
                    <input id="su-state" type="text" maxlength="2" placeholder="IL" autocomplete="address-level1" style="text-transform:uppercase">
                </div>
            </div>
            <button type="button" class="btn" id="su-go">Join the list</button>
            <div class="msg" id="su-msg" role="status" aria-live="polite"></div>
            <p class="fine">Please don&rsquo;t include symptoms or medical history here &mdash; this is a
            mailing list, not a medical record, and it isn&rsquo;t encrypted for that. There will be a
            secure place for it when the portal opens.</p>
        </div>
        <p class="fine" style="max-width:640px">If you&rsquo;re an existing patient and need the office in
        the meantime, please call the practice or email
        <a href="mailto:info@mountzara.com">info@mountzara.com</a>.</p>
    </section>

    <footer>
        <a href="/">Home</a><a href="/about/">About Dr. Mabini</a><a href="/evidence/">Evidence</a><a href="/trending/">Trending</a>
    </footer>
</div>

<script>
(function () {
    "use strict";
    function esc(v) {
        return String(v == null ? "" : v)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }
    function $(id) { return document.getElementById(id); }
    function hide(id) { var s = $(id); if (s) s.style.display = "none"; }

    fetch("/api/v1/membership", { headers: { Accept: "application/json" } })
        .then(function (r) { return r.json(); })
        .then(function (d) {
            if (!d || !d.ok) throw new Error("no data");

            // ---- tiers ----
            var strip = $("tier-strip"), sel = $("su-tier"), h = "";
            (d.tiers || []).forEach(function (t) {
                h += '<div class="tier' + (t.key === "navigator" ? " lead" : "") + '">';
                h += '<div class="badge">' + (t.key === "navigator" ? "Most people start here" : "&nbsp;") + "</div>";
                h += "<h3>" + esc(t.name) + "</h3>";
                h += '<p class="tag">' + esc(t.tagline) + "</p>";
                h += '<div class="price">$' + t.price_month + (t.price_month ? "<small>/mo</small>" : "") + "</div>";
                h += '<div class="yr">' + (t.price_year ? "or $" + t.price_year + " a year" : "Free, always") + "</div>";
                h += "<ul>" + (t.benefits || []).map(function (b) { return "<li>" + esc(b) + "</li>"; }).join("") + "</ul>";
                h += '<div class="worth">' + esc((t.value && t.value.headline) || "Billed to your insurance as usual.") + "</div>";
                h += "</div>";
                if (sel && t.price_month > 0) {
                    var o = document.createElement("option");
                    o.value = t.key;
                    o.textContent = t.name + " \\u2014 $" + t.price_month + "/mo";
                    sel.appendChild(o);
                }
            });
            if (strip) strip.innerHTML = h;

            // ---- comparison ----
            var body = $("cmp-body");
            if (body && d.comparison && d.comparison.length) {
                body.innerHTML =
                    "<tr><th></th><th>Usually</th><th>Here</th></tr>" +
                    d.comparison.map(function (c) {
                        return '<tr><td class="k">' + esc(c.dimension) + '</td><td class="was">' +
                               esc(c.traditional) + "</td><td>" + esc(c.here) + "</td></tr>";
                    }).join("");
            } else { hide("difference"); }

            // ---- evidence ----
            var ev = $("evidence");
            if (ev && d.evidence && d.evidence.length) {
                ev.innerHTML = d.evidence.map(function (e) {
                    var s = '<div class="ev"><p class="claim">' + esc(e.claim) + "</p>";
                    if (e.detail) s += '<p class="det">' + esc(e.detail) + "</p>";
                    s += '<p class="src">' + esc(e.source) + (e.year ? " (" + e.year + ")" : "");
                    if (e.url) s += ' &middot; <a href="' + esc(e.url) + '" target="_blank" rel="noopener">read it</a>';
                    s += "</p>";
                    if (e.caveat) s += '<p class="cav">' + esc(e.caveat) + "</p>";
                    return s + "</div>";
                }).join("");
            } else { hide("why"); }

            // ---- preparation ----
            var pg = $("prep-grid");
            if (pg && d.visit_prep && d.visit_prep.deliverables) {
                pg.innerHTML = d.visit_prep.deliverables.map(function (p) {
                    return '<div class="card"><h4>' + esc(p.name) + "</h4><p>" + esc(p.what) +
                           '</p><p class="why">' + esc(p.why) + "</p></div>";
                }).join("");
                var pn = $("prep-note");
                if (pn) pn.textContent = d.visit_prep.disclaimer || "";
            } else { hide("prep"); }

            // ---- plainly ----
            var dis = $("disclosures");
            if (dis) {
                var items = (d.disclosures || []).slice();
                if (d.consultation_states && d.consultation_states.length) {
                    items.push("Dr. Mabini is licensed in " + d.consultation_states.join(" and ") +
                        ". Preparation tools are available wherever you live; a clinical consultation is only possible in those states.");
                }
                dis.innerHTML = items.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("");
                if (!items.length) hide("plainly");
            }
        })
        .catch(function () {
            // The signup still works without the detail. Say so rather than
            // leaving a "Loading…" that never resolves.
            var strip = $("tier-strip");
            if (strip) strip.innerHTML = '<p class="skeleton">Tier details could not be loaded just now. ' +
                'You can still join the list below and we will send them to you.</p>';
            ["difference", "why", "prep", "plainly"].forEach(hide);
        });

    // ---- waitlist ----
    var go = $("su-go"), msg = $("su-msg");
    if (!go || !msg) return;
    function show(text, ok) { msg.className = "msg " + (ok ? "ok" : "err"); msg.textContent = text; }
    go.addEventListener("click", function () {
        var email = ($("su-email").value || "").trim();
        if (!email) { show("Please add your email address.", false); return; }
        go.disabled = true; go.textContent = "Adding you\\u2026";
        fetch("/api/v1/membership/interest", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                email: email,
                tier: ($("su-tier") || {}).value || "any",
                state: ($("su-state").value || "").trim().toUpperCase(),
                source: "portal_coming_soon"
            })
        }).then(function (r) { return r.json(); }).then(function (j) {
            go.disabled = false; go.textContent = "Join the list";
            if (!j.ok) { show(j.error || "Could not add you just now.", false); return; }
            show(j.message + (j.note ? "\\n\\n" + j.note : ""), true);
            $("su-email").value = "";
        }).catch(function () {
            go.disabled = false; go.textContent = "Join the list";
            show("Could not reach the server. Please try again.", false);
        });
    });
})();
</script>
</body>
</html>
`;
