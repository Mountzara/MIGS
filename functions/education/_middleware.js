// =====================================================================
// functions/education/_middleware.js — admin preview gate for /education/*
// =====================================================================
// Per user directive 2026-05-17: the public /education/<slug>/ patient
// education pages are clinical content (§9.2 — draft-and-queue policy)
// and must be reviewed and approved before going public. Until each
// topic is approved, this middleware serves a Coming Soon page to public
// visitors and lets admin Basic Auth through to the live pages so Dr.
// Mabini can read each one at his own pace.
//
//   * env.EDUCATION_PUBLIC_LAUNCH = "true" → gate opens to public
//   * Otherwise: admin Basic Auth required (same path as /admin/*)
//
// To flip a single topic from gated → public (without flipping every
// topic at once), set env.EDUCATION_PUBLIC_LAUNCH = "true" once Dr.
// Mabini has approved all 12. For per-topic approval, see the
// per-slug allow-list below.
// =====================================================================

import { previewAccess } from "../_lib/preview_gate.js";

// Per-slug allow-list. When you want to release a specific topic to
// public without flipping the full launch flag, add its slug here.
// Slugs are matched against the first path segment after /education/.
const PUBLICLY_APPROVED_SLUGS = new Set([
    // Add slugs here as Dr. Mabini approves them. Example:
    // "endometriosis",
    // "chronic-pelvic-pain",
]);

export async function onRequest(ctx) {
    const { request, env, next } = ctx;

    // If a specific topic is on the public allow-list, let it through
    // for everyone (no auth needed).
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean); // ["education", "<slug>", ...]
    const slug = parts[1] || "";
    if (slug && PUBLICLY_APPROVED_SLUGS.has(slug)) {
        return next();
    }

    // Otherwise: same gate as /portal/*. Launched OR admin-authed → through.
    const { allow } = await previewAccess(request, env);
    if (allow) {
        return next();
    }

    // Public, pre-launch — serve the Coming Soon HTML.
    return new Response(COMING_SOON_HTML, {
        status: 200,
        headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "public, max-age=60, s-maxage=60",
            "x-content-type-options": "nosniff",
            "referrer-policy": "strict-origin-when-cross-origin",
        },
    });
}

