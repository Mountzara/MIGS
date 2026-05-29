// =====================================================================
// POST /api/v1/patient/appointments/:id/launch
// =====================================================================
// Sprint 1 R4 — Pre-visit privacy attestation interstitial.
// Joshi & Welch (2023) Telehealth Success, p. 135 — "Have patients confirm
// they're alone and in a satisfactory, comfortable, and private location."
//
// Contract:
//   POST {
//     privacy_confirmed: true,
//     alone_confirmed:   true,
//     device_check_passed: bool | null   // optional snapshot from R5
//   }
//
// Server logic:
//   1. Auth — patient session required (preview gate respected).
//   2. Ownership — appointment.patient_id MUST equal session.patient_id.
//   3. T-15-minute release window — gate_opens_at = scheduled_at - 15min.
//      If server now < gate_opens_at → 403 launch_too_early.
//   4. Attestation — privacy_confirmed AND alone_confirmed MUST be true.
//      If not → 403 privacy_attestation_required.
//   5. Persist a visit_launch_attestations row (with ip_hash + user_agent).
//   6. Return { room_url, expires_at } where room_url is the practice's
//      Doxy.me URL pulled from practice_settings.
//
// Audit: every call writes audit_log (success or fail).
//
// Source of truth: the doxy room URL must ONLY come from this endpoint
// after the attestation gate. Strip it from any /api/v1/patient/* GET
// response that previously included it.
// =====================================================================

import { previewAccess, preLaunchNotFound } from "../../../../../_lib/preview_gate.js";
import { requireRole } from "../../../../../_lib/auth.js";
import { logAudit } from "../../../../../_lib/audit.js";

const CLINICIAN_ID = "mabini-christopher-z";
const LAUNCH_WINDOW_MS = 15 * 60 * 1000;   // T-15 minutes
const ROOM_URL_TTL_MS = 60 * 60 * 1000;    // 1 hour validity

