// =====================================================================
// /api/v1/admin/triage/<id> — single triage row: GET / PATCH (override)
// =====================================================================
// Per CLAUDE.md §11.7.5 Clinician Override Layer.
//
// GET  — returns the triage row joined with patient + chief complaint
//        + intake submitted_at. Same row shape as the list endpoint.
//
// PATCH — apply clinician override fields. Body may include any of:
//   {
//     visit_type:               "<one of VISIT_TYPES keys>",
//     duration_min:             <int 5..240>,
//     urgency:                  "urgent" | "routine",
//     in_person_required:       true | false,
//     preferred_time_of_day:    "morning" | "afternoon" | "any",
//     override_reason:          "<<=500 chars>"
//   }
//
//   Only fields that DIFFER from the AI's decision are written to the
//   clinician_override_* columns. If the clinician chooses to accept the
//   AI categorization verbatim, PATCH with `override_reason: ""` (or no
//   body) — the row is marked reviewed without override fields set.
//
//   PATCH alone does NOT release the row to the patient — that's the
//   /release subroute. PATCH is the in-flight edit; once the clinician
//   is satisfied they POST /release which sets final_* + reviewed_at.
//
// All actions write to audit_log with action=triage_review and the
// before/after override values in details_json.
// =====================================================================

import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../../_lib/admin_api.js";
import { logAudit } from "../../../../_lib/audit.js";
import { isValidVisitTypeKey } from "../../../../_lib/visit_types.js";

const ALLOWED_URGENCY = new Set(["urgent", "routine"]);
const ALLOWED_TIME_OF_DAY = new Set(["morning", "afternoon", "any"]);

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

async function loadRow(env, id) {
    return env.DB.prepare(`
        SELECT
            t.id, t.intake_id, t.patient_id,
            t.ai_visit_type, t.ai_duration_min, t.ai_urgency,
            t.ai_in_person_required, t.ai_preferred_time_of_day,
            t.ai_rationale, t.ai_prompt_version, t.ai_secondary_concerns_json,
            t.clinician_override_visit_type, t.clinician_override_duration_min,
            t.clinician_override_reason, t.clinician_reviewed_at,
            t.clinician_reviewer_id, t.final_visit_type, t.final_duration_min,
            t.created_at AS triage_created_at, t.updated_at,
            ir.submitted_at AS intake_submitted_at,
            p.first_name AS patient_first_name,
            p.last_name AS patient_last_name,
            p.email AS patient_email,
            p.dob AS patient_dob
        FROM appointment_triage t
        LEFT JOIN intake_responses ir ON ir.id = t.intake_id
        LEFT JOIN patients p ON p.id = t.patient_id
        WHERE t.id = ?
    `).bind(id).first();
}

function shapeRow(r, chief) {
    if (!r) return null;
    let secondary = [];
    try { secondary = JSON.parse(r.ai_secondary_concerns_json || "[]"); } catch {}
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
        triage_created_at: r.triage_created_at,
        chief_complaint_summary: chief,
    };
}

async function loadChiefComplaint(env, intake_id) {
    if (!intake_id) return null;
    const sec4 = await env.DB.prepare(
        `SELECT data_json FROM intake_section_data
         WHERE intake_id = ? AND section_number = 4`
    ).bind(intake_id).first();
    if (!sec4?.data_json) return null;
    try {
        const d = JSON.parse(sec4.data_json);
        const cc = typeof d.chief_complaint === "string" ? d.chief_complaint : "";
        return cc || null;
    } catch { return null; }
}

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env, request }) => {
        const id = String(ctx.params?.id || "");
        if (!id) return jsonError("bad_params", 400);
        const row = await loadRow(env, id);
        if (!row) return jsonError("triage_not_found", 404);
        const chief = await loadChiefComplaint(env, row.intake_id);
        return jsonResponse({ row: shapeRow(row, chief) });
    });
}

