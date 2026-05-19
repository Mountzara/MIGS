// =====================================================================
// GET  /api/v1/patient/proms/:assignment_id      — get questionnaire to fill
// POST /api/v1/patient/proms/:assignment_id      — submit responses
// =====================================================================

import { requireRole } from "../../../../../_lib/auth.js";
import { getAssignment, getDefinition, submitResponse } from "../../../../../_lib/proms.js";

function jsonError(message, status = 400) {
    return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { "content-type": "application/json", "cache-control": "no-store" }
    });
}

export async function onRequestGet(ctx) {
    let session;
    try { session = await requireRole(ctx, ["patient"]); }
    catch (resp) { return resp; }
    const { patient_id } = session;
    const { assignment_id } = ctx.params || {};
    if (!assignment_id) return jsonError("missing_assignment_id", 400);

    const assignment = await getAssignment(ctx.env, assignment_id, patient_id);
    if (!assignment) return jsonError("not_found", 404);

    const def = await getDefinition(ctx.env, assignment.prom_slug);
    if (!def) return jsonError("definition_missing", 500);

    return new Response(JSON.stringify({ ok: true, assignment, definition: def }), {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" }
    });
}

export async function onRequestPost(ctx) {
    let session;
    try { session = await requireRole(ctx, ["patient"]); }
    catch (resp) { return resp; }
    const { patient_id } = session;
    const { assignment_id } = ctx.params || {};
    if (!assignment_id) return jsonError("missing_assignment_id", 400);

    let body = {};
    try { body = await ctx.request.json(); } catch { return jsonError("bad_request", 400); }
    if (!body || typeof body.response_data !== "object" || body.response_data === null) {
        return jsonError("missing_response_data", 400);
    }

    try {
        const result = await submitResponse(ctx.env, {
            assignment_id,
            patient_id,
            response_data: body.response_data
        });
        return new Response(JSON.stringify({ ok: true, ...result }), {
            status: 200,
            headers: { "content-type": "application/json", "cache-control": "no-store" }
        });
    } catch (e) {
        const msg = String(e && e.message || e);
        const status = (msg === "assignment_not_found") ? 404
                     : (msg === "already_completed") ? 409
                     : 400;
        return jsonError(msg, status);
    }
}