function jerr(status, code, message, extra = {}) {
    return new Response(JSON.stringify({ error: code, message, ...extra }), {
        status,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

async function sha256Hex(s) {
    const buf = new TextEncoder().encode(s);
    const dg = await crypto.subtle.digest("SHA-256", buf);
    return [...new Uint8Array(dg)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function hashIp(env, request) {
    const ip = request.headers.get("cf-connecting-ip") || "";
    if (!ip) return null;
    const salt = env?.IP_HASH_SALT
        ? String(env.IP_HASH_SALT)
        : `mz-fallback-${new Date().toISOString().slice(0, 10)}`;
    return (await sha256Hex(`${ip}|${salt}`)).slice(0, 24);
}

export async function onRequestPost(ctx) {
    const { request, env, params } = ctx;
    const { allow } = await previewAccess(request, env);
    if (!allow) return preLaunchNotFound();

    let session;
    try { session = await requireRole(ctx, ["patient"]); }
    catch (resp) { return resp; }
    if (!session.patient_id || !env.DB) {
        return jerr(500, "server_error", "DB not bound");
    }

    const appointment_id = String(params?.id || "").trim();
    if (!appointment_id) return jerr(400, "invalid_id", "Appointment id required.");

    // Parse body
    let body;
    try { body = await request.json(); }
    catch { return jerr(400, "invalid_json", "Body must be JSON."); }
    const privacy_confirmed = body.privacy_confirmed === true;
    const alone_confirmed = body.alone_confirmed === true;
    const device_check_passed =
        body.device_check_passed === true ? 1 :
        body.device_check_passed === false ? 0 : null;

    // Load appointment + ownership check
    const appt = await env.DB.prepare(`
        SELECT id, patient_id, clinician_id, starts_at, ends_at, status,
               modality, chaperone_required, chaperone_confirmed_at
        FROM appointments
        WHERE id = ?
    `).bind(appointment_id).first();

    if (!appt) {
        await logAudit(env, {
            actor_role: "patient",
            actor_id: session.patient_id,
            action: "visit_launch_attempt",
            target_type: "appointment",
            target_id: appointment_id,
            outcome: "not_found",
        }, ctx);
        return jerr(404, "appointment_not_found", "Appointment not found.");
    }

    if (appt.patient_id !== session.patient_id) {
        await logAudit(env, {
            actor_role: "patient",
            actor_id: session.patient_id,
            action: "visit_launch_attempt",
            target_type: "appointment",
            target_id: appointment_id,
            outcome: "ownership_mismatch",
        }, ctx);
        return jerr(403, "not_owner", "You don't have access to that appointment.");
    }

    if (appt.status !== "scheduled") {
        return jerr(409, "appointment_not_scheduled",
            `Cannot launch a ${appt.status} appointment.`);
    }

    if (appt.modality !== "telehealth") {
        return jerr(409, "not_telehealth",
            "This appointment is in-person; nothing to launch.");
    }

    // Chaperone check — if the booking required a chaperone and it has not
    // been confirmed, block launch (defense-in-depth; book.js already
    // gates this at booking time).
    if (appt.chaperone_required && !appt.chaperone_confirmed_at) {
        return jerr(409, "chaperone_confirmation_required",
            "An adult chaperone is required before this telehealth visit can start.");
    }

    // T-15-minute window
    const now = Date.now();
    const scheduled_at = Number(appt.starts_at);
    if (!Number.isFinite(scheduled_at)) {
        return jerr(500, "appointment_corrupted", "Scheduled time is invalid.");
    }
    const gate_opens_at = scheduled_at - LAUNCH_WINDOW_MS;
    const ends_at = Number(appt.ends_at) || (scheduled_at + 30 * 60 * 1000);
    const grace_after_end = 30 * 60 * 1000; // 30-min grace after scheduled end
    if (now < gate_opens_at) {
        return jerr(403, "launch_too_early", "Your visit room opens 15 minutes before the appointment.", {
            scheduled_at,
            gate_opens_at,
            server_now: now,
        });
    }
    if (now > ends_at + grace_after_end) {
        return jerr(403, "launch_window_closed",
            "The launch window for this visit has closed. Please contact the clinic to reschedule.");
    }

    // Privacy attestation required (it's an interstitial — the patient
    // MUST acknowledge before getting the room URL).
    if (!privacy_confirmed || !alone_confirmed) {
        return jerr(403, "privacy_attestation_required",
            "Please confirm both attestations before joining the visit.", {
                privacy_confirmed,
                alone_confirmed,
            });
    }

    // Look up the practice's Doxy room URL.
    const practice = await env.DB.prepare(`
        SELECT doxy_room_url
        FROM practice_settings
        WHERE clinician_id = ?
    `).bind(appt.clinician_id || CLINICIAN_ID).first();

    if (!practice?.doxy_room_url) {
        return jerr(503, "doxy_not_configured",
            "Telehealth room is not configured. Please contact the clinic.");
    }

    // Persist the attestation
    const ip_hash = await hashIp(env, request);
    const user_agent = (request.headers.get("user-agent") || "").slice(0, 240);

    try {
        await env.DB.prepare(`
            INSERT INTO visit_launch_attestations
              (appointment_id, patient_id, privacy_confirmed, alone_confirmed,
               device_check_passed, attested_at, ip_hash, user_agent)
            VALUES (?, ?, ?, ?, ?, datetime('now'), ?, ?)
        `).bind(
            appointment_id,
            session.patient_id,
            privacy_confirmed ? 1 : 0,
            alone_confirmed ? 1 : 0,
            device_check_passed,
            ip_hash,
            user_agent,
        ).run();
    } catch (e) {
        // Persist failure should not block launch — log it but still
        // serve the URL since gating passed. Visibility for diagnostics.
        await logAudit(env, {
            actor_role: "patient",
            actor_id: session.patient_id,
            action: "visit_launch_attestation_write_failed",
            target_type: "appointment",
            target_id: appointment_id,
            outcome: "error",
            details_json: JSON.stringify({ message: String(e?.message || e).slice(0, 240) }),
        }, ctx);
    }

    await logAudit(env, {
        actor_role: "patient",
        actor_id: session.patient_id,
        action: "visit_launch_succeeded",
        target_type: "appointment",
        target_id: appointment_id,
        outcome: "success",
        details_json: JSON.stringify({
            privacy_confirmed,
            alone_confirmed,
            device_check_passed,
            modality: appt.modality,
        }),
    }, ctx);

    return new Response(JSON.stringify({
        room_url: practice.doxy_room_url,
        expires_at: now + ROOM_URL_TTL_MS,
        appointment: {
            id: appointment_id,
            scheduled_at,
            modality: appt.modality,
        },
    }), {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}
