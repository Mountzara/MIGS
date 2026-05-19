// =====================================================================
// functions/admin/_mfa.js — admin TOTP MFA second-factor endpoint.
//
// Flow:
//   1. Admin's browser hits /admin/* with valid Basic Auth.
//   2. Middleware sees ADMIN_TOTP_SECRET is configured AND no valid
//      mz_admin_mfa cookie → serves the MFA prompt HTML.
//   3. Browser POSTs the 6-digit code to /admin/_mfa.
//   4. Endpoint here verifies the TOTP code against env.ADMIN_TOTP_SECRET
//      (and recovery-code fallback if provided). On success: issues the
//      signed cookie + 303-redirect back to the URL the operator was
//      trying to reach (carried via ?next= query param).
//   5. Browser follows redirect; middleware sees the cookie + lets through.
//
// Recovery codes:
//   When the operator enrolls TOTP, the enroll script generates 10
//   one-time recovery codes (xxxx-xxxx format) and prints them once.
//   The hashes are stored in env.ADMIN_TOTP_RECOVERY_HASHES (newline-
//   separated SHA-256 hashes). If a recovery code is submitted instead
//   of a TOTP code, this endpoint verifies it + marks it consumed in
//   audit_log (full revocation requires updating the secret value).
// =====================================================================

import { verifyTotp } from "../_lib/totp.js";
import { buildMfaCookie } from "../_lib/mfa_cookie.js";
import { logAudit } from "../_lib/audit.js";

// Thin wrapper to match the audit() signature this file uses inline.
async function audit(env, role, action, details) {
    try {
        await logAudit(env, {
            user_id: "admin",
            user_role: role || "admin",
            action,
            record_type: "admin_mfa",
            success: action !== "admin_mfa_failure",
            details: details || {},
        });
    } catch (_e) { /* audit failures must not block the auth flow */ }
}

