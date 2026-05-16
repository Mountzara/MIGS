// =====================================================================
// POST /api/v1/admin/triage/<id>/release — release triage to patient
// =====================================================================
// Per CLAUDE.md §11.7.5. After the clinician reviews (and possibly
// PATCH-es) a triage row, they "release" it — this stamps reviewed_at,
// writes final_visit_type and final_duration_min, and unlocks the
// patient booking flow (Round C consumes final_* to filter slots).
//
// Body (all optional — if omitted, the AI decision OR the existing
// clinician_override_* values are promoted to final):
//   {
//     final_visit_type:    "<override key>"   // optional
//     final_duration_min:  <int 5..240>       // optional
//     final_in_person:     true | false       // optional
//     final_preferred_time_of_day: ...        // optional
//     final_urgency:       "urgent"|"routine" // optional
//     override_reason:     "<<=500 chars>"    // optional
//   }
//
// Returns the updated row.
//
// Audit: logged as triage_review op=release with the AI decision +
// final values + reason length.
// =====================================================================

import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../../../_lib/admin_api.js";
import { logAudit } from "../../../../../_lib/audit.js";
import { isValidVisitTypeKey, getVisitType } from "../../../../../_lib/visit_types.js";

const ALLOWED_URGENCY = new Set(["urgent", "routine"]);
const ALLOWED_TIME_OF_DAY = new Set(["morning", "afternoon", "any"]);

export async function onRequestPost(ctx) {
    return adminRoute(ctx, async ({ env, request, admin }) => {
        const id = String(ctx.params?.id || "");
        if (!id) return jsonError("bad_params", 400);
        const body = await readJsonBody(request);

        const row = await env.DB.prepare(`
            SELECT id, intake_id, patient_id,
                   ai_visit_type, ai_duration_min, ai_urgency,
                   ai_in_person_required, ai_preferred_time_of_day,
                   clinician_override_visit_type, clinician_override_duration_min,
                   clinician_override_reason, clinician_reviewed_at
            FROM appointment_triage WHERE id = ?
        `).bind(id).first();
        if (!row) return jsonError("triage_not_found", 404);
        if (row.clinician_reviewed_at) {
            return jsonError("already_released", 409, {
                reviewed_at: row.clinician_reviewed_at,
            });
        }

        // Resolve final visit_type: explicit body > clinician_override > AI.
        let final_visit_type = row.clinician_override_visit_type || row.ai_visit_type;
        if (body.final_visit_type !== undefined) {
            if (!isValidVisitTypeKey(body.final_visit_type)) {
                return jsonError("invalid_final_visit_type", 400);
            }
            final_visit_type = body.final_visit_type;
        }

        // Resolve final duration: explicit > override > AI > catalog default.
        let final_duration_min = row.clinician_override_duration_min || row.ai_duration_min;
        if (body.final_duration_min !== undefined) {
            const d = Number(body.final_duration_min);
            if (!Number.isFinite(d) || d < 5 || d > 240) {
                return jsonError("invalid_final_duration_min", 400, { range: "5..240" });
            }
            final_duration_min = Math.round(d);
        }
        if (!final_duration_min) {
            const vt = getVisitType(final_visit_type);
            if (vt) final_duration_min = vt.duration_min;
        }

        // urgency / in_person / time_of_day are not stored in final_*
        // columns (schema doesn't have them) but DO matter for the
        // patient booking flow. They're written to audit_log so analytics
        // can pull them, and surfaced from the row JSON via the override
        // columns + ai_* fallbacks.
        if (body.final_urgency !== undefined && !ALLOWED_URGENCY.has(body.final_urgency)) {
            return jsonError("invalid_final_urgency", 400);
        }
        if (body.final_in_person !== undefined && typeof body.final_in_person !== "boolean") {
            return jsonError("invalid_final_in_person", 400);
        }
        if (body.final_preferred_time_of_day !== undefined
            && !ALLOWED_TIME_OF_DAY.has(body.final_preferred_time_of_day)) {
            return jsonError("invalid_final_preferred_time_of_day", 400);
        }

        const override_reason = typeof body.override_reason === "string"
            ? body.override_reason.slice(0, 500)
            : row.clinician_override_reason;

        const t = Date.now();
        await env.DB.prepare(`
            UPDATE appointment_triage
            SET clinician_reviewed_at = ?,
                clinician_reviewer_id = ?,
                clinician_override_reason = COALESCE(?, clinician_override_reason),
                clinician_override_visit_type = CASE
                    WHEN ? = ai_visit_type THEN clinician_override_visit_type
                    ELSE ?
                END,
                clinician_override_duration_min = CASE
                    WHEN ? = ai_duration_min THEN clinician_override_duration_min
                    ELSE ?
                END,
                final_visit_type = ?,
                final_duration_min = ?,
                updated_at = ?
            WHERE id = ?
        `).bind(
            t,
            admin.user,
            override_reason,
            final_visit_type, final_visit_type,
            final_duration_min, final_duration_min,
            final_visit_type, final_duration_min,
            t, id
        ).run();

        await logAudit(env, {
            user_id: admin.user, user_role: admin.role,
            action: "triage_review",
            record_type: "triage",
            record_id: id,
            ip: request.headers.get("CF-Connecting-IP") || "",
            user_agent: request.headers.get("User-Agent") || "",
            success: true,
            details: {
                op: "release",
                ai_visit_type: row.ai_visit_type,
                ai_duration_min: row.ai_duration_min,
                final_visit_type,
                final_duration_min,
                final_urgency: body.final_urgency || row.ai_urgency,
                final_in_person:
                    body.final_in_person !== undefined
                        ? body.final_in_person
                        : !!row.ai_in_person_required,
                final_preferred_time_of_day:
                    body.final_preferred_time_of_day || row.ai_preferred_time_of_day,
                clinician_changed_visit_type: final_visit_type !== row.ai_visit_type,
                clinician_changed_duration: final_duration_min !== row.ai_duration_min,
                reason_len: override_reason ? override_reason.length : 0,
            },
        });

        return jsonResponse({
            ok: true,
            id,
            final_visit_type,
            final_duration_min,
            clinician_reviewed_at: t,
            clinician_reviewer_id: admin.user,
        });
    });
}
