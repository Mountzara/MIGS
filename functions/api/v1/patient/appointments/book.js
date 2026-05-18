// =====================================================================
// POST /api/v1/patient/appointments/book — patient books a slot
// =====================================================================
// Per CLAUDE.md §11.7.4. The patient picked a slot returned by
// /api/v1/patient/appointments/available; this endpoint validates it's
// still bookable and writes the `appointments` row with the triage_id
// FK so the cross-app aggregation view can correlate intake → triage →
// appointment in /admin/cases.
//
// Body:
//   {
//     triage_id:           "<patient's released triage row id>",
//     block_id:            "<clinician_availability.id>",
//     start_minute_of_day: <int 0..1439, 15-min aligned>,
//     duration_min:        <int 5..240>            // optional; defaults to triage final_duration_min
//     modality:            'in_person' | 'telehealth',
//     chief_complaint_summary?: "<<=500 chars>",   // optional, copied to appt
//   }
//
// Response (201 on success):
//   {
//     ok: true,
//     appointment: { id, starts_at, ends_at, duration_min, visit_type,
//                    modality, doxy_room_url, status: 'scheduled' }
//   }
//
// Auth: patient session. Preview gate honored. Audit row
// `appointment_book` with op=patient_self_book.
// =====================================================================

import { previewAccess, preLaunchNotFound } from "../../../../_lib/preview_gate.js";
import { requireRole, nowMs } from "../../../../_lib/auth.js";
import { logAudit } from "../../../../_lib/audit.js";
import { newId } from "../../../../_lib/db.js";
import { getVisitType, isValidVisitTypeKey } from "../../../../_lib/visit_types.js";
import { dateStringToMs } from "../../../../_lib/scheduling.js";

const CLINICIAN_ID = "mabini-christopher-z";
const ALLOWED_MODALITIES = new Set(["in_person", "telehealth"]);

