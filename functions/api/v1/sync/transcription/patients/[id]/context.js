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
        //
        // Eleven of the columns this used to name do not exist on
        // `patients` and never have: sex, gender_identity, the five
        // address fields, both emergency-contact fields, and
        // date_of_birth (the column is `dob`). D1 threw on the first
        // statement, so the Transcription app's context pull has returned
        // 500 for every patient since it shipped.
        //
        // The demographics it was reaching for are not missing — they are
        // in the encrypted intake, which this endpoint already returns
        // below as `intake.sections`. Selecting them from `patients` was
        // never going to work. `date_of_birth` is aliased so the app's
        // existing parser is unaffected.
        const patient = await env.DB.prepare(`
            SELECT id, first_name, last_name, preferred_name, email, phone,
                   dob AS date_of_birth, pronouns, preferred_language, timezone,
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
            // The FK column is `intake_id` and the timestamp is
            // `last_updated_at` — `intake_response_id` and `updated_at` do
            // not exist on this table. Two unknown columns in one
            // statement, and this one is NOT inside a try/catch, so it
            // took the whole endpoint down with it.
            const sectionsR = await env.DB.prepare(`
                SELECT section_number, section_key, data_json, last_updated_at
                FROM intake_section_data
                WHERE intake_id = ?
                ORDER BY section_number ASC
            `).bind(intake_id).all();
            intakeSections = (sectionsR.results || []).map((row) => ({
                section_number: row.section_number,
                section_key: row.section_key,
                data: safeJson(row.data_json),
                updated_at: row.last_updated_at,
            }));
        }

        // Symptom diary — last 90 days.
        const ninetyAgo = new Date(Date.now() - 90 * 86400 * 1000).toISOString().slice(0, 10);
        let symptomEntries = [];
        try {
            // `values_json` / `note`, not `symptoms_json` / `notes`. The
            // catch below reported this as "no diary entries", so the
            // Transcription app opened every encounter believing the
            // patient had logged nothing in 90 days.
            // Bounded at both ends: the block above calls this "last 90
            // days" and the LIMIT 200 is ordered DESC, so a future-dated
            // row would not merely be included — it would sort to the top
            // and could push genuine recent entries out of the 200.
            const todayIso = new Date().toISOString().slice(0, 10);
            const entriesR = await env.DB.prepare(`
                SELECT entry_date, values_json, note, created_at
                FROM symptom_diary_entries
                WHERE patient_id = ? AND entry_date >= ? AND entry_date <= ?
                ORDER BY entry_date DESC
                LIMIT 200
            `).bind(patient_id, ninetyAgo, todayIso).all();
            symptomEntries = (entriesR.results || []).map((row) => ({
                entry_date: row.entry_date,
                symptoms: safeJson(row.values_json),
                notes: row.note,
            }));
        } catch (e) {
            // Table may not exist on a slim install — non-fatal, but log it,
            // because "empty" and "broken" looked identical from the app.
            console.error("transcription context: symptom diary query failed", String(e).slice(0, 200));
            symptomEntries = [];
        }

        // Active triage (most recent appointment).
        let activeTriage = null;
        try {
            // Every one of the eleven columns this named was wrong. The
            // table stores the AI proposal and the clinician's override in
            // SEPARATE columns (ai_visit_type / clinician_override_visit_type
            // / final_visit_type) rather than one mutable field, and there
            // is no `released_at`, no `rationale`, no `urgency`.
            //
            // COALESCE in override-then-AI order is what a consumer
            // actually wants — the value in force — and matches how
            // admin/analytics.js reads the same table. The raw components
            // are returned alongside so the app can show that a human
            // changed it, which is the whole reason the columns are split.
            const tr = await env.DB.prepare(`
                SELECT ar.id, ar.intake_id,
                       COALESCE(ar.final_visit_type, ar.clinician_override_visit_type, ar.ai_visit_type) AS visit_type,
                       COALESCE(ar.final_duration_min, ar.clinician_override_duration_min, ar.ai_duration_min) AS estimated_duration_min,
                       COALESCE(ar.clinician_override_urgency, ar.ai_urgency) AS urgency,
                       COALESCE(ar.clinician_override_in_person_required, ar.ai_in_person_required) AS in_person_required,
                       COALESCE(ar.clinician_override_preferred_time_of_day, ar.ai_preferred_time_of_day) AS preferred_time_of_day,
                       ar.ai_rationale, ar.ai_secondary_concerns_json,
                       ar.ai_visit_type, ar.clinician_override_visit_type, ar.clinician_override_reason,
                       ar.clinician_reviewed_at, ar.appointment_id, ar.created_at, ar.updated_at
                FROM appointment_triage ar
                WHERE ar.patient_id = ?
                ORDER BY ar.created_at DESC
                LIMIT 1
            `).bind(patient_id).first();
            if (tr) {
                tr.secondary_concerns = safeJson(tr.ai_secondary_concerns_json);
                delete tr.ai_secondary_concerns_json;
                tr.rationale = tr.ai_rationale;
                // A clinician has reviewed it when there is a review
                // timestamp — not a column of its own, so derive it once
                // here rather than in every consumer.
                tr.clinician_override = Boolean(tr.clinician_override_visit_type || tr.clinician_reviewed_at);
                tr.released_at = tr.clinician_reviewed_at || null;
                activeTriage = tr;
            }
        } catch (e) {
            console.error("transcription context: triage query failed", String(e).slice(0, 200));
            activeTriage = null;
        }

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
