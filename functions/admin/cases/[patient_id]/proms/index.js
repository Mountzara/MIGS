// =====================================================================
// Pages Function: /admin/cases/<patient_id>/proms/ → serves the PROMs SPA
// =====================================================================
// Mirrors functions/admin/cases/[patient_id]/index.js: a static-shell
// HTML at admin/cases/_t/proms/index.html is rendered for any patient_id.
// The SPA reads patient_id from the URL and calls
// /api/v1/admin/patients/<id>/proms.
//
// Admin Basic Auth is enforced by functions/admin/_middleware.js.
// =====================================================================

export async function onRequestGet({ env, request }) {
    const assetUrl = new URL("/admin/cases/_t/proms/index.html", request.url);
    const upstream = await env.ASSETS.fetch(new Request(assetUrl.toString(), { method: "GET" }));
    const html = await upstream.text();
    return new Response(html, {
        status: 200,
        headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
        },
    });
}
