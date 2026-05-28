// =====================================================================
// POST /api/v1/admin/deep-dive/<id>/bundle-ready
// =====================================================================
// Mac orchestrator (pull_approved_overrides.py) calls this AFTER it
// runs prep_deep_dive_bundle.py and the .bundle.md is in place locally
// and the Cowork trigger string is on the clipboard.  Optionally
// uploads the bundle markdown to R2 for archival.
//
// Auth: X-Pipeline-Token (Mac orchestrator) OR admin Basic Auth.
//
// Body:
//   {
//     bundle_local_path: string,    // Mac path for diagnostic display
//     bundle_size_bytes: number,
//     bundle_markdown?: string,     // optional: upload to R2 for archival
//   }
// =====================================================================

import { jsonResponse, jsonError, readAdminIdentity } from "../../../../../_lib/admin_api.js";
import {
    isPipelineRequest, bundleR2Key, appendAuditEvent,
} from "../../../../../_lib/deep_dive.js";

const MAX_BUNDLE_BYTES = 600_000;  // 600 KB cap

export async function onRequestPost(ctx) {
    const { env, request, params } = ctx;

    const isPipeline = isPipelineRequest(request, env);
    let admin = null;
    if (!isPipeline) {
        admin = await readAdminIdentity(request, env);
        if (!admin) return jsonError("authentication_required", 401);
    }
    const actorLabel = isPipeline ? "mac_puller" : (admin?.user || "admin");

    if (!env.DB)      return jsonError("server_error: DB binding missing", 500);
    if (!env.CONTENT) return jsonError("server_error: CONTENT R2 bucket binding missing", 500);

    const id = decodeURIComponent(String(params?.id || ""));
    if (!id) return jsonError("bad_id", 400);

    const row = await env.DB.prepare(
        "SELECT id, status FROM deep_dive_authoring WHERE id = ?"
    ).bind(id).first();
    if (!row) return jsonError("not_found", 404);

    let body;
    try { body = await request.json(); }
    catch { return jsonError("invalid_json_body", 400); }

    const localPath = body.bundle_local_path ? String(body.bundle_local_path).slice(0, 500) : null;
    const bundleMd  = typeof body.bundle_markdown === "string" ? body.bundle_markdown : null;
    let r2Key = null;

    if (bundleMd) {
        if (bundleMd.length > MAX_BUNDLE_BYTES) {
            return jsonError(`bundle_markdown_too_large (>${MAX_BUNDLE_BYTES} bytes)`, 413);
        }
        r2Key = bundleR2Key(id);
        try {
            await env.CONTENT.put(r2Key, bundleMd, {
                httpMetadata: { contentType: "text/markdown; charset=utf-8" },
                customMetadata: { "mz-authoring-id": id, "mz-uploaded-at": String(Date.now()) },
            });
        } catch (e) {
            console.error("bundle R2 write failed", { id, error: String(e) });
            return jsonError("r2_write_failed: " + String(e), 502);
        }
    }

    const now = Date.now();
    try {
        await env.DB.prepare(`
            UPDATE deep_dive_authoring SET
                status = 'bundle_ready',
                bundle_ready_at = ?,
                bundle_local_path = COALESCE(?, bundle_local_path),
                bundle_r2_key = COALESCE(?, bundle_r2_key),
                pulled_at = COALESCE(pulled_at, ?),
                updated_at = ?
            WHERE id = ?
        `).bind(now, localPath, r2Key, now, now, id).run();
    } catch (e) {
        console.error("bundle-ready D1 update failed", { id, error: String(e) });
        return jsonError("d1_update_failed: " + String(e), 500);
    }

    ctx.waitUntil(appendAuditEvent(env, ctx, id, {
        ts: now,
        actor: isPipeline ? "mac_puller" : "admin",
        actor_label: actorLabel,
        event_kind: "bundle_materialized",
        detail: { local_path: localPath, has_r2_archive: !!r2Key, bundle_size: body.bundle_size_bytes || (bundleMd ? bundleMd.length : null) },
    }));

    return jsonResponse({
        ok: true,
        id,
        status: "bundle_ready",
        bundle_ready_at: now,
        bundle_r2_key: r2Key,
        bundle_local_path: localPath,
    });
}
