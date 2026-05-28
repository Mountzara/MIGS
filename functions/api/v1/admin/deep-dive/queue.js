// =====================================================================
// GET /api/v1/admin/deep-dive/queue
// =====================================================================
// Lists PMIDs needing deep-dive authoring.  Filter by surface_kind +
// surface_key to scope to a single brief / week.  Returns rows + per-
// status summary so the per-brief UI can render counts.
// =====================================================================

import { adminRoute, jsonResponse, jsonError } from "../../../../_lib/admin_api.js";
import { rowToWire, VALID_SURFACE_KINDS, VALID_STATUSES } from "../../../../_lib/deep_dive.js";

const DEFAULT_STATUSES = ["pending", "bundle_requested", "bundle_ready", "patch_uploaded"];

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env, request }) => {
        if (!env.DB) return jsonError("server_error: DB binding missing", 500);

        const url = new URL(request.url);
        const surfaceKind = url.searchParams.get("surface_kind");
        const surfaceKey  = url.searchParams.get("surface_key");
        const statusParam = url.searchParams.get("status");
        const includeAuthored = url.searchParams.get("include_authored") === "1";
        const limit = Math.min(
            Math.max(parseInt(url.searchParams.get("limit"), 10) || 100, 1),
            500,
        );

        if (surfaceKind && !VALID_SURFACE_KINDS.has(surfaceKind)) {
            return jsonError("bad surface_kind", 400);
        }

        const statuses = statusParam
            ? statusParam.split(",").map((s) => s.trim()).filter(Boolean)
            : (includeAuthored ? [...DEFAULT_STATUSES, "authored"] : DEFAULT_STATUSES);

        const where = [];
        const args = [];
        if (statuses.length > 0) {
            where.push(`status IN (${statuses.map(() => "?").join(",")})`);
            args.push(...statuses);
        }
        if (surfaceKind) { where.push("surface_kind = ?"); args.push(surfaceKind); }
        if (surfaceKey)  { where.push("surface_key = ?");  args.push(surfaceKey); }
        const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
        args.push(limit);

        const rowsRes = await env.DB.prepare(`
            SELECT id, surface_kind, surface_key, pmid,
                   paper_title, paper_journal, paper_year, paper_design,
                   status, status_reason,
                   bundle_r2_key, patch_r2_key, content_json,
                   bundle_requested_at, bundle_requested_by,
                   bundle_ready_at, patch_uploaded_at, patch_uploaded_by,
                   authored_at, pulled_at,
                   created_at, updated_at
            FROM deep_dive_authoring
            ${whereSql}
            ORDER BY
                CASE status
                    WHEN 'patch_uploaded'    THEN 0
                    WHEN 'bundle_ready'      THEN 1
                    WHEN 'bundle_requested'  THEN 2
                    WHEN 'pending'           THEN 3
                    WHEN 'authored'          THEN 4
                END,
                paper_year DESC,
                paper_title ASC
            LIMIT ?
        `).bind(...args).all();

        const rows = (rowsRes?.results || []).map(rowToWire);

        // Summary across all rows for this surface (ignoring status filter).
        const sumArgs = [];
        const sumWhere = [];
        if (surfaceKind) { sumWhere.push("surface_kind = ?"); sumArgs.push(surfaceKind); }
        if (surfaceKey)  { sumWhere.push("surface_key = ?");  sumArgs.push(surfaceKey); }
        const sumWhereSql = sumWhere.length ? `WHERE ${sumWhere.join(" AND ")}` : "";
        const sumRes = await env.DB.prepare(`
            SELECT status, COUNT(*) AS n FROM deep_dive_authoring ${sumWhereSql} GROUP BY status
        `).bind(...sumArgs).all();
        const summary = {};
        for (const r of (sumRes?.results || [])) summary[r.status] = r.n;

        return jsonResponse({
            ok: true,
            count: rows.length,
            summary,
            rows,
            filters_applied: {
                surface_kind: surfaceKind, surface_key: surfaceKey,
                statuses, include_authored: includeAuthored, limit,
            },
        });
    });
}
