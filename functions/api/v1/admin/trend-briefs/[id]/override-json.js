// =====================================================================
// GET /api/v1/admin/trend-briefs/<id>/override-json
// =====================================================================
// Raw approved override JSON, served by the Mac puller after it sees
// the row in /overrides.  Returns 404 until status='approved'.  Same
// auth model as the parent /overrides endpoint: pipeline token OR
// admin Basic Auth.
// =====================================================================

import { jsonResponse, jsonError, readAdminIdentity } from "../../../../../_lib/admin_api.js";
import { isPipelineRequest, safeParse } from "../../../../../_lib/trend_briefs.js";

export async function onRequestGet(ctx) {
    const { env, request, params } = ctx;

    const isPipeline = isPipelineRequest(request, env);
    if (!isPipeline) {
        const admin = await readAdminIdentity(request, env);
        if (!admin) return jsonError("authentication_required", 401);
    }

    if (!env.DB) return jsonError("server_error: DB binding missing", 500);

    const id = decodeURIComponent(String(params?.id || ""));
    if (!id) return jsonError("bad_id", 400);

    const row = await env.DB.prepare(
        "SELECT id, status, override_json FROM trend_brief_pending WHERE id = ?"
    ).bind(id).first();
    if (!row) return jsonError("not_found", 404);
    if (row.status !== "approved") {
        return jsonError(`not_approved (current_status=${row.status})`, 404);
    }
    if (!row.override_json) {
        return jsonError("override_missing_despite_approved_status", 500);
    }

    const parsed = safeParse(row.override_json);
    return jsonResponse({
        ok: true,
        id,
        override: parsed,
    });
}
