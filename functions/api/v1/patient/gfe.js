// =====================================================================
// GET /api/v1/patient/gfe — my Good Faith Estimates
// =====================================================================
// The No Surprises Act requires the estimate be GIVEN to the patient in
// writing. Handing it to them in the portal, where it stays available,
// is the durable form of that — and it means the patient can compare a
// later bill against it, which is the entire point of the $400 dispute
// right the estimate has to tell them about.
//
// Only ISSUED estimates are returned. A draft is our working document.
// =====================================================================

import { previewAccess, preLaunchNotFound } from "../../../_lib/preview_gate.js";
import { requireRole } from "../../../_lib/auth.js";
import { DISCLAIMERS, totals } from "../../../_lib/gfe.js";

export async function onRequestGet(ctx) {
    const { request, env } = ctx;
    const { allow } = await previewAccess(request, env);
    if (!allow) return preLaunchNotFound();
    let session;
    try { session = await requireRole(ctx, ["patient"]); } catch (resp) { return resp; }
    if (!session.patient_id || !env.DB) {
        return new Response(JSON.stringify({ error: "server_error" }), { status: 500, headers: { "content-type": "application/json" } });
    }

    const rows = (await env.DB.prepare(`
        SELECT id, gfe_number, service_date, primary_service, issued_at, practice_total_cents
          FROM good_faith_estimates
         WHERE patient_id = ? AND status = 'issued'
         ORDER BY issued_at DESC LIMIT 50`).bind(session.patient_id).all())?.results || [];

    const out = [];
    for (const g of rows) {
        const lines = (await env.DB.prepare(
            `SELECT kind, description, service_code, quantity, unit_cents, total_cents, provider_name, note
               FROM gfe_line_items WHERE gfe_id = ? ORDER BY sort_order ASC`).bind(g.id).all())?.results || [];
        out.push({ ...g, lines, totals: totals(lines) });
    }
    return new Response(JSON.stringify({ ok: true, estimates: out, disclaimers: DISCLAIMERS }), {
        status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}
