// =====================================================================
// POST /api/v1/internal/nps/dispatch — Phase 18 Sprint 2 R9
// =====================================================================
// NPS survey dispatcher. Invoked by the mountzara-cron Worker daily at
// 11:00 UTC (≈ 6:00am America/Chicago) with the X-Pipeline-Token header
// (same constant-time check as /api/posts — _lib/trend_briefs.js).
// Runs inside the Pages runtime ON PURPOSE: secure-message delivery
// needs the envelope-encryption + messaging libs that only exist here.
//
// Behavior per the R9 spec:
//   * Finds appointments with status='completed' whose ends_at falls in
//     the prior 36 hours (daily cron + margin; the nps_dispatches UNIQUE
//     appointment guard makes overlap harmless).
//   * Skips appointments already dispatched.
//   * 30-day per-patient cooldown between surveys (survey-fatigue guard).
//   * Mints a one-time token, writes nps_dispatches, and delivers the
//     survey link via secure messaging (from_role 'staff'). Token
//     expires 14 days after dispatch (enforced at respond time).
//   * Audit-logged per dispatch.
// KNOWN GAP: the spec also wants an email copy — no outbound mailer
// exists yet (deferred since Phase 2); secure message + portal unread
// badge is the delivery channel until a mailer lands.
// =====================================================================

import { isPipelineRequest } from "../../../../_lib/trend_briefs.js";
import { startThread } from "../../../../_lib/messaging.js";
import { logAudit } from "../../../../_lib/audit.js";

const DISPATCH_WINDOW_MS = 36 * 60 * 60 * 1000;   // completed within prior 36h
const COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;     // 30-day per-patient cooldown
const MAX_PER_RUN = 50;

function jres(status, body) {
    return new Response(JSON.stringify(body), {
        status, headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

function mintToken() {
    const a = crypto.randomUUID().replace(/-/g, "");
    const b = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    return a + b; // 48 hex chars, single-use, stored UNIQUE
}

export async function onRequestPost(ctx) {
    const { request, env } = ctx;
    if (!isPipelineRequest(request, env)) {
        return jres(404, { error: "not_found" }); // leak nothing
    }
    if (!env.DB) return jres(500, { error: "db_not_bound" });

    const now = Date.now();
    const from = now - DISPATCH_WINDOW_MS;

    // Completed appointments in the window with no dispatch yet and no
    // dispatch to the same patient inside the cooldown.
    const rows = await env.DB.prepare(`
        SELECT a.id AS appointment_id, a.patient_id, a.ends_at, a.visit_type
        FROM appointments a
        WHERE a.status = 'completed'
          AND a.ends_at >= ? AND a.ends_at <= ?
          AND NOT EXISTS (
              SELECT 1 FROM nps_dispatches d WHERE d.appointment_id = a.id
          )
          AND NOT EXISTS (
              SELECT 1 FROM nps_dispatches d2
              WHERE d2.patient_id = a.patient_id
                AND d2.dispatched_at >= datetime(?, 'unixepoch')
          )
        ORDER BY a.ends_at ASC
        LIMIT ?
    `).bind(from, now, Math.floor((now - COOLDOWN_MS) / 1000), MAX_PER_RUN).all();

    const candidates = rows?.results || [];
    const dispatched = [];
    const failures = [];

    for (const a of candidates) {
        const token = mintToken();
        try {
            await env.DB.prepare(`
                INSERT INTO nps_dispatches (patient_id, appointment_id, token, dispatched_at)
                VALUES (?, ?, ?, datetime('now'))
            `).bind(a.patient_id, a.appointment_id, token).run();
        } catch (e) {
            failures.push({ appointment_id: a.appointment_id, stage: "dispatch_insert", error: String(e?.message || e).slice(0, 120) });
            continue;
        }

        const link = `https://mountzara.com/portal/nps/${token}/`;
        const body =
            "Thanks for visiting Mount Zara. One question: how likely would you be " +
            "to recommend Dr. Mabini to a friend or family member?\n\n" +
            "Tap the link below, slide between 0 (not at all) and 10 (definitely), " +
            "and — if you'd like — tell us why. Your honest answer makes the practice better.\n\n" +
            link + "\n\n" +
            "The link is just for you and works for 14 days. No reply needed here.";
        const msg = await startThread(env, {
            patient_id: a.patient_id,
            from_role: "staff",
            from_user_id: "nps-dispatcher",
            subject: "One quick question about your recent visit",
            body,
            related_appointment_id: a.appointment_id,
        });
        if (!msg.ok) {
            failures.push({ appointment_id: a.appointment_id, stage: "secure_message", error: msg.error });
            // Keep the dispatch row — the token still works if the patient
            // reaches the portal; the failure is surfaced for follow-up.
        }

        await logAudit(env, {
            user_id: null,
            user_role: "app",
            action: "nps_survey_dispatched",
            record_type: "appointment",
            record_id: a.appointment_id,
            ip: "",
            user_agent: "nps-dispatcher",
            success: msg.ok ? true : false,
            details: { patient_record_id: a.patient_id, delivered_via: msg.ok ? "secure_message" : "dispatch_row_only" },
        }, ctx);

        dispatched.push({ appointment_id: a.appointment_id, message_ok: !!msg.ok });
    }

    return jres(200, {
        ok: true,
        window_from: from,
        window_to: now,
        candidates: candidates.length,
        dispatched: dispatched.length,
        failures,
    });
}
