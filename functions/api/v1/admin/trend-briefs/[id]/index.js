// =====================================================================
// GET /api/v1/admin/trend-briefs/<id>
// =====================================================================
// Per-brief detail view.  Returns the wire row + audit-event timeline
// + sidecar (parsed from R2) so the SPA can render everything in a
// single fetch.
// =====================================================================

import { adminRoute, jsonResponse, jsonError } from "../../../../../_lib/admin_api.js";
import { rowToWire, safeParse } from "../../../../../_lib/trend_briefs.js";

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env, request, params }) => {
        if (!env.DB)      return jsonError("server_error: DB binding missing", 500);
        if (!env.CONTENT) return jsonError("server_error: CONTENT R2 bucket binding missing", 500);

        const id = decodeURIComponent(String(params?.id || ""));
        if (!id) return jsonError("bad_id", 400);

        const row = await env.DB.prepare(`
            SELECT id, slug, brief_date, claim_text, influencer,
                   topics_covered, pmids_cited, kb_entries_retrieved, gaps_surfaced,
                   body_html_r2_key, sidecar_r2_key,
                   audit_table_json, audit_pass_count, audit_fail_count,
                   status, status_reason,
                   override_json, override_r2_key,
                   submitted_at, approved_at, approved_by, rejected_at, rejected_by,
                   pulled_at, rerender_passed, rerender_attempted_at, draft_post_id,
                   suggestions_text, suggestions_set_at,
                   created_at, updated_at
            FROM trend_brief_pending WHERE id = ?
        `).bind(id).first();
        if (!row) return jsonError("not_found", 404);

        // Timeline
        const eventsRes = await env.DB.prepare(`
            SELECT id, ts, actor, actor_label, event_kind, detail_json
            FROM trend_brief_audit_events
            WHERE brief_id = ?
            ORDER BY ts ASC
        `).bind(id).all();
        const events = (eventsRes?.results || []).map((e) => ({
            id: e.id, ts: e.ts, actor: e.actor, actor_label: e.actor_label,
            event_kind: e.event_kind, detail: safeParse(e.detail_json),
        }));

        // Sidecar pull (best-effort; if R2 misses we still return the row)
        let sidecar = null;
        try {
            const obj = await env.CONTENT.get(row.sidecar_r2_key);
            if (obj) sidecar = safeParse(await obj.text());
        } catch (e) {
            console.warn("sidecar R2 get failed (non-fatal)", { id, error: String(e) });
        }

        return jsonResponse({
            ok: true,
            brief: rowToWire(row),
            events,
            sidecar,
        });
    });
}
