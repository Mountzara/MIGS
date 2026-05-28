// =====================================================================
// GET /api/v1/admin/deep-dive/pull?since=<epoch_ms>
// =====================================================================
// Mac orchestrator (pull_approved_overrides.py) polls this to discover
// rows needing pipeline work:
//
//   - status='bundle_requested' AND pulled_at < bundle_requested_at:
//       Mac side runs prep_deep_dive_bundle.py to materialize the
//       Cowork bundle + pbcopy a trigger string + macOS notify, then
//       POSTs /<id>/bundle-ready.
//
//   - status='patch_uploaded' AND pulled_at < patch_uploaded_at:
//       Mac side downloads the patch JSON via /<id>/patch-json and
//       runs apply_deep_dive_patch.py to merge into the surface
//       storage, then POSTs /<id>/patch with mark_authored=true.
//
// Auth: X-Pipeline-Token OR admin Basic Auth.
// =====================================================================

import { jsonResponse, jsonError, readAdminIdentity } from "../../../../_lib/admin_api.js";
import { isPipelineRequest } from "../../../../_lib/deep_dive.js";

export async function onRequestGet(ctx) {
    const { env, request } = ctx;
    const isPipeline = isPipelineRequest(request, env);
    if (!isPipeline) {
        const admin = await readAdminIdentity(request, env);
        if (!admin) return jsonError("authentication_required", 401);
    }
    if (!env.DB) return jsonError("server_error: DB binding missing", 500);

    const url = new URL(request.url);
    const since = Math.max(parseInt(url.searchParams.get("since") || "0", 10) || 0, 0);
    const limit = Math.min(
        Math.max(parseInt(url.searchParams.get("limit") || "100", 10), 1),
        500,
    );

    // Two unioned selects.
    const [resA, resB] = await Promise.all([
        env.DB.prepare(`
            SELECT id, surface_kind, surface_key, pmid,
                   paper_title, paper_journal, paper_year, paper_design,
                   bundle_requested_at, bundle_requested_by, pulled_at,
                   'bundle_request' AS work_kind,
                   bundle_requested_at AS sort_key
            FROM deep_dive_authoring
            WHERE status = 'bundle_requested'
              AND (pulled_at IS NULL OR pulled_at < bundle_requested_at)
              AND (? = 0 OR bundle_requested_at > ?)
            ORDER BY bundle_requested_at ASC
            LIMIT ?
        `).bind(since, since, limit).all(),
        env.DB.prepare(`
            SELECT id, surface_kind, surface_key, pmid,
                   paper_title, paper_journal, paper_year, paper_design,
                   patch_uploaded_at, patch_uploaded_by, pulled_at,
                   'apply_patch' AS work_kind,
                   patch_uploaded_at AS sort_key
            FROM deep_dive_authoring
            WHERE status = 'patch_uploaded'
              AND (pulled_at IS NULL OR pulled_at < patch_uploaded_at)
              AND (? = 0 OR patch_uploaded_at > ?)
            ORDER BY patch_uploaded_at ASC
            LIMIT ?
        `).bind(since, since, limit).all(),
    ]);

    const merged = [...(resA?.results || []), ...(resB?.results || [])]
        .sort((a, b) => (a.sort_key || 0) - (b.sort_key || 0));

    const work = merged.map((r) => ({
        work_kind: r.work_kind,                              // 'bundle_request' | 'apply_patch'
        id: r.id,
        surface_kind: r.surface_kind,
        surface_key: r.surface_key,
        pmid: r.pmid,
        paper_title: r.paper_title,
        paper_journal: r.paper_journal,
        paper_year: r.paper_year,
        paper_design: r.paper_design,
        bundle_requested_at: r.bundle_requested_at,
        patch_uploaded_at: r.patch_uploaded_at,
        // For apply_patch work: Mac downloads the patch via /<id>/patch-json
        patch_url: r.work_kind === "apply_patch"
            ? `/api/v1/admin/deep-dive/${encodeURIComponent(r.id)}/patch-json`
            : null,
    }));

    return jsonResponse({
        ok: true,
        since,
        server_now: Date.now(),
        count: work.length,
        work,
    });
}
