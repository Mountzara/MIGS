// =====================================================================
// /api/v1/patient/messages — list threads + start new thread
// =====================================================================
// GET  → list this patient's threads (newest first)
// POST → start a new thread:
//   { subject, body, related_appointment_id?, related_intake_id? }
//
// Auth: patient session required. Preview gate honored.
// Per CLAUDE.md §11.5.1 Secure Messaging.
// =====================================================================

import { previewAccess, preLaunchNotFound } from "../../../_lib/preview_gate.js";
import { requireRole } from "../../../_lib/auth.js";
import { listThreads, startThread, auditMessage, ALLOWED_URGENCIES } from "../../../_lib/messaging.js";

function err(status, code, message, extra = {}) {
    return new Response(JSON.stringify({ error: code, message, ...extra }), {
        status,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

export async function onRequestGet(ctx) {
    const { request, env } = ctx;
    const { allow } = await previewAccess(request, env);
    if (!allow) return preLaunchNotFound();

    let session;
    try { session = await requireRole(ctx, ["patient"]); }
    catch (resp) { return resp; }
    if (!session.patient_id || !env.DB) return err(500, "server_error", "DB not bound");

    const url = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "50", 10), 1), 100);
    const out = await listThreads(env, { side: "patient", patient_id: session.patient_id, limit });
    if (!out.ok) return err(500, "server_error", out.error);
    return new Response(JSON.stringify({ threads: out.threads }), {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

export async function onRequestPost(ctx) {
    const { request, env } = ctx;
    const { allow } = await previewAccess(request, env);
    if (!allow) return preLaunchNotFound();

    let session;
    try { session = await requireRole(ctx, ["patient"]); }
    catch (resp) { return resp; }
    if (!session.patient_id || !env.DB) return err(500, "server_error", "DB not bound");

    let body;
    try { body = await request.json(); } catch { return err(400, "invalid_json_body"); }

    // Phase 18 R8 — every patient-originated thread carries an urgency so
    // the response-window SLA clock can start. Urgent = same business day
    // (due close of next business day); non-urgent = within 48 business
    // hours. Required — the compose UI presents the two radios.
    const urgency = String(body.urgency || "");
    if (!ALLOWED_URGENCIES.has(urgency)) {
        return err(400, "urgency_required",
            "Please tell us whether this is urgent (same business day) or not urgent (within 48 business hours).",
            { allowed: ["urgent", "non_urgent"] });
    }

    const out = await startThread(env, {
        patient_id: session.patient_id,
        from_role: "patient",
        from_user_id: session.patient_id,
        subject: body.subject,
        body: body.body,
        urgency,
        related_appointment_id: body.related_appointment_id || null,
        related_intake_id: body.related_intake_id || null,
    });
    if (!out.ok) return err(400, out.error, out.detail || "could not start thread");

    await auditMessage(env, request, {
        user_id: session.patient_id, user_role: "patient",
        action: "message_send",
        thread_id: out.thread_id, message_id: out.message_id,
        detail: { op: "thread_create" },
    });

    return new Response(JSON.stringify({
        ok: true,
        thread_id: out.thread_id,
        message_id: out.message_id,
        created_at: out.created_at,
    }), {
        status: 201,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}
