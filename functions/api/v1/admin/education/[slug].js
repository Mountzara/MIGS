// =====================================================================
// /api/v1/admin/education/<slug> — clinician-side material CRUD
// =====================================================================
// GET    — full record (including body_md if inline).
// PATCH  — partial update: { title?, summary?, body_md?, r2_key?,
//                            topic_tags?[], target_audience?, status? }
//          Bumps `version` on any change. Sets published_at when status
//          flips draft->published.
// DELETE — archive (status='archived'), not a hard delete.
// =====================================================================

import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../../_lib/admin_api.js";
import { logAudit } from "../../../../_lib/audit.js";
import { now } from "../../../../_lib/db.js";

const ALLOWED_STATUS = new Set(["draft", "published", "archived"]);

function safeTags(arr) {
    if (!Array.isArray(arr)) return null;
    return arr
        .filter(x => typeof x === "string" && x.length > 0 && x.length < 60)
        .map(x => x.toLowerCase().trim())
        .slice(0, 16);
}

async function loadRow(env, slug) {
    return env.DB.prepare(`
        SELECT id, slug, title, summary, body_md, r2_key,
               topic_tags_json, target_audience, status, version,
               author_clinician_id, published_at, created_at, updated_at
        FROM education_materials WHERE slug = ?
    `).bind(slug).first();
}

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env }) => {
        const slug = String(ctx.params?.slug || "");
        if (!slug) return jsonError("missing_slug", 400);
        const r = await loadRow(env, slug);
        if (!r) return jsonError("material_not_found", 404);
        return jsonResponse({
            material: {
                ...r,
                topic_tags: safeJson(r.topic_tags_json) || [],
                topic_tags_json: undefined,
            },
        });
    });
}

export async function onRequestPatch(ctx) {
    return adminRoute(ctx, async ({ env, request, admin }) => {
        const slug = String(ctx.params?.slug || "");
        if (!slug) return jsonError("missing_slug", 400);
        const body = await readJsonBody(request);

        const r = await loadRow(env, slug);
        if (!r) return jsonError("material_not_found", 404);

        const update = {};
        if (body.title !== undefined) {
            const t = String(body.title).trim();
            if (!t || t.length > 200) return jsonError("invalid_title", 400);
            update.title = t;
        }
        if (body.summary !== undefined) {
            update.summary = body.summary == null ? null : String(body.summary).trim().slice(0, 280);
        }
        if (body.body_md !== undefined) {
            if (body.body_md && String(body.body_md).length > 60_000) return jsonError("body_md_too_large", 400);
            update.body_md = body.body_md == null ? null : String(body.body_md);
        }
        if (body.r2_key !== undefined) {
            update.r2_key = body.r2_key == null ? null : String(body.r2_key).trim();
        }
        if (body.topic_tags !== undefined) {
            const tags = safeTags(body.topic_tags);
            if (tags == null) return jsonError("invalid_topic_tags", 400);
            update.topic_tags_json = JSON.stringify(tags);
        }
        if (body.target_audience !== undefined) {
            update.target_audience = String(body.target_audience).trim().toLowerCase();
        }
        if (body.status !== undefined) {
            const s = String(body.status).trim().toLowerCase();
            if (!ALLOWED_STATUS.has(s)) return jsonError("invalid_status", 400);
            update.status = s;
        }
        if (Object.keys(update).length === 0) return jsonError("no_fields_to_update", 400);

        const t = now();
        update.version = (r.version || 1) + 1;
        update.updated_at = t;
        if (update.status === "published" && r.status !== "published") {
            update.published_at = t;
        }

        // Build UPDATE statement dynamically.
        const cols = Object.keys(update);
        const setClause = cols.map(c => `${c} = ?`).join(", ");
        const binds = cols.map(c => update[c]);
        binds.push(slug);

        await env.DB.prepare(`UPDATE education_materials SET ${setClause} WHERE slug = ?`).bind(...binds).run();

        await logAudit(env, {
            user_id: admin.user, user_role: admin.role,
            action: "education_publish",
            record_type: "education_material",
            record_id: r.id,
            ip: request.headers.get("CF-Connecting-IP") || "",
            user_agent: request.headers.get("User-Agent") || "",
            success: true,
            details: {
                op: "update",
                slug,
                fields_changed: cols.filter(c => c !== "updated_at" && c !== "version"),
                from_status: r.status, to_status: update.status || r.status,
                new_version: update.version,
            },
        });

        const after = await loadRow(env, slug);
        return jsonResponse({
            ok: true,
            material: {
                ...after,
                topic_tags: safeJson(after.topic_tags_json) || [],
                topic_tags_json: undefined,
            },
        });
    });
}

export async function onRequestDelete(ctx) {
    return adminRoute(ctx, async ({ env, request, admin }) => {
        const slug = String(ctx.params?.slug || "");
        if (!slug) return jsonError("missing_slug", 400);
        const r = await loadRow(env, slug);
        if (!r) return jsonError("material_not_found", 404);
        const t = now();
        await env.DB.prepare(`
            UPDATE education_materials
            SET status = 'archived', updated_at = ?, version = version + 1
            WHERE slug = ?
        `).bind(t, slug).run();
        await logAudit(env, {
            user_id: admin.user, user_role: admin.role,
            action: "education_publish",
            record_type: "education_material",
            record_id: r.id,
            ip: request.headers.get("CF-Connecting-IP") || "",
            user_agent: request.headers.get("User-Agent") || "",
            success: true,
            details: { op: "archive", slug },
        });
        return jsonResponse({ ok: true, archived: true });
    });
}

function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }
