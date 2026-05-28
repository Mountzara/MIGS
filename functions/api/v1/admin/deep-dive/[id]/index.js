// =====================================================================
// GET /api/v1/admin/deep-dive/<id>
// =====================================================================
// Per-row detail: full row + audit timeline.
// =====================================================================

import { adminRoute, jsonResponse, jsonError } from "../../../../../_lib/admin_api.js";
import { rowToWire, safeParse } from "../../../../../_lib/deep_dive.js";

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env, params }) => {
        if (!env.DB) return jsonError("server_error: DB binding missing", 500);
        const id = decodeURIComponent(String(params?.id || ""));
        if (!id) return jsonError("bad_id", 400);

        const row = await env.DB.prepare(`
            SELECT id, surface_kind, surface_key, pmid,
                   paper_title, paper_journal, paper_year, paper_design,
                   status, status_reason,
                   bundle_r2_key, patch_r2_key, content_json,
                   bundle_requested_at, bundle_requested_by,
                   bundle_ready_at, patch_uploaded_at, patch_uploaded_by,
                   authored_at, pulled_at,
                   created_at, updated_at
            FROM deep_dive_authoring WHERE id = ?
        `).bind(id).first();
        if (!row) return jsonError("not_found", 404);

        const eventsRes = await env.DB.prepare(`
            SELECT id, ts, actor, actor_label, event_kind, detail_json
            FROM deep_dive_audit_events
            WHERE authoring_id = ?
            ORDER BY ts ASC
        `).bind(id).all();
        const events = (eventsRes?.results || []).map((e) => ({
            id: e.id, ts: e.ts, actor: e.actor, actor_label: e.actor_label,
            event_kind: e.event_kind, detail: safeParse(e.detail_json),
        }));

        return jsonResponse({
            ok: true,
            row: rowToWire(row),
            events,
        });
    });
}