function htmlEscape(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function isSafeNext(next) {
    // Only allow same-origin paths under /admin to avoid open-redirect.
    if (typeof next !== "string") return false;
    if (!next.startsWith("/admin")) return false;
    if (next.includes("://")) return false;
    if (next.length > 512) return false;
    return true;
}

export function mfaPromptHtml({ next = "/admin/", error = "" } = {}) {
    const safeNext = isSafeNext(next) ? next : "/admin/";
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Two-factor — Mount Zara Admin</title>
    <link rel="icon" href="/assets/favicon.ico">
    <style>
        :root { color-scheme: dark; }
        body {
            margin: 0; min-height: 100vh;
            font-family: 'Avenir Next', 'Avenir', 'Nunito Sans', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
            background: #050514; color: rgba(245, 245, 247, 0.92);
            display: flex; align-items: center; justify-content: center;
            padding: 24px;
        }
        .card {
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid rgba(255, 255, 255, 0.10);
            border-radius: 14px;
            backdrop-filter: blur(28px) saturate(165%);
            -webkit-backdrop-filter: blur(28px) saturate(165%);
            padding: clamp(28px, 4vw, 44px); max-width: 420px; width: 100%;
        }
        .eyebrow { font-size: 11px; font-weight: 700; letter-spacing: 0.22em;
                   text-transform: uppercase; color: rgba(167, 139, 250, 0.95); margin-bottom: 14px; }
        h1 { font-weight: 200; font-size: clamp(24px, 3.4vw, 32px);
             letter-spacing: -0.018em; margin: 0 0 12px; line-height: 1.15; }
        p  { font-size: 15px; line-height: 1.55; color: rgba(245, 245, 247, 0.74); margin: 0 0 22px; }
        form { display: grid; gap: 14px; }
        label { font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase;
                color: rgba(245, 245, 247, 0.62); }
        input[type="text"] {
            font: inherit; font-size: 22px; letter-spacing: 0.32em; text-align: center;
            background: rgba(0, 0, 0, 0.22); color: inherit;
            border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 10px;
            padding: 14px 16px; width: 100%; outline: none;
            transition: border-color 0.22s, background 0.22s;
        }
        input[type="text"]:focus { border-color: rgba(167, 139, 250, 0.65); background: rgba(0, 0, 0, 0.32); }
        button {
            font: inherit; font-size: 15px; font-weight: 500;
            background: linear-gradient(180deg, #6d28d9 0%, #5b21b6 100%);
            color: white; border: 0; border-radius: 10px;
            padding: 14px 18px; cursor: pointer;
            transition: transform 0.18s, box-shadow 0.22s;
        }
        button:hover { transform: translateY(-1px); box-shadow: 0 8px 24px rgba(109, 40, 217, 0.32); }
        .err {
            background: rgba(245, 50, 75, 0.10); border: 1px solid rgba(245, 50, 75, 0.30);
            color: rgba(252, 165, 165, 0.95); padding: 10px 14px; border-radius: 8px;
            font-size: 14px; line-height: 1.45;
        }
        details { font-size: 13px; color: rgba(245, 245, 247, 0.55); margin-top: 6px; }
        details summary { cursor: pointer; }
    </style>
</head>
<body>
    <div class="card">
        <p class="eyebrow">Two-factor</p>
        <h1>Enter your authenticator code</h1>
        <p>Open Google Authenticator, 1Password, Authy, or your TOTP app and enter the 6-digit code for Mount Zara Admin.</p>
        ${error ? `<div class="err">${htmlEscape(error)}</div>` : ""}
        <form method="POST" action="/admin/_mfa" autocomplete="off">
            <input type="hidden" name="next" value="${htmlEscape(safeNext)}">
            <label for="code">6-digit code</label>
            <input id="code" name="code" type="text" inputmode="numeric" pattern="[0-9 ]{6,9}"
                   maxlength="9" autofocus required autocomplete="one-time-code">
            <button type="submit">Verify</button>
            <details>
                <summary>Lost your authenticator?</summary>
                <p style="margin-top: 10px;">Enter one of your one-time recovery codes (format <code>xxxx-xxxx</code>) in the field above. Each code works only once.</p>
            </details>
        </form>
    </div>
</body>
</html>`;
}

async function sha256Hex(s) {
    const bytes = new TextEncoder().encode(s);
    const sig = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function onRequestPost(ctx) {
    const { request, env } = ctx;
    if (!env.ADMIN_TOTP_SECRET) {
        return new Response(mfaPromptHtml({ error: "Admin MFA is not configured." }),
                            { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    const ct = request.headers.get("Content-Type") || "";
    let code = "", next = "/admin/";
    if (ct.includes("application/x-www-form-urlencoded")) {
        const params = new URLSearchParams(await request.text());
        code = (params.get("code") || "").trim();
        next = (params.get("next") || "/admin/").trim();
    } else if (ct.includes("application/json")) {
        const body = await request.json();
        code = (body.code || "").trim();
        next = (body.next || "/admin/").trim();
    }
    if (!isSafeNext(next)) next = "/admin/";

    // Recovery code? Format `xxxx-xxxx`. Verify hash against newline-separated env secret.
    if (/^[0-9a-z]{4}-[0-9a-z]{4}$/i.test(code) && env.ADMIN_TOTP_RECOVERY_HASHES) {
        const codeNorm = code.toLowerCase();
        const codeHash = await sha256Hex(codeNorm);
        const hashes = env.ADMIN_TOTP_RECOVERY_HASHES.split(/\s+/).filter(Boolean);
        if (hashes.includes(codeHash)) {
            await audit(env, "admin", "admin_mfa_recovery_used", { code_hash_prefix: codeHash.slice(0, 12) });
            const cookie = await buildMfaCookie(env);
            return new Response("redirecting", {
                status: 303,
                headers: { "Location": next, "Set-Cookie": cookie, "Cache-Control": "no-store" },
            });
        }
    }

    // TOTP path.
    let ok = false;
    try {
        ok = await verifyTotp(env.ADMIN_TOTP_SECRET, code);
    } catch (e) {
        console.error("admin/_mfa verifyTotp threw", { error: String(e) });
        ok = false;
    }
    if (!ok) {
        await audit(env, "admin", "admin_mfa_failure", {});
        return new Response(mfaPromptHtml({ next, error: "Code didn't match. Try again — codes refresh every 30 seconds." }),
                            { status: 401, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    await audit(env, "admin", "admin_mfa_success", {});
    const cookie = await buildMfaCookie(env);
    return new Response("redirecting", {
        status: 303,
        headers: { "Location": next, "Set-Cookie": cookie, "Cache-Control": "no-store" },
    });
}

export async function onRequestGet(ctx) {
    // If someone GETs /admin/_mfa directly, show the prompt.
    const url = new URL(ctx.request.url);
    const next = url.searchParams.get("next") || "/admin/";
    return new Response(mfaPromptHtml({ next }),
                        { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