export async function onRequestPatch(ctx) {
    return adminRoute(ctx, async ({ env, request, admin }) => {
        const id = String(ctx.params?.id || "");
        if (!id) return jsonError("bad_params", 400);
        const body = await readJsonBody(request);

        // Validate. Each field is optional; missing means "no change".
        const ovr = {};
        if (body.visit_type !== undefined) {
            if (!isValidVisitTypeKey(body.visit_type)) {
                return jsonError("invalid_visit_type", 400);
            }
            ovr.visit_type = body.visit_type;
        }
        if (body.duration_min !== undefined) {
            const d = Number(body.duration_min);
            if (!Number.isFinite(d) || d < 5 || d > 240) {
                return jsonError("invalid_duration_min", 400, { range: "5..240" });
            }
            ovr.duration_min = Math.round(d);
        }
        if (body.urgency !== undefined) {
            if (!ALLOWED_URGENCY.has(body.urgency)) {
                return jsonError("invalid_urgency", 400);
            }
            ovr.urgency = body.urgency;
        }
        if (body.in_person_required !== undefined) {
            if (typeof body.in_person_required !== "boolean") {
                return jsonError("invalid_in_person_required", 400);
            }
            ovr.in_person_required = body.in_person_required;
        }
        if (body.preferred_time_of_day !== undefined) {
            if (!ALLOWED_TIME_OF_DAY.has(body.preferred_time_of_day)) {
                return jsonError("invalid_preferred_time_of_day", 400);
            }
            ovr.preferred_time_of_day = body.preferred_time_of_day;
        }
        if (body.override_reason !== undefined) {
            if (typeof body.override_reason !== "string") {
                return jsonError("invalid_override_reason", 400);
            }
            ovr.reason = body.override_reason.slice(0, 500);
        }

        const before = await loadRow(env, id);
        if (!before) return jsonError("triage_not_found", 404);
        if (before.clinician_reviewed_at) {
            return jsonError("already_released", 409, {
                reviewed_at: before.clinician_reviewed_at,
            });
        }

        // Only write override columns where the value differs from AI's.
        // If clinician picks the same visit_type the AI did, leave the
        // column NULL so the row reads as "AI accepted as-is".
        const setVisit = ovr.visit_type !== undefined && ovr.visit_type !== before.ai_visit_type
            ? ovr.visit_type
            : (ovr.visit_type === undefined ? before.clinician_override_visit_type : null);
        const setDur = ovr.duration_min !== undefined && ovr.duration_min !== before.ai_duration_min
            ? ovr.duration_min
            : (ovr.duration_min === undefined ? before.clinician_override_duration_min : null);
        const setReason = ovr.reason !== undefined ? (ovr.reason || null) : before.clinician_override_reason;

        // Update only the override columns; reviewed_at/final_* happen on /release.
        const t = Date.now();
        await env.DB.prepare(`
            UPDATE appointment_triage
            SET clinician_override_visit_type = ?,
                clinician_override_duration_min = ?,
                clinician_override_reason = ?,
                updated_at = ?
            WHERE id = ?
        `).bind(setVisit, setDur, setReason, t, id).run();

        await logAudit(env, {
            user_id: admin.user, user_role: admin.role,
            action: "triage_review",
            record_type: "triage",
            record_id: id,
            ip: request.headers.get("CF-Connecting-IP") || "",
            user_agent: request.headers.get("User-Agent") || "",
            success: true,
            details: {
                op: "patch",
                ai_visit_type: before.ai_visit_type,
                ai_duration_min: before.ai_duration_min,
                set_override_visit_type: setVisit,
                set_override_duration_min: setDur,
                reason_len: setReason ? setReason.length : 0,
            },
        });

        const after = await loadRow(env, id);
        const chief = await loadChiefComplaint(env, after.intake_id);
        return jsonResponse({ ok: true, row: shapeRow(after, chief) });
    });
}
