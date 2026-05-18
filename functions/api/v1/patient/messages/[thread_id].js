// =====================================================================
// /api/v1/patient/messages/<thread_id> — single thread
// =====================================================================
// GET   → load all messages in the thread (decrypted bodies) AND mark
//         every clinician-authored unread message as read.
// POST  → patient reply to the thread:  { body }
// PATCH → mark-read only (no message append). Body: {}
//
// Auth: patient session. Preview gate honored. Ownership enforced
// against thread.patient_id.
// =====================================================================

import { previewAccess, preLaunchNotFound } from "../../../../_lib/preview_gate.js";
import { requireRole } from "../../../../_lib/auth.js";
import {
    loadThreadMessages, replyInThread, markThreadRead, auditMessage,
} from "../../../../_lib/messaging.js";

function err(status, code, message, extra = {}) {
    return new Response(JSON.stringify({ error: code, message, ...extra }), {
        status,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

async function loadThread(env, thread_id, patient_id) {
    return env.DB.prepare(`
        SELECT id, patient_id, clinician_id, subject,
               last_message_at, last_message_from_role,
               patient_unread_count, clinician_unread_count,
               status, related_appointment_id, related_intake_id,
               created_at, updated_at
        FROM message_threads
        WHERE id = ? AND patient_id = ?
    `).bind(thread_id, patient_id).first();
}

export async function onRequestGet(ctx) {
    const { request, env, params } = ctx;
    const { allow } = await previewAccess(request, env);
    if (!allow) return preLaunchNotFound();

    let session;
    try { session = await requireRole(ctx, ["patient"]); }
    catch (resp) { return resp; }
    if (!session.patient_id || !env.DB) return err(500, "server_error", "DB not bound");

    const thread_id = String(params?.thread_id || "");
    if (!thread_id) return err(400, "bad_params");
    const thread = await loadThread(env, thread_id, session.patient_id);
    if (!thread) return err(404, "thread_not_found");

    const messages = await loadThreadMessages(env, thread_id);
    // Mark read for the patient side (no body sent).
    await markThreadRead(env, thread_id, "patient");
    await auditMessage(env, request, {
        user_id: session.patient_id, user_role: "patient",
        action: "message_read",
        thread_id,
        detail: { op: "thread_view", message_count: messages.length },
    });

    return new Response(JSON.stringify({
        thread: { ...thread, patient_unread_count: 0 },
        messages,
    }), {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

export async function onRequestPost(ctx) {
    const { request, env, params } = ctx;
    const { allow } = await previewAccess(request, env);
    if (!allow) return preLaunchNotFound();

    let session;
    try { session = await requireRole(ctx, ["patient"]); }
    catch (resp) { return resp; }
    if (!session.patient_id || !env.DB) return err(500, "server_error", "DB not bound");

    const thread_id = String(params?.thread_id || "");
    if (!thread_id) return err(400, "bad_params");

    let body;
    try { body = await request.json(); } catch { return err(400, "invalid_json_body"); }

    const out = await replyInThread(env, {
        thread_id,
        patient_id: session.patient_id,
        from_role: "patient",
        from_user_id: session.patient_id,
        body: body.body,
    });
    if (!out.ok) {
        const map = {
            thread_not_owned: 403,
            thread_not_found: 404,
            thread_closed: 409,
            empty_body: 400,
            body_too_large: 413,
        };
        return err(map[out.error] || 400, out.error, out.detail || "could not reply");
    }
    await auditMessage(env, request, {
        user_id: session.patient_id, user_role: "patient",
        action: "message_send",
        thread_id: out.thread_id, message_id: out.message_id,
        detail: { op: "thread_reply" },
    });

    // Phase 9.5 — record an encounter event so the clinician's case view
    // surfaces "patient replied" on the "what's new since you last looked"
    // panel and the patient is marked dirty for snapshot regeneration.
    // Best-effort: never blocks the reply.
    try {
        // Need the subject for the summary string; loadThread already
        // succeeded inside replyInThread so we can re-fetch lightly here.
        const subjRow = await env.DB.prepare(
            "SELECT subject FROM message_threads WHERE id = ? LIMIT 1"
        ).bind(out.thread_id).first();
        const subj = (subjRow && subjRow.subject) || "(no subject)";
        const { recordEncounterEvent } = await import("../../../../_lib/encounters.js");
        await recordEncounterEvent(env, {
            patient_id: session.patient_id,
            event_type: "message_reply",
            event_summary: `Patient replied in thread "${String(subj).slice(0, 80)}"`,
            severity: "info",
            ref_kind: "message",
            ref_id: out.message_id,
            details: { thread_id: out.thread_id, from_role: "patient" }
        });
    } catch {}

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

export async function onRequestPatch(ctx) {
    const { request, env, params } = ctx;
    const { allow } = await previewAccess(request, env);
    if (!allow) return preLaunchNotFound();

    let session;
    try { session = await requireRole(ctx, ["patient"]); }
    catch (resp) { return resp; }
    if (!session.patient_id || !env.DB) return err(500, "server_error", "DB not bound");

    const thread_id = String(params?.thread_id || "");
    if (!thread_id) return err(400, "bad_params");
    const thread = await loadThread(env, thread_id, session.patient_id);
    if (!thread) return err(404, "thread_not_found");

    await markThreadRead(env, thread_id, "patient");
    await auditMessage(env, request, {
        user_id: session.patient_id, user_role: "patient",
        action: "message_read",
        thread_id,
        detail: { op: "mark_read" },
    });
    return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}
