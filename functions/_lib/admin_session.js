// =====================================================================
// admin_session.js — one sign-in for the whole backend
// =====================================================================
// THE PROBLEM THIS FIXES. Signing into the admin used to take TWO
// credential prompts with TWO DIFFERENT usernames:
//
//   1. the browser's native Basic-auth dialog on the page load, wanting
//      ADMIN_USER (`drmabini`), enforced by functions/admin/_middleware.js;
//   2. a second, prettier modal injected by admin/_nav.js before any API
//      call, which defaulted to an EMAIL ADDRESS — a value the server
//      never accepts, since readAdminIdentity compares against ADMIN_USER.
//
// The second prompt existed because the SPA's fetch() calls to
// /api/v1/admin/* could not rely on the browser replaying Basic
// credentials outside the /admin path tree. The right fix is not a
// second prompt: it is a SESSION. Authenticating the page load now mints
// a signed, HttpOnly cookie that the API accepts, so every subsequent
// request — page or fetch — is already authenticated.
//
// Format:  <expires_at_iso>|<user>|<base64url hmac-sha256 of "iso|user">
// Signed with ADMIN_SESSION_KEY, falling back to SESSION_SECRET so this
// works without a new secret being provisioned first.
//
// SameSite=Lax is deliberate: it still arrives on top-level navigation to
// /admin, but is NOT sent on cross-site POSTs, which is what protects the
// state-changing admin API from CSRF. HttpOnly keeps it away from any
// script, including an XSS payload on an admin page.
// =====================================================================

const COOKIE_NAME = "mz_admin_session";
export const SESSION_TTL_SECONDS = 12 * 3600;

function b64urlEncode(bytes) {
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function keyMaterial(env) {
    return env.ADMIN_SESSION_KEY || env.SESSION_SECRET || "";
}

async function hmac(message, secret) {
    const key = await crypto.subtle.importKey(
        "raw", new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

function safeEq(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

export async function buildAdminSessionCookie(env, user, { ttlSeconds = SESSION_TTL_SECONDS } = {}) {
    const secret = keyMaterial(env);
    if (!secret) return null;                       // no key → no cookie, Basic still works
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const payload = `${expiresAt}|${user}`;
    const value = `${payload}|${b64urlEncode(await hmac(payload, secret))}`;
    return `${COOKIE_NAME}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${ttlSeconds}`;
}

export function clearAdminSessionCookie() {
    return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

/**
 * Returns { user, role } for a valid session cookie, else null.
 * Verifies the signature BEFORE trusting any field, and rejects an
 * expired cookie even when the signature is good.
 */
export async function verifyAdminSession(request, env) {
    const secret = keyMaterial(env);
    if (!secret) return null;
    const header = request.headers.get("Cookie") || "";
    const m = header.match(new RegExp("(?:^|;\\s*)" + COOKIE_NAME + "=([^;]+)"));
    if (!m) return null;
    let raw;
    try { raw = decodeURIComponent(m[1]); } catch { return null; }
    const parts = raw.split("|");
    if (parts.length !== 3) return null;
    const [expiresAt, user, sig] = parts;
    const expected = b64urlEncode(await hmac(`${expiresAt}|${user}`, secret));
    if (!safeEq(sig, expected)) return null;
    const exp = Date.parse(expiresAt);
    if (!Number.isFinite(exp) || exp <= Date.now()) return null;
    return { user, role: "clinician" };
}

export default { buildAdminSessionCookie, clearAdminSessionCookie, verifyAdminSession, SESSION_TTL_SECONDS };
