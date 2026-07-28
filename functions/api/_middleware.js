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
// a proper JSON 404.
//
// The original version assumed "every legitimate /api/* response in this
// repo is JSON — never text/html" and used content-type alone as the
// discriminator. That assumption was WRONG, and silently so: the
// trend-brief preview route (/api/v1/admin/trend-briefs/<id>/preview)
// deliberately returns rendered HTML for the iframe in
// /admin/trend-briefs/. Its healthy 200 was being rewritten into
// {"error":"not_found"} 404, so visual review was broken for EVERY
// queued brief — the failure looked like a missing D1 row and pointed
// investigation at entirely the wrong file. Found 2026-07-28.
//
// Fix: an HTML-emitting /api/* route declares intent with the response
// header `x-mz-html: intentional`. The middleware passes those through
// (stripping the marker so it never reaches the client) and keeps the
// JSON-404 guarantee for genuine static fallthrough.
//
// Adding a new HTML-returning /api/* route? Set that header on the
// response, or this middleware will eat it and report not_found.
// =====================================================================

const HTML_OPT_OUT_HEADER = "x-mz-html";
const HTML_OPT_OUT_VALUE = "intentional";

export async function onRequest(ctx) {
    const resp = await ctx.next();
    const ct = (resp.headers.get("content-type") || "").toLowerCase();
    if (!ct.startsWith("text/html")) return resp;

    const marker = (resp.headers.get(HTML_OPT_OUT_HEADER) || "")
        .trim().toLowerCase();
    if (marker === HTML_OPT_OUT_VALUE) {
        // Intentional HTML from a real handler — pass through, minus the
        // internal marker header.
        const headers = new Headers(resp.headers);
        headers.delete(HTML_OPT_OUT_HEADER);
        return new Response(resp.body, {
            status: resp.status,
            statusText: resp.statusText,
            headers,
        });
    }

    return new Response(JSON.stringify({ error: "not_found" }), {
        status: 404,
        headers: {
            "content-type": "application/json",
            "cache-control": "no-store",
        },
    });
}
