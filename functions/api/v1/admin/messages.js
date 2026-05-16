// =====================================================================
// /api/v1/admin/messages — clinician thread inbox
// =====================================================================
// GET   → list every thread the clinician has access to (newest first)
// POST  → start a new thread WITH a specific patient (clinician-initiated):
//         { patient_id, subject, body, related_appointment_id? }
//
// Per CLAUDE.md §11.5.1 — staff and clinician roles share the same admin
// inbox during Phase 3.
// =====================================================================

import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../_lib/admin_api.js";
import { listThreads, startThread, auditMessage } from "../../../_lib/messaging.js";

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env, request }) => {
        const url = new URL(request.url);
        const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "50", 10), 1), 100);
        const out = await listThreads(env, { side: "clinician", limit });
        if (!out.ok) return jsonError(out.error, 500);
        return jsonResponse({ threads: out.threads });
    });
}

export async function onRequestPost(ctx) {
    return adminRoute(ctx, async ({ env, request, admin }) => {
        const body = await readJsonBody(request);
        if (!body.patient_id) return jsonError("missing_patient_id", 400);

        // Confirm the patient exists.
        const patient = await env.DB.prepare(
            `SELECT id FROM patients WHERE id = ?`
        ).bind(body.patient_id).first();
        if (!patient) return jsonError("patient_not_found", 404);

        const out = await startThread(env, {
            patient_id: body.patient_id,
            from_role: "clinician",
            from_user_id: admin.user,
            subject: body.subject,
            body: body.body,
            related_appointment_id: body.related_appointment_id || null,
            related_intake_id: body.related_intake_id || null,
        });
        if (!out.ok) return jsonError(out.error, 400, { detail: out.detail });

        await auditMessage(env, request, {
            user_id: admin.user, user_role: admin.role,
            action: "message_send",
            thread_id: out.thread_id, message_id: out.message_id,
            detail: { op: "thread_create_by_clinician", patient_id: body.patient_id },
        });

        return jsonResponse({
            ok: true,
            thread_id: out.thread_id,
            message_id: out.message_id,
            created_at: out.created_at,
        }, { status: 201 });
    });
}
