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

// Phase 14 Round D — patients can self-edit nickname + care_goals + photo
// from /portal/profile/. The clinician's patient_personal_notes table is
// NOT exposed on the patient side; those stay clinician-only.
const ALLOWED_PATCH_STRINGS = new Set([
    "phone", "preferred_name", "pronouns", "preferred_language",
    "timezone", "nickname",
]);

const MAX_NICKNAME = 60;
const MAX_CARE_GOALS_BYTES = 8 * 1024;

function _validateCareGoals(value) {
    if (value === null || value === undefined) return null;
    if (typeof value !== "object") {
        throw new Error("care_goals must be a JSON object");
    }
    const safe = {
        goals: Array.isArray(value.goals) ? value.goals.map(String).slice(0, 20) : [],
        preferences: Array.isArray(value.preferences) ? value.preferences.map(String).slice(0, 20) : [],
        avoid: Array.isArray(value.avoid) ? value.avoid.map(String).slice(0, 20) : [],
        notes: typeof value.notes === "string" ? value.notes.slice(0, 1200) : "",
    };
    for (const k of ["goals", "preferences", "avoid"]) {
        safe[k] = safe[k].map((s) => String(s).slice(0, 240));
    }
    const encoded = JSON.stringify(safe);
    if (new TextEncoder().encode(encoded).length > MAX_CARE_GOALS_BYTES) {
        throw new Error(`care_goals_json exceeds ${MAX_CARE_GOALS_BYTES} bytes`);
    }
    return encoded;
}

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
               preferred_language, timezone, status, created_at,
               nickname, photo_r2_key, photo_uploaded_at,
               care_goals_json, care_goals_updated_at
        FROM patients WHERE id = ?
    `).bind(session.patient_id).first();

    if (!row) {
        return new Response(JSON.stringify({ error: "not_found" }), {
            status: 404, headers: { "content-type": "application/json" },
        });
    }

    // Hydrate care_goals_json + photo_url for the portal UI.
    let care_goals = null;
    if (row.care_goals_json) {
        try { care_goals = JSON.parse(row.care_goals_json); } catch { /* ignore parse */ }
    }
    const profile = {
        email: row.email,
        phone: row.phone,
        first_name: row.first_name,
        last_name: row.last_name,
        preferred_name: row.preferred_name,
        nickname: row.nickname || null,
        dob: row.dob,
        pronouns: row.pronouns,
        preferred_language: row.preferred_language,
        timezone: row.timezone,
        status: row.status,
        created_at: row.created_at,
        photo_url: row.photo_r2_key ? "/api/v1/patient/photo" : null,
        photo_uploaded_at: row.photo_uploaded_at || null,
        care_goals,
        care_goals_updated_at: row.care_goals_updated_at || null,
    };

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

    return new Response(JSON.stringify({ profile }), {
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
        if (!ALLOWED_PATCH_STRINGS.has(k)) continue;
        const v = body[k];
        if (v === null || v === undefined) { updates[k] = null; continue; }
        if (typeof v !== "string") return badRequest(`${k} must be a string`);
        const cap = (k === "nickname") ? MAX_NICKNAME : 200;
        updates[k] = v.trim().replace(/[<>]/g, "").slice(0, cap) || null;
    }

    // care_goals takes an object, not a string — handled separately and
    // stored as JSON with care_goals_updated_at = now() so the briefing
    // engine's "intake suggests update" rule can compare timestamps.
    let careGoalsUpdated = false;
    if (Object.prototype.hasOwnProperty.call(body, "care_goals")) {
        let encoded;
        try {
            encoded = body.care_goals === null ? null : _validateCareGoals(body.care_goals);
        } catch (e) {
            return badRequest(e.message);
        }
        updates.care_goals_json = encoded;
        updates.care_goals_updated_at = nowMs();
        careGoalsUpdated = true;
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
