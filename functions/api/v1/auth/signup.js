// =====================================================================
// POST /api/v1/auth/signup — create a new patient account
// =====================================================================
// Per CLAUDE.md §11 Phase 1 + §11.5.2 preview gate.
//
// Body (JSON):
//   { email, password, first_name, last_name, dob, phone?, pronouns?,
//     preferred_language?, timezone? }
//
// Side effects:
//   * Inserts row in `patients` (PBKDF2-100k hashed password; per CF
//     Workers cap — §9.8.3).
//   * Creates auth_session, mirrors to KV, sets HttpOnly cookie.
//   * Writes audit_log rows for patient_create + session_create.
//
// Pre-launch (env.PORTAL_PUBLIC_LAUNCH != "true") the route requires
// admin Basic Auth — non-admin requests return 404 (we don't even
// acknowledge the endpoint exists).
// =====================================================================

import { previewAccess, preLaunchNotFound } from "../../../_lib/preview_gate.js";
import { hashPassword, createSession, buildSessionCookie, normalizeEmail, nowMs } from "../../../_lib/auth.js";
import { logAudit } from "../../../_lib/audit.js";
import { newId } from "../../../_lib/db.js";
import { recordTrace } from "../../../_lib/session_trace.js";

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

function badRequest(message, code) {
    return new Response(JSON.stringify({ error: code || "bad_request", message }), {
        status: 400,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

function serverError(message) {
    return new Response(JSON.stringify({ error: "server_error", message }), {
        status: 500,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

export async function onRequestPost(ctx) {
    const { request, env } = ctx;
    const _t0 = Date.now();
    const { allow } = await previewAccess(request, env);
    if (!allow) {
        await recordTrace(env, {
            request, action: "auth_signup_gate_closed",
            outcome: "blocked", http_status: 404, duration_ms: Date.now() - _t0,
        });
        return preLaunchNotFound();
    }

    if (!env.DB || !env.MZ_SESSIONS) {
        return serverError("auth backend not configured");
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return badRequest("expected JSON body");
    }

    const email = normalizeEmail(body?.email);
    const password = typeof body?.password === "string" ? body.password : "";
    const first_name = (body?.first_name || "").trim();
    const last_name = (body?.last_name || "").trim();
    const dob = (body?.dob || "").trim();
    const phone = (body?.phone || "").trim() || null;
    const pronouns = (body?.pronouns || "").trim() || null;
    const preferred_language = (body?.preferred_language || "en").trim();
    const timezone = (body?.timezone || "America/Chicago").trim();
    const preferred_name = (body?.preferred_name || "").trim() || null;

    // Validate
    const _failTrace = async (reason, code) => {
        await recordTrace(env, {
            request, action: "auth_signup_validation_fail",
            outcome: "validation_fail", http_status: 400,
            duration_ms: Date.now() - _t0,
            detail: { reason: code || reason },
        });
    };
    if (!EMAIL_RX.test(email)) { await _failTrace("invalid email", "invalid_email"); return badRequest("invalid email", "invalid_email"); }
    if (password.length < 12) { await _failTrace("password short", "weak_password"); return badRequest("password must be at least 12 characters", "weak_password"); }
    if (password.length > 256) { await _failTrace("password long", "weak_password"); return badRequest("password too long", "weak_password"); }
    if (!first_name) { await _failTrace("missing first name", "missing_first_name"); return badRequest("first name required", "missing_first_name"); }
    if (!last_name) { await _failTrace("missing last name", "missing_last_name"); return badRequest("last name required", "missing_last_name"); }
    if (!ISO_DATE_RX.test(dob)) { await _failTrace("invalid dob", "invalid_dob"); return badRequest("dob must be ISO YYYY-MM-DD", "invalid_dob"); }

    const ip = request.headers.get("CF-Connecting-IP") || "";
    const ua = request.headers.get("User-Agent") || "";

    // Reject duplicate email up front.
    const existing = await env.DB.prepare("SELECT id FROM patients WHERE email = ? LIMIT 1").bind(email).first();
    if (existing) {
        await logAudit(env, {
            user_role: "anonymous",
            action: "patient_create",
            record_type: "patient",
            record_id: existing.id,
            ip, user_agent: ua,
            success: false,
            details: { reason: "email_exists" },
        });
        await recordTrace(env, {
            request, action: "auth_signup_email_exists",
            outcome: "validation_fail", http_status: 409,
            duration_ms: Date.now() - _t0,
            detail: { existing_patient_id: existing.id },
        });
        return new Response(JSON.stringify({ error: "email_exists" }), {
            status: 409,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
    }

    let password_hash;
    try {
        password_hash = await hashPassword(password);
    } catch (e) {
        console.error("signup hashPassword threw", { error: String(e) });
        return serverError("password hashing failed");
    }

    const patient_id = newId();
    const now = nowMs();

    try {
        await env.DB.prepare(`
            INSERT INTO patients
                (id, email, phone, first_name, last_name, preferred_name, dob, pronouns,
                 preferred_language, timezone, password_hash, password_set_at,
                 status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
        `).bind(
            patient_id, email, phone, first_name, last_name, preferred_name, dob, pronouns,
            preferred_language, timezone, password_hash, now,
            now, now
        ).run();
    } catch (e) {
        console.error("signup DB.insert threw", { error: String(e) });
        await logAudit(env, {
            user_role: "anonymous",
            action: "patient_create",
            record_type: "patient",
            record_id: patient_id,
            ip, user_agent: ua,
            success: false,
            details: { reason: "db_insert_failed" },
        });
        return serverError("could not create account");
    }

    await logAudit(env, {
        user_id: patient_id,
        user_role: "patient",
        action: "patient_create",
        record_type: "patient",
        record_id: patient_id,
        ip, user_agent: ua,
        success: true,
        details: { signup_source: "portal" },
    });

    // Issue session.
    let session;
    try {
        session = await createSession({
            env, patient_id, role: "patient", request,
        });
    } catch (e) {
        console.error("signup createSession threw", { error: String(e) });
        return serverError("session creation failed");
    }

    await logAudit(env, {
        user_id: patient_id,
        user_role: "patient",
        action: "login_success",
        record_type: "session",
        record_id: session.session_id,
        ip, user_agent: ua,
        success: true,
        details: { source: "signup" },
    });

    await recordTrace(env, {
        request,
        patient_id,
        session_token: session.token,
        action: "auth_signup_success",
        outcome: "ok", http_status: 201,
        duration_ms: Date.now() - _t0,
        detail: { has_phone: !!phone, has_preferred_name: !!preferred_name, has_pronouns: !!pronouns },
    });

    const cookie = buildSessionCookie(session.token, session.expires_at);
    return new Response(JSON.stringify({
        ok: true,
        patient_id,
        email,
        expires_at: session.expires_at,
    }), {
        status: 201,
        headers: {
            "content-type": "application/json",
            "set-cookie": cookie,
            "cache-control": "no-store",
        },
    });
}
