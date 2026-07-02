// =====================================================================
// /api/v1/admin/carousels                — list + ingest carousel drafts
// /api/v1/admin/carousels/<slug>         — detail + approve/reject       (in [slug].js)
// /api/v1/admin/carousels/<slug>/asset/<file>  — R2-proxied asset        (in asset/[name].js)
//
// Round E of phase 13 — admin queue integration for the social-media
// carousel pipeline (§3.11). Mirrors the /api/posts pattern.
//
// Storage in R2 (binding = CONTENT, same bucket the posts API uses):
//   carousels/<slug>.json                       — manifest + metadata
//   carousel-assets/<slug>/<file>               — PDF + PNGs + captions
//   _index/carousels.json                       — sorted list of summaries
//
// Auth model (mirrors /api/posts):
//   - GET list/detail: requires admin Basic Auth (carousels carry PHI-free
//     editorial content but they're pre-publish drafts; gated for now).
//   - POST ingest: requires X-Pipeline-Token (set by the publisher script).
//   - POST approve / reject: requires admin Basic Auth.
// =====================================================================

import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../../_lib/admin_api.js";

const CAROUSEL_INDEX_KEY = "_index/carousels.json";
const ALLOWED_STATUSES = new Set(["draft", "approved", "rejected", "published"]);
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{2,80}$/;

function isPipelineToken(request, env) {
    const tok = request.headers.get("X-Pipeline-Token") || "";
    const expected = env.PIPELINE_TOKEN || "";
    if (!tok || !expected || tok.length !== expected.length) return false;
    // Constant-time compare (2026-07-02) — was a plain ===, unlike the posts
    // and trend-brief ingestion paths which already compare constant-time.
    let diff = 0;
    for (let i = 0; i < tok.length; i++) diff |= tok.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
}

async function loadIndex(env) {
    const obj = await env.CONTENT.get(CAROUSEL_INDEX_KEY);
    if (!obj) return [];
    try { return JSON.parse(await obj.text()) || []; } catch { return []; }
}

async function saveIndex(env, list) {
    await env.CONTENT.put(
        CAROUSEL_INDEX_KEY,
        JSON.stringify(list, null, 2),
        { httpMetadata: { contentType: "application/json; charset=utf-8" } },
    );
}

function summarize(c) {
    return {
        slug: c.slug,
        title: c.title || c.slug,
        handle_line: c.handle_line || "",
        post_topic: c.post_topic || "",
        week_label: c.week_label || "",
        status: c.status,
        slide_count: c.slide_count || 0,
        cover_png_url: c.cover_png_url || null,
        ready_to_publish: !!c.ready_to_publish,
        created_at: c.created_at,
        approved_at: c.approved_at || null,
        rejected_at: c.rejected_at || null,
    };
}

// ---------------------------------------------------------------------
// GET /api/v1/admin/carousels — list
// ---------------------------------------------------------------------
async function handleList(request, env) {
    const url = new URL(request.url);
    const status = (url.searchParams.get("status") || "").toLowerCase();

    const list = await loadIndex(env);
    let filtered = list;
    if (status && ALLOWED_STATUSES.has(status)) {
        filtered = list.filter((c) => c.status === status);
    }
    return jsonResponse({ carousels: filtered.map(summarize) });
}

// ---------------------------------------------------------------------
// POST /api/v1/admin/carousels — ingest a fresh carousel bundle
// Body shape (from publish_carousel_to_admin.py):
//   {
//     slug: "cbgmigs_monday_26_w21",
//     deck: { ...full deck JSON... },
//     verification: { ready_to_publish: true, checks: [...] },
//     captions: { linkedin: "...", instagram: "..." },
//     alt_text: { "0": "...", "1": "...", ... },
//     hashtags: { linkedin: [...], instagram: [...] },
//     assets: { [filename]: "<base64>" }   // PDF + PNGs
//   }
// ---------------------------------------------------------------------
async function handleIngest(request, env) {
    if (!isPipelineToken(request, env)) {
        return jsonError("missing or invalid X-Pipeline-Token", 401);
    }
    const body = await readJsonBody(request);
    if (!body) return jsonError("invalid JSON body", 400);

    const slug = (body.slug || "").trim();
    if (!SLUG_RE.test(slug)) {
        return jsonError(`invalid slug ${JSON.stringify(slug)} — must match ${SLUG_RE.source}`, 400);
    }
    const deck = body.deck;
    if (!deck || !Array.isArray(deck.slides) || deck.slides.length === 0) {
        return jsonError("deck.slides must be a non-empty array", 400);
    }
    const verification = body.verification || { ready_to_publish: false, checks: [] };
    const captions = body.captions || {};
    const alt_text = body.alt_text || {};
    const hashtags = body.hashtags || {};
    const assets = body.assets || {};

    // Persist asset binaries (base64-decoded) under carousel-assets/<slug>/
    const stored_files = [];
    let cover_png_url = null;
    for (const [fname, b64] of Object.entries(assets)) {
        try {
            const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
            const key = `carousel-assets/${slug}/${fname}`;
            const ct = fname.endsWith(".pdf") ? "application/pdf"
                     : fname.endsWith(".png") ? "image/png"
                     : "application/octet-stream";
            await env.CONTENT.put(key, bin, {
                httpMetadata: { contentType: ct },
            });
            stored_files.push(fname);
            // Pick the first slide PNG as the cover thumbnail.
            if (!cover_png_url && /slide0?1\.png$/i.test(fname)) {
                cover_png_url = `/api/v1/admin/carousels/${slug}/asset/${encodeURIComponent(fname)}`;
            }
        } catch (e) {
            return jsonError(`failed to store asset ${fname}: ${e.message || e}`, 500);
        }
    }

    // Persist the manifest itself
    const adapter_meta = deck._adapter_metadata || {};
    const manifest = {
        slug,
        title: deck.title || slug,
        handle_line: deck.handle_line || "",
        post_topic: deck.post_topic || "",
        week_label: adapter_meta.week_label || "",
        status: "draft",
        slide_count: deck.slides.length,
        ready_to_publish: !!verification.ready_to_publish,
        verification,
        captions,
        alt_text,
        hashtags,
        cover_png_url,
        stored_files,
        adapter_metadata: adapter_meta,
        deck, // full deck spec preserved for re-render if needed
        created_at: Date.now(),
        approved_at: null,
        rejected_at: null,
    };
    await env.CONTENT.put(
        `carousels/${slug}.json`,
        JSON.stringify(manifest, null, 2),
        { httpMetadata: { contentType: "application/json; charset=utf-8" } },
    );

    // Update the index — replace any existing slug entry
    let list = await loadIndex(env);
    list = list.filter((c) => c.slug !== slug);
    list.unshift(summarize(manifest));
    await saveIndex(env, list);

    return jsonResponse({
        ok: true,
        slug,
        ready_to_publish: manifest.ready_to_publish,
        stored_files,
        status: "draft",
    }, { status: 201 });
}

// ---------------------------------------------------------------------
// Pages Function entrypoint
// ---------------------------------------------------------------------
export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ request, env }) => handleList(request, env));
}

export async function onRequestPost({ request, env }) {
    // Pipeline ingestion bypasses admin Basic Auth — token-gated instead.
    return handleIngest(request, env);
}
