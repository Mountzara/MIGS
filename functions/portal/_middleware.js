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

export async function onRequest(ctx) {
    const { request, env, next } = ctx;
    const { allow } = await previewAccess(request, env);
    if (allow) {
        // Admin (or launched) — pass through to the real /portal/* asset,
        // and rewrite the HTML response to inject the feedback widget.
        const resp = await next();
        const ct = (resp.headers.get("content-type") || "").toLowerCase();
        if (!ct.startsWith("text/html")) return resp;
        // Don't inject into the preview-grant landing page or coming-soon
        // (those are already self-contained and we want a clean handoff).
        const path = new URL(request.url).pathname;
        if (path.startsWith("/portal/preview-grant")) return resp;
        return new HTMLRewriter()
            .on("body", new PortalScriptInjector())
            .transform(resp);
    }
    // Public, pre-launch — serve the Coming Soon HTML.
    return new Response(COMING_SOON_HTML, {
        status: 200,
        headers: {
            "content-type": "text/html; charset=utf-8",
            // Don't cache aggressively — when we flip launch flag, the
            // public should pick up the real site quickly. Cache only at
            // the browser, short TTL.
            "cache-control": "public, max-age=60, s-maxage=60",
            // Belt-and-suspenders security headers (mirrors site defaults).
            "x-content-type-options": "nosniff",
            "referrer-policy": "strict-origin-when-cross-origin",
        },
    });
}

