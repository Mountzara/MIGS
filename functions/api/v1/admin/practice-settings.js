// GET / PATCH /api/v1/admin/practice-settings
//
// Per CLAUDE.md §11 Phase 2. Practice-level settings (Doxy.me URL,
// business hours, timezone, workflow rules) live in the practice_settings
// D1 table, one row per (clinician_id, key). The admin UI reads them via
// GET and updates via PATCH with a single { key, value } body.

import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../_lib/admin_api.js";
import { logAudit } from "../../../_lib/audit.js";

const CLINICIAN_ID = "mabini-christopher-z";

// Whitelist of editable keys so a typo in the UI can't write a junk row.
const EDITABLE_KEYS = new Set([
    "doxy_room_url",
    "timezone",
    "practice_address",
    "phone_office",
    "reminders_email_from",
    "business_hours_json",
    "workflow_rules_json",
]);

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env }) => {
        const res = await env.DB.prepare(`
            SELECT key, value_json, updated_at, updated_by
            FROM practice_settings
            WHERE clinician_id = ?
            ORDER BY key
        `).bind(CLINICIAN_ID).all();
        const rows = res?.results || [];
        const settings = {};
        for (const r of rows) {
            try {
                settings[r.key] = JSON.parse(r.value_json);
            } catch {
                settings[r.key] = null;
            }
        }
        return jsonResponse({ clinician_id: CLINICIAN_ID, settings, raw: rows });
    });
}

export async function onRequestPatch(ctx) {
    return adminRoute(ctx, async ({ env, request, admin }) => {
        const body = await readJsonBody(request);
        const { key, value } = body || {};
        if (!key || typeof key !== "string") return jsonError("missing_key", 400);
        if (!EDITABLE_KEYS.has(key)) return jsonError("key_not_editable", 400, { allowed: Array.from(EDITABLE_KEYS) });
        if (value === undefined) return jsonError("missing_value", 400);

        const value_json = JSON.stringify(value);
        const now = Date.now();
        await env.DB.prepare(`
            INSERT INTO practice_settings (clinician_id, key, value_json, updated_at, updated_by)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (clinician_id, key) DO UPDATE SET
                value_json = excluded.value_json,
                updated_at = excluded.updated_at,
                updated_by = excluded.updated_by
        `).bind(CLINICIAN_ID, key, value_json, now, admin.user).run();

        await logAudit(env, {
            user_id: admin.user,
            user_role: admin.role,
            action: "admin_override",
            record_type: "practice_settings",
            record_id: `${CLINICIAN_ID}/${key}`,
            ip: request.headers.get("CF-Connecting-IP") || "",
            user_agent: request.headers.get("User-Agent") || "",
            success: true,
            details: { key, length: value_json.length },
        });

        return jsonResponse({ ok: true, key, updated_at: now });
    });
}
