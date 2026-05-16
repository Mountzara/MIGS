// =====================================================================
// POST /api/v1/auth/login — authenticate an existing patient
// =====================================================================
// Body (JSON): { email, password }
//
// On success: 200, sets HttpOnly session cookie, audit_log login_success.
// On failure: 401, audit_log login_fail (with reason). Same response for
// "no such patient" and "wrong password" — never reveal which.
// =====================================================================

import { previewAccess, preLaunchNotFound } from "../../../_lib/preview_gate.js";
import { verifyPassword, createSession, buildSessionCookie, normalizeEmail } from "../../../_lib/auth.js";
import { logAudit } from "../../../_lib/audit.js";
import { checkLockout, recordFailure, clearLockout, tooManyRequests } from "../../../_lib/rate_limit.js";

// Per HIPAA risk register row 5. 10 failures per 15-min window
// triggers a soft-lockout for the remainder of that window.
const RL_THRESHOLD = 10;
const RL_WINDOW_SECONDS = 15 * 60;

function badRequest(message) {
    return new Response(JSON.stringify({ error: "bad_request", message }), {
        status: 400,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

function unauthorized() {
    return new Response(JSON.stringify({ error: "invalid_credentials" }), {
        status: 401,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

export async function onRequestPost(ctx) {
    const { request, env } = ctx;
    const { allow } = await previewAccess(request, env);
    if (!allow) return preLaunchNotFound();

    if (!env.DB || !env.MZ_SESSIONS) {
        return new Response(JSON.stringify({ error: "server_error" }), {
            status: 500, headers: { "content-type": "application/json" },
        });
    }

    let body;
    try { body = await request.json(); } catch { return badRequest("expected JSON body"); }
    const email = normalizeEmail(body?.email);
    const password = typeof body?.password === "string" ? body.password : "";
    if (!email || !password) return badRequest("email and password required");

    const ip = request.headers.get("CF-Connecting-IP") || "";
    const ua = request.headers.get("User-Agent") || "";

    // Rate-limit by (email + ip) — combined identifier means a per-account
    // brute force throttles AND a per-IP credential-stuffing run throttles.
    const rlIdentifier = `${email}|${ip}`;
    const lock = await checkLockout({
        env, prefix: "login", identifier: rlIdentifier,
        threshold: RL_THRESHOLD, windowSeconds: RL_WINDOW_SECONDS,
    });
    if (lock.locked) {
        await logAudit(env, {
            user_id: null, user_role: "anonymous",
            action: "login_fail",
            record_type: "patient",
            ip, user_agent: ua, success: false,
            details: { reason: "rate_limited", fails: lock.fails, retry_after_seconds: lock.retry_after_seconds },
        });
        return tooManyRequests(lock.retry_after_seconds);
    }

    const row = await env.DB.prepare(
        "SELECT id, password_hash, status FROM patients WHERE email = ? LIMIT 1"
    ).bind(email).first();

    // Always run a PBKDF2 verify to keep timing roughly constant whether
    // the email exists or not — defense against email enumeration via
    // response timing. Use a known stable dummy hash so the work is real.
    const dummy = "pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    const ok = row
        ? await verifyPassword(password, row.password_hash || dummy)
        : await verifyPassword(password, dummy).then(() => false);

    if (!row || !ok) {
        const fr = await recordFailure({
            env, prefix: "login", identifier: rlIdentifier,
            threshold: RL_THRESHOLD, windowSeconds: RL_WINDOW_SECONDS,
        });
        await logAudit(env, {
            user_id: row?.id || null,
            user_role: "anonymous",
            action: "login_fail",
            record_type: "patient",
            record_id: row?.id || null,
            ip, user_agent: ua,
            success: false,
            details: {
                reason: row ? "wrong_password" : "no_such_email",
                fails: fr.fails,
                locked_after_this: fr.locked_after_this,
            },
        });
        // If THIS failure triggers the lockout, return 429 instead of 401
        // so the attacker sees the soft-lockout immediately on attempt #10.
        if (fr.locked_after_this) {
            return tooManyRequests(RL_WINDOW_SECONDS);
        }
        return unauthorized();
    }

    if (row.status !== "active") {
        const fr = await recordFailure({
            env, prefix: "login", identifier: rlIdentifier,
            threshold: RL_THRESHOLD, windowSeconds: RL_WINDOW_SECONDS,
        });
        await logAudit(env, {
            user_id: row.id,
            user_role: "anonymous",
            action: "login_fail",
            record_type: "patient",
            record_id: row.id,
            ip, user_agent: ua,
            success: false,
            details: { reason: `status_${row.status}`, fails: fr.fails },
        });
        return unauthorized();
    }

    // Successful auth — clear any accumulated failure count.
    await clearLockout({ env, prefix: "login", identifier: rlIdentifier });

    let session;
    try {
        session = await createSession({ env, patient_id: row.id, role: "patient", request });
    } catch (e) {
        console.error("login createSession threw", { error: String(e) });
        return new Response(JSON.stringify({ error: "server_error" }), {
            status: 500, headers: { "content-type": "application/json" },
        });
    }

    await logAudit(env, {
        user_id: row.id,
        user_role: "patient",
        action: "login_success",
        record_type: "session",
        record_id: session.session_id,
        ip, user_agent: ua,
        success: true,
        details: { source: "password" },
    });

    const cookie = buildSessionCookie(session.token, session.expires_at);
    return new Response(JSON.stringify({
        ok: true,
        patient_id: row.id,
        expires_at: session.expires_at,
    }), {
        status: 200,
        headers: {
            "content-type": "application/json",
            "set-cookie": cookie,
            "cache-control": "no-store",
        },
    });
}
