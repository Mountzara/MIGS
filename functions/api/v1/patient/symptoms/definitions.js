// =====================================================================
// GET /api/v1/patient/symptoms/definitions — symptom catalog
// =====================================================================
// Returns the seed catalog from symptom_definitions, filtered to
// migs_relevant=1 entries by default. Patient UI uses this to render
// the diary form (one widget per symptom).
//
// Query params:
//   domain:        filter by domain (e.g. 'pain' | 'bleeding' | 'cycle')
//   include_all:   'true' returns even non-migs_relevant entries
//
// Auth: patient session (no PHI in the response — system catalog only).
// =====================================================================

import { previewAccess, preLaunchNotFound } from "../../../../_lib/preview_gate.js";
import { requireRole } from "../../../../_lib/auth.js";

function err(status, code, message) {
    return new Response(JSON.stringify({ error: code, message }), {
        status,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

export async function onRequestGet(ctx) {
    const { request, env } = ctx;
    const { allow } = await previewAccess(request, env);
    if (!allow) return preLaunchNotFound();

    let session;
    try { session = await requireRole(ctx, ["patient"]); }
    catch (resp) { return resp; }
    if (!session.patient_id || !env.DB) return err(500, "server_error", "DB not bound");

    const url = new URL(request.url);
    const domain = url.searchParams.get("domain");
    const includeAll = url.searchParams.get("include_all") === "true";

    let sql = `SELECT key, domain, display_name, description, scale_kind,
                      scale_min, scale_max, enum_options_json, unit,
                      migs_relevant, sort_order
               FROM symptom_definitions`;
    const binds = [];
    const wheres = [];
    if (!includeAll) wheres.push("migs_relevant = 1");
    if (domain) { wheres.push("domain = ?"); binds.push(domain); }
    if (wheres.length > 0) sql += " WHERE " + wheres.join(" AND ");
    sql += " ORDER BY sort_order, display_name";

    const res = await env.DB.prepare(sql).bind(...binds).all();
    const rows = (res?.results || []).map(r => ({
        ...r,
        enum_options: r.enum_options_json ? safeJson(r.enum_options_json) : null,
    }));

    return new Response(JSON.stringify({
        count: rows.length,
        domains: [...new Set(rows.map(r => r.domain))],
        symptoms: rows,
    }), {
        status: 200,
        headers: {
            "content-type": "application/json",
            // Catalog is static — caching is fine.
            "cache-control": "private, max-age=3600",
        },
    });
}

function safeJson(s) {
    try { return JSON.parse(s); } catch { return null; }
}
