// =====================================================================
// GET /api/v1/patient/education/<slug> — read one material + track view
// =====================================================================
// Returns the full material body. On every successful read we upsert
// the patient_content_views row (first_viewed_at + last_viewed_at +
// view_count). If the material is assigned to this patient, the
// assignment's first_opened_at is back-filled on the first read.
//
// Per §11.5.1, education materials with body_md inline render directly.
// If only r2_key is set (large primers stored in mountzara-content),
// the worker fetches and returns the body text. mountzara-content is
// the non-PHI content bucket, so no envelope decryption needed.
// =====================================================================

import { previewAccess, preLaunchNotFound } from "../../../../_lib/preview_gate.js";
import { requireRole, nowMs } from "../../../../_lib/auth.js";
import { logAudit } from "../../../../_lib/audit.js";
import { newId } from "../../../../_lib/db.js";

function err(status, code, message, extra = {}) {
    return new Response(JSON.stringify({ error: code, message, ...extra }), {
        status,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

export async function onRequestGet(ctx) {
    const { request, env, params } = ctx;
    const { allow } = await previewAccess(request, env);
    if (!allow) return preLaunchNotFound();

    let session;
    try { session = await requireRole(ctx, ["patient"]); }
    catch (resp) { return resp; }
    if (!session.patient_id || !env.DB) return err(500, "server_error", "DB not bound");

    const slug = String(params?.slug || "");
    if (!slug) return err(400, "missing_slug");

    const material = await env.DB.prepare(`
        SELECT id, slug, title, summary, body_md, r2_key, topic_tags_json,
               target_audience, status, version, author_clinician_id,
               published_at, created_at, updated_at
        FROM education_materials
        WHERE slug = ?
    `).bind(slug).first();
    if (!material) return err(404, "material_not_found");

    const assignment = await env.DB.prepare(`
        SELECT id, reason, assigned_at, first_opened_at, completed_at
        FROM patient_education_assignments
        WHERE patient_id = ? AND material_id = ?
        ORDER BY assigned_at DESC LIMIT 1
    `).bind(session.patient_id, material.id).first();

    // Visibility: patient sees published materials OR materials explicitly assigned to them.
    if (material.status !== "published" && !assignment) {
        return err(404, "material_not_found");
    }

    // Resolve body — inline body_md wins; else fetch from content bucket.
    //
    // PORTAL-EDUCATION ROUTING (added 2026-05-20):
    //
    // Some seeded D1 rows point r2_key at the FULL STATIC HTML file
    // (e.g. "education/endometriosis/index.html") rather than at a
    // markdown blob. In that case we must NOT fetch the HTML and return
    // it as body_md — the portal's renderMarkdown() would escape every
    // angle bracket and the patient would see raw `<html>...` tags as
    // text in the modal. That was the literal cause of the 2026-05-20
    // "I only see html view" patient-portal bug.
    //
    // Instead we surface a `static_path` field that the portal honors by
    // navigating the browser straight to the canonical static page at
    // `/portal/education/<slug>/`. The static page is a fully-rendered
    // §0.8.1-anchored patient education guide — the canonical UX. The
    // modal-with-markdown render path stays in place for any future
    // clinician-authored material that legitimately uses body_md.
    let body_md = material.body_md || "";
    let static_path = null;
    const r2KeyIsHtmlFile =
        material.r2_key && /\.html?$/i.test(material.r2_key);
    if (!body_md && r2KeyIsHtmlFile) {
        // The r2_key references a complete HTML page — route the portal
        // directly to the static URL rather than inlining the document.
        static_path = `/portal/education/${encodeURIComponent(slug)}/`;
    } else if (!body_md && material.r2_key && env.CONTENT) {
        try {
            const obj = await env.CONTENT.get(material.r2_key);
            if (obj) body_md = await obj.text();
        } catch (e) {
            console.warn("education R2 fetch failed", { error: String(e), key: material.r2_key });
        }
    }

    // Track view (upsert patient_content_views).
    const t = nowMs();
    try {
        const existing = await env.DB.prepare(`
            SELECT id, view_count FROM patient_content_views
            WHERE patient_id = ? AND content_kind = 'education_material' AND content_id = ?
        `).bind(session.patient_id, slug).first();
        if (existing) {
            await env.DB.prepare(`
                UPDATE patient_content_views
                SET last_viewed_at = ?, view_count = ?
                WHERE id = ?
            `).bind(t, (existing.view_count || 0) + 1, existing.id).run();
        } else {
            await env.DB.prepare(`
                INSERT INTO patient_content_views
                    (id, patient_id, content_kind, content_id, first_viewed_at, last_viewed_at, view_count, completed)
                VALUES (?, ?, 'education_material', ?, ?, ?, 1, 0)
            `).bind(newId(), session.patient_id, slug, t, t).run();
        }
        // First-opened back-fill on the assignment, if applicable.
        if (assignment && !assignment.first_opened_at) {
            await env.DB.prepare(`
                UPDATE patient_education_assignments SET first_opened_at = ? WHERE id = ?
            `).bind(t, assignment.id).run();
        }
    } catch (e) {
        console.warn("education view tracking failed", { error: String(e) });
    }

    await logAudit(env, {
        user_id: session.patient_id, user_role: "patient",
        action: "education_view",
        record_type: "education_material",
        record_id: material.id,
        ip: request.headers.get("CF-Connecting-IP") || "",
        user_agent: request.headers.get("User-Agent") || "",
        success: true,
        details: { slug, op: assignment ? "assigned_read" : "library_read" },
    });

    return new Response(JSON.stringify({
        material: {
            id: material.id,
            slug: material.slug,
            title: material.title,
            summary: material.summary,
            body_md,
            topic_tags: safeJson(material.topic_tags_json) || [],
            target_audience: material.target_audience,
            status: material.status,
            published_at: material.published_at,
            updated_at: material.updated_at,
        },
        // When non-null, the portal should navigate the browser to this
        // path instead of rendering body_md in the in-page reader. See
        // the routing note above the static_path assignment.
        static_path,
        assignment: assignment ? {
            id: assignment.id,
            reason: assignment.reason,
            assigned_at: assignment.assigned_at,
            first_opened_at: assignment.first_opened_at || t,
            completed_at: assignment.completed_at,
        } : null,
    }), {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

export async function onRequestPost(ctx) {
    // POST /api/v1/patient/education/<slug>/complete-equivalent — mark
    // the material as completed by this patient. Body is { completed: true|false }.
    const { request, env, params } = ctx;
    const { allow } = await previewAccess(request, env);
    if (!allow) return preLaunchNotFound();

    let session;
    try { session = await requireRole(ctx, ["patient"]); }
    catch (resp) { return resp; }
    if (!session.patient_id || !env.DB) return err(500, "server_error", "DB not bound");

    const slug = String(params?.slug || "");
    if (!slug) return err(400, "missing_slug");

    let body;
    try { body = await request.json(); } catch { return err(400, "invalid_json_body"); }
    const completed = body && body.completed === true;

    const material = await env.DB.prepare(`SELECT id FROM education_materials WHERE slug = ?`).bind(slug).first();
    if (!material) return err(404, "material_not_found");

    const t = nowMs();
    // Update patient_content_views.completed.
    const existing = await env.DB.prepare(`
        SELECT id FROM patient_content_views
        WHERE patient_id = ? AND content_kind = 'education_material' AND content_id = ?
    `).bind(session.patient_id, slug).first();
    if (existing) {
        await env.DB.prepare(`
            UPDATE patient_content_views SET completed = ?, last_viewed_at = ? WHERE id = ?
        `).bind(completed ? 1 : 0, t, existing.id).run();
    } else {
        await env.DB.prepare(`
            INSERT INTO patient_content_views
                (id, patient_id, content_kind, content_id, first_viewed_at, last_viewed_at, view_count, completed)
            VALUES (?, ?, 'education_material', ?, ?, ?, 1, ?)
        `).bind(newId(), session.patient_id, slug, t, t, completed ? 1 : 0).run();
    }
    // Back-fill assignment.completed_at if relevant.
    if (completed) {
        await env.DB.prepare(`
            UPDATE patient_education_assignments
            SET completed_at = ?
            WHERE patient_id = ? AND material_id = ? AND completed_at IS NULL
        `).bind(t, session.patient_id, material.id).run();
    } else {
        // Un-complete: clear it.
        await env.DB.prepare(`
            UPDATE patient_education_assignments
            SET completed_at = NULL
            WHERE patient_id = ? AND material_id = ? AND completed_at IS NOT NULL
        `).bind(session.patient_id, material.id).run();
    }

    return new Response(JSON.stringify({ ok: true, completed }), {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }
