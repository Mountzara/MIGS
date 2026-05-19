// =====================================================================
// GET /api/v1/admin/snapshots/:patient_id/history
// =====================================================================
// Phase 9 Round B. Lists every snapshot version for a patient. Slim —
// each row is the snapshot head + counts, not the full child trees.
// Used to populate the version switcher / history slider in the EMR
// dashboard.
//
// Auth: admin Basic Auth.
// =====================================================================

import { adminRoute, jsonResponse, jsonError } from "../../../../../_lib/admin_api.js";

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env, params }) => {
        const patient_id = params && params.patient_id ? String(params.patient_id) : "";
        if (!patient_id) return jsonError("missing_patient_id", 400);

        const patient = await env.DB.prepare(`SELECT id FROM patients WHERE id = ?`).bind(patient_id).first();
        if (!patient) return jsonError("patient_not_found", 404);

        const rowsR = await env.DB.prepare(`
            SELECT
                ps.id,
                ps.version_number,
                ps.source_app,
                ps.generated_at,
                ps.encounter_count,
                ps.dominant_category,
                ps.change_notes,
                ps.is_current,
                ps.ai_model,
                ps.ai_prompt_version,
                ps.created_at,
                (SELECT COUNT(*) FROM snapshot_problem_list WHERE snapshot_id = ps.id) AS problem_count,
                (SELECT COUNT(*) FROM snapshot_problem_list WHERE snapshot_id = ps.id AND status = 'Active') AS active_problem_count,
                (SELECT COUNT(*) FROM snapshot_diagnostic_trends WHERE snapshot_id = ps.id) AS dx_trend_count,
                (SELECT COUNT(*) FROM snapshot_imaging_measurements WHERE snapshot_id = ps.id) AS imaging_count,
                (SELECT COUNT(*) FROM snapshot_timeline_events WHERE snapshot_id = ps.id) AS timeline_count,
                (SELECT COUNT(*) FROM snapshot_action_items WHERE snapshot_id = ps.id) AS action_count
            FROM patient_snapshots ps
            WHERE ps.patient_id = ?
            ORDER BY ps.version_number DESC
        `).bind(patient_id).all();

        return jsonResponse({
            ok: true,
            patient_id,
            versions: rowsR.results || [],
        });
    });
}
