// =====================================================================
// POST /api/v1/patient/intake/new — start (or resume) an intake
// =====================================================================
// Per CLAUDE.md §11.6 — the 19-section Thorek intake. The endpoint is
// idempotent in the sense that if the patient already has an
// in_progress intake, it is returned rather than a duplicate created.
// This handles the very common "the patient started, paused, came back
// next day" flow without ever losing data.
//
// Response: { intake_id, status, started_at, completion_pct, resumed }
// =====================================================================

import { previewAccess, preLaunchNotFound } from "../../../../_lib/preview_gate.js";
import { requireRole, nowMs } from "../../../../_lib/auth.js";
import { logAudit } from "../../../../_lib/audit.js";
import { newId } from "../../../../_lib/db.js";

export async function onRequestPost(ctx) {
    const { request, env } = ctx;
    const { allow } = await previewAccess(request, env);
    if (!allow) return preLaunchNotFound();

    let session;
    try { session = await requireRole(ctx, ["patient"]); }
    catch (resp) { return resp; }
    if (!session.patient_id || !env.DB) {
        return new Response(JSON.stringify({ error: "server_error" }), { status: 500 });
    }

    const ip = request.headers.get("CF-Connecting-IP") || "";
    const ua = request.headers.get("User-Agent") || "";

    // Resume existing in-progress intake if any.
    const existing = await env.DB.prepare(`
        SELECT id, status, started_at, completion_pct
        FROM intake_responses
        WHERE patient_id = ? AND status = 'in_progress'
        ORDER BY started_at DESC LIMIT 1
    `).bind(session.patient_id).first();

    if (existing) {
        await logAudit(env, {
            user_id: session.patient_id,
            user_role: "patient",
            action: "intake_start",
            record_type: "intake",
            record_id: existing.id,
            ip, user_agent: ua,
            success: true,
            details: { resumed: true },
        });
        return new Response(JSON.stringify({
            intake_id: existing.id,
            status: existing.status,
            started_at: existing.started_at,
            completion_pct: existing.completion_pct,
            resumed: true,
        }), {
            status: 200,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
    }

    const intake_id = newId();
    const now = nowMs();
    try {
        await env.DB.prepare(`
            INSERT INTO intake_responses
                (id, patient_id, status, locale, started_at, updated_at, completion_pct)
            VALUES (?, ?, 'in_progress', 'en', ?, ?, 0)
        `).bind(intake_id, session.patient_id, now, now).run();
    } catch (e) {
        console.error("intake/new DB.insert threw", { error: String(e) });
        return new Response(JSON.stringify({ error: "server_error" }), { status: 500 });
    }

    await logAudit(env, {
        user_id: session.patient_id,
        user_role: "patient",
        action: "intake_start",
        record_type: "intake",
        record_id: intake_id,
        ip, user_agent: ua,
        success: true,
        details: { resumed: false },
    });

    return new Response(JSON.stringify({
        intake_id,
        status: "in_progress",
        started_at: now,
        completion_pct: 0,
        resumed: false,
    }), {
        status: 201,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}
