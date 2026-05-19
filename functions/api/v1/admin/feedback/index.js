// =====================================================================
// /api/v1/admin/feedback — list the beta-tester feedback queue
// =====================================================================
// GET filters by ?status= (default "new,ai_analyzed,approved" — the
// actionable buckets), ?invite_label, ?feedback_type, ?route, ?limit (cap
// 200, default 60). Returns rows + per-status summary so the admin UI can
// render counts.
// =====================================================================

import { adminRoute, jsonResponse, jsonError } from "../../../../_lib/admin_api.js";

const DEFAULT_STATUSES = ["new", "ai_analyzed", "approved"];

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env, request }) => {
        if (!env.DB) return jsonError("server_error: DB binding missing", 500);

        const url = new URL(request.url);
        const statusParam = url.searchParams.get("status");
        const statuses = statusParam
            ? statusParam.split(",").map((s) => s.trim()).filter(Boolean)
            : DEFAULT_STATUSES;
        const label = url.searchParams.get("invite_label");
        const type  = url.searchParams.get("feedback_type");
        const route = url.searchParams.get("route");
        const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit"), 10) || 60, 1), 200);

        // Build WHERE clause dynamically (parameterized).
        const where = [];
        const args = [];
        if (statuses.length > 0) {
            where.push(`status IN (${statuses.map(() => "?").join(",")})`);
            args.push(...statuses);
        }
        if (label) { where.push("invite_label = ?"); args.push(label); }
        if (type)  { where.push("feedback_type = ?"); args.push(type); }
        if (route) { where.push("route LIKE ?"); args.push(`%${route}%`); }
        const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

        // Rows.
        args.push(limit);
        const rowsRes = await env.DB.prepare(`
            SELECT id, patient_id, invite_label, route, viewport_width, viewport_height,
                   feedback_type, severity, comment_text, detail_json,
                   screenshot_r2_key, status, status_reason,
                   ai_recommendation_json, ai_generated_at,
                   approved_at, approved_by, implemented_at, implemented_in_commit,
                   created_at, updated_at
            FROM member_feedback
            ${whereSql}
            ORDER BY created_at DESC
            LIMIT ?
        `).bind(...args).all();

        const rows = (rowsRes?.results || []).map((r) => ({
            ...r,
            detail: r.detail_json ? safeParse(r.detail_json) : null,
            ai_recommendation: r.ai_recommendation_json ? safeParse(r.ai_recommendation_json) : null,
            detail_json: undefined,
            ai_recommendation_json: undefined,
            has_screenshot: !!r.screenshot_r2_key,
            screenshot_r2_key: undefined,                   // never re-emit the key over the wire
        }));

        // Summary (all-status counts ignoring filters, for the UI badge bar).
        const sumRes = await env.DB.prepare(`
            SELECT status, COUNT(*) AS n FROM member_feedback GROUP BY status
        `).all();
        const summary = {};
        for (const r of (sumRes?.results || [])) summary[r.status] = r.n;

        return jsonResponse({
            ok: true,
            count: rows.length,
            summary,
            feedback: rows,
            filters_applied: { statuses, label, type, route, limit },
        });
    });
}

function safeParse(s) {
    try { return JSON.parse(s); } catch { return { _parse_error: true, _raw: String(s).slice(0, 120) }; }
}
