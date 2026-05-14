// HTTP Basic Auth gate for /admin/*
// --------------------------------------------------------------------
// Protects the entire admin dashboard at the Cloudflare edge. Until a
// valid Authorization: Basic <base64> header is presented, every /admin/*
// request returns 401 with WWW-Authenticate, which makes the browser show
// its native login prompt.
//
// Encryption / hardening notes:
//   - Credentials travel from browser → edge over TLS 1.3 (Cloudflare).
//   - The password is NOT stored in plaintext on Cloudflare. The
//     ADMIN_PASS_HASH secret holds a PBKDF2-HMAC-SHA-256 hash with a
//     per-user random salt and 200,000 iterations, encoded as:
//       "pbkdf2$<iterations>$<base64-salt>$<base64-hash>"
//     Submitted passwords are hashed with the same salt+iterations and
//     compared in constant time. Compromise of the Cloudflare secret
//     leaks the hash, not the password.
//   - Cloudflare Pages secrets are themselves encrypted at rest by
//     Cloudflare's KMS; the hash adds defense-in-depth.
//
// Once authenticated, the browser caches the credentials for the domain
// and re-sends them on every subsequent /admin/* request AND every
// fetch() the admin SPA makes back to /api/posts (same origin) — so the
// API's isAdminRequest() check (which also verifies Basic auth via the
// same PBKDF2 routine) continues to work without the SPA managing tokens.

function unauthorized(reason) {
    return new Response(reason || "Authorization required", {
        status: 401,
        headers: {
            "WWW-Authenticate": 'Basic realm="Mount Zara Admin", charset="UTF-8"',
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-store",
        },
    });
}

function safeStringEq(a, b) {
    if (typeof a !== "string" || typeof b !== "string") return false;
    if (a.length !== b.length) return false;
    let mismatch = 0;
    for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return mismatch === 0;
}

function safeBytesEq(a, b) {
    if (a.length !== b.length) return false;
    let mismatch = 0;
    for (let i = 0; i < a.length; i++) mismatch |= a[i] ^ b[i];
    return mismatch === 0;
}

function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

// PBKDF2-HMAC-SHA-256 password verification.
//   stored format: "pbkdf2$<iterations>$<base64-salt>$<base64-hash>"
export async function verifyPbkdf2(password, stored) {
    if (typeof stored !== "string") return false;
    const parts = stored.split("$");
    if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
    const iterations = parseInt(parts[1], 10);
    if (!Number.isFinite(iterations) || iterations < 10000) return false;
    let salt, expected;
    try {
        salt = b64ToBytes(parts[2]);
        expected = b64ToBytes(parts[3]);
    } catch {
        return false;
    }
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
    return safeBytesEq(new Uint8Array(bits), expected);
}

export async function onRequest({ request, env, next }) {
    // Defense-in-depth: wrap the entire auth gate in try/catch so a rejected
    // WebCrypto promise (e.g. crypto.subtle.deriveBits rejecting on malformed
    // hash bytes or hitting a platform CPU/edge-state issue) NEVER becomes an
    // uncaught throw. An uncaught throw inside a Pages Function surfaces to
    // the browser as Cloudflare Error 1101 ("Worker threw exception") which
    // looks identical to a site outage. We'd rather degrade to a clean 401
    // (the visitor sees "Invalid credentials") and log the exception for the
    // operator. Per CLAUDE.md §4.4, log every caught exception with module
    // context, the cause, and the recovery action.
    try {
        if (!env.ADMIN_PASS_HASH) {
            return new Response(
                "Admin backend not configured: ADMIN_PASS_HASH Cloudflare Pages secret is missing.",
                { status: 500, headers: { "content-type": "text/plain" } }
            );
        }

        const authHeader = request.headers.get("Authorization") || "";
        if (!authHeader.startsWith("Basic ")) {
            return unauthorized();
        }

        let decoded;
        try {
            decoded = atob(authHeader.slice(6));
        } catch {
            return unauthorized("Invalid credentials encoding");
        }

        const sep = decoded.indexOf(":");
        if (sep < 0) return unauthorized("Invalid credentials format");
        const user = decoded.slice(0, sep);
        const pass = decoded.slice(sep + 1);

        // Email-address comparison is case-insensitive (RFC 5321 §2.3.11
        // for the domain part; Gmail and every other major provider treats
        // the local part case-insensitively too) — and iOS/Safari
        // autocapitalize the first letter of the email field on the login
        // prompt, which is why submitted credentials with the right
        // password but a capitalized email kept getting rejected. Normalize
        // both sides (trim whitespace from autofill, lowercase) before the
        // constant-time compare. Password comparison stays exact-case via
        // the PBKDF2 hash check below.
        const expectedUser = (env.ADMIN_USER || "admin").trim().toLowerCase();
        const submittedUser = user.trim().toLowerCase();
        if (!safeStringEq(submittedUser, expectedUser)) return unauthorized("Invalid credentials");

        let ok = false;
        try {
            ok = await verifyPbkdf2(pass, env.ADMIN_PASS_HASH);
        } catch (e) {
            // Most likely cause: malformed stored hash (e.g. trailing newline
            // in the Cloudflare secret) or transient WebCrypto rejection.
            // Either way we surface 401 to the browser and a structured log
            // line to wrangler tail. Never bubble — that becomes Error 1101.
            console.error("admin._middleware verifyPbkdf2 threw", {
                module: "admin/_middleware",
                op: "verifyPbkdf2",
                error: e && e.message ? e.message : String(e),
                hash_present: !!env.ADMIN_PASS_HASH,
                hash_prefix: env.ADMIN_PASS_HASH ? env.ADMIN_PASS_HASH.slice(0, 8) : null,
                hash_parts: env.ADMIN_PASS_HASH ? env.ADMIN_PASS_HASH.split("$").length : 0,
                recovery: "respond 401",
            });
            return unauthorized("Invalid credentials");
        }
        if (!ok) return unauthorized("Invalid credentials");

        // Authenticated. Pass through to the static /admin/ file.
        return next();
    } catch (e) {
        // Last-resort safety net for ANY unanticipated throw above.
        console.error("admin._middleware top-level threw", {
            module: "admin/_middleware",
            op: "onRequest",
            error: e && e.message ? e.message : String(e),
            recovery: "respond 401",
        });
        return unauthorized("Invalid credentials");
    }
}
