// =====================================================================
// /api/v1/admin/education — clinician authoring of patient-facing primers
// =====================================================================
// GET   ?status=draft|published|archived|all — list materials
// POST   { slug, title, summary?, body_md?, topic_tags?[], target_audience?,
//          status?: 'draft' (default), r2_key? }
//          — create. Duplicate slug -> 409.
// =====================================================================

import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../_lib/admin_api.js";
import { logAudit } from "../../../_lib/audit.js";
import { newId, now } from "../../../_lib/db.js";

const CLINICIAN_ID = "mabini-christopher-z";

const ALLOWED_STATUS = new Set(["draft", "published", "archived"]);
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,80}[a-z0-9])?$/;

function safeTags(arr) {
    if (!Array.isArray(arr)) return [];
    return arr
        .filter(x => typeof x === "string" && x.length > 0 && x.length < 60)
        .map(x => x.toLowerCase().trim())
        .slice(0, 16);
}

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env, request }) => {
        const url = new URL(request.url);
        const status = (url.searchParams.get("status") || "all").toLowerCase();

        let sql = `
            SELECT id, slug, title, summary, topic_tags_json, target_audience,
                   status, version, author_clinician_id,
                   published_at, created_at, updated_at,
                   length(body_md) AS body_md_len, r2_key
            FROM education_materials
        `;
        const binds = [];
        if (status !== "all") {
            if (!ALLOWED_STATUS.has(status)) return jsonError("invalid_status", 400);
            sql += " WHERE status = ?";
            binds.push(status);
        }
        sql += " ORDER BY updated_at DESC LIMIT 200";

        const r = await env.DB.prepare(sql).bind(...binds).all();
        const materials = (r?.results || []).map(m => ({
            ...m,
            topic_tags: safeJson(m.topic_tags_json) || [],
            topic_tags_json: undefined,
            has_inline_body: (m.body_md_len || 0) > 0,
            has_r2_body: !!m.r2_key,
            body_md_len: undefined,
        }));
        return jsonResponse({ status, count: materials.length, materials });
    });
}

export async function onRequestPost(ctx) {
    return adminRoute(ctx, async ({ env, request, admin }) => {
        const body = await readJsonBody(request);
        const slug = (body.slug || "").toString().trim().toLowerCase();
        const title = (body.title || "").toString().trim();
        const summary = body.summary != null ? body.summary.toString().trim().slice(0, 280) : null;
        const body_md = body.body_md != null ? body.body_md.toString() : null;
        const r2_key = body.r2_key != null ? body.r2_key.toString().trim() : null;
        const topic_tags = safeTags(body.topic_tags);
        const target_audience = (body.target_audience || "all").toString().trim().toLowerCase();
        const status = (body.status || "draft").toString().trim().toLowerCase();

        if (!SLUG_RE.test(slug)) return jsonError("invalid_slug", 400, { format: "lowercase, digits, hyphens" });
        if (!title || title.length > 200) return jsonError("invalid_title", 400, { max: 200 });
        if (!ALLOWED_STATUS.has(status)) return jsonError("invalid_status", 400);
        if (body_md && body_md.length > 60_000) return jsonError("body_md_too_large", 400, { max: 60000 });
        if (!body_md && !r2_key) return jsonError("body_required", 400, { detail: "supply body_md or r2_key" });

        const existing = await env.DB.prepare(`SELECT id FROM education_materials WHERE slug = ?`).bind(slug).first();
        if (existing) return jsonError("slug_already_exists", 409);

        const id = newId();
        const t = now();
        await env.DB.prepare(`
            INSERT INTO education_materials
                (id, slug, title, summary, body_md, r2_key,
                 topic_tags_json, target_audience, status, version,
                 author_clinician_id, published_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
        `).bind(
            id, slug, title, summary, body_md, r2_key,
            JSON.stringify(topic_tags), target_audience, status,
            CLINICIAN_ID, status === "published" ? t : null,
            t, t
        ).run();

        await logAudit(env, {
            user_id: admin.user, user_role: admin.role,
            action: "education_publish",
            record_type: "education_material",
            record_id: id,
            ip: request.headers.get("CF-Connecting-IP") || "",
            user_agent: request.headers.get("User-Agent") || "",
            success: true,
            details: { op: "create", slug, status, has_inline_body: !!body_md, has_r2_key: !!r2_key },
        });

        return jsonResponse({
            ok: true, id, slug, title, status, version: 1,
        }, { status: 201 });
    });
}

function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }
