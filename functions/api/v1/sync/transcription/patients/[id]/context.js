// =====================================================================
// GET /api/v1/sync/transcription/patients/:id/context — full patient
// context for the Transcription app to seed SOAP / coding / snapshot AI.
// =====================================================================
// Phase 9. Called by the MountZaraMedicalTranscription app after
// /patients?since=... returns a patient_id. Bundles every piece of
// website-side context the app needs to start a new SOAP encounter
// pre-loaded:
//   • Demographics (name, DOB, sex, contact)
//   • Latest 19-section intake (per §11.6)
//   • Active medications (parsed from intake current_medications)
//   • Allergies
//   • Family GYN history flags
//   • ERAS perioperative section (critical: GLP-1 last dose, anticoag, etc.)
//   • Mental-health screen (PHQ-2 + surgical anxiety)
//   • Social determinants of health
//   • Recent (90 days) symptom-diary entries with trend stats
//   • Active triage categorization (if appointment scheduled)
//   • Prior encounters list (visit_date, type, em_code, chief_complaint)
//   • Latest snapshot version_number on file (if any) — so the app can
//     compare and decide whether to regenerate
//
// This endpoint also UPDATES patient_sync_state.last_pulled_at so the
// /patients?since=... endpoint knows the app has caught up.
//
// Response (200): { ok: true, context: { ... } }
// Auth: Bearer TRANSCRIPTION_SYNC_TOKEN.
// =====================================================================

import { syncRoute, syncJson, syncError } from "../../../../../../_lib/sync_auth.js";

const APP = "transcription";

function safeJson(s) {
    if (!s || typeof s !== "string") return null;
    try { return JSON.parse(s); } catch { return null; }
}

export async function onRequestGet(ctx) {
    return syncRoute(ctx, APP, async ({ env, params, request }) => {
        const patient_id = params && params.id ? String(params.id) : "";
        if (!patient_id) return syncError("missing_patient_id", 400);

        // Patient core.
        const patient = await env.DB.prepare(`
            SELECT id, first_name, last_name, preferred_name, email, phone,
                   date_of_birth, sex, gender_identity, pronouns,
                   address_line1, address_line2, city, state_code, zip,
                   emergency_contact_name, emergency_contact_phone,
                   created_at, updated_at
            FROM patients
            WHERE id = ?
        `).bind(patient_id).first();
        if (!patient) return syncError("patient_not_found", 404);

        // Latest submitted intake.
        const intakeHead = await env.DB.prepare(`
            SELECT id, status, started_at, submitted_at, completion_pct, updated_at
            FROM intake_responses
            WHERE patient_id = ? AND status = 'submitted'
            ORDER BY submitted_at DESC
            LIMIT 1
        `).bind(patient_id).first();

        let intakeSections = [];
        let intake_id = null;
        if (intakeHead) {
            intake_id = intakeHead.id;
            const sectionsR = await env.DB.prepare(`
                SELECT section_number, section_key, data_json, updated_at
                FROM intake_section_data
                WHERE intake_response_id = ?
                ORDER BY section_number ASC
            `).bind(intake_id).all();
            intakeSections = (sectionsR.results || []).map((row) => ({
                section_number: row.section_number,
                section_key: row.section_key,
                data: safeJson(row.data_json),
                updated_at: row.updated_at,
            }));
        }

        // Symptom diary — last 90 days.
        const ninetyAgo = new Date(Date.now() - 90 * 86400 * 1000).toISOString().slice(0, 10);
        let symptomEntries = [];
        try {
            const entriesR = await env.DB.prepare(`
                SELECT entry_date, symptoms_json, notes, created_at
                FROM symptom_diary_entries
                WHERE patient_id = ? AND entry_date >= ?
                ORDER BY entry_date DESC
                LIMIT 200
            `).bind(patient_id, ninetyAgo).all();
            symptomEntries = (entriesR.results || []).map((row) => ({
                entry_date: row.entry_date,
                symptoms: safeJson(row.symptoms_json),
                notes: row.notes,
            }));
        } catch {
            // Table may not exist on a slim install — non-fatal.
            symptomEntries = [];
        }

        // Active triage (most recent appointment).
        let activeTriage = null;
        try {
            const tr = await env.DB.prepare(`
                SELECT ar.id, ar.intake_response_id, ar.visit_type, ar.estimated_duration_min,
                       ar.urgency, ar.in_person_required, ar.preferred_time_of_day,
                       ar.rationale, ar.secondary_concerns_json, ar.released_at, ar.clinician_override
                FROM appointment_triage ar
                WHERE ar.patient_id = ?
                ORDER BY ar.created_at DESC
                LIMIT 1
            `).bind(patient_id).first();
            if (tr) {
                tr.secondary_concerns = safeJson(tr.secondary_concerns_json);
                delete tr.secondary_concerns_json;
                activeTriage = tr;
            }
        } catch { activeTriage = null; }

        // Prior encounters list (cap 40 — most recent).
        const enrR = await env.DB.prepare(`
            SELECT id, visit_date, visit_type_actual, chief_complaint,
                   transcription_session_id, note_source, created_at
            FROM encounters
            WHERE patient_id = ?
            ORDER BY visit_date DESC, created_at DESC
            LIMIT 40
        `).bind(patient_id).all();
        const prior_encounters = enrR.results || [];

        // Latest snapshot version on file.
        const currentSnapshot = await env.DB.prepare(`
            SELECT id, version_number, source_app, generated_at,
                   encounter_count, dominant_category, change_notes,
                   ai_model, ai_prompt_version
            FROM patient_snapshots
            WHERE patient_id = ? AND is_current = 1
            LIMIT 1
        `).bind(patient_id).first();

        // Latest billing claim summary (helps app cross-check coding history).
        let recent_claims = [];
        try {
            const cR = await env.DB.prepare(`
                SELECT id, visit_date, em_code, em_mdm_level, total_wrvu,
                       compliance_status, medico_legal_score, status
                FROM billing_claims
                WHERE patient_id = ?
                ORDER BY visit_date DESC
                LIMIT 10
            `).bind(patient_id).all();
            recent_claims = cR.results || [];
        } catch { recent_claims = []; }

        // Update patient_sync_state — record the pull.
        const now = Date.now();
        const sync_state_id = `${APP}:${patient_id}`;
        await env.DB.prepare(`
            INSERT INTO patient_sync_state
                (id, app, patient_id, last_pulled_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                last_pulled_at = excluded.last_pulled_at,
                updated_at = excluded.updated_at
        `).bind(sync_state_id, APP, patient_id, now, now, now).run();

        // Clear dirty flag — the app has now seen the latest delta.
        await env.DB.prepare(`DELETE FROM patient_dirty_flag WHERE patient_id = ?`).bind(patient_id).run();

        return syncJson({
            ok: true,
            context: {
                patient,
                intake: {
                    intake_id,
                    head: intakeHead,
                    sections: intakeSections,
                },
                symptom_diary_recent_90d: symptomEntries,
                active_triage: activeTriage,
                prior_encounters,
                current_snapshot: currentSnapshot,
                recent_claims,
                server_time: now,
            },
        });
    });
}
