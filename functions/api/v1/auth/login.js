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
        await logAudit(env, {
            user_id: row?.id || null,
            user_role: "anonymous",
            action: "login_fail",
            record_type: "patient",
            record_id: row?.id || null,
            ip, user_agent: ua,
            success: false,
            details: { reason: row ? "wrong_password" : "no_such_email" },
        });
        return unauthorized();
    }

    if (row.status !== "active") {
        await logAudit(env, {
            user_id: row.id,
            user_role: "anonymous",
            action: "login_fail",
            record_type: "patient",
            record_id: row.id,
            ip, user_agent: ua,
            success: false,
            details: { reason: `status_${row.status}` },
        });
        return unauthorized();
    }

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
