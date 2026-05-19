// =====================================================================
// GET  /api/v1/admin/cases/:id/whats-new — events since clinician's last view
// POST /api/v1/admin/cases/:id/whats-new — mark the case as just-viewed
// =====================================================================
// Backs the "What's new since you last looked" panel on /admin/cases/:id/.
//
// On GET:
//   - reads snapshot_view_history for (clinician_id, patient_id)
//   - returns encounter_events that occurred AFTER last_viewed_at
//     (or the last 30 days if no prior view recorded)
//   - groups by severity + event_type so the panel can render
//
// On POST:
//   - upserts snapshot_view_history with now() as last_viewed_at
//   - body may include { snapshot_id } to pin the snapshot version too
// =====================================================================

import { adminRoute, jsonResponse, jsonError } from "../../../../../_lib/admin_api.js";
import { listEventsForPatient } from "../../../../../_lib/encounters.js";

function nowIso() { return new Date().toISOString(); }

function clinicianIdFromContext(env, request) {
    // The admin pre-launch system uses HTTP Basic Auth with a single admin
    // user (ADMIN_USER, e.g. chris.mabini@gmail.com). Treat that username
    // as the clinician_id key for the view-history table. When real multi-
    // clinician auth lands, swap this for the session.clinician_id.
    const auth = request.headers.get("Authorization") || "";
    if (!auth.startsWith("Basic ")) return env.ADMIN_USER || "admin";
    try {
        const decoded = atob(auth.slice(6));
        const colon = decoded.indexOf(":");
        if (colon > 0) return decoded.slice(0, colon).trim().toLowerCase();
    } catch {}
    return env.ADMIN_USER || "admin";
}

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env, request, ctx: inner }) => {
        if (!env.DB) return jsonError("server_error", 500);
        const patient_id = String((inner && inner.params && inner.params.id) || "").trim();
        if (!patient_id) return jsonError("bad_params", 400);
        const clinician_id = clinicianIdFromContext(env, request);

        // Look up the last view
        const view = await env.DB.prepare(
            "SELECT last_viewed_at, last_viewed_snapshot_id FROM snapshot_view_history WHERE clinician_id = ? AND patient_id = ? LIMIT 1"
        ).bind(clinician_id, patient_id).first();

        // Cutoff: last_viewed_at if present; else 30 days ago
        let sinceIso;
        let firstVisit = false;
        if (view && view.last_viewed_at) {
            sinceIso = view.last_viewed_at;
        } else {
            sinceIso = new Date(Date.now() - 30 * 86400000).toISOString();
            firstVisit = true;
        }

        const events = await listEventsForPatient(env, patient_id, { sinceIso, limit: 100 });

        // Group by severity + count by type for the panel header
        const bySeverity = { urgent: 0, warning: 0, info: 0 };
        const byType = {};
        for (const e of events) {
            const s = (e.severity || "info");
            bySeverity[s] = (bySeverity[s] || 0) + 1;
            byType[e.event_type] = (byType[e.event_type] || 0) + 1;
        }

        return jsonResponse({
            ok: true,
            clinician_id,
            patient_id,
            since: sinceIso,
            first_visit: firstVisit,
            last_viewed_snapshot_id: view?.last_viewed_snapshot_id || null,
            counts: {
                total: events.length,
                by_severity: bySeverity,
                by_type: byType
            },
            events
        });
    });
}

export async function onRequestPost(ctx) {
    return adminRoute(ctx, async ({ env, request, ctx: inner }) => {
        if (!env.DB) return jsonError("server_error", 500);
        const patient_id = String((inner && inner.params && inner.params.id) || "").trim();
        if (!patient_id) return jsonError("bad_params", 400);
        const clinician_id = clinicianIdFromContext(env, request);

        let body = {};
        try { body = await request.json(); } catch {}
        const pinned_snapshot_id = body && typeof body.snapshot_id === "string" ? body.snapshot_id : null;

        const now = nowIso();
        await env.DB.prepare(`
            INSERT INTO snapshot_view_history (clinician_id, patient_id, last_viewed_at, last_viewed_snapshot_id)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(clinician_id, patient_id) DO UPDATE SET
                last_viewed_at = excluded.last_viewed_at,
                last_viewed_snapshot_id = COALESCE(excluded.last_viewed_snapshot_id, snapshot_view_history.last_viewed_snapshot_id)
        `).bind(clinician_id, patient_id, now, pinned_snapshot_id).run();

        return jsonResponse({ ok: true, clinician_id, patient_id, viewed_at: now });
    });
}
