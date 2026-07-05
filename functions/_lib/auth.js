// =====================================================================
// functions/_lib/auth.js — patient & clinician auth helpers
// =====================================================================
// Per CLAUDE.md §11 Tier 1 (Identity & Auth).
//
// Patient auth: roll-your-own on D1 with PBKDF2-HMAC-SHA-256 (100k iter)
// for passwords + opaque session tokens (256 random bits) stored in KV
// for fast lookup and D1 for the durable record.
//
// Clinician auth: Cloudflare Access at /admin/* (existing) plus this
// module's `requireRole()` guard for fine-grained per-route checks.
//
// Magic-link tokens: 192 random bits, raw token mailed to the patient,
// SHA-256 hash of the token stored in D1. Single-use, 15-min expiry.
//
// All auth-sensitive functions emit audit_log rows via _lib/audit.js so
// every login_success / login_fail / session_create / session_revoke /
// magic_link_issue / magic_link_redeem is recorded. PHI is NEVER logged
// in the details_json — only opaque record ids.
// =====================================================================

import { logAudit } from "./audit.js";

// IMPORTANT: Cloudflare Workers caps PBKDF2 iterations at 100,000. Higher
// values (e.g. 200,000, 600,000 per OWASP 2023) cause `subtle.deriveBits`
// to throw at verify time ("Pbkdf2 failed: iteration counts above 100000
// are not supported"). The middleware's try/catch turns that into a 401
// "Invalid credentials" that's impossible to diagnose without a probe.
// Confirmed 2026-05-15 via on-deploy diagnostic. Re-evaluate if Workers
// raises the cap. See admin/_middleware.js header comment.
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_SALT_BYTES = 16;
const PBKDF2_HASH_BYTES = 32;
const SESSION_TOKEN_BYTES = 32;            // 256 bits → 43 chars base64url
const MAGIC_TOKEN_BYTES = 24;              // 192 bits → 32 chars base64url
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;        // 12 hours
const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;          // 15 minutes

// ---------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------

