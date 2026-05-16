// =====================================================================
// GET /api/v1/patient/education — list available education materials
// =====================================================================
// Returns published materials, plus any unpublished materials that
// have been explicitly assigned to this patient via
// patient_education_assignments (clinician-curated handoffs).
//
// Query params:
//   tag:           optional topic filter (e.g. 'endometriosis')
//   audience:      optional audience filter ('all' default)
//   include_drafts:'true' when admin previewing (still gated to admin-tier of
//                  patient session — patient should not see drafts).
// =====================================================================

import { previewAccess, preLaunchNotFound } from "../../../_lib/preview_gate.js";
import { requireRole } from "../../../_lib/auth.js";

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
    const tag = url.searchParams.get("tag");
    const audience = url.searchParams.get("audience");

    // 1. Published materials.
    let sql = `
        SELECT id, slug, title, summary, topic_tags_json, target_audience,
               status, published_at, updated_at
        FROM education_materials
        WHERE status = 'published'
    `;
    const binds = [];
    if (audience) { sql += " AND (target_audience = ? OR target_audience = 'all')"; binds.push(audience); }
    sql += " ORDER BY published_at DESC LIMIT 200";
    const pubRes = await env.DB.prepare(sql).bind(...binds).all();

    // 2. Materials explicitly assigned to this patient (may be unpublished).
    const assignRes = await env.DB.prepare(`
        SELECT m.id, m.slug, m.title, m.summary, m.topic_tags_json, m.target_audience,
               m.status, m.published_at, m.updated_at,
               a.id AS assignment_id, a.reason, a.assigned_at, a.first_opened_at, a.completed_at
        FROM patient_education_assignments a
        JOIN education_materials m ON m.id = a.material_id
        WHERE a.patient_id = ?
        ORDER BY a.assigned_at DESC
    `).bind(session.patient_id).all();

    // 3. Patient view state.
    const viewRes = await env.DB.prepare(`
        SELECT content_id, first_viewed_at, last_viewed_at, view_count, completed
        FROM patient_content_views
        WHERE patient_id = ? AND content_kind = 'education_material'
    `).bind(session.patient_id).all();
    const viewsBySlug = {};
    for (const v of (viewRes?.results || [])) viewsBySlug[v.content_id] = v;

    const shape = (m, assignment) => ({
        id: m.id,
        slug: m.slug,
        title: m.title,
        summary: m.summary,
        topic_tags: safeJson(m.topic_tags_json) || [],
        target_audience: m.target_audience,
        status: m.status,
        published_at: m.published_at,
        updated_at: m.updated_at,
        assignment: assignment ? {
            id: assignment.assignment_id,
            reason: assignment.reason,
            assigned_at: assignment.assigned_at,
            first_opened_at: assignment.first_opened_at,
            completed_at: assignment.completed_at,
        } : null,
        view: viewsBySlug[m.slug] || null,
    });

    // Merge: assigned materials first (de-duplicate by slug).
    const out = [];
    const seen = new Set();
    for (const r of (assignRes?.results || [])) {
        out.push(shape(r, r));
        seen.add(r.slug);
    }
    for (const r of (pubRes?.results || [])) {
        if (seen.has(r.slug)) continue;
        if (tag) {
            const tags = safeJson(r.topic_tags_json) || [];
            if (!tags.includes(tag)) continue;
        }
        out.push(shape(r, null));
    }

    return new Response(JSON.stringify({
        count: out.length,
        materials: out,
    }), {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }
