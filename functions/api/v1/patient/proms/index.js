// =====================================================================
// GET /api/v1/patient/proms — list the signed-in member's assignments
// =====================================================================
// Returns pending + in-progress + completed history. Patient-scoped via
// the session cookie; no cross-patient visibility.
// =====================================================================

import { requireRole } from "../../../../_lib/auth.js";
import { listAssignments } from "../../../../_lib/proms.js";
import { previewAccess, preLaunchNotFound } from "../../../../_lib/preview_gate.js";

export async function onRequestGet(ctx) {
    // Pre-launch cloak — every other /api/v1/patient/* route 404s to
    // anonymous traffic; without this the PROMs routes alone answered
    // 401, leaking their existence.
    const { allow } = await previewAccess(ctx.request, ctx.env);
    if (!allow) return preLaunchNotFound();
    let session;
    try { session = await requireRole(ctx, ["patient"]); }
    catch (resp) { return resp; }
    const { patient_id } = session;
    const url = new URL(ctx.request.url);
    const statusFilter = url.searchParams.get("status");
    const rows = await listAssignments(ctx.env, patient_id, statusFilter || null);
    return new Response(JSON.stringify({ ok: true, assignments: rows }), {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" }
    });
}
