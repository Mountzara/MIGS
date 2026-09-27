// =====================================================================
// GET /api/v1/patient/orders — what was ordered for me, and where it is
// =====================================================================
// Patients chase results by phone because nothing tells them where an
// order stands. This returns their own orders with a plain-language
// stage, and — deliberately — the RESULT STATUS but not the result
// narrative: an abnormal result reaches a patient through their
// clinician, not through a status field they refresh at midnight.
//
// A result appears here only once it has been acknowledged by the
// clinician, for the same reason.
// =====================================================================

import { previewAccess, preLaunchNotFound } from "../../../_lib/preview_gate.js";
import { requireRole } from "../../../_lib/auth.js";

function err(status, code) {
    return new Response(JSON.stringify({ error: code }), {
        status, headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

const STAGE = {
    draft: "Being prepared",
    placed: "Sent to the lab or facility",
    in_progress: "In progress",
    resulted: "Result received — your clinician is reviewing it",
    reviewed: "Reviewed by your clinician",
    cancelled: "Cancelled",
};

export async function onRequestGet(ctx) {
    const { request, env } = ctx;
    const { allow } = await previewAccess(request, env);
    if (!allow) return preLaunchNotFound();
    let session;
    try { session = await requireRole(ctx, ["patient"]); } catch (resp) { return resp; }
    if (!session.patient_id || !env.DB) return err(500, "server_error");

    const rows = (await env.DB.prepare(`
        SELECT id, order_type, status, priority, tests_json, modality, body_site, specialty,
               facility_name, placed_at, resulted_at, reviewed_at, created_at
          FROM clinical_orders
         WHERE patient_id = ? AND status != 'draft'
         ORDER BY created_at DESC LIMIT 100
    `).bind(session.patient_id).all())?.results || [];

    const ids = rows.map(r => r.id);
    const ackByOrder = new Map();
    if (ids.length) {
        const ph = ids.map(() => "?").join(",");
        const rs = (await env.DB.prepare(`
            SELECT order_id, result_status, received_at, patient_communicated_at
              FROM order_results
             WHERE order_id IN (${ph}) AND acknowledged_at IS NOT NULL
             ORDER BY received_at DESC`).bind(...ids).all())?.results || [];
        for (const r of rs) if (!ackByOrder.has(r.order_id)) ackByOrder.set(r.order_id, r);
    }

    return new Response(JSON.stringify({
        ok: true,
        orders: rows.map(r => {
            const res = ackByOrder.get(r.id) || null;
            return {
                id: r.id, order_type: r.order_type, status: r.status,
                stage: STAGE[r.status] || r.status,
                tests: (() => { try { return r.tests_json ? JSON.parse(r.tests_json) : []; } catch { return []; } })(),
                modality: r.modality, body_site: r.body_site, specialty: r.specialty,
                facility_name: r.facility_name, placed_at: r.placed_at,
                resulted_at: r.resulted_at, reviewed_at: r.reviewed_at,
                result_available: !!res,
                result_status: res ? res.result_status : null,
                discussed_with_you: res ? !!res.patient_communicated_at : null,
            };
        }),
    }), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
