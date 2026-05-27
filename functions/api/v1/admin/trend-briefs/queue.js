// =====================================================================
// GET /api/v1/admin/trend-briefs/queue
// =====================================================================
// Lists trend-brief peer-review queue rows.  Default filter: status in
// ("pending", "approved") with rerender_passed != 1 — i.e. items still
// requiring operator attention.  Pass ?status=<csv> to override; pass
// ?include_done=1 to include approved+re-rendered items (history view).
// Also returns per-status counts for the badge bar.
// =====================================================================

import { adminRoute, jsonResponse, jsonError } from "../../../../_lib/admin_api.js";
import { rowToWire } from "../../../../_lib/trend_briefs.js";

const DEFAULT_STATUSES = ["pending", "approved"];

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env, request }) => {
        if (!env.DB) return jsonError("server_error: DB binding missing", 500);

        const url = new URL(request.url);
        const statusParam = url.searchParams.get("status");
        const statuses = statusParam
            ? statusParam.split(",").map((s) => s.trim()).filter(Boolean)
            : DEFAULT_STATUSES;
        const includeDone = url.searchParams.get("include_done") === "1";
        const briefDate   = url.searchParams.get("brief_date");
        const slug        = url.searchParams.get("slug");
        const limit = Math.min(
            Math.max(parseInt(url.searchParams.get("limit"), 10) || 60, 1),
            300,
        );

        const where = [];
        const args = [];
        if (statuses.length > 0) {
            where.push(`status IN (${statuses.map(() => "?").join(",")})`);
            args.push(...statuses);
        }
        if (!includeDone) {
            // Hide approved+re-rendered (already moved on to /admin/content/ queue).
            where.push("(rerender_passed IS NULL OR rerender_passed != 1)");
        }
        if (briefDate) { where.push("brief_date = ?"); args.push(briefDate); }
        if (slug)      { where.push("slug = ?");       args.push(slug); }
        const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

        args.push(limit);

        const rowsRes = await env.DB.prepare(`
            SELECT id, slug, brief_date, claim_text, influencer,
                   topics_covered, pmids_cited, kb_entries_retrieved, gaps_surfaced,
                   audit_table_json, audit_pass_count, audit_fail_count,
                   status, status_reason,
                   override_json, override_r2_key,
                   submitted_at, approved_at, approved_by, rejected_at, rejected_by,
                   pulled_at, rerender_passed, rerender_attempted_at, draft_post_id,
                   suggestions_text, suggestions_set_at,
                   created_at, updated_at
            FROM trend_brief_pending
            ${whereSql}
            ORDER BY submitted_at DESC
            LIMIT ?
        `).bind(...args).all();

        const briefs = (rowsRes?.results || []).map(rowToWire);

        // Summary across all statuses (ignoring filters) for the UI badge bar.
        const sumRes = await env.DB.prepare(`
            SELECT status, COUNT(*) AS n FROM trend_brief_pending GROUP BY status
        `).all();
        const summary = {};
        for (const r of (sumRes?.results || [])) summary[r.status] = r.n;

        return jsonResponse({
            ok: true,
            count: briefs.length,
            summary,
            briefs,
            filters_applied: { statuses, include_done: includeDone, brief_date: briefDate, slug, limit },
        });
    });
}
