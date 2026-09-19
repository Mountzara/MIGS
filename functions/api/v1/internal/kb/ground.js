// =====================================================================
// POST /api/v1/internal/kb/ground — KB retrieval for the content pipeline
// =====================================================================
// The curated master KB lives in production D1 (kb_docs FTS5, with the
// field-aware kb_sections index when loaded) and is already the grounding
// source for every clinical AI task via _lib/clinical_grounding.js. The
// content pipeline needs the SAME retrieval: the cloud producer sessions
// that investigate trend claims and draft evidence briefs must ground
// their clinical framing in the KB — never in a model's general memory
// (the site's standing constitution, §0.8.1). This endpoint is that
// bridge: it exposes groundClinical() to pipeline-token callers, so the
// producer retrieves from the real corpus instead of shipping with a
// stale copy or, worse, without one.
//
// It is a THIN wrapper — retrieval logic, field-aware ranking, and the
// per-kind policies stay in _lib/clinical_grounding.js (one rulebook).
// Returns the groundClinical result verbatim: { grounded, chunks,
// context, citations, allowed_doc_ids, coverage, missing_terms, policy,
// reason? }. The KB is curated clinical knowledge — no PHI — but the
// endpoint is still auth-gated (pipeline token or admin) because the KB
// is the practice's editorial asset, not a public API.
//
// Auth: X-Pipeline-Token (the producer path) or admin auth (manual use).
// =====================================================================

import { jsonResponse, jsonError, readAdminIdentity } from "../../../../_lib/admin_api.js";
import { isPipelineRequest } from "../../../../_lib/trend_briefs.js";
import { groundClinical } from "../../../../_lib/clinical_grounding.js";

const MAX_QUERY_CHARS = 2000;

export async function onRequestPost(ctx) {
    const { request, env } = ctx;
    if (!env.DB) return jsonError("server_error: DB binding missing", 500);

    if (!isPipelineRequest(request, env)) {
        const admin = await readAdminIdentity(request, env);
        if (!admin) return jsonError("authentication_required", 401);
    }

    let body;
    try { body = await request.json(); }
    catch { return jsonError("invalid_json_body", 400); }

    const query = String(body.query || "").trim().slice(0, MAX_QUERY_CHARS);
    if (!query) return jsonError("query_required", 400);
    const kind = String(body.kind || "visit_prep").trim();
    const topK = Math.min(Math.max(parseInt(body.topK, 10) || 8, 1), 24);
    const maxChars = Math.min(Math.max(parseInt(body.maxChars, 10) || 6000, 400), 20000);

    const result = await groundClinical(env, { kind, query, topK, maxChars });
    return jsonResponse({ ok: true, query, ...result });
}