// ---------------------------------------------------------------------
// Coming Soon HTML for /education/* — same visual grammar as the portal
// Coming Soon page (purple Apple-glass, mzRise cascade, Nunito Sans).
// ---------------------------------------------------------------------
const COMING_SOON_HTML = `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>Patient Education — Coming Soon · Mount Zara</title>
    <meta name="description" content="Mount Zara's patient education library is in active design and clinician review. Comprehensive, peer-reviewed guides on every topic Dr. Mabini cares about launch soon.">
    <meta name="robots" content="noindex, nofollow">
    <link rel="icon" type="image/png" href="/favicon.png">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@200;300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-base: #120b22;
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
        }
        a { color: var(--accent-soft); text-decoration: none; transition: color 0.2s ease; }
        a:hover { color: var(--fg-strong); }
        .wrap {
            max-width: 760px;
            margin: 0 auto;
            padding: clamp(48px, 8vw, 96px) clamp(20px, 5vw, 40px);
            min-height: 100vh;
            display: flex; flex-direction: column; justify-content: center;
        }
        .nav-back {
            display: inline-flex; align-items: center; gap: 8px;
            font-size: 13px; color: var(--fg-soft);
            margin-bottom: 36px;
            animation: mzRise 0.7s cubic-bezier(0.16, 1, 0.3, 1) both;
            animation-delay: 0.05s;
        }
        .nav-back::before { content: "\\2190"; font-size: 14px; margin-right: 2px; }
        .eyebrow {
            display: inline-flex; align-items: center; gap: 10px;
            font-size: 11px; font-weight: 700; letter-spacing: 0.22em;
            text-transform: uppercase;
            color: rgba(var(--glow-purple), 0.95);
            margin-bottom: 24px;
            animation: mzRise 0.7s cubic-bezier(0.16, 1, 0.3, 1) both;
            animation-delay: 0.18s;
        }
        .pulse {
            width: 8px; height: 8px; border-radius: 50%;
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
        .topics {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: 14px;
            margin: 0 0 44px 0;
        }
        .topic {
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid rgba(255, 255, 255, 0.10);
            border-radius: 14px;
            backdrop-filter: blur(28px) saturate(165%);
            -webkit-backdrop-filter: blur(28px) saturate(165%);
            padding: 14px 16px;
            font-size: 13.5px;
            line-height: 1.5;
            color: var(--fg-mid);
            animation: mzRise 0.85s cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        .topic:nth-of-type(1)  { animation-delay: 0.50s; }
        .topic:nth-of-type(2)  { animation-delay: 0.56s; }
        .topic:nth-of-type(3)  { animation-delay: 0.62s; }
        .topic:nth-of-type(4)  { animation-delay: 0.68s; }
        .topic:nth-of-type(5)  { animation-delay: 0.74s; }
        .topic:nth-of-type(6)  { animation-delay: 0.80s; }
        .topic:nth-of-type(7)  { animation-delay: 0.86s; }
        .topic:nth-of-type(8)  { animation-delay: 0.92s; }
        .topic:nth-of-type(9)  { animation-delay: 0.98s; }
        .topic:nth-of-type(10) { animation-delay: 1.04s; }
        .topic:nth-of-type(11) { animation-delay: 1.10s; }
        .topic:nth-of-type(12) { animation-delay: 1.16s; }
        .topic strong {
            color: var(--fg-strong);
            font-weight: 500;
            font-size: 14.5px;
            display: block;
            margin-bottom: 4px;
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
            .nav-back, .eyebrow, h1.title, .lede, .topic, .note, .footer-links {
                opacity: 1 !important; transform: none !important;
            }
        }
    </style>
</head>
<body>
    <main class="wrap">
        <a class="nav-back" href="/">Back to mountzara.com</a>
        <span class="eyebrow"><span class="pulse" aria-hidden="true"></span>Patient Education &middot; Coming Soon</span>
        <h1 class="title">A comprehensive library, <em>built for you</em>, anchored to the evidence.</h1>
        <p class="lede">
            Dr.&nbsp;Mabini is finalizing a library of in-depth patient education guides &mdash;
            <strong>every clinical claim cited inline, every PubMed abstract included verbatim,
            every page anchored to ACOG and peer-reviewed sources</strong>. Each guide is
            built around the way you actually live with a condition: what it is, how it&rsquo;s
            worked up, the full treatment menu, and the questions Dr.&nbsp;Mabini gets asked
            most often. Topics in active review:
        </p>
        <section class="topics" aria-label="Topics in review">
            <article class="topic"><strong>Endometriosis</strong>Full guide from NSAIDs to laparoscopic excision, with OMT and pelvic-floor PT integration.</article>
            <article class="topic"><strong>Chronic Pelvic Pain</strong>The four overlapping layers and the multi-modal treatment ladder.</article>
            <article class="topic"><strong>Abnormal Uterine Bleeding</strong>PALM&ndash;COEIN framework, layered workup, full medical and procedural menu.</article>
            <article class="topic"><strong>Menopause</strong>Vasomotor symptoms, GSM, modern hormone therapy, bone health, cardiovascular risk.</article>
            <article class="topic"><strong>Uterine Fibroids</strong>FIGO Types 0&ndash;8, medical, hysteroscopic, laparoscopic, UAE, fertility considerations.</article>
            <article class="topic"><strong>Dysmenorrhea</strong>Primary vs secondary, the full ladder, when to suspect endometriosis.</article>
            <article class="topic"><strong>Adenomyosis</strong>Diffuse vs focal, imaging diagnosis, medical and surgical management.</article>
            <article class="topic"><strong>PCOS</strong>Rotterdam criteria, phenotypes, lifestyle, metformin, GLP-1s, letrozole.</article>
            <article class="topic"><strong>Ovarian Cysts &amp; Adnexal Masses</strong>The modern workup, watch vs operate, hereditary risk and BRCA.</article>
            <article class="topic"><strong>Postoperative Recovery</strong>ERAS protocols, opioid-sparing pain control, medication holds, red flags.</article>
            <article class="topic"><strong>Contraception</strong>The full effectiveness tier hierarchy, US MEC 2024, life-stage considerations.</article>
            <article class="topic"><strong>Pregnancy Loss</strong>Trauma-informed walkthrough of diagnosis, management options, recurrent loss workup.</article>
        </section>
        <p class="note">If you&rsquo;re an existing patient and have a question that can&rsquo;t wait, please call the practice directly or email <a href="mailto:info@mountzara.com">info@mountzara.com</a>.</p>
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
</html>`;
