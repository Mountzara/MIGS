// =====================================================================
// Pages Function: /portal/visit/<id>/launch  → serves the R4 interstitial
// =====================================================================
// The _redirects rewrite `/portal/visit/*/launch /portal/visit/launch/
// index.html 200` was unreliable — Cloudflare Pages fell back to the
// marketing homepage for these URLs (the same trailing-slash failure
// documented for /admin/cases/<id>/, which is why that route is served
// by a Pages Function). Found 2026-06-10 during the Sprint 2 batch-1
// visual VERIFY: the launch interstitial had been unreachable BY URL
// since R4 shipped (its API endpoint worked; the page route didn't).
//
// This Function takes priority over static lookup + _redirects and
// unconditionally returns the interstitial HTML; the page's own JS reads
// the appointment id from window.location.pathname. The portal preview
// gate runs first via functions/portal/_middleware.js.
// =====================================================================

export async function onRequestGet({ env, request }) {
    const assetUrl = new URL("/portal/visit/launch/index.html", request.url);
    const upstream = await env.ASSETS.fetch(new Request(assetUrl.toString(), { method: "GET" }));
    const html = await upstream.text();
    return new Response(html, {
        status: 200,
        headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
            "x-mz-route": "visit-launch-interstitial",
        },
    });
}
