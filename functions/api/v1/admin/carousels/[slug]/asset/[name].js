// /api/v1/admin/carousels/<slug>/asset/<name>
// Admin-gated proxy for a single carousel bundle file (PDF, slide PNGs).
// Used by the admin SPA to render the cover thumbnail + download links.

import { adminRoute, jsonError } from "../../../../../_lib/admin_api.js";

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{2,80}$/;
const NAME_RE = /^[A-Za-z0-9._-]{1,120}$/;

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env }) => {
        const slug = ctx.params.slug || "";
        const name = ctx.params.name || "";
        if (!SLUG_RE.test(slug) || !NAME_RE.test(name)) {
            return jsonError("invalid slug or asset name", 400);
        }
        const key = `carousel-assets/${slug}/${name}`;
        const obj = await env.CONTENT.get(key);
        if (!obj) return jsonError("asset not found", 404);
        const ct = obj.httpMetadata?.contentType
            || (name.endsWith(".pdf") ? "application/pdf"
                : name.endsWith(".png") ? "image/png"
                : "application/octet-stream");
        return new Response(obj.body, {
            status: 200,
            headers: {
                "content-type": ct,
                "cache-control": "private, max-age=300",
            },
        });
    });
}
