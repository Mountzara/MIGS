// =====================================================================
// GET /api/v1/admin/patients/:id/proms — full PROM history for one patient
// =====================================================================
// Clinician-side view of:
//   - every assignment (pending + completed) with AI rationale
//   - every response with computed scores + interpretation band
//   - every threshold flag (open + acknowledged)
//   - score trend over time per slug for easy charting
// =====================================================================

import { adminRoute, jsonResponse, jsonError } from "../../../../../_lib/admin_api.js";
import { getDefinition } from "../../../../../_lib/proms.js";

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env, params }) => {
        if (!env.DB) return jsonError("server_error", 500);
        const patient_id = String(params?.id || "").trim();
        if (!patient_id) return jsonError("bad_params", 400);

        // 1. Identity
        const patient = await env.DB.prepare(
            "SELECT id, first_name, last_name, email, status FROM patients WHERE id = ? LIMIT 1"
        ).bind(patient_id).first();
        if (!patient) return jsonError("not_found", 404);

        // 2. Assignments (joined with definition meta so the UI doesn't need a second hop)
        const aRs = await env.DB.prepare(`
            SELECT a.id, a.prom_slug, a.assigned_by_kind, a.assigned_by_id,
                   a.trigger_reason, a.period_label, a.assigned_at, a.due_at,
                   a.status, a.started_at, a.completed_at, a.response_id,
                   d.title, d.short_name, d.domain, d.tier, d.estimated_minutes
              FROM prom_assignments a
              LEFT JOIN prom_definitions d ON d.slug = a.prom_slug
             WHERE a.patient_id = ?
             ORDER BY a.assigned_at DESC
        `).bind(patient_id).all();
        const assignments = (aRs && aRs.results) || [];

        // 3. Responses (most recent first)
        const rRs = await env.DB.prepare(`
            SELECT id, assignment_id, prom_slug, computed_scores, threshold_flags, submitted_at
              FROM prom_responses
             WHERE patient_id = ?
             ORDER BY submitted_at DESC
        `).bind(patient_id).all();
        const responses = ((rRs && rRs.results) || []).map(r => {
            let computed_scores = {}, threshold_flags = [];
            try { computed_scores = JSON.parse(r.computed_scores || "{}"); } catch {}
            try { threshold_flags = JSON.parse(r.threshold_flags || "[]"); } catch {}
            return { ...r, computed_scores, threshold_flags };
        });

        // 4. Open + recent flags (last 90 days)
        const fRs = await env.DB.prepare(`
            SELECT id, response_id, prom_slug, flag_type, severity, message,
                   created_at, acknowledged_by_clinician_id, acknowledged_at, acknowledged_note
              FROM prom_triage_flags
             WHERE patient_id = ?
               AND created_at >= datetime('now','-90 day')
             ORDER BY
               CASE severity WHEN 'urgent' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
               created_at DESC
        `).bind(patient_id).all();
        const flags = (fRs && fRs.results) || [];

        // 5. Score trend per slug — handy for the trend chart in the UI
        const trends = {};
        for (const r of responses) {
            const t = r.computed_scores && (typeof r.computed_scores.total === "number" ? r.computed_scores.total : null);
            if (t === null) continue;
            if (!trends[r.prom_slug]) trends[r.prom_slug] = [];
            trends[r.prom_slug].push({ submitted_at: r.submitted_at, total: t });
        }
        // sort ascending for charting
        for (const slug of Object.keys(trends)) {
            trends[slug].sort((a, b) => (a.submitted_at < b.submitted_at ? -1 : 1));
        }

        return jsonResponse({
            ok: true,
            patient: { id: patient.id, name: [patient.first_name, patient.last_name].filter(Boolean).join(" "), email: patient.email, status: patient.status },
            counts: {
                assignments: assignments.length,
                pending: assignments.filter(a => a.status === "pending" || a.status === "in_progress").length,
                completed: assignments.filter(a => a.status === "completed").length,
                open_flags: flags.filter(f => !f.acknowledged_at).length,
                total_flags_90d: flags.length,
            },
            assignments,
            responses,
            flags,
            trends
        });
    });
}
