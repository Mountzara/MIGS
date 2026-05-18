// =====================================================================
// /api/v1/admin/messages/<thread_id> — clinician thread view + reply
// =====================================================================
// GET   → all messages + mark-read for the clinician side.
// POST  → clinician reply: { body }
// PATCH → mark-read only.
// =====================================================================

import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../../_lib/admin_api.js";
import {
    loadThreadMessages, replyInThread, markThreadRead, auditMessage,
    CLINICIAN_ID,
} from "../../../../_lib/messaging.js";

async function loadThread(env, thread_id) {
    return env.DB.prepare(`
        SELECT t.id, t.patient_id, t.clinician_id, t.subject,
               t.last_message_at, t.last_message_from_role,
               t.patient_unread_count, t.clinician_unread_count,
               t.status, t.related_appointment_id, t.related_intake_id,
               t.created_at, t.updated_at,
               p.first_name AS patient_first_name,
               p.last_name  AS patient_last_name,
               p.email      AS patient_email
        FROM message_threads t
        LEFT JOIN patients p ON p.id = t.patient_id
        WHERE t.id = ? AND t.clinician_id = ?
    `).bind(thread_id, CLINICIAN_ID).first();
}

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env, request, admin, ctx: c }) => {
        const id = String(ctx.params?.id || ctx.params?.thread_id || "");
        if (!id) return jsonError("bad_params", 400);
        const thread = await loadThread(env, id);
        if (!thread) return jsonError("thread_not_found", 404);
        const messages = await loadThreadMessages(env, id);
        await markThreadRead(env, id, "clinician");
        await auditMessage(env, request, {
            user_id: admin.user, user_role: admin.role,
            action: "message_read",
            thread_id: id,
            detail: { op: "thread_view_by_clinician", message_count: messages.length },
        });
        return jsonResponse({
            thread: { ...thread, clinician_unread_count: 0 },
            messages,
        });
    });
}

export async function onRequestPost(ctx) {
    return adminRoute(ctx, async ({ env, request, admin }) => {
        const id = String(ctx.params?.id || ctx.params?.thread_id || "");
        if (!id) return jsonError("bad_params", 400);
        const thread = await loadThread(env, id);
        if (!thread) return jsonError("thread_not_found", 404);

        const body = await readJsonBody(request);
        const out = await replyInThread(env, {
            thread_id: id,
            patient_id: thread.patient_id,
            from_role: "clinician",
            from_user_id: admin.user,
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
            return jsonError(out.error, map[out.error] || 400, { detail: out.detail });
        }
        await auditMessage(env, request, {
            user_id: admin.user, user_role: admin.role,
            action: "message_send",
            thread_id: out.thread_id, message_id: out.message_id,
            detail: { op: "thread_reply_by_clinician" },
        });
        // Phase 9.5 — record an encounter event so the patient is marked dirty
        // and the case-view "what's new since you last looked" panel surfaces
        // the clinician outbound. Best-effort: never blocks the reply.
        try {
            const { recordEncounterEvent } = await import("../../../../_lib/encounters.js");
            await recordEncounterEvent(env, {
                patient_id: thread.patient_id,
                event_type: "message_reply",
                event_summary: `Clinician replied in thread "${(thread.subject || "(no subject)").slice(0, 80)}"`,
                severity: "info",
                ref_kind: "message",
                ref_id: out.message_id,
                details: { thread_id: out.thread_id, from_role: "clinician" }
            });
        } catch {}
        return jsonResponse({
            ok: true,
            thread_id: out.thread_id,
            message_id: out.message_id,
            created_at: out.created_at,
        }, { status: 201 });
    });
}

export async function onRequestPatch(ctx) {
    return adminRoute(ctx, async ({ env, request, admin }) => {
        const id = String(ctx.params?.id || ctx.params?.thread_id || "");
        if (!id) return jsonError("bad_params", 400);
        const thread = await loadThread(env, id);
        if (!thread) return jsonError("thread_not_found", 404);
        await markThreadRead(env, id, "clinician");
        await auditMessage(env, request, {
            user_id: admin.user, user_role: admin.role,
            action: "message_read",
            thread_id: id,
            detail: { op: "mark_read_by_clinician" },
        });
        return jsonResponse({ ok: true });
    });
}
