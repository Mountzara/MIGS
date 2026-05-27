// =====================================================================
// GET /api/v1/admin/trend-briefs/overrides?since=<epoch_ms>
// =====================================================================
// Unified MAC-side polling endpoint.  The Mac orchestrator runs
// scripts/pull_approved_overrides.py at the head of every
// run_trend_tracker.sh invocation; that script GETs this endpoint
// with ?since=<last_pull_ts> and walks back two kinds of rows:
//
//   1. status='approved' rows where pulled_at is null or older than
//      approved_at — overrides ready to be applied to the next render.
//   2. status='pending' rows where suggestions_text is set and
//      pulled_at is null or older than suggestions_set_at — bundles
//      to materialize for Cowork peer-review.
//
// Each result carries a `kind` field: "approved_override" or
// "suggestions_pending".  The puller handles each kind differently
// (write override JSON locally vs materialize Cowork bundle).
//
// Auth: X-Pipeline-Token (mirrors /api/posts producer) OR admin Basic
// Auth (so the endpoint is testable from a browser).
// =====================================================================

import { jsonResponse, jsonError, readAdminIdentity } from "../../../../_lib/admin_api.js";
import { isPipelineRequest, safeParse } from "../../../../_lib/trend_briefs.js";

export async function onRequestGet(ctx) {
    const { env, request } = ctx;

    const isPipeline = isPipelineRequest(request, env);
    if (!isPipeline) {
        const admin = await readAdminIdentity(request, env);
        if (!admin) {
            return jsonError(
                "authentication_required (X-Pipeline-Token or admin Basic Auth)",
                401,
            );
        }
    }

    if (!env.DB) return jsonError("server_error: DB binding missing", 500);

    const url = new URL(request.url);
    const since = Math.max(parseInt(url.searchParams.get("since") || "0", 10) || 0, 0);
    const limit = Math.min(
        Math.max(parseInt(url.searchParams.get("limit") || "100", 10), 1),
        500,
    );
    const includePulled = url.searchParams.get("include_pulled") === "1";

    // Two unioned queries:
    //   - approved-override candidates: status='approved' and not-yet-pulled
    //   - suggestions-pending candidates: status='pending' with suggestions
    //     set and either never-pulled or pulled-before-suggestions
    const params1 = ["approved"];
    let where1 = "status = ?";
    if (since > 0) { where1 += " AND approved_at > ?"; params1.push(since); }
    if (!includePulled) where1 += " AND (pulled_at IS NULL OR pulled_at < approved_at)";

    const params2 = ["pending"];
    let where2 = "status = ? AND suggestions_text IS NOT NULL AND suggestions_set_at IS NOT NULL";
    if (since > 0) { where2 += " AND suggestions_set_at > ?"; params2.push(since); }
    if (!includePulled) where2 += " AND (pulled_at IS NULL OR pulled_at < suggestions_set_at)";

    const [res1, res2] = await Promise.all([
        env.DB.prepare(`
            SELECT id, slug, brief_date, approved_at, approved_by,
                   suggestions_text, suggestions_set_at,
                   override_r2_key,
                   'approved_override' AS kind,
                   approved_at AS sort_key
            FROM trend_brief_pending
            WHERE ${where1}
            ORDER BY approved_at ASC
            LIMIT ?
        `).bind(...params1, limit).all(),
        env.DB.prepare(`
            SELECT id, slug, brief_date, approved_at, approved_by,
                   suggestions_text, suggestions_set_at,
                   override_r2_key,
                   'suggestions_pending' AS kind,
                   suggestions_set_at AS sort_key
            FROM trend_brief_pending
            WHERE ${where2}
            ORDER BY suggestions_set_at ASC
            LIMIT ?
        `).bind(...params2, limit).all(),
    ]);

    const merged = [
        ...(res1?.results || []),
        ...(res2?.results || []),
    ].sort((a, b) => (a.sort_key || 0) - (b.sort_key || 0));

    const overrides = merged.map((r) => ({
        kind: r.kind,
        id: r.id,
        slug: r.slug,
        brief_date: r.brief_date,
        approved_at: r.approved_at,
        approved_by: r.approved_by,
        suggestions_text: r.suggestions_text || null,
        suggestions_set_at: r.suggestions_set_at || null,
        override_url:  `/api/v1/admin/trend-briefs/${encodeURIComponent(r.id)}/override-json`,
        body_html_url: `/api/v1/admin/trend-briefs/${encodeURIComponent(r.id)}/preview`,
        detail_url:    `/api/v1/admin/trend-briefs/${encodeURIComponent(r.id)}`,
    }));

    return jsonResponse({
        ok: true,
        since,
        server_now: Date.now(),
        count: overrides.length,
        overrides,
    });
}
