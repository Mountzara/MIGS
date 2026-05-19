// =====================================================================
// functions/_lib/mfa_cookie.js — signed cookie carrying "TOTP recently
// verified" state for the admin MFA flow.
//
// Cookie value format:
//   <expires_at_iso8601>|<base64url-hmac-sha256-of-expires_at>
//
// Signed with env.ADMIN_MFA_COOKIE_KEY (random Cloudflare Pages secret).
// Cookie is HttpOnly, Secure, SameSite=Strict, Path=/admin.
// =====================================================================

const COOKIE_NAME = "mz_admin_mfa";
export const COOKIE_TTL_SECONDS = 8 * 3600; // 8 hours

function b64urlEncode(bytes) {
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str) {
    const padded = str + "===".slice((str.length + 3) % 4);
    const bin = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

async function hmac(message, keyMaterial) {
    const key = await crypto.subtle.importKey(
        "raw", new TextEncoder().encode(keyMaterial),
        { name: "HMAC", hash: "SHA-256" },
        false, ["sign", "verify"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
    return new Uint8Array(sig);
}

function safeBytesEq(a, b) {
    if (a.length !== b.length) return false;
    let mismatch = 0;
    for (let i = 0; i < a.length; i++) mismatch |= a[i] ^ b[i];
    return mismatch === 0;
}

export async function buildMfaCookie(env, { ttlSeconds = COOKIE_TTL_SECONDS } = {}) {
    if (!env.ADMIN_MFA_COOKIE_KEY) {
        throw new Error("ADMIN_MFA_COOKIE_KEY env secret not configured");
    }
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const sig = await hmac(expiresAt, env.ADMIN_MFA_COOKIE_KEY);
    const value = `${expiresAt}|${b64urlEncode(sig)}`;
    return `${COOKIE_NAME}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Strict; Path=/admin; Max-Age=${ttlSeconds}`;
}

export function clearMfaCookie() {
    return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/admin; Max-Age=0`;
}

/**
 * Inspect the incoming request for a valid signed MFA cookie. Returns
 * `true` only when the cookie is present, signature verifies, and the
 * carried expiry is still in the future.
 */
export async function verifyMfaCookie(request, env) {
    if (!env.ADMIN_MFA_COOKIE_KEY) return false;
    const cookieHeader = request.headers.get("Cookie") || "";
    const match = cookieHeader.match(new RegExp("(?:^|;\\s*)" + COOKIE_NAME + "=([^;]+)"));
    if (!match) return false;
    let value;
    try { value = decodeURIComponent(match[1]); }
    catch { return false; }
    const idx = value.indexOf("|");
    if (idx <= 0) return false;
    const expiresAt = value.slice(0, idx);
    const sigB64 = value.slice(idx + 1);
    // Sig check first (constant time) — only then trust the timestamp.
    let sigBytes;
    try { sigBytes = b64urlDecode(sigB64); }
    catch { return false; }
    const expectedSig = await hmac(expiresAt, env.ADMIN_MFA_COOKIE_KEY);
    if (!safeBytesEq(sigBytes, expectedSig)) return false;
    // Timestamp must parse + be in the future.
    const expMs = Date.parse(expiresAt);
    if (!Number.isFinite(expMs)) return false;
    if (expMs <= Date.now()) return false;
    return true;
}
