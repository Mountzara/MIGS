// =====================================================================
// GET /api/v1/admin/triage — list pending appointment_triage rows
// =====================================================================
// Per CLAUDE.md §11.7.5 Clinician Override Layer. Returns every triage
// row whose clinician_reviewed_at IS NULL, joined with the basic
// patient + intake metadata the clinician needs to make an override
// decision.
//
// Query params:
//   status:  "pending" (default) | "released" | "all"
//   limit:   1..100 (default 50)
//
// Response shape (one row per pending triage):
//   {
//     pending: [
//       {
//         id, intake_id, patient_id, patient_name, patient_email,
//         patient_dob, ai_visit_type, ai_duration_min, ai_urgency,
//         ai_in_person_required, ai_preferred_time_of_day,
//         ai_rationale, ai_prompt_version, ai_secondary_concerns,
//         intake_submitted_at, chief_complaint_summary, age_years,
//         triage_created_at, hours_pending
//       }
//     ],
//     auto_release_threshold_hours: 4
//   }
//
// PHI handling: this endpoint is admin-only (adminRoute). The patient
// name + DOB do appear in the response because that is the clinician's
// reviewing surface. /admin/* is gated by HTTP Basic Auth and the
// admin middleware. No PHI is returned to non-admin sessions.
// =====================================================================

import { adminRoute, jsonResponse } from "../../../_lib/admin_api.js";

const AUTO_RELEASE_THRESHOLD_HOURS = 4;

function ageYearsFromDob(dob) {
    if (!dob || typeof dob !== "string") return null;
    const m = dob.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const y = parseInt(m[1], 10), mo = parseInt(m[2], 10), d = parseInt(m[3], 10);
    const now = new Date();
    let age = now.getFullYear() - y;
    if (now.getMonth() + 1 < mo || (now.getMonth() + 1 === mo && now.getDate() < d)) age -= 1;
    return Number.isFinite(age) && age >= 0 && age < 130 ? age : null;
}

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env, request }) => {
        const url = new URL(request.url);
        const statusFilter = (url.searchParams.get("status") || "pending").toLowerCase();
        const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 1), 100);

        // SQL: triage + intake + patient join
        let where;
        switch (statusFilter) {
            case "released":
                where = "WHERE t.clinician_reviewed_at IS NOT NULL";
                break;
            case "all":
                where = "";
                break;
            case "pending":
            default:
                where = "WHERE t.clinician_reviewed_at IS NULL";
                break;
        }
        const sql = `
            SELECT
                t.id, t.intake_id, t.patient_id,
                t.ai_visit_type, t.ai_duration_min, t.ai_urgency,
                t.ai_in_person_required, t.ai_preferred_time_of_day,
                t.ai_rationale, t.ai_prompt_version, t.ai_secondary_concerns_json,
                t.clinician_override_visit_type, t.clinician_override_duration_min,
                t.clinician_override_reason, t.clinician_reviewed_at,
                t.clinician_reviewer_id, t.final_visit_type, t.final_duration_min,
                t.created_at AS triage_created_at,
                ir.submitted_at AS intake_submitted_at,
                p.first_name AS patient_first_name,
                p.last_name AS patient_last_name,
                p.email AS patient_email,
                p.dob AS patient_dob
            FROM appointment_triage t
            LEFT JOIN intake_responses ir ON ir.id = t.intake_id
            LEFT JOIN patients p ON p.id = t.patient_id
            ${where}
            ORDER BY t.created_at DESC
            LIMIT ?
        `;
        const res = await env.DB.prepare(sql).bind(limit).all();

        // Also pull each intake's Section 4 chief_complaint for clinician context.
        // Batched to avoid N+1: collect intake_ids, single IN-query.
        const intakeIds = (res?.results || []).map(r => r.intake_id).filter(Boolean);
        const chiefByIntake = {};
        if (intakeIds.length > 0) {
            const ph = intakeIds.map(() => "?").join(",");
            const sec4Res = await env.DB.prepare(
                `SELECT intake_id, data_json
                 FROM intake_section_data
                 WHERE section_number = 4 AND intake_id IN (${ph})`
            ).bind(...intakeIds).all();
            for (const r of (sec4Res?.results || [])) {
                try {
                    const d = JSON.parse(r.data_json || "{}");
                    const cc = typeof d.chief_complaint === "string" ? d.chief_complaint : "";
                    chiefByIntake[r.intake_id] = cc.length > 240 ? cc.slice(0, 237) + "…" : cc;
                } catch {}
            }
        }

        const nowMs = Date.now();
        const rows = (res?.results || []).map(r => {
            let secondary = [];
            try { secondary = JSON.parse(r.ai_secondary_concerns_json || "[]"); } catch {}
            const hours_pending = r.clinician_reviewed_at
                ? 0
                : Math.round((nowMs - (r.triage_created_at || nowMs)) / 36000) / 100; // 2 decimals
            const patient_name = [r.patient_first_name, r.patient_last_name].filter(Boolean).join(" ");
            return {
                id: r.id,
                intake_id: r.intake_id,
                patient_id: r.patient_id,
                patient_name,
                patient_email: r.patient_email,
                patient_dob: r.patient_dob,
                age_years: ageYearsFromDob(r.patient_dob),
                ai_visit_type: r.ai_visit_type,
                ai_duration_min: r.ai_duration_min,
                ai_urgency: r.ai_urgency,
                ai_in_person_required: !!r.ai_in_person_required,
                ai_preferred_time_of_day: r.ai_preferred_time_of_day,
                ai_rationale: r.ai_rationale,
                ai_prompt_version: r.ai_prompt_version,
                ai_secondary_concerns: Array.isArray(secondary) ? secondary : [],
                clinician_override_visit_type: r.clinician_override_visit_type,
                clinician_override_duration_min: r.clinician_override_duration_min,
                clinician_override_reason: r.clinician_override_reason,
                clinician_reviewed_at: r.clinician_reviewed_at,
                clinician_reviewer_id: r.clinician_reviewer_id,
                final_visit_type: r.final_visit_type,
                final_duration_min: r.final_duration_min,
                intake_submitted_at: r.intake_submitted_at,
                chief_complaint_summary: chiefByIntake[r.intake_id] || null,
                triage_created_at: r.triage_created_at,
                hours_pending,
                is_overdue: r.clinician_reviewed_at ? false : hours_pending >= AUTO_RELEASE_THRESHOLD_HOURS,
            };
        });

        return jsonResponse({
            status: statusFilter,
            count: rows.length,
            auto_release_threshold_hours: AUTO_RELEASE_THRESHOLD_HOURS,
            rows,
        });
    });
}
