// =====================================================================
// functions/api/_middleware.js — JSON-only guarantee for /api/*
// =====================================================================
// Cloudflare Pages has no 404.html here, so any /api/* request that no
// Function handles (wrong method on a POST-only auth route, a typo'd
// path, GET /api/v1/auth/login from a crawler) falls through to the
// static-asset SPA fallback and returns the MARKETING HOMEPAGE as
// HTTP 200 text/html. Clients then try to JSON.parse an HTML document
// and surface a garbage error, and monitoring can't distinguish a dead
// endpoint from a healthy page.
//
// This middleware runs for every /api/* request, lets real handlers
// respond untouched, and converts only the static-HTML fallthrough into
// a proper JSON 404. Every legitimate /api/* response in this repo is
// JSON (or CSV for billing report exports) — never text/html — so
// content-type is a safe discriminator.
// =====================================================================

export async function onRequest(ctx) {
    const resp = await ctx.next();
    const ct = (resp.headers.get("content-type") || "").toLowerCase();
    if (ct.startsWith("text/html")) {
        return new Response(JSON.stringify({ error: "not_found" }), {
            status: 404,
            headers: {
                "content-type": "application/json",
                "cache-control": "no-store",
            },
        });
    }
    return resp;
}
