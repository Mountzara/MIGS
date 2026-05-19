// =====================================================================
// Pages Function: /admin/cases/<patient_id>/snapshot/  → serves the
// AI-snapshot EMR-dashboard SPA. See sibling index.js for rationale.
// =====================================================================

export async function onRequestGet({ env, request }) {
    const assetUrl = new URL("/admin/cases/_t/snapshot/index.html", request.url);
    const upstream = await env.ASSETS.fetch(new Request(assetUrl.toString(), { method: "GET" }));
    const html = await upstream.text();
    return new Response(html, {
        status: 200,
        headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
            "x-mz-route": "case-snapshot-spa",
        },
    });
}
