// =====================================================================
// functions/_lib/preview_invite.js — signed preview-access cookie
// =====================================================================
// Per CLAUDE.md §11.5.2 — pre-launch portal is gated by previewAccess().
// The gate already honors PORTAL_PUBLIC_LAUNCH, admin Basic Auth, the
// magic-link redeem path, and an existing mz_session cookie. This module
// adds a fourth allow-path: a signed preview-access cookie issued by an
// admin-initiated invitation, scoped to a single recipient.
//
// Threat model + invariants:
//   * Cookie is HMAC-SHA256 signed with env.PREVIEW_INVITE_KEY (a Pages
//     secret, ≥32 bytes random). Forgery requires the key.
//   * Cookie value is BASE64URL(payload).BASE64URL(sig), where payload
//     is JSON: { jti, label, email_prefix, exp_ms }. NO raw email,
//     NO PHI, NO session token.
//   * Cookie is HttpOnly + Secure + SameSite=Lax + Path=/ so the portal
//     can read it on every route. Cookie does NOT carry session
//     authority — it ONLY gates the previewAccess() check. Real auth
//     still flows through the password / magic-link / mz_session path.
//   * 90-day default TTL. After signup completion the patient has an
//     mz_session cookie and the preview cookie becomes superfluous
//     (still works but irrelevant to auth).
//   * jti is recorded in D1 preview_invites.cookie_jti — operator can
//     revoke a single invite by clearing the row.
//
// The "grant URL" — what the recipient clicks in their invitation email —
// looks like:
//
//     https://mountzara.com/portal/preview-grant/?t=<TOKEN>
//
// where TOKEN is BASE64URL(payload).BASE64URL(sig). The preview-grant
// page validates the token (signature + expiry + invite-row freshness),
// then sets the cookie + redirects to /portal/signup. The TOKEN is
// single-use: preview_invites.grant_used_at gets stamped on first redeem
// and subsequent attempts are rejected.
// =====================================================================

const _enc = new TextEncoder();
const _dec = new TextDecoder();

