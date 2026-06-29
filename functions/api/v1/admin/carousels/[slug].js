// /api/v1/admin/carousels/<slug>  — GET detail + POST approve/reject + DELETE
import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../../_lib/admin_api.js";

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{2,80}$/;
const CAROUSEL_INDEX_KEY = "_index/carousels.json";

async function loadManifest(env, slug) {
    if (!SLUG_RE.test(slug)) return null;
    const obj = await env.CONTENT.get(`carousels/${slug}.json`);
    if (!obj) return null;
    try { return JSON.parse(await obj.text()); } catch { return null; }
}

async function saveManifest(env, manifest) {
    await env.CONTENT.put(
        `carousels/${manifest.slug}.json`,
        JSON.stringify(manifest, null, 2),
        { httpMetadata: { contentType: "application/json; charset=utf-8" } },
    );
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
        slug: c.slug, title: c.title || c.slug,
        handle_line: c.handle_line || "", post_topic: c.post_topic || "",
        week_label: c.week_label || "", status: c.status,
        slide_count: c.slide_count || 0, cover_png_url: c.cover_png_url || null,
        ready_to_publish: !!c.ready_to_publish,
        created_at: c.created_at, approved_at: c.approved_at || null,
        rejected_at: c.rejected_at || null,
    };
}
async function updateIndex(env, manifest) {
    let list = await loadIndex(env);
    list = list.filter((c) => c.slug !== manifest.slug);
    list.unshift(summarize(manifest));
    await saveIndex(env, list);
}

// --- GET /api/v1/admin/carousels/<slug> ----------------------------------
export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env }) => {
        const slug = ctx.params.slug;
        const manifest = await loadManifest(env, slug);
        if (!manifest) return jsonError("carousel not found", 404);
        return jsonResponse({ carousel: manifest });
    });
}

// --- POST /api/v1/admin/carousels/<slug>  (approve | reject) ------------
//      body: { action: "approve" | "reject", admin_memo?: string }
export async function onRequestPost(ctx) {
    return adminRoute(ctx, async ({ request, env, admin }) => {
        const slug = ctx.params.slug;
        const manifest = await loadManifest(env, slug);
        if (!manifest) return jsonError("carousel not found", 404);
        const body = await readJsonBody(request);
        if (!body) return jsonError("invalid JSON body", 400);
        const action = (body.action || "").toLowerCase().trim();
        const now = Date.now();
        const actor = admin?.user || "admin";

        if (action === "approve") {
            if (!manifest.ready_to_publish) {
                return jsonError(
                    "carousel is BLOCKED by the §3.11.6 deploy-gate; fix violations before approving",
                    409,
                );
            }
            manifest.status = "approved";
            manifest.approved_at = now;
            manifest.approved_by = actor;
            manifest.admin_memo = (body.admin_memo || "").trim() || null;
        } else if (action === "reject") {
            manifest.status = "rejected";
            manifest.rejected_at = now;
            manifest.rejected_by = actor;
            manifest.admin_memo = (body.admin_memo || "").trim() || null;
        } else {
            return jsonError(`unknown action ${JSON.stringify(action)} — expected "approve" or "reject"`, 400);
        }

        await saveManifest(env, manifest);
        await updateIndex(env, manifest);
        return jsonResponse({ ok: true, status: manifest.status });
    });
}

// --- PUT /api/v1/admin/carousels/<slug>  — edit editorial fields ---------
//      body: { title?, captions?, alt_text?, hashtags? }
//      Merges the supplied editorial fields into the manifest and re-saves.
//      Re-running the deploy gate stays the pipeline's job; this only stores
//      the operator's copy edits so they aren't lost between ingest and publish.
export async function onRequestPut(ctx) {
    return adminRoute(ctx, async ({ request, env, admin }) => {
        const slug = ctx.params.slug;
        const manifest = await loadManifest(env, slug);
        if (!manifest) return jsonError("carousel not found", 404);
        const body = await readJsonBody(request);
        if (!body || typeof body !== "object") return jsonError("invalid JSON body", 400);

        const ALLOWED = ["title", "captions", "alt_text", "hashtags"];
        let changed = false;
        for (const k of ALLOWED) {
            if (body[k] !== undefined) { manifest[k] = body[k]; changed = true; }
        }
        if (!changed) return jsonError("no editable fields provided (title, captions, alt_text, hashtags)", 400);

        manifest.edited_at = Date.now();
        manifest.edited_by = admin?.user || "admin";
        await saveManifest(env, manifest);
        await updateIndex(env, manifest);
        return jsonResponse({ ok: true, carousel: manifest });
    });
}

// --- DELETE /api/v1/admin/carousels/<slug>  — drop from queue ------------
export async function onRequestDelete(ctx) {
    return adminRoute(ctx, async ({ env }) => {
        const slug = ctx.params.slug;
        if (!SLUG_RE.test(slug)) return jsonError("invalid slug", 400);
        const manifest = await loadManifest(env, slug);
        if (!manifest) return jsonError("carousel not found", 404);

        await env.CONTENT.delete(`carousels/${slug}.json`);
        for (const fname of manifest.stored_files || []) {
            await env.CONTENT.delete(`carousel-assets/${slug}/${fname}`);
        }
        let list = await loadIndex(env);
        list = list.filter((c) => c.slug !== slug);
        await saveIndex(env, list);
        return jsonResponse({ ok: true, deleted: slug });
    });
}
