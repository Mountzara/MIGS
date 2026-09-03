// =====================================================================
// /admin/_login — the branded admin sign-in
// =====================================================================
// WHY THIS EXISTS. The backend used to greet the operator with the
// browser's native Basic-auth dialog: an unstyled grey box that cannot
// carry the practice's name, cannot show an error, cannot be recovered
// from without closing the tab, and (on iOS) autocapitalises the first
// letter of what it thinks is an email. It was then followed by a SECOND,
// prettier prompt that asked for different credentials — see
// _lib/admin_session.js for that story.
//
// This page is the single sign-in. It verifies the password against the
// same PBKDF2 hash the middleware uses, applies the same lockout, and
// mints the same signed session cookie. Nothing about the security model
// changed; only the door the operator walks through.
//
// GET  → render the form (never behind auth, or it could not be reached)
// POST → verify, mint the session, 303 back to `next`
// =====================================================================

import { verifyPbkdf2 } from "./_middleware.js";
import { buildAdminSessionCookie } from "../_lib/admin_session.js";
import { logAudit } from "../_lib/audit.js";

const RL_THRESHOLD = 10;
const RL_WINDOW_SECONDS = 900;

// Only ever redirect somewhere inside this site. An open redirect on a
// login page is how a convincing phishing link gets built.
function safeNext(raw) {
    const v = String(raw || "/admin/");
    if (!v.startsWith("/") || v.startsWith("//")) return "/admin/";
    if (v.startsWith("/admin/_login") || v.startsWith("/admin/_signout")) return "/admin/";
    return v;
}