function _b64urlEncode(bytes) {
    let s = btoa(String.fromCharCode(...bytes));
    return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function _b64urlDecode(s) {
    let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

async function _hmacKey(rawKey) {
    return await crypto.subtle.importKey(
        "raw",
        _enc.encode(rawKey),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"]
    );
}

async function _sha256Hex(input) {
    const data = typeof input === "string" ? _enc.encode(input) : input;
    const buf = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

/**
 * Sign a one-time grant token. Returns { token, jti, exp_ms }.
 *
 * @param {object} env - must include PREVIEW_INVITE_KEY
 * @param {object} payload
 * @param {string} payload.label        - short label ("ally")
 * @param {string} payload.email_prefix - email[0..3] + "***", PHI-conservative
 * @param {number=} payload.ttl_ms      - default 14 days
 */
export async function mintGrantToken(env, payload) {
    if (!env?.PREVIEW_INVITE_KEY || env.PREVIEW_INVITE_KEY.length < 32) {
        throw new Error("PREVIEW_INVITE_KEY missing or too short (need ≥32 chars)");
    }
    const ttlMs = payload.ttl_ms || (14 * 24 * 60 * 60 * 1000);
    const exp_ms = Date.now() + ttlMs;
    const jti = crypto.randomUUID();
    const body = {
        v: 1,
        kind: "grant",
        jti,
        label: String(payload.label || "guest").toLowerCase(),
        email_prefix: String(payload.email_prefix || "").slice(0, 8),
        exp_ms,
    };
    const bodyJson = JSON.stringify(body);
    const bodyB64 = _b64urlEncode(_enc.encode(bodyJson));
    const key = await _hmacKey(env.PREVIEW_INVITE_KEY);
    const sig = await crypto.subtle.sign("HMAC", key, _enc.encode(bodyB64));
    const sigB64 = _b64urlEncode(new Uint8Array(sig));
    return {
        token: `${bodyB64}.${sigB64}`,
        jti,
        exp_ms,
    };
}

/**
 * Verify a grant token. Returns the decoded payload if valid + unexpired,
 * else null. Does NOT check the preview_invites row (caller is responsible
 * for that single-use enforcement).
 */
export async function verifyGrantToken(env, token) {
    if (!env?.PREVIEW_INVITE_KEY) return null;
    if (typeof token !== "string" || !token.includes(".")) return null;
    const [bodyB64, sigB64] = token.split(".", 2);
    if (!bodyB64 || !sigB64) return null;
    let valid;
    try {
        const key = await _hmacKey(env.PREVIEW_INVITE_KEY);
        valid = await crypto.subtle.verify(
            "HMAC", key, _b64urlDecode(sigB64), _enc.encode(bodyB64)
        );
    } catch { return null; }
    if (!valid) return null;
    let payload;
    try {
        payload = JSON.parse(_dec.decode(_b64urlDecode(bodyB64)));
    } catch { return null; }
    if (!payload || payload.v !== 1 || payload.kind !== "grant") return null;
    if (typeof payload.exp_ms !== "number" || payload.exp_ms < Date.now()) return null;
    return payload;
}

/**
 * Mint the long-lived preview-access cookie payload + signature, distinct
 * from the one-time grant token. The cookie is what the gate honors on
 * every request going forward; the grant token is single-use.
 */
export async function mintAccessCookie(env, payload) {
    if (!env?.PREVIEW_INVITE_KEY) throw new Error("PREVIEW_INVITE_KEY missing");
    const ttlMs = payload.ttl_ms || (90 * 24 * 60 * 60 * 1000);
    const exp_ms = Date.now() + ttlMs;
    const jti = payload.jti || crypto.randomUUID();
    const body = {
        v: 1,
        kind: "access",
        jti,
        label: String(payload.label || "guest").toLowerCase(),
        exp_ms,
    };
    const bodyJson = JSON.stringify(body);
    const bodyB64 = _b64urlEncode(_enc.encode(bodyJson));
    const key = await _hmacKey(env.PREVIEW_INVITE_KEY);
    const sig = await crypto.subtle.sign("HMAC", key, _enc.encode(bodyB64));
    const sigB64 = _b64urlEncode(new Uint8Array(sig));
    return {
        value: `${bodyB64}.${sigB64}`,
        jti,
        exp_ms,
    };
}

/**
 * Verify the cookie value from an inbound request. Returns the decoded
 * payload (with .label) if valid + unexpired, else null.
 */
export async function verifyAccessCookie(env, cookieValue) {
    if (!env?.PREVIEW_INVITE_KEY) return null;
    if (typeof cookieValue !== "string" || !cookieValue.includes(".")) return null;
    const [bodyB64, sigB64] = cookieValue.split(".", 2);
    if (!bodyB64 || !sigB64) return null;
    let valid;
    try {
        const key = await _hmacKey(env.PREVIEW_INVITE_KEY);
        valid = await crypto.subtle.verify(
            "HMAC", key, _b64urlDecode(sigB64), _enc.encode(bodyB64)
        );
    } catch { return null; }
    if (!valid) return null;
    let payload;
    try {
        payload = JSON.parse(_dec.decode(_b64urlDecode(bodyB64)));
    } catch { return null; }
    if (!payload || payload.v !== 1 || payload.kind !== "access") return null;
    if (typeof payload.exp_ms !== "number" || payload.exp_ms < Date.now()) return null;
    return payload;
}

/**
 * Extract the preview-access cookie value (raw) from a Request.
 */
export function readAccessCookieValue(request) {
    const c = request.headers.get("Cookie") || "";
    const m = c.match(/(?:^|;\s*)mz_preview_access=([^;]+)/);
    return m && m[1] ? m[1].trim() : null;
}

/**
 * Build a Set-Cookie header value for mz_preview_access.
 */
export function buildAccessCookieHeader(value, exp_ms) {
    const maxAge = Math.max(60, Math.floor((exp_ms - Date.now()) / 1000));
    return [
        `mz_preview_access=${value}`,
        "Path=/",
        "HttpOnly",
        "Secure",
        "SameSite=Lax",
        `Max-Age=${maxAge}`,
    ].join("; ");
}

/**
 * Build a Set-Cookie header for the human-readable mz_preview_label
 * (used by session_trace.readInviteLabel for fast filtering). This
 * cookie is non-HttpOnly intentionally — the admin debug UI reads it
 * from the same browser session if needed — and carries NO authority.
 */
export function buildLabelCookieHeader(label, exp_ms) {
    const safeLabel = String(label || "guest").toLowerCase().replace(/[^a-z0-9_\-]/g, "").slice(0, 32) || "guest";
    const maxAge = Math.max(60, Math.floor((exp_ms - Date.now()) / 1000));
    return [
        `mz_preview_label=${encodeURIComponent(safeLabel)}`,
        "Path=/",
        "Secure",
        "SameSite=Lax",
        `Max-Age=${maxAge}`,
    ].join("; ");
}

/**
 * SHA256 hash for one-time grant tokens — used as the DB lookup key.
 */
export async function hashGrantToken(token) {
    return await _sha256Hex(token);
}
