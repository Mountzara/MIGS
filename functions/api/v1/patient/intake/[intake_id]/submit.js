// =====================================================================
// POST /api/v1/patient/intake/<intake_id>/submit — finalize an intake
// =====================================================================
// Marks the intake_responses row status='submitted' + submitted_at=now,
// which freezes section edits (the PATCH endpoint rejects writes once
// status is not in_progress).
//
// Side effects per §11.6:
//   * If mental_health_screening shows PHQ-2 ≥ 3 OR surgical_anxiety
//     in {moderate, severe}, record a `mental_health_flag` detail on
//     the audit row so the clinician dashboard can surface it.
//   * Schedule (Phase 2.5) AI triage runs off intake_submit downstream;
//     we just write the audit row here and let the triage worker pick
//     up the work.
// =====================================================================

import { previewAccess, preLaunchNotFound } from "../../../../../_lib/preview_gate.js";
import { requireRole, nowMs } from "../../../../../_lib/auth.js";
import { logAudit } from "../../../../../_lib/audit.js";

function err(status, code, message) {
    return new Response(JSON.stringify({ error: code, message }), {
        status,
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

    const intake_id = String(params?.intake_id || "");
    if (!intake_id) return err(400, "bad_params", "intake_id required");

    const intake = await env.DB.prepare(`
        SELECT id, status FROM intake_responses WHERE id = ? AND patient_id = ?
    `).bind(intake_id, session.patient_id).first();
    if (!intake) return err(404, "intake_not_found", "no such intake for this patient");
    if (intake.status === "submitted" || intake.status === "reviewed") {
        return err(409, "already_submitted", `intake is ${intake.status}`);
    }

    // Confirm at least the consent (section 2) is on file before submit.
    const consent = await env.DB.prepare(`
        SELECT data_json FROM intake_section_data WHERE intake_id = ? AND section_number = 2
    `).bind(intake_id).first();
    if (!consent) {
        return err(409, "consent_required", "section 2 (consent) must be saved before submit");
    }

    // Inspect section 17 (mental health) for flagging.
    let mh_flag = null;
    try {
        const mh = await env.DB.prepare(`
            SELECT data_json FROM intake_section_data WHERE intake_id = ? AND section_number = 17
        `).bind(intake_id).first();
        if (mh?.data_json) {
            const d = JSON.parse(mh.data_json);
            const phq2 = (Number(d?.phq2_anhedonia) || 0) + (Number(d?.phq2_depressed) || 0);
            const anx = String(d?.surgical_anxiety || "").toLowerCase();
            if (phq2 >= 3 || anx === "moderate" || anx === "severe") {
                mh_flag = { phq2_total: phq2, surgical_anxiety: anx || null };
            }
        }
    } catch (e) {
        console.warn("intake submit mh parse warn", { error: String(e) });
    }

    const now = nowMs();
    try {
        await env.DB.prepare(`
            UPDATE intake_responses
            SET status = 'submitted', submitted_at = ?, updated_at = ?
            WHERE id = ?
        `).bind(now, now, intake_id).run();
    } catch (e) {
        console.error("intake submit DB.run threw", { error: String(e) });
        return err(500, "server_error", "could not submit intake");
    }

    await logAudit(env, {
        user_id: session.patient_id,
        user_role: "patient",
        action: "intake_submit",
        record_type: "intake",
        record_id: intake_id,
        ip: request.headers.get("CF-Connecting-IP") || "",
        user_agent: request.headers.get("User-Agent") || "",
        success: true,
        details: mh_flag ? { mental_health_flag: mh_flag } : null,
    });

    return new Response(JSON.stringify({
        ok: true,
        intake_id,
        status: "submitted",
        submitted_at: now,
        mental_health_flag: mh_flag,
    }), {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}
