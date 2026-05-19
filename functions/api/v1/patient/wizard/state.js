// =====================================================================
// GET /api/v1/patient/wizard/state — wizard step state for current patient
// PATCH same path — flip enabled flag, mark step skipped, snooze, etc.
// =====================================================================

import { previewAccess, preLaunchNotFound } from "../../../../_lib/preview_gate.js";
import { requireRole } from "../../../../_lib/auth.js";
import { computeStepStatus, patchWizardState } from "../../../../_lib/wizard.js";
import { recordTrace } from "../../../../_lib/session_trace.js";

function err(status, code, message) {
    return new Response(JSON.stringify({ error: code, message }), {
        status, headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

export async function onRequestGet(ctx) {
    const { request, env } = ctx;
    const { allow } = await previewAccess(request, env);
    if (!allow) return preLaunchNotFound();

    let session;
    try { session = await requireRole(ctx, ["patient"]); }
    catch (resp) { return resp; }
    if (!session.patient_id || !env.DB) return err(500, "server_error", "DB binding missing");

    let state;
    try { state = await computeStepStatus(env, session.patient_id); }
    catch (e) {
        console.error("wizard state compute threw", { error: String(e), patient_id: session.patient_id });
        return err(500, "server_error", "could not compute wizard state");
    }

    await recordTrace(env, {
        request, patient_id: session.patient_id,
        action: "wizard_state_read", outcome: "ok", http_status: 200,
        detail: { pct: state.completion_pct, enabled: state.enabled, next: state.next_step_key },
    });

    return new Response(JSON.stringify({ ok: true, wizard: state }), {
        status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

export async function onRequestPatch(ctx) {
    const { request, env } = ctx;
    const { allow } = await previewAccess(request, env);
    if (!allow) return preLaunchNotFound();

    let session;
    try { session = await requireRole(ctx, ["patient"]); }
    catch (resp) { return resp; }
    if (!session.patient_id || !env.DB) return err(500, "server_error", "DB binding missing");

    let body;
    try { body = await request.json(); }
    catch { return err(400, "bad_json", "expected JSON"); }
    if (!body || typeof body !== "object") return err(400, "bad_payload", "object required");

    try {
        await patchWizardState(env, session.patient_id, {
            enabled:               typeof body.enabled === "boolean" ? body.enabled : undefined,
            step_key:              typeof body.step_key === "string" ? body.step_key : undefined,
            skipped:               typeof body.skipped === "boolean" ? body.skipped : undefined,
            snooze_for_ms:         typeof body.snooze_for_ms === "number" ? body.snooze_for_ms : undefined,
            clear_snooze:          body.clear_snooze === true,
            snooze_until_global_ms: typeof body.snooze_until_global_ms === "number" ? body.snooze_until_global_ms : undefined,
            clear_global_snooze:   body.clear_global_snooze === true,
            bump_opened:           body.bump_opened === true,
        });
    } catch (e) {
        console.error("wizard PATCH threw", { error: String(e), patient_id: session.patient_id });
        return err(400, "bad_request", e?.message || String(e));
    }

    const state = await computeStepStatus(env, session.patient_id);

    await recordTrace(env, {
        request, patient_id: session.patient_id,
        action: "wizard_state_patch", outcome: "ok", http_status: 200,
        detail: {
            enabled_set: typeof body.enabled === "boolean" ? body.enabled : null,
            step_skip:   body.step_key && body.skipped ? body.step_key : null,
            snooze_for_ms: body.snooze_for_ms || null,
            global_snooze: body.snooze_until_global_ms || null,
        },
    });

    return new Response(JSON.stringify({ ok: true, wizard: state }), {
        status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}
