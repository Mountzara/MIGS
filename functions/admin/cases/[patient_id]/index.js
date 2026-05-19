// =====================================================================
// Pages Function: /admin/cases/<patient_id>/  → serves the case SPA
// =====================================================================
// _redirects rewrite of `/admin/cases/*` to a static path was unreliable
// when the URL had a trailing slash — Cloudflare Pages treated the
// trailing slash as directory navigation and fell back to the marketing
// homepage instead of matching the redirect. This Pages Function takes
// priority over both static lookup and _redirects, and unconditionally
// returns the SPA HTML. The SPA's own JS reads patient_id from
// window.location.pathname and fetches the admin API.
//
// Admin Basic Auth is enforced by functions/admin/_middleware.js which
// runs before this handler.
// =====================================================================

export async function onRequestGet({ env, request }) {
    // ASSETS is the static-asset binding automatically wired by Pages.
    // Fetching this exact file always succeeds — the literal file exists
    // at admin/cases/_t/index.html in the build output.
    const assetUrl = new URL("/admin/cases/_t/index.html", request.url);
    const upstream = await env.ASSETS.fetch(new Request(assetUrl.toString(), { method: "GET" }));
    // Pass through the body but force a no-cache + utf-8 content-type so
    // the page is fresh and the patient_id changes in the URL are not
    // intermediated by a stale cache.
    const html = await upstream.text();
    return new Response(html, {
        status: 200,
        headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
            "x-mz-route": "case-detail-spa",
        },
    });
}