function err(status, code, message, extra = {}) {
    return new Response(JSON.stringify({ error: code, message, ...extra }), {
        status,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

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

export async function onRequestPost(ctx) {
    const { request, env } = ctx;
    const { allow } = await previewAccess(request, env);
    if (!allow) return preLaunchNotFound();

    let session;
    try { session = await requireRole(ctx, ["patient"]); }
    catch (resp) { return resp; }
    if (!session.patient_id || !env.DB) {
        return err(500, "server_error", "DB not bound");
    }

    let body;
    try { body = await request.json(); } catch { return err(400, "invalid_json_body"); }
    const triage_id = String(body.triage_id || "");
    const block_id = String(body.block_id || "");
    const start_minute_of_day = body.start_minute_of_day;
    const modality = body.modality;
    const chief_complaint_summary = typeof body.chief_complaint_summary === "string"
        ? body.chief_complaint_summary.slice(0, 500) : null;

    if (!triage_id) return err(400, "missing_triage_id");
    if (!block_id) return err(400, "missing_block_id");
    if (!Number.isInteger(start_minute_of_day) || start_minute_of_day < 0
        || start_minute_of_day > 1439 || start_minute_of_day % 15 !== 0) {
        return err(400, "invalid_start_minute_of_day", "0..1439, 15-min aligned");
    }
    if (!ALLOWED_MODALITIES.has(modality)) return err(400, "invalid_modality");

    // Load the triage; it must belong to this patient and be released.
    const triage = await env.DB.prepare(`
        SELECT id, intake_id, patient_id,
               ai_visit_type, ai_duration_min, ai_in_person_required,
               clinician_override_visit_type, clinician_override_duration_min,
               final_visit_type, final_duration_min, clinician_reviewed_at,
               appointment_id
        FROM appointment_triage WHERE id = ? AND patient_id = ?
    `).bind(triage_id, session.patient_id).first();
    if (!triage) return err(404, "triage_not_found");
    if (!triage.clinician_reviewed_at) {
        return err(409, "triage_not_released",
            "Your triage is still pending clinician review.");
    }
    if (triage.appointment_id) {
        return err(409, "triage_already_booked", "This intake already has an appointment booked.", {
            appointment_id: triage.appointment_id,
        });
    }

    const visit_type = triage.final_visit_type || triage.clinician_override_visit_type || triage.ai_visit_type;
    if (!isValidVisitTypeKey(visit_type)) {
        return err(409, "invalid_triage_visit_type", "Triage visit type not in catalog.");
    }
    if (visit_type === "manual_review_required") {
        return err(409, "manual_review_required",
            "Your triage requires manual review.");
    }
    const vt = getVisitType(visit_type);
    const duration_min = Number.isInteger(body.duration_min) && body.duration_min > 0
        ? body.duration_min
        : (triage.final_duration_min || triage.clinician_override_duration_min || triage.ai_duration_min || vt.duration_min);

    // Modality validation against triage.
    if (triage.ai_in_person_required && modality !== "in_person") {
        return err(409, "in_person_required",
            "This visit type requires in-person attendance.");
    }
    const procedureOrOmt = vt && (vt.category === "procedure" || visit_type === "omt_treatment");
    if (procedureOrOmt && modality === "telehealth") {
        return err(409, "in_person_required",
            "Procedure / OMT visits must be in-person.");
    }

    // Load the availability block. Verify it's open + on the clinician we expect.
    const block = await env.DB.prepare(`
        SELECT id, clinician_id, date, start_minute_of_day, end_minute_of_day,
               block_kind, allowed_visit_types_json, location
        FROM clinician_availability WHERE id = ? AND clinician_id = ?
    `).bind(block_id, CLINICIAN_ID).first();
    if (!block) return err(404, "block_not_found");
    if (block.block_kind !== "open") return err(409, "block_not_open");

    // Slot must fit inside the block (no buffer-min check at booking time
    // because the available endpoint already validated; we just need the
    // upper bound to be ≤ block.end here for the basic write).
    const slotEndMod = start_minute_of_day + duration_min;
    if (start_minute_of_day < block.start_minute_of_day
        || slotEndMod > block.end_minute_of_day) {
        return err(409, "slot_outside_block", "Slot doesn't fit inside this block.");
    }

    // allowed_visit_types_json filter (if set on the block).
    if (block.allowed_visit_types_json) {
        try {
            const allowed = JSON.parse(block.allowed_visit_types_json);
            if (Array.isArray(allowed) && allowed.length > 0 && !allowed.includes(visit_type)) {
                return err(409, "visit_type_not_allowed_in_block", "", { allowed });
            }
        } catch {}
    }

    // Location vs modality.
    if (block.location === "telehealth_only" && modality !== "telehealth") {
        return err(409, "block_is_telehealth_only");
    }
    if (block.location === "procedure_room" && modality === "telehealth") {
        return err(409, "block_is_procedure_room");
    }

    const starts_at = dateStringToMs(block.date, start_minute_of_day);
    const ends_at = starts_at + duration_min * 60 * 1000;

    // Must be in the future.
    if (starts_at < Date.now()) {
        return err(409, "slot_in_past");
    }

    // Final overlap guard against scheduled appointments. We allow
    // 'completed' / 'cancelled' / 'no_show' to occupy the same minute
    // (they're historical).
    const overlap = await env.DB.prepare(`
        SELECT id FROM appointments
        WHERE clinician_id = ? AND status = 'scheduled'
          AND starts_at < ? AND ends_at > ?
        LIMIT 1
    `).bind(CLINICIAN_ID, ends_at, starts_at).first();
    if (overlap) {
        return err(409, "slot_already_taken", "Someone booked this slot before you did. Please pick another.");
    }

    const id = newId();
    const t = nowMs();
    let doxy_room_url = null;
    if (modality === "telehealth") {
        doxy_room_url = await getDoxyRoomUrl(env);
    }

    try {
        await env.DB.prepare(`
            INSERT INTO appointments
                (id, patient_id, clinician_id, visit_type, starts_at, ends_at,
                 duration_min, modality, status, chief_complaint_summary,
                 doxy_room_url, triage_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?)
        `).bind(
            id, session.patient_id, CLINICIAN_ID, visit_type, starts_at, ends_at,
            duration_min, modality, chief_complaint_summary, doxy_room_url,
            triage_id, t, t
        ).run();

        // Back-link the triage row.
        await env.DB.prepare(`
            UPDATE appointment_triage
            SET appointment_id = ?, updated_at = ?
            WHERE id = ?
        `).bind(id, t, triage_id).run();
    } catch (e) {
        console.error("appt book DB.run threw", { error: String(e), triage_id });
        return err(500, "server_error", "Could not book appointment.");
    }

    await logAudit(env, {
        user_id: session.patient_id,
        user_role: "patient",
        action: "appointment_book",
        record_type: "appointment",
        record_id: id,
        ip: request.headers.get("CF-Connecting-IP") || "",
        user_agent: request.headers.get("User-Agent") || "",
        success: true,
        details: {
            op: "patient_self_book",
            triage_id,
            visit_type,
            duration_min,
            modality,
            starts_at,
        },
    });

    // Phase 9.5 — record an encounter event so the clinician's "what's new
    // since you last looked" panel surfaces newly booked appointments and
    // the patient is marked dirty for snapshot regeneration. Best-effort.
    try {
        const startsDate = new Date(starts_at);
        const summary = `Appointment booked: ${vt?.display_name || visit_type}`
            + ` on ${startsDate.toISOString().slice(0, 10)} (${modality})`;
        const { recordEncounterEvent } = await import("../../../../_lib/encounters.js");
        await recordEncounterEvent(env, {
            patient_id: session.patient_id,
            event_type: "appointment_booked",
            event_summary: summary,
            severity: "info",
            ref_kind: "appointment",
            ref_id: id,
            details: { triage_id, visit_type, duration_min, modality, starts_at, ends_at }
        });
    } catch {}

    return new Response(JSON.stringify({
        ok: true,
        appointment: {
            id, starts_at, ends_at, duration_min, visit_type, modality,
            doxy_room_url, status: "scheduled",
        },
    }), {
        status: 201,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}
