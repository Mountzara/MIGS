// =====================================================================
// Pages Function: /portal/nps/<token>  → serves the R9 NPS survey page
// =====================================================================
// Same pattern (and same reason) as /portal/visit/<id>/launch — the
// _redirects wildcard rewrite fell through to the marketing homepage,
// so the route is served by a Pages Function instead. The page's own JS
// reads the one-time token from window.location.pathname and POSTs to
// /api/v1/patient/nps/respond (token-is-auth). The portal preview gate
// runs first via functions/portal/_middleware.js — pre-launch, patients
// arrive from a secure-message link carrying their mz_session cookie,
// which satisfies the gate.
// =====================================================================

export async function onRequestGet({ env, request }) {
    const assetUrl = new URL("/portal/nps/index.html", request.url);
    const upstream = await env.ASSETS.fetch(new Request(assetUrl.toString(), { method: "GET" }));
    const html = await upstream.text();
    return new Response(html, {
        status: 200,
        headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
            "x-mz-route": "nps-survey",
        },
    });
}
