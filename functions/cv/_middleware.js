// =====================================================================
// functions/cv/_middleware.js — the CV / operative outcomes gate
// =====================================================================
// Owner directive (2026-08-23): the page carrying the raw operative log
// — 444 cases, 1,511 procedures, per-category counts, ClassIntra /
// Clavien–Dindo rates — should be PRIVATE and available BY REQUEST only.
// A surgeon's personal case tally is a credentialing document, not shop
// -window content; a referring physician or a credentialing body can ask
// for it, but it does not belong open to anonymous traffic and scrapers.
//
// WHY NOT previewAccess(): that gate opens for EVERYONE the moment
// PORTAL_PUBLIC_LAUNCH flips (isPortalLaunched short-circuits it). The CV
// must stay by-request AFTER the portal is public, so this gate is
// deliberately narrower — it grants only:
//   1. the admin (signed admin session, or the Basic path), and
//   2. a holder of a valid preview-access cookie, which is minted when
//      someone follows a grant link Dr. Mabini has issued
//      (/cv/grant?t=…), exactly the mechanism the portal preview uses.
// It does NOT consult PORTAL_PUBLIC_LAUNCH at all.
//
// Everyone else is served a professional "available on request" page
// (200, not 404 — the CV's existence is not a secret, only its contents)
// with a request form that posts to /api/v1/cv-access-request and
// notifies the practice through the live mail pipeline.
//
// The hardening headers are applied here for the same reason as
// /education and /portal: Cloudflare does not apply _headers to a
// Function-constructed response, so the gate must set them itself.
// =====================================================================

import { isAdminAuthed } from "../_lib/preview_gate.js";
import {
    verifyAccessCookie, readAccessCookieValue,
    verifyGrantToken, mintAccessCookie, buildAccessCookieHeader,
} from "../_lib/preview_invite.js";

const PUBLIC_CSP = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' https://*.mountzara.com https://mountzara.com data:",
    "connect-src 'self' https://*.mountzara.com https://mountzara.com https://cloudflareinsights.com",
    "frame-ancestors 'none'",
    "base-uri 'self'", "form-action 'self'", "object-src 'none'",
    "upgrade-insecure-requests",
].join("; ");

function harden(resp) {
    const out = new Response(resp.body, resp);
    out.headers.set("Content-Security-Policy", PUBLIC_CSP);
    out.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
    out.headers.set("X-Frame-Options", "DENY");
    out.headers.set("X-Content-Type-Options", "nosniff");
    out.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    out.headers.set("Cross-Origin-Opener-Policy", "same-origin");
    out.headers.set("Permissions-Policy",
        "camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()");
    // A private CV must never be indexed, and is not training material.
    out.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive, noai, noimageai");
    out.headers.set("X-AI-Training", "noai, noimageai");
    return out;
}

// A grant link Dr. Mabini shares: /cv/grant?t=<token>. Validating the
// token mints the same preview-access cookie the portal uses and 302s to
// the CV, so the recipient reads it without a login.
async function handleGrant(url, env) {
    const token = url.searchParams.get("t") || "";
    const grant = token ? await verifyGrantToken(env, token) : null;
    if (!grant) {
        return harden(new Response(requestPage("That access link is invalid or has expired."), {
            status: 403,
            headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        }));
    }
    // mintAccessCookie owns the expiry (from ttl_ms) and returns {value, exp_ms};
    // buildAccessCookieHeader is then handed that exact exp_ms.
    const minted = await mintAccessCookie(env, {
        label: grant.label || "cv-reviewer",
        ttl_ms: 30 * 24 * 60 * 60 * 1000, // a granted reviewer keeps access 30 days
    });
    const resp = new Response(null, { status: 302, headers: { Location: "/cv/" } });
    resp.headers.append("Set-Cookie", buildAccessCookieHeader(minted.value, minted.exp_ms));
    return harden(resp);
}

export async function onRequest(ctx) {
    const { request, env, next } = ctx;
    const url = new URL(request.url);

    if (url.pathname.replace(/\/+$/, "") === "/cv/grant") {
        return handleGrant(url, env);
    }

    // Admin (session or Basic) always sees the full CV.
    if (await isAdminAuthed(request, env)) {
        return harden(await next());
    }

    // A valid preview-access cookie (from a grant link) sees it too.
    const raw = readAccessCookieValue(request);
    if (raw && await verifyAccessCookie(env, raw)) {
        return harden(await next());
    }

    // Everyone else: the professional request page.
    return harden(new Response(requestPage(), {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    }));
}

