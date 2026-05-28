// =====================================================================
// POST /api/v1/admin/deep-dive/discover
// =====================================================================
// Producer-facing.  Pipeline (publish_to_admin / rebuild_w<N>_post) or
// admin calls this when a brief / week is submitted so every cited
// PMID gets a `pending` row in the authoring queue.  Idempotent — re-
// posting the same PMID set refreshes paper metadata but does not
// re-queue in-flight authoring.
//
// Auth: X-Pipeline-Token OR admin Basic Auth.
//
// Body:
//   {
//     surface_kind: 'trend_brief' | 'monday_morning',
//     surface_key:  'YYYY-MM-DD__<slug>' | 'W<N>',
//     pmids: [
//       { pmid: '34899597', title: '...', journal: '...', year: 2021, design: '...' },
//       ...
//     ]
//   }
// =====================================================================

import { jsonResponse, jsonError, readAdminIdentity } from "../../../../_lib/admin_api.js";
import {
    isPipelineRequest, upsertDiscoveredPmid, appendAuditEvent,
    VALID_SURFACE_KINDS,
} from "../../../../_lib/deep_dive.js";

export async function onRequestPost(ctx) {
    const { env, request } = ctx;
    const isPipeline = isPipelineRequest(request, env);
    let admin = null;
    if (!isPipeline) {
        admin = await readAdminIdentity(request, env);
        if (!admin) return jsonError("authentication_required", 401);
    }
    const actorLabel = isPipeline ? "pipeline" : (admin?.user || "admin");

    if (!env.DB) return jsonError("server_error: DB binding missing", 500);

    let body;
    try { body = await request.json(); }
    catch { return jsonError("invalid_json_body", 400); }

    const surfaceKind = String(body.surface_kind || "").trim();
    const surfaceKey  = String(body.surface_key  || "").trim();
    const pmids       = Array.isArray(body.pmids) ? body.pmids : null;

    if (!VALID_SURFACE_KINDS.has(surfaceKind)) return jsonError("bad surface_kind", 400);
    if (!surfaceKey)   return jsonError("surface_key required", 400);
    if (!pmids)        return jsonError("pmids[] required", 400);
    if (pmids.length > 200) return jsonError("pmids[] too long (>200)", 413);

    const results = [];
    for (const p of pmids) {
        const pmid = String(p.pmid || "").trim();
        if (!pmid) continue;
        try {
            const r = await upsertDiscoveredPmid(env, {
                surfaceKind, surfaceKey, pmid,
                paperTitle:  p.title  ? String(p.title).slice(0, 500) : null,
                paperJournal: p.journal ? String(p.journal).slice(0, 200) : null,
                paperYear:   Number.isFinite(p.year) ? p.year : null,
                paperDesign: p.design ? String(p.design).slice(0, 100) : null,
            });
            results.push({ pmid, ...r });
            if (r.action === "inserted") {
                ctx.waitUntil(appendAuditEvent(env, ctx, r.id, {
                    actor: isPipeline ? "pipeline" : "admin",
                    actor_label: actorLabel,
                    event_kind: "discovered",
                    detail: { paper_title_preview: (p.title || "").slice(0, 80) },
                }));
            }
        } catch (e) {
            results.push({ pmid, error: String(e) });
        }
    }

    const inserted  = results.filter((r) => r.action === "inserted").length;
    const refreshed = results.filter((r) => r.action === "refreshed").length;
    const errors    = results.filter((r) => r.error).length;

    return jsonResponse({
        ok: true,
        surface_kind: surfaceKind,
        surface_key: surfaceKey,
        total: results.length,
        inserted, refreshed, errors,
        results,
    });
}
