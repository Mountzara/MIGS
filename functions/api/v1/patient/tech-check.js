// =====================================================================
// POST /api/v1/patient/tech-check
// =====================================================================
// Sprint 1 R5 — Patient device + connection test results.
// Joshi & Welch (2023) Telehealth Success, p. 79 — "Most issues actually
// tend to occur on the patient side, especially if they're an older
// patient. 30 percent of adults often or sometimes experience problems
// connecting to the internet at home."
//
// Contract:
//   POST {
//     camera_ok:     bool,
//     microphone_ok: bool,
//     speaker_ok:    bool,
//     network_kbps:  number,        // measured downlink throughput in kbps
//     browser:       string,         // optional, UA-derived (≤120 chars)
//     os:            string,         // optional (≤120 chars)
//     appointment_id: string|null,   // optional — links to specific visit
//     failure_reasons: [             // optional, array per failing component
//       { component: "camera"|"microphone"|"speaker"|"network",
//         reason:    string }
//     ]
//   }
//
// Auth: patient session required. Preview gate honored.
// Persists one tech_check_results row per call. The Doxy.me network
// floor is 600 kbps — network_ok = (network_kbps >= 600). overall_ok
// is the AND of all four component flags. Audit logged.
// =====================================================================

import { previewAccess, preLaunchNotFound } from "../../../_lib/preview_gate.js";
import { requireRole } from "../../../_lib/auth.js";
import { logAudit } from "../../../_lib/audit.js";

const NETWORK_FLOOR_KBPS = 600;

function jerr(status, code, message, extra = {}) {
    return new Response(JSON.stringify({ error: code, message, ...extra }), {
        status,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

function truncate(s, n) {
    if (typeof s !== "string") return null;
    return s.length > n ? s.slice(0, n) : s;
}

export async function onRequestPost(ctx) {
    const { request, env } = ctx;
    const { allow } = await previewAccess(request, env);
    if (!allow) return preLaunchNotFound();

    let session;
    try { session = await requireRole(ctx, ["patient"]); }
    catch (resp) { return resp; }
    if (!session.patient_id || !env.DB) {
        return jerr(500, "server_error", "DB not bound");
    }

    let body;
    try { body = await request.json(); }
    catch { return jerr(400, "invalid_json", "Body must be JSON."); }

    const camera_ok = body.camera_ok === true ? 1 : 0;
    const microphone_ok = body.microphone_ok === true ? 1 : 0;
    const speaker_ok = body.speaker_ok === true ? 1 : 0;

    let network_kbps = null;
    if (body.network_kbps != null) {
        const n = Number(body.network_kbps);
        if (Number.isFinite(n) && n >= 0 && n < 10_000_000) {
            network_kbps = Math.round(n);
        }
    }
    const network_ok = network_kbps != null && network_kbps >= NETWORK_FLOOR_KBPS ? 1 : 0;
    const overall_ok = (camera_ok && microphone_ok && speaker_ok && network_ok) ? 1 : 0;

    const browser = truncate(body.browser || "", 120) || null;
    const os = truncate(body.os || "", 120) || null;

    let appointment_id = null;
    if (body.appointment_id) {
        const a = String(body.appointment_id).trim();
        if (a) appointment_id = a;
    }

    let failure_reasons_json = null;
    if (Array.isArray(body.failure_reasons) && body.failure_reasons.length > 0) {
        const sane = body.failure_reasons
            .slice(0, 12)
            .filter(r => r && typeof r === "object")
            .map(r => ({
                component: truncate(String(r.component || ""), 40),
                reason: truncate(String(r.reason || ""), 240),
            }));
        if (sane.length > 0) {
            failure_reasons_json = JSON.stringify(sane);
        }
    }

    // Defense — if appointment_id supplied, confirm patient owns it (silent
    // drop if not, so we don't surface info about other patients' bookings).
    if (appointment_id) {
        const own = await env.DB.prepare(`
            SELECT 1 FROM appointments
            WHERE id = ? AND patient_id = ?
            LIMIT 1
        `).bind(appointment_id, session.patient_id).first();
        if (!own) appointment_id = null;
    }

    try {
        await env.DB.prepare(`
            INSERT INTO tech_check_results
              (patient_id, appointment_id, browser, os,
               camera_ok, microphone_ok, speaker_ok,
               network_kbps, network_ok, overall_ok,
               failure_reasons_json, checked_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).bind(
            session.patient_id,
            appointment_id,
            browser, os,
            camera_ok, microphone_ok, speaker_ok,
            network_kbps, network_ok, overall_ok,
            failure_reasons_json,
        ).run();
    } catch (e) {
        await logAudit(env, {
            actor_role: "patient",
            actor_id: session.patient_id,
            action: "tech_check_write_failed",
            target_type: "tech_check",
            target_id: appointment_id || null,
            outcome: "error",
            details_json: JSON.stringify({ message: String(e?.message || e).slice(0, 240) }),
        }, ctx);
        return jerr(500, "persist_failed", "Could not save your check; please retry.");
    }

    await logAudit(env, {
        actor_role: "patient",
        actor_id: session.patient_id,
        action: "tech_check_completed",
        target_type: appointment_id ? "appointment" : "tech_check",
        target_id: appointment_id || null,
        outcome: overall_ok ? "success" : "partial",
        details_json: JSON.stringify({
            overall_ok: !!overall_ok,
            camera_ok: !!camera_ok,
            microphone_ok: !!microphone_ok,
            speaker_ok: !!speaker_ok,
            network_ok: !!network_ok,
            network_kbps,
        }),
    }, ctx);

    return new Response(JSON.stringify({
        ok: !!overall_ok,
        results: {
            camera_ok: !!camera_ok,
            microphone_ok: !!microphone_ok,
            speaker_ok: !!speaker_ok,
            network_ok: !!network_ok,
            network_kbps,
            network_floor_kbps: NETWORK_FLOOR_KBPS,
        },
    }), {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}