// ---------------------------------------------------------------------
// The "available on request" page. Same visual grammar as the rest of
// the site (purple Apple-glass on deep plum, Nunito Sans). No PHI, no
// operative figures — it only explains how to ask.
// ---------------------------------------------------------------------
function requestPage(notice = "") {
    const noticeHtml = notice
        ? `<p class="cv-notice" role="alert">${notice}</p>`
        : "";
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>Curriculum vitae &amp; operative outcomes · Mount Zara</title>
<link rel="icon" type="image/png" href="/favicon.png">
<style>
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;min-height:100vh;
    background:radial-gradient(ellipse 80% 60% at 50% -10%,rgba(167,139,250,.10),transparent 60%),#FBFAF8;
    color:#1A1726;font-family:'Avenir Next','Avenir','Nunito Sans',-apple-system,BlinkMacSystemFont,system-ui,sans-serif;
    display:flex;align-items:center;justify-content:center;line-height:1.55}
  .card{width:min(92%,560px);margin:48px auto;padding:clamp(28px,5vw,48px);
    background:rgba(255,255,255,0.72);border:1px solid #E9E5EE;border-radius:24px;
    backdrop-filter:saturate(180%) blur(20px);-webkit-backdrop-filter:saturate(180%) blur(20px);
    box-shadow:0 40px 120px rgba(26,23,38,0.12),inset 0 1px 0 rgba(255,255,255,0.7)}
  .eyebrow{font-size:12px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#6d28d9;margin:0 0 14px}
  h1{font-size:clamp(24px,4vw,32px);font-weight:600;line-height:1.15;letter-spacing:-.02em;margin:0 0 16px}
  p{font-size:16px;color:#4A4658;margin:0 0 16px}
  .cv-notice{background:rgba(239,68,68,.14);border:1px solid rgba(239,68,68,.4);border-radius:10px;padding:10px 14px;font-size:14px}
  label{display:block;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#6E6A7C;margin:14px 0 6px}
  input,textarea{width:100%;padding:12px 14px;font:inherit;font-size:15px;color:#1A1726;
    background:rgba(255,255,255,0.72);border:1px solid #E9E5EE;border-radius:10px}
  textarea{min-height:84px;resize:vertical}
  button{margin-top:20px;width:100%;padding:13px;font:inherit;font-size:15px;font-weight:600;color:#1A1726;cursor:pointer;
    background:linear-gradient(135deg,#8b5cf6,#6d28d9);border:none;border-radius:999px;transition:transform .15s,box-shadow .15s}
  button:hover{transform:translateY(-1px);box-shadow:0 10px 30px -8px rgba(109,40,217,.6)}
  button:disabled{opacity:.6;cursor:default;transform:none}
  .ok{color:#6d28d9;font-weight:600}
  a{color:#6d28d9}
  button,button:hover,.btn,.btn:hover{color:#fff}
</style>
</head>
<body>
  <main class="card">
    ${noticeHtml}
    <p class="eyebrow">By request</p>
    <h1>Curriculum vitae &amp; operative outcomes</h1>
    <p>Dr.&nbsp;Mabini's full curriculum vitae and detailed operative outcomes are shared with
       referring physicians, hospitals and credentialing bodies on request rather than published
       openly. Leave your details and the reason, and the office will follow up.</p>
    <form id="req" autocomplete="on">
      <label for="name">Your name</label>
      <input id="name" name="name" required autocomplete="name">
      <label for="email">Email</label>
      <input id="email" name="email" type="email" required autocomplete="email">
      <label for="reason">Who you are / why you're requesting it</label>
      <textarea id="reason" name="reason" placeholder="e.g. referring physician, hospital credentialing, colleague"></textarea>
      <button type="submit" id="go">Request access</button>
    </form>
    <p id="done" hidden class="ok">Thank you — your request has been sent. The office will be in touch.</p>
  </main>
<script>
  var f=document.getElementById('req'),b=document.getElementById('go');
  f.addEventListener('submit',function(e){
    e.preventDefault();b.disabled=true;b.textContent='Sending…';
    fetch('/api/v1/cv-access-request',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({name:f.name.value,email:f.email.value,reason:f.reason.value})})
    .then(function(r){return r.ok?r.json():Promise.reject()})
    .then(function(){f.hidden=true;document.getElementById('done').hidden=false;})
    .catch(function(){b.disabled=false;b.textContent='Try again';});
  });
</script>
</body>
</html>`;
}