// ---------------------------------------------------------------------
// Coming Soon HTML
// Single inline document — same visual grammar as the homepage so a
// visitor immediately recognizes it as a mountzara.com surface.
// Per CLAUDE.md §3.10: Apple-glass purple, mzRise cascade, no blue
// tokens, prefers-reduced-motion override, Nunito Sans + Avenir Next.
// ---------------------------------------------------------------------
const COMING_SOON_HTML = `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>Member Portal — Coming Soon · Mount Zara</title>
    <meta name="description" content="The Mount Zara member portal is in active design. Telehealth, intake, secure messaging, and document handling launch soon.">
    <meta name="robots" content="noindex, nofollow">
    <link rel="icon" type="image/png" href="/favicon.png">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@200;300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-base: #120b22;
            --bg-soft: #0e0e13;
            --fg-strong: #ffffff;
            --fg-mid: #ffffff;
            --fg-soft: #ffffff;
            --accent: #6d28d9;
            --accent-soft: #a78bfa;
            --glow-purple: 167, 139, 250;
        }
        * { box-sizing: border-box; }
        html, body {
            margin: 0; padding: 0;
            background:
                radial-gradient(ellipse 80% 60% at 50% -10%, rgba(var(--glow-purple), 0.18), transparent 60%),
                radial-gradient(ellipse 60% 50% at 90% 110%, rgba(109, 40, 217, 0.12), transparent 60%),
                var(--bg-base);
            color: var(--fg-mid);
            font-family: 'Avenir Next', 'Avenir', 'Nunito Sans', -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif;
            font-feature-settings: "ss01", "cv11";
            line-height: 1.55;
            min-height: 100vh;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
        }
        a { color: var(--accent-soft); text-decoration: none; transition: color 0.2s ease; }
        a:hover { color: var(--fg-strong); }
        .wrap {
            max-width: 760px;
            margin: 0 auto;
            padding: clamp(48px, 8vw, 96px) clamp(20px, 5vw, 40px);
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            justify-content: center;
        }
        .nav-back {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            font-size: 13px;
            color: var(--fg-soft);
            margin-bottom: 36px;
            animation: mzRise 0.7s cubic-bezier(0.16, 1, 0.3, 1) both;
            animation-delay: 0.05s;
        }
        .nav-back::before {
            content: "\\2190";
            font-size: 14px;
            margin-right: 2px;
        }
        .eyebrow {
            display: inline-flex;
            align-items: center;
            gap: 10px;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.22em;
            text-transform: uppercase;
            color: rgba(var(--glow-purple), 0.95);
            margin-bottom: 24px;
            animation: mzRise 0.7s cubic-bezier(0.16, 1, 0.3, 1) both;
            animation-delay: 0.18s;
        }
        .pulse {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: var(--accent-soft);
            box-shadow: 0 0 0 0 rgba(var(--glow-purple), 0.6);
            animation: mzPulse 2.4s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
        h1.title {
            font-family: inherit;
            font-weight: 200;
            font-size: clamp(34px, 5.6vw, 60px);
            letter-spacing: -0.024em;
            line-height: 1.05;
            color: var(--fg-strong);
            margin: 0 0 22px 0;
            animation: mzRise 0.85s cubic-bezier(0.16, 1, 0.3, 1) both;
            animation-delay: 0.3s;
        }
        h1.title em {
            font-style: normal;
            background: linear-gradient(180deg, rgba(var(--glow-purple), 1) 0%, var(--accent) 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }
        .lede {
            font-size: clamp(16px, 1.8vw, 18px);
            line-height: 1.65;
            color: var(--fg-mid);
            max-width: 64ch;
            margin: 0 0 40px 0;
            animation: mzRise 0.85s cubic-bezier(0.16, 1, 0.3, 1) both;
            animation-delay: 0.42s;
        }
        .lede strong { color: var(--fg-strong); font-weight: 500; }
        .features {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: 14px;
            margin: 0 0 44px 0;
        }
        .feature {
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid rgba(255, 255, 255, 0.10);
            border-radius: 14px;
            backdrop-filter: blur(28px) saturate(165%);
            -webkit-backdrop-filter: blur(28px) saturate(165%);
            padding: 18px 18px 16px;
            transition: transform 0.22s ease, border-color 0.22s ease, background 0.22s ease;
            animation: mzRise 0.85s cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        .feature:nth-of-type(1)  { animation-delay: 0.55s; }
        .feature:nth-of-type(2)  { animation-delay: 0.62s; }
        .feature:nth-of-type(3)  { animation-delay: 0.69s; }
        .feature:nth-of-type(4)  { animation-delay: 0.76s; }
        .feature:nth-of-type(5)  { animation-delay: 0.83s; }
        .feature:nth-of-type(6)  { animation-delay: 0.90s; }
        .feature:nth-of-type(7)  { animation-delay: 0.97s; }
        .feature:nth-of-type(8)  { animation-delay: 1.04s; }
        .feature:nth-of-type(9)  { animation-delay: 1.11s; }
        .feature:nth-of-type(10) { animation-delay: 1.18s; }
        .feature:hover {
            transform: translateY(-2px);
            border-color: rgba(var(--glow-purple), 0.45);
            background: rgba(var(--glow-purple), 0.06);
        }
        .feature-label {
            font-size: 10.5px;
            font-weight: 700;
            letter-spacing: 0.18em;
            text-transform: uppercase;
            color: rgba(var(--glow-purple), 0.92);
            margin-bottom: 8px;
        }
        .feature-title {
            font-size: 15px;
            font-weight: 500;
            color: var(--fg-strong);
            margin: 0 0 6px 0;
        }
        .feature-body {
            font-size: 13.5px;
            line-height: 1.55;
            color: var(--fg-soft);
            margin: 0;
        }
        .note {
            font-size: 14px;
            line-height: 1.65;
            color: var(--fg-soft);
            border-left: 2px solid rgba(var(--glow-purple), 0.4);
            padding: 4px 0 4px 16px;
            margin: 0 0 32px 0;
            animation: mzRise 0.85s cubic-bezier(0.16, 1, 0.3, 1) both;
            animation-delay: 1.28s;
        }
        .footer-links {
            font-size: 13px;
            color: var(--fg-soft);
            animation: mzRise 0.85s cubic-bezier(0.16, 1, 0.3, 1) both;
            animation-delay: 1.36s;
        }
        .footer-links a { margin: 0 6px; }
        .signup-eyebrow {
            display: inline-flex;
            align-items: center;
            font-size: 10.5px;
            font-weight: 700;
            letter-spacing: 0.18em;
            text-transform: uppercase;
            color: rgba(var(--glow-purple), 0.92);
            margin: 0 0 14px 0;
            animation: mzRise 0.85s cubic-bezier(0.16, 1, 0.3, 1) both;
            animation-delay: 1.2s;
        }
        .signup-title {
            font-size: clamp(22px, 3.2vw, 30px);
            font-weight: 300;
            letter-spacing: -0.02em;
            color: var(--fg-strong);
            margin: 0 0 14px 0;
            animation: mzRise 0.85s cubic-bezier(0.16, 1, 0.3, 1) both;
            animation-delay: 1.26s;
        }
        .signup-lede {
            font-size: 14.5px;
            line-height: 1.6;
            color: var(--fg-mid);
            margin: 0 0 24px 0;
            animation: mzRise 0.85s cubic-bezier(0.16, 1, 0.3, 1) both;
            animation-delay: 1.32s;
        }

        

        .signup {
            max-width: 620px; margin: 0 auto 26px; text-align: left;
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid rgba(167, 139, 250, 0.34);
            border-radius: 16px; padding: 22px 22px 20px;
            backdrop-filter: blur(24px) saturate(170%);
            -webkit-backdrop-filter: blur(24px) saturate(170%);
        }
        .signup-row { display: grid; grid-template-columns: 2fr 1fr; gap: 12px; margin-bottom: 14px; }
        @media (max-width: 520px) { .signup-row { grid-template-columns: 1fr; } }
        .signup label {
            display: block; font-size: 10.5px; letter-spacing: 0.12em;
            text-transform: uppercase; color: #ffffff; opacity: 0.72; margin-bottom: 6px;
        }
        .signup input {
            width: 100%; padding: 11px 13px; font-size: 15px; font-family: inherit;
            color: #fff; background: rgba(255, 255, 255, 0.07);
            border: 1px solid rgba(255, 255, 255, 0.16); border-radius: 10px; min-height: 24px;
        }
        .signup input::placeholder { color: rgba(255, 255, 255, 0.42); }
        .signup-btn {
            background: linear-gradient(135deg, #8b5cf6, #7c3aed); color: #fff; border: none;
            border-radius: 10px; padding: 12px 26px; font: 600 15px inherit; cursor: pointer; min-height: 24px;
        }
        .signup-btn:disabled { opacity: 0.55; cursor: wait; }
        .signup-msg {
            display: none; margin-top: 14px; font-size: 14px; line-height: 1.6;
            padding: 11px 13px; border-radius: 10px; white-space: pre-line;
        }
        .signup-msg.ok { display: block; background: rgba(16, 185, 129, 0.14); color: #6ee7b7; }
        .signup-msg.err { display: block; background: rgba(167, 139, 250, 0.14); color: #ddd0ff; }
        .signup-fine { font-size: 12.5px; color: #ffffff; opacity: 0.6; margin: 14px 0 0; line-height: 1.55; }
        .signup select {
            width: 100%; padding: 11px 13px; font-size: 15px; font-family: inherit;
            color: #fff; background: rgba(255, 255, 255, 0.07);
            border: 1px solid rgba(255, 255, 255, 0.16); border-radius: 10px; min-height: 24px;
        }
        .signup select option { background: #1d1830; color: #fff; }
        .tier-strip {
            display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
            gap: 14px; max-width: 900px; margin: 0 auto 26px; text-align: left;
        }
        .tier-card {
            background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 14px; padding: 18px 18px 16px;
            backdrop-filter: blur(20px) saturate(160%); -webkit-backdrop-filter: blur(20px) saturate(160%);
        }
        .tier-card.lead { border-color: rgba(167, 139, 250, 0.5); background: rgba(167, 139, 250, 0.09); }
        .tier-card h3 { margin: 0 0 3px; font-size: 17px; font-weight: 600; color: #fff; }
        .tier-card .tt { font-size: 12.5px; color: #fff; opacity: 0.66; margin: 0 0 12px; line-height: 1.45; }
        .tier-card .tp { font-size: 26px; font-weight: 600; color: #fff; margin-bottom: 2px; }
        .tier-card .tp small { font-size: 12.5px; opacity: 0.6; font-weight: 400; }
        .tier-card .ty { font-size: 12px; color: #fff; opacity: 0.55; margin-bottom: 12px; min-height: 16px; }
        .tier-card ul { list-style: none; padding: 0; margin: 0; }
        .tier-card li {
            font-size: 12.8px; line-height: 1.5; color: #fff; opacity: 0.82;
            padding: 0 0 7px 15px; position: relative;
        }
        .tier-card li::before {
            content: ""; position: absolute; left: 0; top: 7px; width: 5px; height: 5px;
            border-radius: 50%; background: #a78bfa;
        }
        .tier-card .tw { font-size: 12px; color: #6ee7b7; margin-top: 10px; }
        .mz-sec { max-width: 900px; margin: 0 auto 34px; text-align: left; }
        .mz-sec > h3 {
            font-size: 11px; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase;
            color: #c4b5fd; margin: 0 0 6px;
        }
        .mz-sec > .mz-sub {
            font-size: 19px; font-weight: 600; color: #fff; margin: 0 0 18px; line-height: 1.3;
        }
        .mz-cmp { width: 100%; border-collapse: collapse; font-size: 13.5px; }
        .mz-cmp th {
            text-align: left; font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase;
            color: #fff; opacity: 0.6; padding: 10px 14px 10px 0; font-weight: 700;
            border-bottom: 1px solid rgba(255, 255, 255, 0.12);
        }
        .mz-cmp td {
            padding: 12px 14px 12px 0; color: #fff; opacity: 0.86; vertical-align: top; line-height: 1.55;
            border-bottom: 1px solid rgba(255, 255, 255, 0.07);
        }
        .mz-cmp td.d { font-weight: 600; opacity: 1; width: 21%; }
        .mz-cmp td.t { opacity: 0.62; width: 39%; }
        .mz-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
        .mz-ev {
            background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.1);
            border-left: 2px solid #a78bfa; border-radius: 12px; padding: 16px 18px; margin-bottom: 12px;
        }
        .mz-ev .c { font-size: 15px; font-weight: 600; color: #fff; margin: 0 0 6px; line-height: 1.45; }
        .mz-ev .dd { font-size: 13px; color: #fff; opacity: 0.72; margin: 0 0 9px; line-height: 1.6; }
        .mz-ev .ss { font-size: 12px; color: #fff; opacity: 0.55; }
        .mz-ev .ss a { color: #c4b5fd; }
        .mz-ev .cv { font-size: 12px; color: #fff; opacity: 0.5; font-style: italic; margin-top: 7px; }
        .mz-prep { display: grid; grid-template-columns: repeat(auto-fit, minmax(215px, 1fr)); gap: 13px; }
        .mz-prep .pp {
            background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 12px; padding: 16px 17px;
        }
        .mz-prep .pp h4 { margin: 0 0 5px; font-size: 14.5px; font-weight: 600; color: #fff; }
        .mz-prep .pp .w { font-size: 12.8px; color: #fff; opacity: 0.72; line-height: 1.55; margin: 0 0 8px; }
        .mz-prep .pp .y { font-size: 12.5px; color: #c4b5fd; line-height: 1.5; margin: 0; }
        .mz-disc {
            background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 12px; padding: 18px 20px;
        }
        .mz-disc ul { margin: 0; padding-left: 19px; }
        .mz-disc li { font-size: 13.5px; color: #fff; opacity: 0.78; line-height: 1.6; margin-bottom: 8px; }
        .mz-note-box {
            background: rgba(167, 139, 250, 0.1); border: 1px solid rgba(167, 139, 250, 0.28);
            border-radius: 12px; padding: 14px 17px; font-size: 13px; color: #fff; opacity: 0.9;
            line-height: 1.6; margin-top: 16px;
        }
        @keyframes mzRise {
            from { opacity: 0; transform: translateY(8px); }
            to   { opacity: 1; transform: none; }
        }
        @keyframes mzPulse {
            0%, 100% { box-shadow: 0 0 0 0 rgba(var(--glow-purple), 0.55); }
            50%      { box-shadow: 0 0 0 8px rgba(var(--glow-purple), 0); }
        }
        @media (prefers-reduced-motion: reduce) {
            * { animation: none !important; transition: none !important; }
            .nav-back, .eyebrow, h1.title, .lede, .feature, .note, .footer-links {
                opacity: 1 !important; transform: none !important;
            }
        }
    </style>
</head>
<body>
    <main class="wrap">
        <a class="nav-back" href="/">Back to mountzara.com</a>
        <span class="eyebrow"><span class="pulse" aria-hidden="true"></span>Member Portal &middot; In Active Design</span>
        <h1 class="title">Building <em>a place to take care</em> of you, between visits and beyond.</h1>
        <p class="lede">A complete member portal is in active design. <strong>Intake forms, scheduling, telehealth, secure messaging, document handling, a symptom tracker &amp; diary, women&rsquo;s-health tooling, education materials, and AI-summarized recaps of your prior visits</strong> &mdash; plus a feed of the newest evidence-based literature and content from Dr. Mabini directly. When it&rsquo;s ready, you&rsquo;ll see it here.</p>

        <section class="features" aria-label="What the portal will offer">
            <article class="feature">
                <div class="feature-label">Intake</div>
                <h2 class="feature-title">A 19-section comprehensive intake</h2>
                <p class="feature-body">Tailored to MIGS gynecology &mdash; bleeding history, pelvic pain mapping, perioperative risk factors (including GLP-1 use and herbs that affect bleeding), and treatment goals. Autosaves as you go.</p>
            </article>
            <article class="feature">
                <div class="feature-label">Symptom Tracker &amp; Diary</div>
                <h2 class="feature-title">Track what you&rsquo;re actually feeling</h2>
                <p class="feature-body">A daily diary for pelvic pain (location, intensity, triggers), bleeding patterns, cycle, sleep, mood, sexual function, bowel and bladder symptoms. Charts trends over time so visits start with data, not memory.</p>
            </article>
            <article class="feature">
                <div class="feature-label">Women&rsquo;s Health</div>
                <h2 class="feature-title">Tools built around women&rsquo;s needs</h2>
                <p class="feature-body">Cycle and ovulation tracking, perimenopause and menopause symptom flagging, pregnancy-loss support resources, postpartum follow-through, and contraception decision aids &mdash; built around what a MIGS gynecology practice actually sees.</p>
            </article>
            <article class="feature">
                <div class="feature-label">AI Visit Summaries</div>
                <h2 class="feature-title">A clear recap of every visit</h2>
                <p class="feature-body">After each appointment, an AI-generated summary of what was discussed, the plan, the medications, and the next steps &mdash; reviewed and signed off by Dr. Mabini, then easy to revisit when you need it.</p>
            </article>
            <article class="feature">
                <div class="feature-label">Telehealth</div>
                <h2 class="feature-title">Doxy.me video, when you need it</h2>
                <p class="feature-body">Visit details and a one-tap join button when your appointment opens. No app to install. Audio + video stay on the Doxy.me HIPAA boundary.</p>
            </article>
            <article class="feature">
                <div class="feature-label">Scheduling</div>
                <h2 class="feature-title">Slots that fit your visit</h2>
                <p class="feature-body">Complex pelvic pain consults get the time they need. Quick follow-ups don&rsquo;t. The system reads your intake and offers only slots that fit your visit type.</p>
            </article>
            <article class="feature">
                <div class="feature-label">Latest Literature</div>
                <h2 class="feature-title">The newest evidence, made readable</h2>
                <p class="feature-body">Each week&rsquo;s peer-reviewed updates relevant to MIGS, endometriosis, fibroids, hormones, menopause, and adjacent topics &mdash; pulled into your portal in plain language, anchored to PubMed, with the bottom line up top.</p>
            </article>
            <article class="feature">
                <div class="feature-label">Dr. Mabini&rsquo;s Content</div>
                <h2 class="feature-title">Stay informed, on your own terms</h2>
                <p class="feature-body">Integrated with the Trending and Evidence sections of mountzara.com so you see Dr. Mabini&rsquo;s commentary on social-media health trends and his MIGS Monday Morning research digests as they go live.</p>
            </article>
            <article class="feature">
                <div class="feature-label">Education Materials</div>
                <h2 class="feature-title">Things to read before and after visits</h2>
                <p class="feature-body">Patient-facing primers Dr. Mabini has authored on endometriosis, adenomyosis, dysmenorrhea, fibroids, OMT, perioperative preparation, and surgical recovery &mdash; sent to you when they&rsquo;re relevant to your care plan.</p>
            </article>
            <article class="feature">
                <div class="feature-label">Messaging &amp; Documents</div>
                <h2 class="feature-title">Secure, on the record</h2>
                <p class="feature-body">A thread with the practice for questions between visits. Upload imaging, records, and pre-op forms. Encrypted at rest with per-record envelope keys.</p>
            </article>
            <article class="feature">
                <div class="feature-label">And more</div>
                <h2 class="feature-title">Built around your care, not around the chart</h2>
                <p class="feature-body">Pre-operative checklists, post-operative recovery trackers, family-history mapping for hereditary risk, billing transparency, and care-plan summaries you can take to other clinicians &mdash; layered in as the portal grows.</p>
            </article>
        </section>

        <!-- 2026-08-13 — the visit-modality matrix was removed at the
             owner's instruction. It described how appointments will work
             for people who cannot yet make one, which is detail without a
             decision attached. What a visitor to a pre-launch portal can
             actually DO is tell us they want it, so that is what this
             section is now. The same waitlist as /membership/, same
             endpoint, same non-clinical guardrails. -->
        <div class="signup-eyebrow">Be first in</div>
        <h2 class="signup-title">Tell me when the portal opens.</h2>
        <p class="signup-lede">One email when it does, and nothing else. No card, no commitment. If you tell us which state you are in, it also tells us where to open first &mdash; Dr.&nbsp;Mabini is licensed in Illinois and California today.</p>

        <!-- Tiers are fetched from /api/v1/membership rather than written
             here, so a price change lands in one place and this page can
             never quietly disagree with /membership/. -->
        <div class="tier-strip" id="tier-strip" aria-label="Membership tiers"></div>

        <div class="signup" id="signup">
            <div class="signup-row">
                <div style="grid-column:1/-1;">
                    <label for="su-tier">Which would you want?</label>
                    <select id="su-tier"><option value="any">Not sure yet &mdash; tell me more</option></select>
                </div>
            </div>
            <div class="signup-row">
                <div>
                    <label for="su-email">Email</label>
                    <input id="su-email" type="email" autocomplete="email" placeholder="you@example.com">
                </div>
                <div>
                    <label for="su-state">State</label>
                    <input id="su-state" type="text" maxlength="2" placeholder="IL" autocomplete="address-level1" style="text-transform:uppercase">
                </div>
            </div>
            <button type="button" class="signup-btn" id="su-go">Join the list</button>
            <div class="signup-msg" id="su-msg" role="status" aria-live="polite"></div>
            <p class="signup-fine">Please don&rsquo;t include symptoms or medical history here &mdash; this is a mailing list, not a medical record, and it isn&rsquo;t encrypted for that. There will be a secure place for it when the portal opens.</p>
        </div>

        <div id="mz-detail"></div>

        <p class="note">If you&rsquo;re an existing patient and need to reach the office in the meantime, please call the practice directly or email <a href="mailto:info@mountzara.com">info@mountzara.com</a>.</p>

        <p class="footer-links">
            <a href="/">Home</a>
            <span aria-hidden="true">&middot;</span>
            <a href="/about/">About Dr. Mabini</a>
            <span aria-hidden="true">&middot;</span>
            <a href="/evidence/">Evidence</a>
            <span aria-hidden="true">&middot;</span>
            <a href="/trending/">Trending</a>
        </p>
    </main>
<script>
// Waitlist. Same endpoint and the same non-clinical guardrails as
// /membership/ — one list, so a person who signs up in either place is
// counted once and hears from us once.
(function () {
    "use strict";
    var go = document.getElementById("su-go");
    var msg = document.getElementById("su-msg");
    if (!go || !msg) return;

    function esc(v) {
        return String(v == null ? "" : v)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    // Show what they would be signing up for. Someone cannot tell you
    // which tier they want if the page never says what the tiers are.
    fetch("/api/v1/membership", { headers: { Accept: "application/json" } })
        .then(function (r) { return r.json(); })
        .then(function (d) {
            if (!d || !d.ok || !d.tiers) return;
            var strip = document.getElementById("tier-strip");
            var sel = document.getElementById("su-tier");
            var h = "";
            d.tiers.forEach(function (t) {
                h += '<div class="tier-card' + (t.key === "navigator" ? " lead" : "") + '">';
                h += "<h3>" + esc(t.name) + "</h3>";
                h += '<p class="tt">' + esc(t.tagline) + "</p>";
                h += '<div class="tp">$' + t.price_month + (t.price_month ? "<small>/mo</small>" : "") + "</div>";
                h += '<div class="ty">' + (t.price_year ? "or $" + t.price_year + "/yr" : "Free, always") + "</div>";
                h += "<ul>" + t.benefits.slice(0, 4).map(function (b) { return "<li>" + esc(b) + "</li>"; }).join("") + "</ul>";
                if (t.value && t.value.headline) h += '<div class="tw">' + esc(t.value.headline) + "</div>";
                h += "</div>";
                if (sel && t.price_month > 0) {
                    var o = document.createElement("option");
                    o.value = t.key;
                    o.textContent = t.name + " — $" + t.price_month + "/mo";
                    sel.appendChild(o);
                }
            });
            if (strip) strip.innerHTML = h;

            // The rest of what /membership/ used to say, in this page's
            // theme. One page, one source of truth, no second URL to keep
            // in sync.
            var det = document.getElementById("mz-detail");
            if (!det) return;
            var m = "";

            if (d.comparison && d.comparison.length) {
                m += '<div class="mz-sec"><h3>The difference</h3><div class="mz-sub">What the ordinary path costs you, and what changes.</div>';
                m += '<div class="mz-scroll"><table class="mz-cmp"><thead><tr><th></th><th>Usually</th><th>Here</th></tr></thead><tbody>';
                d.comparison.forEach(function (c) {
                    m += '<tr><td class="d">' + esc(c.dimension) + '</td><td class="t">' + esc(c.traditional) + "</td><td>" + esc(c.here) + "</td></tr>";
                });
                m += "</tbody></table></div></div>";
            }

            if (d.visit_prep && d.visit_prep.deliverables) {
                m += '<div class="mz-sec"><h3>Preparation</h3><div class="mz-sub">What arrives before your next appointment &mdash; with any clinician.</div>';
                m += '<div class="mz-prep">';
                d.visit_prep.deliverables.forEach(function (p) {
                    m += '<div class="pp"><h4>' + esc(p.name) + '</h4><p class="w">' + esc(p.what) + '</p><p class="y">' + esc(p.why) + "</p></div>";
                });
                m += "</div>";
                m += '<div class="mz-note-box">' + esc(d.visit_prep.disclaimer) + "</div></div>";
            }

            if (d.evidence && d.evidence.length) {
                m += '<div class="mz-sec"><h3>Why</h3><div class="mz-sub">The problem this is built against, with the sources.</div>';
                d.evidence.forEach(function (e) {
                    m += '<div class="mz-ev"><p class="c">' + esc(e.claim) + "</p>";
                    if (e.detail) m += '<p class="dd">' + esc(e.detail) + "</p>";
                    m += '<p class="ss">' + esc(e.source) + (e.year ? " (" + e.year + ")" : "");
                    if (e.url) m += ' &middot; <a href="' + esc(e.url) + '" target="_blank" rel="noopener">read it</a>';
                    m += "</p>";
                    if (e.caveat) m += '<p class="cv">' + esc(e.caveat) + "</p>";
                    m += "</div>";
                });
                m += "</div>";
            }

            m += '<div class="mz-sec"><h3>Plainly</h3><div class="mz-sub">What membership is, and what it is not.</div><div class="mz-disc"><ul>';
            (d.disclosures || []).forEach(function (x) { m += "<li>" + esc(x) + "</li>"; });
            if (d.consultation_states && d.consultation_states.length) {
                m += "<li>Dr. Mabini is licensed in " + esc(d.consultation_states.join(" and "))
                   + ". Preparation tools are available wherever you live; a clinical consultation is only possible in those states.</li>";
            }
            m += "</ul></div></div>";

            det.innerHTML = m;
        })
        .catch(function () { /* the signup still works without the cards */ });

    function show(text, ok) {
        msg.className = "signup-msg " + (ok ? "ok" : "err");
        msg.textContent = text;
    }

    go.addEventListener("click", function () {
        var email = (document.getElementById("su-email").value || "").trim();
        if (!email) { show("Please add your email address.", false); return; }
        go.disabled = true; go.textContent = "Adding you\u2026";
        fetch("/api/v1/membership/interest", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                email: email,
                tier: (document.getElementById("su-tier") || {}).value || "any",
                state: (document.getElementById("su-state").value || "").trim().toUpperCase(),
                source: "portal_coming_soon"
            })
        }).then(function (r) { return r.json(); }).then(function (j) {
            go.disabled = false; go.textContent = "Join the list";
            if (!j.ok) { show(j.error || "Could not add you just now.", false); return; }
            show(j.message + (j.note ? "\n\n" + j.note : ""), true);
            document.getElementById("su-email").value = "";
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
