// =====================================================================
// GET /api/v1/patient/appointments/<id> — Phase 18 Sprint 2
// =====================================================================
// Patient-facing single-appointment read. Created 2026-06-10: the R4
// launch interstitial has fetched this URL since 2026-05-28 as its
// "best-effort appointment lookup", but the endpoint never existed —
// the fetch fell through to the marketing homepage and the page
// silently used its fallback label. The R7 proactive countdown needs
// the appointment's starts_at, which made the gap visible.
//
// Returns only the patient's OWN appointment, and deliberately does NOT
// include doxy_room_url — the room URL is released exclusively by the
// attestation-gated launch endpoint (R4 rule).
// =====================================================================

import { previewAccess, preLaunchNotFound } from "../../../../../_lib/preview_gate.js";
import { requireRole } from "../../../../../_lib/auth.js";
import { getVisitType } from "../../../../../_lib/visit_types.js";

function jerr(status, code, message) {
    return new Response(JSON.stringify({ error: code, message }), {
        status,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

export async function onRequestGet(ctx) {
    const { request, env, params } = ctx;
    const { allow } = await previewAccess(request, env);
    if (!allow) return preLaunchNotFound();

    let session;
    try { session = await requireRole(ctx, ["patient"]); }
    catch (resp) { return resp; }
    if (!session.patient_id || !env.DB) return jerr(500, "server_error", "DB not bound");

    const appointment_id = String(params?.id || "").trim();
    if (!appointment_id) return jerr(400, "invalid_id", "Appointment id required.");

    const appt = await env.DB.prepare(`
        SELECT id, patient_id, visit_type, starts_at, ends_at, duration_min,
               modality, status, chief_complaint_summary, created_at
        FROM appointments
        WHERE id = ? AND patient_id = ?
    `).bind(appointment_id, session.patient_id).first();
    if (!appt) return jerr(404, "appointment_not_found", "Appointment not found.");

    const vt = getVisitType(appt.visit_type);
    return new Response(JSON.stringify({
        appointment: {
            id: appt.id,
            visit_type: appt.visit_type,
            visit_type_label: vt ? vt.label : appt.visit_type,
            starts_at: appt.starts_at,
            ends_at: appt.ends_at,
            duration_min: appt.duration_min,
            modality: appt.modality,
            status: appt.status,
            chief_complaint_summary: appt.chief_complaint_summary,
        },
    }), {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}