function bytesToBase64Url(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function bytesToBase64(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
}

function base64ToBytes(b64) {
    const bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

function constantTimeBytesEq(a, b) {
    if (a.length !== b.length) return false;
    let mismatch = 0;
    for (let i = 0; i < a.length; i++) mismatch |= a[i] ^ b[i];
    return mismatch === 0;
}

function randomBytes(n) {
    const out = new Uint8Array(n);
    crypto.getRandomValues(out);
    return out;
}

function uuidv4() {
    // crypto.randomUUID() is available on Workers runtime.
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
    // Fallback if ever needed: RFC 4122 v4 from getRandomValues.
    const b = randomBytes(16);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const hex = Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function nowMs() { return Date.now(); }

export function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
}

// ---------------------------------------------------------------------
// Password hashing
// ---------------------------------------------------------------------

/**
 * Hash a password for storage. Returns a string in the format:
 *   pbkdf2$<iterations>$<base64-salt>$<base64-hash>
 * which is identical to the format used by admin/_middleware.js so
 * verification logic can be shared.
 */
export async function hashPassword(password) {
    const salt = randomBytes(PBKDF2_SALT_BYTES);
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        enc.encode(password),
        { name: "PBKDF2" },
        false,
        ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits(
        { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
        keyMaterial,
        PBKDF2_HASH_BYTES * 8
    );
    return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(new Uint8Array(bits))}`;
}

/**
 * Verify a password against a stored pbkdf2$ encoded string. Constant-time.
 * Returns false (never throws) on any parse / crypto error so the caller
 * can render a uniform "invalid credentials" response.
 */
export async function verifyPassword(password, stored) {
    try {
        if (typeof stored !== "string") return false;
        const parts = stored.split("$");
        if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
        const iterations = parseInt(parts[1], 10);
        if (!Number.isFinite(iterations) || iterations < 10_000) return false;
        const salt = base64ToBytes(parts[2]);
        const expected = base64ToBytes(parts[3]);
        const enc = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
            "raw",
            enc.encode(password),
            { name: "PBKDF2" },
            false,
            ["deriveBits"]
        );
        const bits = await crypto.subtle.deriveBits(
            { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
            keyMaterial,
            expected.length * 8
        );
        return constantTimeBytesEq(new Uint8Array(bits), expected);
    } catch (e) {
        // Don't bubble — log structured and treat as auth failure.
        console.error("auth.verifyPassword threw", {
            module: "_lib/auth",
            op: "verifyPassword",
            error: e && e.message ? e.message : String(e),
            recovery: "return false",
        });
        return false;
    }
}

// ---------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------

/**
 * Create a new auth session for a patient OR clinician. Writes to both
 * D1 (auth_sessions) and KV (env.MZ_SESSIONS). Returns the raw session
 * token (caller sets it as an HttpOnly Secure SameSite=Lax cookie).
 *
 * @param {object} args
 * @param {object} args.env - Pages Function env (D1=DB, KV=MZ_SESSIONS, etc.)
 * @param {string=} args.patient_id - exactly one of patient_id/clinician_id
 * @param {string=} args.clinician_id
 * @param {'patient'|'clinician'|'staff'} args.role
 * @param {Request} args.request - for ip + ua
 * @returns {Promise<{token: string, session_id: string, expires_at: number}>}
 */
export async function createSession({ env, patient_id, clinician_id, role, request }) {
    if (!env.DB) throw new Error("createSession: env.DB not bound");
    if (!env.MZ_SESSIONS) throw new Error("createSession: env.MZ_SESSIONS KV not bound");
    if (!role || (!patient_id && !clinician_id)) {
        throw new Error("createSession: missing role or subject");
    }
    if (patient_id && clinician_id) {
        throw new Error("createSession: only one of patient_id/clinician_id");
    }

    const session_id = uuidv4();
    const token_bytes = randomBytes(SESSION_TOKEN_BYTES);
    const token = bytesToBase64Url(token_bytes);
    // Token format: <session_id>.<random> so we can index by session_id in KV
    // and the random half acts as the secret bearer half (must match D1).
    const composite_token = `${session_id}.${token}`;
    // We store the SHA-256 of the random half so a KV/D1 compromise alone
    // can't forge a session.
    const token_hash = await sha256Base64Url(token);
    const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "";
    const ua = request.headers.get("User-Agent") || "";
    const now = nowMs();
    const expires_at = now + SESSION_TTL_MS;

    // token_hash lands with migration 0027; tolerate a not-yet-migrated
    // DB by falling back to the legacy INSERT (the session then simply
    // has no D1 fallback — getSession fails closed on a KV miss).
    try {
        await env.DB.prepare(`
            INSERT INTO auth_sessions
                (id, patient_id, clinician_id, role, created_at, expires_at, last_seen_at, ip, user_agent, token_hash)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
            session_id,
            patient_id || null,
            clinician_id || null,
            role,
            now,
            expires_at,
            now,
            ip,
            ua,
            token_hash
        ).run();
    } catch (e) {
        if (!/no column named token_hash/i.test(String(e))) throw e;
        await env.DB.prepare(`
            INSERT INTO auth_sessions
                (id, patient_id, clinician_id, role, created_at, expires_at, last_seen_at, ip, user_agent)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
            session_id,
            patient_id || null,
            clinician_id || null,
            role,
            now,
            expires_at,
            now,
            ip,
            ua
        ).run();
    }

    // KV mirrors session_id → JSON for fast lookup. Token verification still
    // requires the hash compare so KV-only leakage is not enough to forge.
    await env.MZ_SESSIONS.put(session_id, JSON.stringify({
        token_hash,
        patient_id: patient_id || null,
        clinician_id: clinician_id || null,
        role,
        expires_at,
    }), { expirationTtl: Math.floor(SESSION_TTL_MS / 1000) });

    await logAudit(env, {
        user_id: patient_id || clinician_id,
        user_role: role,
        action: "session_create",
        record_type: "session",
        record_id: session_id,
        ip, user_agent: ua,
        success: true,
        details: { ttl_ms: SESSION_TTL_MS },
    });

    return { token: composite_token, session_id, expires_at };
}

async function sha256Base64Url(text) {
    const enc = new TextEncoder();
    const hash = await crypto.subtle.digest("SHA-256", enc.encode(text));
    return bytesToBase64Url(new Uint8Array(hash));
}

/**
 * Resolve a session from a raw composite token. Returns the session
 * record (incl. role + patient_id/clinician_id) or null. Touches
 * last_seen_at on each call.
 */
export async function getSession({ env, token, request, ctx }) {
    if (!token || typeof token !== "string") return null;
    const dot = token.indexOf(".");
    if (dot < 0) return null;
    const session_id = token.slice(0, dot);
    const secret = token.slice(dot + 1);
    if (!session_id || !secret) return null;

    let kvRecord = null;
    try {
        const raw = await env.MZ_SESSIONS.get(session_id);
        if (raw) kvRecord = JSON.parse(raw);
    } catch (e) {
        console.error("auth.getSession KV read threw", { error: String(e) });
    }

    // Fallback to D1 if KV missed (cache miss tolerable).
    let row = null;
    if (!kvRecord) {
        // SELECT * so this works before AND after migration 0027 (an
        // explicit token_hash column reference would throw pre-migration
        // and 500 every KV-miss request).
        row = await env.DB.prepare(`
            SELECT * FROM auth_sessions WHERE id = ?
        `).bind(session_id).first();
        if (!row) return null;
    }

    const expires_at = kvRecord ? kvRecord.expires_at : row.expires_at;
    if (!expires_at || expires_at < nowMs()) return null;
    if (row && row.revoked_at) return null;

    // Verify the secret half by hashing and comparing. FAIL CLOSED: a
    // session with no stored hash (pre-migration-0027 D1 row on a KV
    // miss) is rejected rather than accepted on session_id alone —
    // worst case a 12-hour-TTL session re-authenticates once.
    const expectedHash = kvRecord ? kvRecord.token_hash : row.token_hash;
    if (!expectedHash) return null;
    const candidateHash = await sha256Base64Url(secret);
    // Constant-time on strings
    if (!constantTimeStringEq(expectedHash, candidateHash)) return null;

    // Refresh last_seen_at — truly fire-and-forget. Previous behavior
    // awaited this UPDATE on every authenticated request which added 20-50ms
    // of D1 write latency to every /api/v1/* call, causing intermittent
    // Worker CPU-limit 503s. Now: when ctx is provided, hand the write to
    // ctx.waitUntil() so it runs after the response is sent; otherwise
    // detach without awaiting (best-effort — the runtime may drop it but
    // that's acceptable for a last_seen heartbeat).
    const now = nowMs();
    const touchPromise = env.DB
        .prepare(`UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?`)
        .bind(now, session_id)
        .run()
        .catch((e) => {
            console.error("auth.getSession touch threw", { error: String(e) });
        });
    if (ctx && typeof ctx.waitUntil === "function") {
        ctx.waitUntil(touchPromise);
    }
    // (else: promise runs in the background; we don't await it)

    return kvRecord
        ? { session_id, ...kvRecord }
        : {
            session_id,
            patient_id: row.patient_id,
            clinician_id: row.clinician_id,
            role: row.role,
            expires_at: row.expires_at,
        };
}

function constantTimeStringEq(a, b) {
    if (typeof a !== "string" || typeof b !== "string") return false;
    if (a.length !== b.length) return false;
    let m = 0;
    for (let i = 0; i < a.length; i++) m |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return m === 0;
}

/**
 * Revoke a session — explicit logout, admin revocation, or rotation.
 */
export async function revokeSession({ env, session_id, reason, actor_id, actor_role, request }) {
    const now = nowMs();
    await env.DB.prepare(`
        UPDATE auth_sessions
        SET revoked_at = ?, revocation_reason = ?
        WHERE id = ? AND revoked_at IS NULL
    `).bind(now, reason || "logout", session_id).run();
    try { await env.MZ_SESSIONS.delete(session_id); } catch (_) {}
    await logAudit(env, {
        user_id: actor_id,
        user_role: actor_role || "anonymous",
        action: "session_revoke",
        record_type: "session",
        record_id: session_id,
        ip: request?.headers?.get("CF-Connecting-IP") || "",
        user_agent: request?.headers?.get("User-Agent") || "",
        success: true,
        details: { reason: reason || "logout" },
    });
}

// ---------------------------------------------------------------------
// Magic-link tokens
// ---------------------------------------------------------------------

/**
 * Issue a magic-link token for a given email + purpose. Returns the raw
 * token (mail it to the user — never log it). Only the SHA-256 hash is
 * stored.
 */
export async function issueMagicLink({ env, email, patient_id, purpose, request }) {
    if (!email || !purpose) throw new Error("issueMagicLink: email + purpose required");
    const token_bytes = randomBytes(MAGIC_TOKEN_BYTES);
    const token = bytesToBase64Url(token_bytes);
    const token_hash = await sha256Base64Url(token);
    const now = nowMs();
    const expires_at = now + MAGIC_LINK_TTL_MS;
    const ip = request.headers.get("CF-Connecting-IP") || "";
    const ua = request.headers.get("User-Agent") || "";
    await env.DB.prepare(`
        INSERT INTO magic_link_tokens
            (token_hash, patient_id, email, purpose, issued_at, expires_at, ip, user_agent)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
        token_hash,
        patient_id || null,
        normalizeEmail(email),
        purpose,
        now,
        expires_at,
        ip,
        ua
    ).run();
    await logAudit(env, {
        user_id: patient_id,
        user_role: "anonymous",
        action: "magic_link_issue",
        record_type: "magic_link",
        record_id: token_hash.slice(0, 12),
        ip, user_agent: ua,
        success: true,
        details: { purpose, expires_at },
    });
    return { token, expires_at };
}

/**
 * Redeem a magic-link token. Returns { patient_id, email, purpose } on
 * success or null on failure (already used / expired / unknown).
 */
export async function redeemMagicLink({ env, token, request }) {
    if (!token) return null;
    const token_hash = await sha256Base64Url(token);
    const now = nowMs();
    const row = await env.DB.prepare(`
        SELECT patient_id, email, purpose, expires_at, consumed_at
        FROM magic_link_tokens
        WHERE token_hash = ?
    `).bind(token_hash).first();
    if (!row) {
        await logAudit(env, {
            user_role: "anonymous",
            action: "magic_link_redeem",
            record_type: "magic_link",
            record_id: token_hash.slice(0, 12),
            ip: request.headers.get("CF-Connecting-IP") || "",
            user_agent: request.headers.get("User-Agent") || "",
            success: false,
            details: { reason: "unknown_token" },
        });
        return null;
    }
    if (row.consumed_at) {
        await logAudit(env, {
            user_id: row.patient_id,
            user_role: "anonymous",
            action: "magic_link_redeem",
            record_type: "magic_link",
            record_id: token_hash.slice(0, 12),
            ip: request.headers.get("CF-Connecting-IP") || "",
            user_agent: request.headers.get("User-Agent") || "",
            success: false,
            details: { reason: "already_consumed" },
        });
        return null;
    }
    if (row.expires_at < now) {
        await logAudit(env, {
            user_id: row.patient_id,
            user_role: "anonymous",
            action: "magic_link_redeem",
            record_type: "magic_link",
            record_id: token_hash.slice(0, 12),
            ip: request.headers.get("CF-Connecting-IP") || "",
            user_agent: request.headers.get("User-Agent") || "",
            success: false,
            details: { reason: "expired" },
        });
        return null;
    }
    await env.DB.prepare(`UPDATE magic_link_tokens SET consumed_at = ? WHERE token_hash = ?`)
        .bind(now, token_hash).run();
    await logAudit(env, {
        user_id: row.patient_id,
        user_role: "anonymous",
        action: "magic_link_redeem",
        record_type: "magic_link",
        record_id: token_hash.slice(0, 12),
        ip: request.headers.get("CF-Connecting-IP") || "",
        user_agent: request.headers.get("User-Agent") || "",
        success: true,
        details: { purpose: row.purpose },
    });
    return { patient_id: row.patient_id, email: row.email, purpose: row.purpose };
}

// ---------------------------------------------------------------------
// requireRole — route guard
// ---------------------------------------------------------------------

/**
 * Pages Function helper. Reads the session cookie, resolves the session,
 * and either returns the session record or throws a Response (401/403).
 *
 * Usage in a route:
 *   export async function onRequest(ctx) {
 *       const session = await requireRole(ctx, ['clinician','staff']);
 *       // session.patient_id / session.clinician_id available
 *   }
 */
export async function requireRole(ctx, allowedRoles) {
    const { request, env } = ctx;
    const cookie = request.headers.get("Cookie") || "";
    const m = cookie.match(/(?:^|;\s*)mz_session=([^;]+)/);
    if (!m) throw unauthorized();
    const token = decodeURIComponent(m[1]);
    // Pass ctx through so getSession can hand its touch UPDATE to
    // ctx.waitUntil() — keeps the response path off the D1-write hot
    // path (was a key cause of intermittent 503s before 2026-05-20).
    const session = await getSession({ env, token, request, ctx });
    if (!session) throw unauthorized();
    if (allowedRoles && !allowedRoles.includes(session.role)) {
        // Audit role_check_fail off the response path — patient still
        // gets the 403 immediately.
        const auditPromise = logAudit(env, {
            user_id: session.patient_id || session.clinician_id,
            user_role: session.role,
            action: "role_check_fail",
            record_type: "session",
            record_id: session.session_id,
            ip: request.headers.get("CF-Connecting-IP") || "",
            user_agent: request.headers.get("User-Agent") || "",
            success: false,
            details: { allowed: allowedRoles, actual: session.role },
        });
        if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(auditPromise);
        throw forbidden();
    }
    return session;
}

/**
 * Soft-resolve a session WITHOUT throwing if absent. Returns the session
 * object when an mz_session cookie is present + valid AND (if allowedRoles
 * is given) the role matches; returns null otherwise.
 *
 * Use this for endpoints that should work for both authenticated patients
 * AND anonymous-with-preview-cookie users (e.g., beta-tester feedback
 * submitted before the patient has signed up). The endpoint can branch on
 * the return value rather than catching the requireRole-thrown Response.
 *
 * The token is exposed on the returned session so the caller can pass it
 * into session_trace's recordTrace() for correlation.
 */
export async function requireRoleOptional(ctx, allowedRoles) {
    const { request, env } = ctx;
    const cookie = request.headers.get("Cookie") || "";
    const m = cookie.match(/(?:^|;\s*)mz_session=([^;]+)/);
    if (!m) return null;
    const token = decodeURIComponent(m[1]);
    // Pass ctx through so getSession can hand its touch UPDATE to
    // ctx.waitUntil() — see requireRole for context.
    const session = await getSession({ env, token, request, ctx });
    if (!session) return null;
    if (allowedRoles && !allowedRoles.includes(session.role)) return null;
    // Surface the raw token so recordTrace() can hash + correlate it.
    return { ...session, token };
}

function unauthorized() {
    return new Response(JSON.stringify({ error: "authentication_required" }), {
        status: 401,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

function forbidden() {
    return new Response(JSON.stringify({ error: "insufficient_role" }), {
        status: 403,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

// ---------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------

export function buildSessionCookie(token, expires_at) {
    const expires = new Date(expires_at).toUTCString();
    return `mz_session=${encodeURIComponent(token)}; Path=/; Expires=${expires}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearSessionCookie() {
    return `mz_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax`;
}
