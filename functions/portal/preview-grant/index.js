// =====================================================================
// /portal/preview-grant/ — landing page for admin-issued invitations
// =====================================================================
// Receives the click-once URL minted by /api/v1/admin/preview-invite.
// Validates the HMAC-signed grant token, marks the invite row used,
// sets the signed preview-access cookie, and renders a friendly
// hand-off page that auto-redirects to /portal/signup.
//
// The recipient sees:
//   1. "Welcome Ally — your preview link is being verified."
//   2. After ~700 ms, redirect to /portal/signup?invited=ally
//
// If the token is invalid/expired/already-used the page renders a
// short explanation + a button to request a new invitation.
//
// HMAC verification + DB row lookup are both required — a forged token
// without a matching token_hash row fails closed.
// =====================================================================

import {
    verifyGrantToken,
    mintAccessCookie,
    buildAccessCookieHeader,
    buildLabelCookieHeader,
    hashGrantToken,
} from "../../_lib/preview_invite.js";
import { recordTrace } from "../../_lib/session_trace.js";

const _ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function esc(s) { return String(s || "").replace(/[&<>"']/g, (c) => _ESC[c]); }

function renderShell({ title, eyebrow, body, footer = "", redirectTo = null, ms = 700 }) {
    const refresh = redirectTo ? `<meta http-equiv="refresh" content="${ms / 1000};url=${esc(redirectTo)}">` : "";
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)} · Mount Zara</title>
<meta name="robots" content="noindex, nofollow">
${refresh}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@200;300;400;500;600;700&display=swap" rel="stylesheet">
<style>
:root {
    --bg-base: #FBFAF8;
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
        radial-gradient(ellipse 80% 60% at 50% -10%, rgba(var(--glow-purple), 0.20), transparent 60%),
        radial-gradient(ellipse 60% 50% at 90% 110%, rgba(109, 40, 217, 0.14), transparent 60%),
        var(--bg-base);
    color: var(--fg-mid);
    font-family: 'Avenir Next', 'Avenir', 'Nunito Sans', -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif;
    line-height: 1.55;
    min-height: 100vh;
    -webkit-font-smoothing: antialiased;
}
.wrap {
    max-width: 640px; margin: 0 auto;
    padding: clamp(56px, 10vw, 100px) clamp(20px, 5vw, 40px);
    min-height: 100vh; display: flex; flex-direction: column; justify-content: center;
}
.eyebrow {
    display: inline-flex; align-items: center; gap: 10px;
    font-size: 11px; font-weight: 700; letter-spacing: 0.22em; text-transform: uppercase;
    color: rgba(var(--glow-purple), 0.95); margin-bottom: 24px;
    animation: mzRise 0.7s cubic-bezier(0.16, 1, 0.3, 1) both;
}
.pulse {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--accent-soft);
    animation: mzPulse 1.6s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}
h1 {
    font-weight: 200; font-size: clamp(30px, 5vw, 46px);
    letter-spacing: -0.022em; line-height: 1.1; color: var(--fg-strong);
    margin: 0 0 20px 0;
    animation: mzRise 0.85s cubic-bezier(0.16, 1, 0.3, 1) both;
    animation-delay: 0.12s;
}
h1 em {
    font-style: normal;
    background: linear-gradient(180deg, rgba(var(--glow-purple), 1) 0%, var(--accent) 100%);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
}
.lede {
    font-size: 17px; line-height: 1.65; color: var(--fg-mid); max-width: 56ch;
    margin: 0 0 32px 0;
    animation: mzRise 0.85s cubic-bezier(0.16, 1, 0.3, 1) both;
    animation-delay: 0.24s;
}
.lede strong { color: var(--fg-strong); font-weight: 500; }
.cta {
    display: inline-block;
    padding: 14px 26px;
    font-size: 15px; font-weight: 500; letter-spacing: 0.01em;
    color:#1A1726; text-decoration: none;
    background: linear-gradient(180deg, var(--accent-soft), var(--accent));
    border-radius: 12px;
    box-shadow: 0 12px 30px -10px rgba(var(--glow-purple), 0.5), 0 0 0 1px rgba(var(--glow-purple), 0.35) inset;
    transition: transform 0.2s, box-shadow 0.2s;
    animation: mzRise 0.85s cubic-bezier(0.16, 1, 0.3, 1) both;
    animation-delay: 0.36s;
}
.cta:hover { transform: translateY(-1px); box-shadow: 0 16px 40px -10px rgba(var(--glow-purple), 0.65), 0 0 0 1px rgba(var(--glow-purple), 0.5) inset; }
.footer {
    font-size: 13px; color: var(--fg-soft); margin-top: 36px;
    animation: mzRise 0.85s cubic-bezier(0.16, 1, 0.3, 1) both;
    animation-delay: 0.48s;
}
.footer a { color: var(--accent-soft); text-decoration: none; }
.footer a:hover { color: var(--fg-strong); }
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
    .eyebrow, h1, .lede, .cta, .footer { opacity: 1 !important; transform: none !important; }
}
  button,button:hover,.btn,.btn:hover{color:#fff}
</style>
</head>
<body>
<main class="wrap">
    <span class="eyebrow"><span class="pulse" aria-hidden="true"></span>${esc(eyebrow)}</span>
    ${body}
    <p class="footer">${footer}</p>
</main>
</body>
</html>`;
}

async function readGrantToken(request) {
    const url = new URL(request.url);
    const t = url.searchParams.get("t");
    return t ? String(t) : null;
}

export async function onRequestGet(ctx) {
    const { request, env } = ctx;
    const token = await readGrantToken(request);

    // No token at all → friendly explanation page.
    if (!token) {
        await recordTrace(env, {
            request,
            action: "preview_grant_no_token",
            outcome: "validation_fail",
        });
        return new Response(renderShell({
            title: "Invitation Required",
            eyebrow: "Preview Access · Invitation Required",
            body: `
                <h1>You'll need <em>an invitation link</em> to preview the portal.</h1>
                <p class="lede">The Mount Zara member portal is in active design. Access is by invitation while we finish the build. If you were sent a one-click link from the practice, please open it on the same device you'll be using going forward — the link only works once.</p>
                <a class="cta" href="/">Back to mountzara.com</a>
            `,
            footer: `Need a new invitation? Email <a href="mailto:info@mountzara.com">info@mountzara.com</a>.`,
        }), {
            status: 401,
            headers: {
                "content-type": "text/html; charset=utf-8",
                "cache-control": "no-store",
            },
        });
    }

    // Validate signature + expiry.
    let payload;
    try { payload = await verifyGrantToken(env, token); }
    catch (e) {
        console.error("preview-grant verifyGrantToken threw", { error: String(e) });
        payload = null;
    }
    if (!payload) {
        await recordTrace(env, {
            request,
            action: "preview_grant_token_invalid",
            outcome: "validation_fail",
            detail: { token_len: token.length, reason: "signature_or_expired" },
        });
        return new Response(renderShell({
            title: "Invitation Expired",
            eyebrow: "Preview Access · Link Expired",
            body: `
                <h1>This invitation <em>has expired or is invalid</em>.</h1>
                <p class="lede">Invitation links work for a limited window and can only be used once. If this is your first time clicking, the link may have been copied incorrectly — try copying the full URL from your invitation email and pasting it directly.</p>
                <a class="cta" href="/">Back to mountzara.com</a>
            `,
            footer: `Need a fresh invitation? Email <a href="mailto:info@mountzara.com">info@mountzara.com</a>.`,
        }), {
            status: 401,
            headers: {
                "content-type": "text/html; charset=utf-8",
                "cache-control": "no-store",
            },
        });
    }

    // Look up the invite row by token_hash. Single-use enforcement.
    if (!env.DB) {
        console.error("preview-grant DB not bound");
        return new Response("server_error", { status: 500 });
    }

    const tokenHash = await hashGrantToken(token);
    const row = await env.DB.prepare(
        "SELECT id, label, email, full_name, grant_used_at, revoked_at, cookie_exp FROM preview_invites WHERE token_hash = ? LIMIT 1"
    ).bind(tokenHash).first();

    if (!row) {
        await recordTrace(env, {
            request,
            action: "preview_grant_no_row",
            outcome: "validation_fail",
            detail: { token_len: token.length },
        });
        return new Response(renderShell({
            title: "Invitation Not Found",
            eyebrow: "Preview Access · Not Found",
            body: `
                <h1>We couldn't find that <em>invitation</em>.</h1>
                <p class="lede">The link may have been revoked or the practice may have issued a new one. Reach out and we'll send a fresh link right away.</p>
                <a class="cta" href="/">Back to mountzara.com</a>
            `,
            footer: `Email <a href="mailto:info@mountzara.com">info@mountzara.com</a> for help.`,
        }), {
            status: 401,
            headers: {
                "content-type": "text/html; charset=utf-8",
                "cache-control": "no-store",
            },
        });
    }

    if (row.revoked_at) {
        await recordTrace(env, {
            request,
            action: "preview_grant_revoked",
            outcome: "blocked",
            invite_label: row.label,
            detail: { invite_id: row.id },
        });
        return new Response(renderShell({
            title: "Invitation Revoked",
            eyebrow: "Preview Access · Revoked",
            body: `
                <h1>This invitation has been <em>revoked</em>.</h1>
                <p class="lede">Please reach out to the practice for a new one.</p>
                <a class="cta" href="/">Back to mountzara.com</a>
            `,
            footer: `Email <a href="mailto:info@mountzara.com">info@mountzara.com</a>.`,
        }), {
            status: 403,
            headers: {
                "content-type": "text/html; charset=utf-8",
                "cache-control": "no-store",
            },
        });
    }

    // Single-use enforcement — but allow re-use within a short window
    // (5 minutes) in case the recipient refreshes the page. Beyond that,
    // require a fresh invitation.
    const SHORT_REUSE_MS = 5 * 60 * 1000;
    const alreadyUsed = !!row.grant_used_at;
    const stillReusable = alreadyUsed && (Date.now() - row.grant_used_at) <= SHORT_REUSE_MS;

    if (alreadyUsed && !stillReusable) {
        await recordTrace(env, {
            request,
            action: "preview_grant_already_redeemed",
            outcome: "blocked",
            invite_label: row.label,
            detail: { invite_id: row.id, used_age_ms: Date.now() - row.grant_used_at },
        });
        return new Response(renderShell({
            title: "Already Used",
            eyebrow: "Preview Access · Already Used",
            body: `
                <h1>This invitation link has <em>already been redeemed</em>.</h1>
                <p class="lede">If you've already signed in once on this device, you don't need this link again — just go straight to the portal. If you're on a new device, ask the practice for a fresh invitation.</p>
                <a class="cta" href="/portal/login">Go to portal sign-in</a>
            `,
            footer: `Need help? Email <a href="mailto:info@mountzara.com">info@mountzara.com</a>.`,
        }), {
            status: 410,
            headers: {
                "content-type": "text/html; charset=utf-8",
                "cache-control": "no-store",
            },
        });
    }

    // Mint the signed access cookie + label cookie. Use the cookie_exp
    // from the invite row if available, else default to 90 days.
    const cookieExp = row.cookie_exp || (Date.now() + 90 * 24 * 60 * 60 * 1000);
    const ttl_ms = cookieExp - Date.now();
    const access = await mintAccessCookie(env, {
        label: row.label || payload.label || "guest",
        jti: payload.jti,
        ttl_ms,
    });
    const accessCookie = buildAccessCookieHeader(access.value, access.exp_ms);
    const labelCookie = buildLabelCookieHeader(row.label || payload.label || "guest", access.exp_ms);

    // Stamp the invite row. We tolerate the rare race-condition of two
    // clicks within 5 minutes by writing the timestamp anyway (UPDATE is
    // idempotent within the reuse window).
    if (!alreadyUsed) {
        try {
            await env.DB.prepare(
                "UPDATE preview_invites SET grant_used_at = ?, updated_at = ? WHERE id = ?"
            ).bind(Date.now(), Date.now(), row.id).run();
        } catch (e) {
            console.error("preview-grant UPDATE grant_used_at threw", { error: String(e), invite_id: row.id });
            // Non-fatal — we still set the cookie and let them in.
        }
    }

    await recordTrace(env, {
        request,
        action: "preview_grant_redeemed",
        outcome: "ok",
        invite_label: row.label,
        detail: {
            invite_id: row.id,
            reused: alreadyUsed,
            cookie_exp_iso: new Date(access.exp_ms).toISOString(),
        },
    });

    // Friendly handoff page. We auto-redirect to /portal/signup with the
    // invite label appended as a query param so signup can greet them.
    const greeting = row.full_name ? row.full_name.split(/\s+/)[0] : (row.label ? row.label.charAt(0).toUpperCase() + row.label.slice(1) : "there");
    const redirectTo = `/portal/signup?invited=${encodeURIComponent(row.label || "guest")}`;

    return new Response(renderShell({
        title: "Welcome",
        eyebrow: "Preview Access · Verified",
        redirectTo,
        ms: 800,
        body: `
            <h1>Welcome${greeting ? `, <em>${esc(greeting)}</em>` : `, <em>to the preview</em>`}.</h1>
            <p class="lede">Your invitation has been verified. We're taking you to the member-portal signup so you can create your account and walk through everything we're building — intake, scheduling, secure messaging, document handling, and the rest.</p>
            <a class="cta" href="${esc(redirectTo)}">Continue to signup</a>
        `,
        footer: `If you're not redirected automatically in a moment, use the button above. Questions? <a href="mailto:info@mountzara.com">info@mountzara.com</a>.`,
    }), {
        status: 200,
        headers: new Headers([
            ["content-type", "text/html; charset=utf-8"],
            ["cache-control", "no-store"],
            ["set-cookie", accessCookie],
            ["set-cookie", labelCookie],
        ]),
    });
}
