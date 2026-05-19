// =====================================================================
// GET /api/v1/admin/snapshots/:patient_id — current snapshot + all children
// =====================================================================
// Returns the most-recent is_current=1 snapshot row plus every problem,
// diagnostic trend, imaging measurement, timeline event, and action item.
// Also returns supplementary website-side data the snapshot dashboard
// fuses in:
//   • Symptom diary 30-day window (for sparklines)
//   • Education progress
//   • Appointment summary (last/next + count)
//   • Recent billing claims
//   • Recent encounter list
//
// Auth: admin Basic Auth via adminRoute.
// =====================================================================

import { adminRoute, jsonResponse, jsonError } from "../../../../_lib/admin_api.js";

function safeJson(s) {
    if (!s || typeof s !== "string") return null;
    try { return JSON.parse(s); } catch { return null; }
}

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env, params, request }) => {
        const patient_id = params && params.patient_id ? String(params.patient_id) : "";
        if (!patient_id) return jsonError("missing_patient_id", 400);

        // Patient header.
        const patient = await env.DB.prepare(`
            SELECT id, first_name, last_name, preferred_name, email, phone, date_of_birth,
                   sex, gender_identity, pronouns, created_at
            FROM patients
            WHERE id = ?
        `).bind(patient_id).first();
        if (!patient) return jsonError("patient_not_found", 404);

        // Optional ?version=<n> override — letters render any historical
        // version, defaults to is_current=1.
        const url = new URL(request.url);
        const versionRaw = url.searchParams.get("version");
        const versionInt = versionRaw != null ? parseInt(versionRaw, 10) : null;
        const useHistorical = Number.isFinite(versionInt) && versionInt > 0;

        const snapshot = await (useHistorical
            ? env.DB.prepare(`
                SELECT * FROM patient_snapshots
                WHERE patient_id = ? AND version_number = ?
                LIMIT 1
            `).bind(patient_id, versionInt).first()
            : env.DB.prepare(`
                SELECT * FROM patient_snapshots
                WHERE patient_id = ? AND is_current = 1
                ORDER BY version_number DESC
                LIMIT 1
            `).bind(patient_id).first()
        );

        let problems = [];
        let diagnostic_trends = [];
        let imaging = [];
        let timeline = [];
        let action_items = [];
        let snapshotHydrated = null;

        if (snapshot) {
            const [pR, dR, iR, tR, aR] = await Promise.all([
                env.DB.prepare(`SELECT * FROM snapshot_problem_list WHERE snapshot_id = ? ORDER BY seq ASC`).bind(snapshot.id).all(),
                env.DB.prepare(`SELECT * FROM snapshot_diagnostic_trends WHERE snapshot_id = ? ORDER BY seq ASC`).bind(snapshot.id).all(),
                env.DB.prepare(`SELECT * FROM snapshot_imaging_measurements WHERE snapshot_id = ? ORDER BY seq ASC`).bind(snapshot.id).all(),
                env.DB.prepare(`SELECT * FROM snapshot_timeline_events WHERE snapshot_id = ? ORDER BY seq ASC`).bind(snapshot.id).all(),
                env.DB.prepare(`SELECT * FROM snapshot_action_items WHERE snapshot_id = ? ORDER BY seq ASC`).bind(snapshot.id).all(),
            ]);

            problems = pR.results || [];
            diagnostic_trends = (dR.results || []).map((row) => ({
                ...row,
                entries: safeJson(row.entries_json),
                entries_json: undefined,
            }));
            imaging = iR.results || [];
            timeline = (tR.results || []).map((row) => ({
                ...row,
                icd10_codes: safeJson(row.icd10_codes_json),
                icd10_codes_json: undefined,
            }));
            action_items = aR.results || [];

            snapshotHydrated = {
                ...snapshot,
                encounter_ids: safeJson(snapshot.encounter_ids_json),
                patient_goals: safeJson(snapshot.patient_goals_json),
                surgical_history: safeJson(snapshot.surgical_history_json),
                ai_recommendations: safeJson(snapshot.ai_recommendations_json),
            };
            delete snapshotHydrated.encounter_ids_json;
            delete snapshotHydrated.patient_goals_json;
            delete snapshotHydrated.surgical_history_json;
            delete snapshotHydrated.ai_recommendations_json;
        }

        // Symptom diary — 30-day window for sparklines.
        const thirtyAgo = new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10);
        let symptom_diary_30d = [];
        try {
            const sdR = await env.DB.prepare(`
                SELECT entry_date, symptoms_json, notes
                FROM symptom_diary_entries
                WHERE patient_id = ? AND entry_date >= ?
                ORDER BY entry_date ASC
            `).bind(patient_id, thirtyAgo).all();
            symptom_diary_30d = (sdR.results || []).map((row) => ({
                entry_date: row.entry_date,
                symptoms: safeJson(row.symptoms_json),
                notes: row.notes,
            }));
        } catch {}

        // Education progress.
        let education_progress = { assigned: 0, viewed: 0 };
        try {
            const epR = await env.DB.prepare(`
                SELECT
                    COUNT(*) AS assigned,
                    SUM(CASE WHEN viewed_at IS NOT NULL THEN 1 ELSE 0 END) AS viewed
                FROM patient_education_assignments
                WHERE patient_id = ?
            `).bind(patient_id).first();
            if (epR) education_progress = { assigned: epR.assigned || 0, viewed: epR.viewed || 0 };
        } catch {}

        // Appointments summary.
        let appointments_summary = null;
        try {
            const apR = await env.DB.prepare(`
                SELECT
                    COUNT(*) AS total,
                    SUM(CASE WHEN start_at < ? THEN 1 ELSE 0 END) AS past,
                    SUM(CASE WHEN start_at >= ? THEN 1 ELSE 0 END) AS upcoming,
                    MAX(CASE WHEN start_at < ? THEN start_at ELSE NULL END) AS last_visit_at,
                    MIN(CASE WHEN start_at >= ? THEN start_at ELSE NULL END) AS next_visit_at
                FROM appointments
                WHERE patient_id = ? AND status NOT IN ('cancelled', 'no_show')
            `).bind(Date.now(), Date.now(), Date.now(), Date.now(), patient_id).first();
            appointments_summary = apR;
        } catch {}

        // Recent billing claims.
        let recent_claims = [];
        try {
            const cR = await env.DB.prepare(`
                SELECT id, visit_date, em_code, total_wrvu, expected_collection_cents, status, compliance_status
                FROM billing_claims
                WHERE patient_id = ?
                ORDER BY visit_date DESC
                LIMIT 8
            `).bind(patient_id).all();
            recent_claims = cR.results || [];
        } catch {}

        // Recent encounters.
        const encR = await env.DB.prepare(`
            SELECT id, visit_date, visit_type_actual, chief_complaint, note_source, created_at
            FROM encounters
            WHERE patient_id = ?
            ORDER BY visit_date DESC, created_at DESC
            LIMIT 8
        `).bind(patient_id).all();
        const recent_encounters = encR.results || [];

        // Sync state.
        let sync_state = null;
        try {
            const ssR = await env.DB.prepare(`
                SELECT app, last_pulled_at, last_pushed_at, last_snapshot_id
                FROM patient_sync_state
                WHERE patient_id = ?
            `).bind(patient_id).all();
            sync_state = ssR.results || [];
        } catch {}

        return jsonResponse({
            ok: true,
            patient,
            snapshot: snapshotHydrated,
            problems,
            diagnostic_trends,
            imaging_measurements: imaging,
            timeline_events: timeline,
            action_items,
            supplementary: {
                symptom_diary_30d,
                education_progress,
                appointments_summary,
                recent_claims,
                recent_encounters,
                sync_state,
            },
        });
    });
}
