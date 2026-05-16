// =====================================================================
// GET /api/v1/patient/triage/current — the patient's most recent triage
// =====================================================================
// Per CLAUDE.md §11.7.4 Patient-Facing Booking Flow. The patient lands on
// /portal/appointments/book and needs to know the AI's categorization
// (transparent to them per §11.7.4 step 1).
//
// Returns:
//   - The most recent released triage row for the authenticated patient
//     (clinician_reviewed_at IS NOT NULL), if any. This is the row that
//     drives slot filtering on the booking page.
//   - If no released row exists but a pending one does, returns it with
//     status='pending_review' and an `auto_release_eta_ms` so the page
//     can show a "Awaiting clinician review" state with countdown.
//   - 404 with code 'no_triage' if neither — patient hasn't completed
//     an intake yet (route them to /portal/intake/new).
//
// PHI safety: only fields the patient's own UI needs are returned. The
// AI rationale + secondary concerns are surfaced because they are the
// patient's own data and §11.7.4 explicitly requires the UI to display
// them transparently. The `ai_prompt_version` field is omitted (internal
// audit metadata).
// =====================================================================

import { previewAccess, preLaunchNotFound } from "../../../../_lib/preview_gate.js";
import { requireRole } from "../../../../_lib/auth.js";

const AUTO_RELEASE_THRESHOLD_MS = 4 * 60 * 60 * 1000; // 4 h

function err(status, code, message) {
    return new Response(JSON.stringify({ error: code, message }), {
        status,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

function shapeForPatient(r, statusLabel, etaMs) {
    if (!r) return null;
    let secondary = [];
    try { secondary = JSON.parse(r.ai_secondary_concerns_json || "[]"); } catch {}
    // Use the final_* fields if released; else fall back to AI's choice.
    const visit_type = r.final_visit_type || r.clinician_override_visit_type || r.ai_visit_type;
    const duration_min = r.final_duration_min || r.clinician_override_duration_min || r.ai_duration_min;
    return {
        id: r.id,
        intake_id: r.intake_id,
        status: statusLabel,                          // 'released' | 'pending_review' | 'manual_review_required'
        visit_type,
        duration_min,
        urgency: r.ai_urgency,                        // overrides not stored in a column; AI urgency is the floor
        in_person_required: !!r.ai_in_person_required,
        preferred_time_of_day: r.ai_preferred_time_of_day,
        rationale: r.ai_rationale || null,
        secondary_concerns: Array.isArray(secondary) ? secondary : [],
        ai_visit_type: r.ai_visit_type,               // shown to patient verbatim per §11.7.4
        ai_duration_min: r.ai_duration_min,
        was_overridden_by_clinician: !!r.clinician_override_visit_type || !!r.clinician_override_duration_min,
        override_reason: r.clinician_override_reason || null,
        triage_created_at: r.created_at,
        intake_submitted_at: r.intake_submitted_at,
        clinician_reviewed_at: r.clinician_reviewed_at,
        auto_release_eta_ms: etaMs,
    };
}

export async function onRequestGet(ctx) {
    const { request, env } = ctx;
    const { allow } = await previewAccess(request, env);
    if (!allow) return preLaunchNotFound();

    let session;
    try { session = await requireRole(ctx, ["patient"]); }
    catch (resp) { return resp; }
    if (!session.patient_id || !env.DB) {
        return err(500, "server_error", "DB not bound");
    }

    // Most recent released row first.
    const released = await env.DB.prepare(`
        SELECT t.id, t.intake_id, t.patient_id,
               t.ai_visit_type, t.ai_duration_min, t.ai_urgency,
               t.ai_in_person_required, t.ai_preferred_time_of_day,
               t.ai_rationale, t.ai_secondary_concerns_json,
               t.clinician_override_visit_type, t.clinician_override_duration_min,
               t.clinician_override_reason, t.clinician_reviewed_at,
               t.final_visit_type, t.final_duration_min,
               t.created_at,
               ir.submitted_at AS intake_submitted_at
        FROM appointment_triage t
        LEFT JOIN intake_responses ir ON ir.id = t.intake_id
        WHERE t.patient_id = ? AND t.clinician_reviewed_at IS NOT NULL
        ORDER BY t.created_at DESC
        LIMIT 1
    `).bind(session.patient_id).first();

    if (released) {
        return new Response(JSON.stringify({ triage: shapeForPatient(released, "released", null) }), {
            status: 200,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
    }

    // No released row — return pending if any, else 404.
    const pending = await env.DB.prepare(`
        SELECT t.id, t.intake_id, t.patient_id,
               t.ai_visit_type, t.ai_duration_min, t.ai_urgency,
               t.ai_in_person_required, t.ai_preferred_time_of_day,
               t.ai_rationale, t.ai_secondary_concerns_json,
               t.clinician_override_visit_type, t.clinician_override_duration_min,
               t.clinician_override_reason, t.clinician_reviewed_at,
               t.final_visit_type, t.final_duration_min,
               t.created_at,
               ir.submitted_at AS intake_submitted_at
        FROM appointment_triage t
        LEFT JOIN intake_responses ir ON ir.id = t.intake_id
        WHERE t.patient_id = ? AND t.clinician_reviewed_at IS NULL
        ORDER BY t.created_at DESC
        LIMIT 1
    `).bind(session.patient_id).first();

    if (!pending) return err(404, "no_triage", "Submit an intake first.");

    const isManualReview = pending.ai_visit_type === "manual_review_required";
    const status = isManualReview ? "manual_review_required" : "pending_review";
    const etaMs = (pending.created_at || Date.now()) + AUTO_RELEASE_THRESHOLD_MS;
    return new Response(JSON.stringify({ triage: shapeForPatient(pending, status, etaMs) }), {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}
