// =====================================================================
// GET /api/v1/patient/intake/current — load latest intake + all sections
// =====================================================================
// Returns the patient's most recent intake (in_progress preferred,
// otherwise most recent submitted/reviewed), with every section's
// data_json payload de-stringified into a `sections` map keyed by
// section_number.
//
// Office Use Only (section 3) is filled by the clinician and is
// returned only to clinician role — patient calls won't see it.
//
// Response (patient):
//   {
//     intake: { id, status, started_at, submitted_at, completion_pct, locale },
//     sections: { "1": {...payload}, "2": {...}, "4": {...}, ... }
//   }
//   or null if no intake exists yet.
// =====================================================================

import { previewAccess, preLaunchNotFound } from "../../../../_lib/preview_gate.js";
import { requireRole } from "../../../../_lib/auth.js";
import { logAudit } from "../../../../_lib/audit.js";

export async function onRequestGet(ctx) {
    const { request, env } = ctx;
    const { allow } = await previewAccess(request, env);
    if (!allow) return preLaunchNotFound();

    let session;
    try { session = await requireRole(ctx, ["patient"]); }
    catch (resp) { return resp; }
    if (!session.patient_id || !env.DB) {
        return new Response(JSON.stringify({ error: "server_error" }), { status: 500 });
    }

    const ip = request.headers.get("CF-Connecting-IP") || "";
    const ua = request.headers.get("User-Agent") || "";

    // Prefer in_progress; fall back to most recent any status.
    let intake = await env.DB.prepare(`
        SELECT id, status, started_at, submitted_at, completion_pct, locale, updated_at
        FROM intake_responses
        WHERE patient_id = ? AND status = 'in_progress'
        ORDER BY started_at DESC LIMIT 1
    `).bind(session.patient_id).first();

    if (!intake) {
        intake = await env.DB.prepare(`
            SELECT id, status, started_at, submitted_at, completion_pct, locale, updated_at
            FROM intake_responses
            WHERE patient_id = ?
            ORDER BY started_at DESC LIMIT 1
        `).bind(session.patient_id).first();
    }

    if (!intake) {
        return new Response(JSON.stringify({ intake: null, sections: {} }), {
            status: 200,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
    }

    const sectionsRes = await env.DB.prepare(`
        SELECT section_number, section_key, data_json, last_updated_at
        FROM intake_section_data
        WHERE intake_id = ?
        ORDER BY section_number ASC
    `).bind(intake.id).all();

    const sections = {};
    for (const row of (sectionsRes?.results || [])) {
        // Section 3 (Office Use Only) is clinician-side; not returned to patient.
        if (Number(row.section_number) === 3) continue;
        let payload = null;
        try { payload = JSON.parse(row.data_json); } catch (_) { payload = null; }
        sections[row.section_number] = {
            section_key: row.section_key,
            last_updated_at: row.last_updated_at,
            data: payload,
        };
    }

    await logAudit(env, {
        user_id: session.patient_id,
        user_role: "patient",
        action: "phi_read",
        record_type: "intake",
        record_id: intake.id,
        ip, user_agent: ua,
        success: true,
        details: { source: "/api/v1/patient/intake/current" },
    });

    return new Response(JSON.stringify({ intake, sections }), {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}
