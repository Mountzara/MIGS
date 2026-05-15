// GET / POST /api/v1/admin/appointments — list + create appointments.
//
// Per CLAUDE.md §11 Phase 2. Admin-only during pre-launch; patient flow
// in Phase 1 will call the same DB schema via a separate patient-auth'd
// endpoint.
//
//   GET    ?from=YYYY-MM-DD&to=YYYY-MM-DD&status=...  — list in window
//   POST   { patient_id, visit_type, starts_at, duration_min?,
//            modality, chief_complaint_summary? }
//          — book an appointment (admin-on-behalf-of-patient). Duration
//            defaults to the visit_type's catalog duration.

import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../_lib/admin_api.js";
import { logAudit } from "../../../_lib/audit.js";
import { getVisitType, isValidVisitTypeKey } from "../../../_lib/visit_types.js";
import { newId, now } from "../../../_lib/db.js";

const CLINICIAN_ID = "mabini-christopher-z";
const ALLOWED_MODALITIES = new Set(["in_person", "telehealth"]);
const ALLOWED_STATUSES = new Set(["scheduled", "completed", "no_show", "cancelled", "rescheduled"]);

function validateDateString(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }

async function getDoxyRoomUrl(env) {
    const row = await env.DB.prepare(`
        SELECT value_json FROM practice_settings
        WHERE clinician_id = ? AND key = 'doxy_room_url'
    `).bind(CLINICIAN_ID).first();
    if (!row?.value_json) return "";
    try {
        const v = JSON.parse(row.value_json);
        return typeof v === "string" ? v : "";
    } catch { return ""; }
}

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env, request }) => {
        const url = new URL(request.url);
        const from = url.searchParams.get("from");
        const to = url.searchParams.get("to") || from;
        const status = url.searchParams.get("status");
        if (!validateDateString(from) || !validateDateString(to)) {
            return jsonError("missing_or_invalid_date_range", 400);
        }
        const fromMs = Date.parse(from + "T00:00:00Z");
        const toMs = Date.parse(to + "T23:59:59Z");
        if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
            return jsonError("date_parse_failed", 400);
        }
        let sql = `
            SELECT a.id, a.patient_id, a.clinician_id, a.visit_type, a.starts_at, a.ends_at,
                   a.duration_min, a.modality, a.status, a.cancellation_reason,
                   a.chief_complaint_summary, a.doxy_room_url, a.doxy_join_logged_at,
                   a.created_at, a.updated_at,
                   p.first_name AS patient_first_name, p.last_name AS patient_last_name
            FROM appointments a
            LEFT JOIN patients p ON p.id = a.patient_id
            WHERE a.clinician_id = ?
              AND a.starts_at >= ?
              AND a.starts_at <= ?
        `;
        const binds = [CLINICIAN_ID, fromMs, toMs];
        if (status && ALLOWED_STATUSES.has(status)) {
            sql += ` AND a.status = ?`;
            binds.push(status);
        }
        sql += ` ORDER BY a.starts_at ASC`;
        const res = await env.DB.prepare(sql).bind(...binds).all();
        return jsonResponse({ from, to, status: status || null, appointments: res?.results || [] });
    });
}

export async function onRequestPost(ctx) {
    return adminRoute(ctx, async ({ env, request, admin }) => {
        const body = await readJsonBody(request);
        const { patient_id, visit_type, starts_at, modality } = body || {};
        const chief_complaint_summary = typeof body.chief_complaint_summary === "string"
            ? body.chief_complaint_summary.slice(0, 500) : null;

        if (!patient_id || typeof patient_id !== "string") return jsonError("missing_patient_id", 400);
        if (!isValidVisitTypeKey(visit_type)) return jsonError("invalid_visit_type", 400);
        if (!Number.isInteger(starts_at) || starts_at < Date.now()) {
            return jsonError("starts_at_must_be_future_ms_epoch", 400);
        }
        if (!ALLOWED_MODALITIES.has(modality)) return jsonError("invalid_modality", 400);

        const vt = getVisitType(visit_type);
        const duration_min = Number.isInteger(body.duration_min) && body.duration_min > 0
            ? body.duration_min : vt.duration_min;
        const ends_at = starts_at + duration_min * 60 * 1000;

        // Verify the patient exists.
        const patientRow = await env.DB.prepare(`SELECT id FROM patients WHERE id = ?`)
            .bind(patient_id).first();
        if (!patientRow) return jsonError("patient_not_found", 404);

        // For telehealth, pull the doxy_room_url at booking time so the
        // appointment carries its own copy (doesn't change if the
        // practice URL later changes).
        let doxy_room_url = null;
        if (modality === "telehealth") {
            doxy_room_url = await getDoxyRoomUrl(env);
        }

        const id = newId();
        const t = now();
        await env.DB.prepare(`
            INSERT INTO appointments
                (id, patient_id, clinician_id, visit_type, starts_at, ends_at,
                 duration_min, modality, status, chief_complaint_summary,
                 doxy_room_url, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?)
        `).bind(
            id, patient_id, CLINICIAN_ID, visit_type, starts_at, ends_at,
            duration_min, modality, chief_complaint_summary, doxy_room_url, t, t
        ).run();

        await logAudit(env, {
            user_id: admin.user, user_role: admin.role,
            action: "appointment_book",
            record_type: "appointment",
            record_id: id,
            ip: request.headers.get("CF-Connecting-IP") || "",
            user_agent: request.headers.get("User-Agent") || "",
            success: true,
            details: { visit_type, modality, duration_min, patient_record_id: patient_id },
        });

        return jsonResponse({
            ok: true, id, patient_id, visit_type, starts_at, ends_at,
            duration_min, modality, status: "scheduled", doxy_room_url,
        });
    });
}
