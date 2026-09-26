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
import { isValidVisitTypeKey, getVisitType, MANUAL_REVIEW_PLACEHOLDER } from "../../../../../_lib/visit_types.js";

// "soon" is a real value: the AI triage prompt offers routine|soon|urgent
// and the CLI bridge writes it. Excluding it here meant a clinician could
// not SET the middle urgency on release even though the AI could.
const ALLOWED_URGENCY = new Set(["urgent", "soon", "routine"]);
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
                   clinician_override_reason, clinician_reviewed_at,
                   final_visit_type, final_duration_min
            FROM appointment_triage WHERE id = ?
        `).bind(id).first();
        if (!row) return jsonError("triage_not_found", 404);
        if (row.clinician_reviewed_at) {
            // ONE EXCEPTION, and it is the only way out of a real trap.
            //
            // A row released while carrying the manual-review PLACEHOLDER
            // leaves the patient permanently stuck: her portal says "ready
            // to book", booking 409s on the invalid visit type, and both
            // PATCH and this endpoint answered 409 `already_released`. There
            // was no reopen path, so the row could never be fixed — one live
            // row was in exactly that state.
            //
            // Re-releasing is allowed when the stored final_visit_type is
            // the placeholder AND this request supplies a real one. That is
            // narrow on purpose: it cannot be used to silently rewrite a
            // legitimately reviewed decision.
            const stuck = row.final_visit_type === MANUAL_REVIEW_PLACEHOLDER;
            const fixing = body.final_visit_type !== undefined
                && isValidVisitTypeKey(body.final_visit_type);
            if (!stuck || !fixing) {
                return jsonError("already_released", 409, {
                    reviewed_at: row.clinician_reviewed_at,
                    ...(stuck ? {
                        recoverable: true,
                        message: "This row was released while AI triage had fallen back to manual review, so the patient cannot actually book. Re-send with a real final_visit_type to fix it.",
                    } : {}),
                });
            }
        }

        // Resolve final visit_type: explicit body > clinician_override > AI.
        let final_visit_type = row.clinician_override_visit_type || row.ai_visit_type;
        if (body.final_visit_type !== undefined) {
            if (!isValidVisitTypeKey(body.final_visit_type)) {
                return jsonError("invalid_final_visit_type", 400);
            }
            final_visit_type = body.final_visit_type;
        }
        // Validate what actually gets WRITTEN, not only what was supplied.
        // Only the body was checked before, so a release with no body at all
        // wrote `manual_review_required` straight into final_visit_type — a
        // value the booking endpoint rejects — and marked the row reviewed.
        if (!isValidVisitTypeKey(final_visit_type)) {
            return jsonError("visit_type_not_chosen", 400, {
                resolved: final_visit_type,
                message: final_visit_type === MANUAL_REVIEW_PLACEHOLDER
                    ? "AI triage fell back to manual review, so there is no visit type to release. Choose one and send it as final_visit_type — releasing as-is would show the patient a booking page that cannot accept a booking."
                    : "The resolved visit type is not in the catalogue.",
            });
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

        // The comment that used to sit here said these three fields are
        // "not stored in final_* columns (schema doesn't have them)" and
        // are "surfaced via the override columns + ai_* fallbacks". Both
        // halves were wrong. Schema 0024 added
        // clinician_override_{urgency,in_person_required,preferred_time_of_day}
        // — and nothing wrote them on release, while available.js read ONLY
        // ai_in_person_required (its own comment admitted "overrides not
        // persisted").
        //
        // The consequence: the in-person checkbox in the admin panel DID
        // NOTHING. Every live triage row has ai_in_person_required = 1, so
        // a visit could never be opened to telehealth — the checkbox
        // flipped, the toast said released, and the patient stayed
        // hard-blocked to in-person. The only working path was changing
        // the visit TYPE to telehealth_consult, which is a different
        // decision from "this complex visit may be done by video".
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

        // Same "NULL when same as AI" convention as PATCH: the override
        // column only carries a value when a human actually changed
        // something, so "AI accepted as-is" stays distinguishable from
        // "clinician set the same value deliberately".
        const aiInPerson = row.ai_in_person_required ? 1 : 0;
        const ovrUrgency = body.final_urgency !== undefined && body.final_urgency !== row.ai_urgency
            ? body.final_urgency : null;
        const ovrInPerson = body.final_in_person !== undefined && (body.final_in_person ? 1 : 0) !== aiInPerson
            ? (body.final_in_person ? 1 : 0) : null;
        const ovrTimeOfDay = body.final_preferred_time_of_day !== undefined
                && body.final_preferred_time_of_day !== row.ai_preferred_time_of_day
            ? body.final_preferred_time_of_day : null;

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
                clinician_override_urgency = COALESCE(?, clinician_override_urgency),
                clinician_override_in_person_required = COALESCE(?, clinician_override_in_person_required),
                clinician_override_preferred_time_of_day = COALESCE(?, clinician_override_preferred_time_of_day),
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
            ovrUrgency, ovrInPerson, ovrTimeOfDay,
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
