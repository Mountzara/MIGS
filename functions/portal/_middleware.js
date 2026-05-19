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
            --bg-base: #07070a;
            --bg-soft: #0e0e13;
            --fg-strong: #ffffff;
            --fg-mid: rgba(245, 245, 247, 0.84);
            --fg-soft: rgba(245, 245, 247, 0.62);
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
</body>
</html>
`;
