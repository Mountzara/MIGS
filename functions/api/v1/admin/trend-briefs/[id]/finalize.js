// =====================================================================
// POST /api/v1/admin/trend-briefs/<id>/finalize
// =====================================================================
// Called by the Mac orchestrator AFTER:
//   1. pull_approved_overrides.py downloaded the override locally
//   2. The next render → §3.8 verify → /api/posts POST cycle completed
//
// The producer reports back to this endpoint with the outcome so the
// queue surface can move the row out of the "Needs review" view into
// the "Recently approved → live draft" history view.
//
// Auth: pipeline token (Mac orchestrator) OR admin Basic Auth.
//
// Body:
//   { rerender_passed: bool, draft_post_id: string|null,
//     pulled_at: int|null, failure_detail: string|null }
// =====================================================================

import { jsonResponse, jsonError, readAdminIdentity } from "../../../../../_lib/admin_api.js";
import {
    isPipelineRequest, appendAuditEvent,
} from "../../../../../_lib/trend_briefs.js";

export async function onRequestPost(ctx) {
    const { env, request, params } = ctx;

    const isPipeline = isPipelineRequest(request, env);
    let admin = null;
    if (!isPipeline) {
        admin = await readAdminIdentity(request, env);
        if (!admin) return jsonError("authentication_required", 401);
    }
    const actorLabel = isPipeline ? "pipeline:trend_tracker" : (admin?.user || "admin");

    if (!env.DB) return jsonError("server_error: DB binding missing", 500);

    const id = decodeURIComponent(String(params?.id || ""));
    if (!id) return jsonError("bad_id", 400);

    const row = await env.DB.prepare(
        "SELECT id, status FROM trend_brief_pending WHERE id = ?"
    ).bind(id).first();
    if (!row) return jsonError("not_found", 404);

    let body;
    try { body = await request.json(); }
    catch { return jsonError("invalid_json_body", 400); }

    const rerenderPassed = body.rerender_passed === true ? 1 : 0;
    const draftPostId = body.draft_post_id ? String(body.draft_post_id).slice(0, 200) : null;
    const pulledAtIn  = Number.isFinite(body.pulled_at) ? body.pulled_at : null;
    const failureDetail = body.failure_detail
        ? String(body.failure_detail).slice(0, 2000)
        : null;

    const now = Date.now();
    const pulledAt = pulledAtIn ?? now;

    try {
        await env.DB.prepare(`
            UPDATE trend_brief_pending SET
                pulled_at = COALESCE(pulled_at, ?),
                rerender_passed = ?,
                rerender_attempted_at = ?,
                draft_post_id = ?,
                updated_at = ?
            WHERE id = ?
        `).bind(pulledAt, rerenderPassed, now, draftPostId, now, id).run();
    } catch (e) {
        console.error("finalize D1 update failed", { id, error: String(e) });
        return jsonError("d1_update_failed: " + String(e), 500);
    }

    ctx.waitUntil(appendAuditEvent(env, ctx, id, {
        ts: now,
        actor: isPipeline ? "mac_puller" : "admin",
        actor_label: actorLabel,
        event_kind: rerenderPassed ? "rerender_ok" : "rerender_fail",
        detail: {
            draft_post_id: draftPostId,
            failure_detail_preview: failureDetail ? failureDetail.slice(0, 200) : null,
        },
    }));

    return jsonResponse({
        ok: true,
        id,
        rerender_passed: !!rerenderPassed,
        draft_post_id: draftPostId,
        pulled_at: pulledAt,
        rerender_attempted_at: now,
    });
}
