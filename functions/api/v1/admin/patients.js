// GET / POST /api/v1/admin/patients — minimal admin-side patient registry.
//
// Phase 2 admin-only patient creation so the operator can book demo
// appointments before Phase 1 patient self-signup lands. Phase 1 will
// also write to this table via /api/v1/auth/signup.
//
//   GET    ?q=<text>&limit=20     — list (last_name OR email LIKE q)
//   POST   { email, first_name, last_name, dob, phone? }
//          — create a patient record (no password, no portal access yet)

import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../_lib/admin_api.js";
import { logAudit } from "../../../_lib/audit.js";
import { newId, now } from "../../../_lib/db.js";

function isDate(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function isEmail(s) { return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env, request }) => {
        const url = new URL(request.url);
        const q = (url.searchParams.get("q") || "").trim().toLowerCase();
        const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "20", 10) || 20, 1), 100);

        let sql, binds;
        if (q) {
            const like = `%${q.replace(/[%_]/g, "")}%`;
            sql = `
                SELECT id, email, first_name, last_name, dob, phone, status, created_at
                FROM patients
                WHERE lower(last_name) LIKE ? OR lower(first_name) LIKE ? OR lower(email) LIKE ?
                ORDER BY last_name, first_name
                LIMIT ?
            `;
            binds = [like, like, like, limit];
        } else {
            sql = `SELECT id, email, first_name, last_name, dob, phone, status, created_at
                   FROM patients ORDER BY created_at DESC LIMIT ?`;
            binds = [limit];
        }
        const res = await env.DB.prepare(sql).bind(...binds).all();
        return jsonResponse({ q: q || null, patients: res?.results || [] });
    });
}

export async function onRequestPost(ctx) {
    return adminRoute(ctx, async ({ env, request, admin }) => {
        const body = await readJsonBody(request);
        const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
        const first_name = typeof body.first_name === "string" ? body.first_name.trim() : "";
        const last_name = typeof body.last_name === "string" ? body.last_name.trim() : "";
        const dob = body.dob;
        const phone = typeof body.phone === "string" ? body.phone.trim() : null;

        if (!isEmail(email)) return jsonError("invalid_email", 400);
        if (!first_name || first_name.length > 80) return jsonError("invalid_first_name", 400);
        if (!last_name || last_name.length > 80) return jsonError("invalid_last_name", 400);
        if (!isDate(dob)) return jsonError("invalid_dob", 400, { format: "YYYY-MM-DD" });

        // Duplicate-email guard.
        const existing = await env.DB.prepare(`SELECT id FROM patients WHERE email = ?`).bind(email).first();
        if (existing) return jsonError("email_already_registered", 409, { existing_id: existing.id });

        const id = newId();
        const t = now();
        await env.DB.prepare(`
            INSERT INTO patients (id, email, phone, first_name, last_name, dob, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
        `).bind(id, email, phone, first_name, last_name, dob, t, t).run();

        await logAudit(env, {
            user_id: admin.user, user_role: admin.role,
            action: "patient_create",
            record_type: "patient",
            record_id: id,
            ip: request.headers.get("CF-Connecting-IP") || "",
            user_agent: request.headers.get("User-Agent") || "",
            success: true,
            details: { source: "admin_create", has_phone: !!phone },
        });

        return jsonResponse({ ok: true, id, email, first_name, last_name, dob });
    });
}
