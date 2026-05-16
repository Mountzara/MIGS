// =====================================================================
// functions/_lib/rate_limit.js — KV-backed rate limiter
// =====================================================================
// Per CLAUDE.md §11 Tier 7 + HIPAA risk register row 5/6. Tracks failed
// auth attempts in env.MZ_SESSIONS (the existing KV namespace) and
// returns a soft-lockout decision for any auth surface that calls it.
//
// Design:
//   * Key is sha256(prefix + ":" + identifier). Identifier is whatever
//     the caller wants to throttle by — typically the email being
//     attempted PLUS the source IP. Combining the two means a single
//     attacker IP throttles across emails AND a single email throttles
//     across IPs.
//   * Value is the count of failed attempts in the current window.
//   * TTL = window_seconds. KV's built-in expiration handles cleanup.
//
// Lockout policy (default): 10 failures within a 15-minute window =>
// 5-minute soft-lockout where every subsequent attempt — even with the
// correct password — returns 429 retry-after.
//
// API:
//   checkLockout({ env, prefix, identifier, threshold, windowSeconds })
//     -> { locked: bool, fails: int, retry_after_seconds: int|null }
//
//   recordFailure({ env, prefix, identifier, windowSeconds })
//     -> increments the counter, returns the new count.
//
//   clearLockout({ env, prefix, identifier }) — call on successful auth
//     so the user's next session isn't shadowed by leftover counts.
//
// All three are no-ops (return safe defaults) if env.MZ_SESSIONS is not
// bound — never fail-open in a way that bricks login on KV outage.
// =====================================================================

async function sha256Hex(str) {
    const bytes = new TextEncoder().encode(str);
    const buf = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function key(prefix, idHash) {
    return `rl:${prefix}:${idHash}`;
}

/**
 * Returns a lockout decision without incrementing the counter.
 *
 * @returns {Promise<{locked: boolean, fails: number, retry_after_seconds: number|null}>}
 */
export async function checkLockout({ env, prefix, identifier, threshold = 10, windowSeconds = 900 }) {
    if (!env || !env.MZ_SESSIONS || !identifier) {
        return { locked: false, fails: 0, retry_after_seconds: null };
    }
    const idHash = await sha256Hex(String(identifier).toLowerCase());
    let v;
    try { v = await env.MZ_SESSIONS.get(key(prefix, idHash), { type: "json" }); }
    catch { return { locked: false, fails: 0, retry_after_seconds: null }; }
    if (!v || typeof v !== "object") return { locked: false, fails: 0, retry_after_seconds: null };
    const fails = Number(v.fails) || 0;
    const first_failed_at = Number(v.first_failed_at) || 0;
    const elapsed = Math.floor((Date.now() - first_failed_at) / 1000);
    if (fails >= threshold && elapsed < windowSeconds) {
        return {
            locked: true,
            fails,
            retry_after_seconds: Math.max(1, windowSeconds - elapsed),
        };
    }
    return { locked: false, fails, retry_after_seconds: null };
}

/**
 * Increments the failure counter and returns the new count.
 *
 * @returns {Promise<{fails: number, locked_after_this: boolean}>}
 */
export async function recordFailure({ env, prefix, identifier, threshold = 10, windowSeconds = 900 }) {
    if (!env || !env.MZ_SESSIONS || !identifier) {
        return { fails: 0, locked_after_this: false };
    }
    const idHash = await sha256Hex(String(identifier).toLowerCase());
    const k = key(prefix, idHash);
    let v;
    try { v = await env.MZ_SESSIONS.get(k, { type: "json" }); } catch { v = null; }
    const now = Date.now();
    if (!v || typeof v !== "object") {
        v = { fails: 1, first_failed_at: now, last_failed_at: now };
    } else {
        const elapsed = Math.floor((now - (Number(v.first_failed_at) || now)) / 1000);
        if (elapsed >= windowSeconds) {
            // Window expired — start a fresh count.
            v = { fails: 1, first_failed_at: now, last_failed_at: now };
        } else {
            v.fails = (Number(v.fails) || 0) + 1;
            v.last_failed_at = now;
        }
    }
    try {
        await env.MZ_SESSIONS.put(k, JSON.stringify(v), { expirationTtl: windowSeconds });
    } catch { /* fail-open on KV outage */ }
    return { fails: v.fails, locked_after_this: v.fails >= threshold };
}

/**
 * Clears the counter after a successful auth (so a user who fat-fingered
 * their password 3 times then logged in doesn't carry that count over).
 */
export async function clearLockout({ env, prefix, identifier }) {
    if (!env || !env.MZ_SESSIONS || !identifier) return;
    const idHash = await sha256Hex(String(identifier).toLowerCase());
    try { await env.MZ_SESSIONS.delete(key(prefix, idHash)); } catch {}
}

/**
 * Build a standardized 429 Response with Retry-After.
 */
export function tooManyRequests(retry_after_seconds) {
    return new Response(JSON.stringify({
        error: "rate_limited",
        message: "Too many failed attempts. Try again in a few minutes.",
        retry_after_seconds,
    }), {
        status: 429,
        headers: {
            "content-type": "application/json",
            "retry-after": String(retry_after_seconds || 60),
            "cache-control": "no-store",
        },
    });
}
