// =====================================================================
// GET /api/v1/admin/deep-dive/<id>/patch-json
// =====================================================================
// Mac orchestrator pulls the raw patch content here so it can run
// apply_deep_dive_patch.py against the local working tree.
// =====================================================================

import { jsonResponse, jsonError, readAdminIdentity } from "../../../../../_lib/admin_api.js";
import { isPipelineRequest, safeParse } from "../../../../../_lib/deep_dive.js";

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

    const row = await env.DB.prepare(`
        SELECT id, surface_kind, surface_key, pmid, status, content_json
        FROM deep_dive_authoring WHERE id = ?
    `).bind(id).first();
    if (!row) return jsonError("not_found", 404);
    if (!row.content_json) return jsonError("no_content_yet", 404);

    return jsonResponse({
        ok: true,
        id,
        surface_kind: row.surface_kind,
        surface_key: row.surface_key,
        pmid: row.pmid,
        status: row.status,
        content: safeParse(row.content_json),
    });
}