function page({ next = "/admin/", error = "" } = {}) {
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Sign in · Mount Zara Admin</title>
<meta name="robots" content="noindex, nofollow">
<link rel="icon" type="image/png" href="/favicon.png">
<style>
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;min-height:100vh;
    background:radial-gradient(ellipse 80% 60% at 50% -10%,rgba(167,139,250,.10),transparent 60%),#FBFAF8;
    color:#1A1726;font-family:'Avenir Next','Avenir',-apple-system,BlinkMacSystemFont,system-ui,sans-serif;
    display:flex;align-items:center;justify-content:center;-webkit-font-smoothing:antialiased}
  .card{width:min(92%,420px);
    background:linear-gradient(155deg,rgba(255,255,255,.72),rgba(244,241,236,.78));
    backdrop-filter:blur(28px) saturate(180%);-webkit-backdrop-filter:blur(28px) saturate(180%);
    border:1px solid #E9E5EE;border-radius:22px;
    box-shadow:0 40px 120px rgba(26,23,38,0.12),inset 0 1px 0 rgba(255,255,255,0.7);
    padding:34px 30px 28px}
  .eyebrow{font-size:11px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;
    color:rgba(167,139,250,.95);margin-bottom:12px}
  h1{margin:0 0 4px;font-size:23px;font-weight:300;letter-spacing:-.01em}
  p.sub{margin:0;font-size:13px;color:#6E6A7C}
  label{display:block;font-size:11px;letter-spacing:.12em;text-transform:uppercase;
    color:#6E6A7C;margin:20px 0 6px}
  input{width:100%;background:rgba(255,255,255,0.72);border:1px solid #E9E5EE;
    border-radius:12px;padding:13px 14px;color:#1A1726;font-size:16px;outline:none}
  input:focus{border-color:rgba(167,139,250,.7);background:rgba(255,255,255,0.72)}
  button{width:100%;margin-top:24px;border:none;border-radius:12px;padding:14px;
    font-size:16px;font-weight:600;cursor:pointer;color:#1A1726;
    background:linear-gradient(135deg,#8b5cf6,#7c3aed)}
  button:active{transform:translateY(1px)}
  .err{margin-top:18px;padding:11px 14px;border-radius:10px;font-size:13px;
    background:rgba(239,68,68,.14);border:1px solid rgba(239,68,68,.45);color:#fca5a5}
  .foot{margin-top:22px;font-size:11.5px;color:#6E6A7C;line-height:1.55}
  button,button:hover,.btn,.btn:hover{color:#fff}
</style>
</head>
<body>
  <form class="card" method="POST" action="/admin/_login">
    <div class="eyebrow">Mount Zara</div>
    <h1>Admin sign-in</h1>
    <p class="sub">This backend holds patient information.</p>
    <input type="hidden" name="next" value="${esc(next)}">
    <label for="u">Username or email</label>
    <input id="u" name="username" autocomplete="username" autocapitalize="none"
           autocorrect="off" spellcheck="false" required autofocus>
    <label for="p">Password</label>
    <input id="p" name="password" type="password" autocomplete="current-password" required>
    <button type="submit">Sign in</button>
    ${error ? `<div class="err">${esc(error)}</div>` : ""}
    <div class="foot">One sign-in covers the whole backend for 12 hours.
      Signing out ends it everywhere.</div>
  </form>
</body>
</html>`;
}

export function loginPage(opts) { return page(opts); }

// The operator may type either the configured username or any address in
// ADMIN_EMAILS — the grey dialog trained a habit of typing the email, and
// refusing it here would be pedantry, not security. The password check is
// identical either way.
function identifierAccepted(submitted, env) {
    const v = String(submitted || "").trim().toLowerCase();
    if (!v) return false;
    if (v === (env.ADMIN_USER || "admin").trim().toLowerCase()) return true;
    return String(env.ADMIN_EMAILS || "")
        .split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean)
        .includes(v);
}

export async function onRequestGet(ctx) {
    const url = new URL(ctx.request.url);
    return new Response(page({ next: safeNext(url.searchParams.get("next")) }), {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
}

export async function onRequestPost(ctx) {
    const { request, env } = ctx;
    let form;
    try { form = await request.formData(); }
    catch { return new Response(page({ error: "Could not read the form. Try again." }), {
        status: 400, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }); }

    const username = String(form.get("username") || "");
    const password = String(form.get("password") || "");
    const next = safeNext(form.get("next"));
    const ip = request.headers.get("CF-Connecting-IP") || "";
    const identifier = `admin:${username.trim().toLowerCase()}|${ip}`;

    const fail = (msg, status = 401) => new Response(page({ next, error: msg }), {
        status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });

    // Same lockout the Basic path uses — a prettier door is not a weaker one.
    let rl = null;
    if (env.MZ_SESSIONS) {
        try {
            rl = await import("../_lib/rate_limit.js");
            const lock = await rl.checkLockout({ env, prefix: "admin_login", identifier,
                threshold: RL_THRESHOLD, windowSeconds: RL_WINDOW_SECONDS });
            if (lock.locked) {
                return fail(`Too many failed attempts. Try again in ${Math.ceil((lock.retry_after_seconds || 60) / 60)} minute(s).`, 429);
            }
        } catch { rl = null; }
    }

    const okUser = identifierAccepted(username, env);
    let okPass = false;
    if (okUser && env.ADMIN_PASS_HASH) {
        try { okPass = await verifyPbkdf2(password, env.ADMIN_PASS_HASH); }
        catch (e) { console.error("admin/_login verifyPbkdf2 threw", String(e && e.message || e)); }
    }

    if (!okUser || !okPass) {
        if (rl) { try { await rl.recordFailure({ env, prefix: "admin_login", identifier, threshold: RL_THRESHOLD, windowSeconds: RL_WINDOW_SECONDS }); } catch {} }
        try {
            await logAudit(env, { user_id: username.slice(0, 60) || "(blank)", user_role: "admin",
                action: "admin_login_failure", record_type: "admin_auth", record_id: "login",
                success: false, ip, details: { reason: okUser ? "bad_password" : "unknown_user" } }, ctx);
        } catch {}
        // One message for both cases: naming which half was wrong tells an
        // attacker which half to keep.
        return fail("That username or password is not right.");
    }

    if (rl) { try { await rl.clearLockout({ env, prefix: "admin_login", identifier }); } catch {} }
    const cookie = await buildAdminSessionCookie(env, (env.ADMIN_USER || "admin").trim().toLowerCase());
    if (!cookie) {
        return fail("Sign-in is not configured on this deployment (no session key). Tell the developer.", 500);
    }
    try {
        await logAudit(env, { user_id: (env.ADMIN_USER || "admin"), user_role: "admin",
            action: "admin_login", record_type: "admin_auth", record_id: "login",
            success: true, ip, details: {} }, ctx);
    } catch {}

    return new Response(null, {
        status: 303,
        headers: { location: next, "set-cookie": cookie, "cache-control": "no-store" },
    });
}
