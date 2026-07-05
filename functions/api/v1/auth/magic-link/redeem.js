// =====================================================================
// POST /api/v1/auth/magic-link/redeem — exchange a token for a session
// =====================================================================
// Body (JSON): { token }
//
// Flow:
//   1. Call redeemMagicLink (functions/_lib/auth.js) which verifies the
//      SHA-256 hash of the submitted token against magic_link_tokens,
//      checks not-consumed + not-expired, and marks consumed.
//   2. On success — if purpose === 'login' and patient_id is set —
//      create a fresh session for that patient and set the cookie.
//   3. Audit-log login_success with source=magic_link.
// =====================================================================

import { previewAccess, preLaunchNotFound } from "../../../../_lib/preview_gate.js";
import { redeemMagicLink, createSession, buildSessionCookie } from "../../../../_lib/auth.js";
import { logAudit } from "../../../../_lib/audit.js";
import { checkLockout, recordFailure, clearLockout, tooManyRequests } from "../../../../_lib/rate_limit.js";

// Same soft-lockout policy as password login: 10 failed redeems per IP
// per 15 min. Keyed by IP alone (a redeem carries no email); a
// successful redeem clears the counter so a legitimate member who
// fumbled a stale link isn't shadowed.
const RL_THRESHOLD = 10;
const RL_WINDOW_SECONDS = 15 * 60;

function unauthorized(reason) {
    return new Response(JSON.stringify({ error: "invalid_token", reason }), {
        status: 401,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

export async function onRequestPost(ctx) {
    const { request, env } = ctx;
    const { allow } = await previewAccess(request, env);
    if (!allow) return preLaunchNotFound();

    if (!env.DB || !env.MZ_SESSIONS) {
        return new Response(JSON.stringify({ error: "server_error" }), { status: 500 });
    }

    let body;
    try { body = await request.json(); } catch {
        return new Response(JSON.stringify({ error: "bad_request" }), {
            status: 400, headers: { "content-type": "application/json" },
        });
    }
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    if (!token) return unauthorized("missing_token");

    const ip = request.headers.get("CF-Connecting-IP") || "";
    const ua = request.headers.get("User-Agent") || "";

    const lock = await checkLockout({
        env, prefix: "magic_redeem", identifier: ip || "unknown",
        threshold: RL_THRESHOLD, windowSeconds: RL_WINDOW_SECONDS,
    });
    if (lock.locked) return tooManyRequests(lock.retry_after_seconds);

    let redeemed;
    try {
        redeemed = await redeemMagicLink({ env, token, request });
    } catch (e) {
        console.error("magic-link redeem threw", { error: String(e) });
        return unauthorized("redeem_threw");
    }
    if (!redeemed || !redeemed.patient_id || redeemed.purpose !== "login") {
        await recordFailure({
            env, prefix: "magic_redeem", identifier: ip || "unknown",
            threshold: RL_THRESHOLD, windowSeconds: RL_WINDOW_SECONDS,
        });
        return unauthorized("invalid_or_expired");
    }
    await clearLockout({ env, prefix: "magic_redeem", identifier: ip || "unknown" });

    // Confirm patient is still active.
    const patient = await env.DB.prepare(
        "SELECT id, status FROM patients WHERE id = ? LIMIT 1"
    ).bind(redeemed.patient_id).first();
    if (!patient || patient.status !== "active") {
        return unauthorized("patient_inactive");
    }

    let session;
    try {
        session = await createSession({
            env, patient_id: patient.id, role: "patient", request,
        });
    } catch (e) {
        console.error("magic-link redeem createSession threw", { error: String(e) });
        return new Response(JSON.stringify({ error: "server_error" }), { status: 500 });
    }

    await logAudit(env, {
        user_id: patient.id,
        user_role: "patient",
        action: "login_success",
        record_type: "session",
        record_id: session.session_id,
        ip, user_agent: ua,
        success: true,
        details: { source: "magic_link" },
    });

    const cookie = buildSessionCookie(session.token, session.expires_at);
    return new Response(JSON.stringify({
        ok: true,
        patient_id: patient.id,
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
