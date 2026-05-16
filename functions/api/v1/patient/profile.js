// =====================================================================
// GET / PATCH /api/v1/patient/profile — own profile
// =====================================================================
// Patient reads and updates a small subset of their own profile fields
// (the ones that don't require chart review). Sensitive medical history
// flows through the intake endpoints, not here.
//
// GET returns: { email, phone, first_name, last_name, preferred_name,
//                dob, pronouns, preferred_language, timezone,
//                status, created_at }
//
// PATCH accepts (any subset): phone, preferred_name, pronouns,
//                              preferred_language, timezone
// Email + dob + names are NOT patient-editable here — those are
// identity fields and changes require clinician sign-off.
//
// Every successful PATCH writes a patient_update audit row with the
// changed field names (NOT the values — PHI-free per §4.4).
// =====================================================================

import { previewAccess, preLaunchNotFound } from "../../../_lib/preview_gate.js";
import { requireRole, nowMs } from "../../../_lib/auth.js";
import { logAudit } from "../../../_lib/audit.js";

const ALLOWED_PATCH = new Set(["phone", "preferred_name", "pronouns", "preferred_language", "timezone"]);

function badRequest(message) {
    return new Response(JSON.stringify({ error: "bad_request", message }), {
        status: 400,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

export async function onRequestGet(ctx) {
    const { request, env } = ctx;
    const { allow } = await previewAccess(request, env);
    if (!allow) return preLaunchNotFound();

    let session;
    try {
        session = await requireRole(ctx, ["patient"]);
    } catch (resp) {
        return resp;
    }
    if (!session.patient_id || !env.DB) {
        return new Response(JSON.stringify({ error: "server_error" }), {
            status: 500, headers: { "content-type": "application/json" },
        });
    }

    const row = await env.DB.prepare(`
        SELECT email, phone, first_name, last_name, preferred_name, dob, pronouns,
               preferred_language, timezone, status, created_at
        FROM patients WHERE id = ?
    `).bind(session.patient_id).first();

    if (!row) {
        return new Response(JSON.stringify({ error: "not_found" }), {
            status: 404, headers: { "content-type": "application/json" },
        });
    }

    await logAudit(env, {
        user_id: session.patient_id,
        user_role: "patient",
        action: "phi_read",
        record_type: "patient",
        record_id: session.patient_id,
        ip: request.headers.get("CF-Connecting-IP") || "",
        user_agent: request.headers.get("User-Agent") || "",
        success: true,
        details: { source: "/api/v1/patient/profile" },
    });

    return new Response(JSON.stringify({ profile: row }), {
        status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

export async function onRequestPatch(ctx) {
    const { request, env } = ctx;
    const { allow } = await previewAccess(request, env);
    if (!allow) return preLaunchNotFound();

    let session;
    try {
        session = await requireRole(ctx, ["patient"]);
    } catch (resp) {
        return resp;
    }
    if (!session.patient_id || !env.DB) {
        return new Response(JSON.stringify({ error: "server_error" }), { status: 500 });
    }

    let body;
    try { body = await request.json(); } catch { return badRequest("expected JSON"); }
    if (!body || typeof body !== "object") return badRequest("expected JSON object");

    const updates = {};
    for (const k of Object.keys(body)) {
        if (!ALLOWED_PATCH.has(k)) continue;
        const v = body[k];
        if (v === null || v === undefined) { updates[k] = null; continue; }
        if (typeof v !== "string") return badRequest(`${k} must be a string`);
        updates[k] = v.trim().slice(0, 200) || null;
    }
    const fields = Object.keys(updates);
    if (fields.length === 0) return badRequest("no editable fields supplied");

    const setSql = fields.map(f => `${f} = ?`).join(", ");
    const args = fields.map(f => updates[f]);
    args.push(nowMs());
    args.push(session.patient_id);

    try {
        await env.DB.prepare(
            `UPDATE patients SET ${setSql}, updated_at = ? WHERE id = ?`
        ).bind(...args).run();
    } catch (e) {
        console.error("profile PATCH DB.run threw", { error: String(e) });
        return new Response(JSON.stringify({ error: "server_error" }), { status: 500 });
    }

    await logAudit(env, {
        user_id: session.patient_id,
        user_role: "patient",
        action: "patient_update",
        record_type: "patient",
        record_id: session.patient_id,
        ip: request.headers.get("CF-Connecting-IP") || "",
        user_agent: request.headers.get("User-Agent") || "",
        success: true,
        details: { fields_changed: fields },
    });

    return new Response(JSON.stringify({ ok: true, fields_changed: fields }), {
        status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}
