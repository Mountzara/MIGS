// GET / POST / DELETE /api/v1/admin/availability
//
// Per CLAUDE.md §11.7.3. Drag-to-set availability blocks at 15-min
// granularity per clinician per date.
//
//   GET    ?from=YYYY-MM-DD&to=YYYY-MM-DD  — list blocks in the window
//   POST   { date, start_minute_of_day, end_minute_of_day, block_kind,
//            allowed_visit_types?, location?, notes? }
//          — insert OR update (by clinician_id + date + start window)
//   DELETE ?id=<uuid>                       — remove a block
//
// All routes admin-only.

import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../_lib/admin_api.js";
import { logAudit } from "../../../_lib/audit.js";
import { isValidVisitTypeKey } from "../../../_lib/visit_types.js";
import { newId, now } from "../../../_lib/db.js";

const CLINICIAN_ID = "mabini-christopher-z";

const ALLOWED_BLOCK_KINDS = new Set(["open", "blocked", "admin", "lunch", "procedure", "surgery"]);
const ALLOWED_LOCATIONS = new Set([null, "clinic", "telehealth_only", "procedure_room"]);

function validateDateString(s) {
    return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env, request }) => {
        const url = new URL(request.url);
        const from = url.searchParams.get("from");
        const to = url.searchParams.get("to") || from;
        if (!validateDateString(from) || !validateDateString(to)) {
            return jsonError("missing_or_invalid_date_range", 400, { example: "?from=2026-05-18&to=2026-05-24" });
        }
        const res = await env.DB.prepare(`
            SELECT id, clinician_id, date, start_minute_of_day, end_minute_of_day,
                   block_kind, allowed_visit_types_json, location, notes, created_at, updated_at
            FROM clinician_availability
            WHERE clinician_id = ? AND date >= ? AND date <= ?
            ORDER BY date, start_minute_of_day
        `).bind(CLINICIAN_ID, from, to).all();
        const rows = (res?.results || []).map((r) => ({
            ...r,
            allowed_visit_types: r.allowed_visit_types_json ? JSON.parse(r.allowed_visit_types_json) : null,
        }));
        return jsonResponse({ from, to, clinician_id: CLINICIAN_ID, blocks: rows });
    });
}

export async function onRequestPost(ctx) {
    return adminRoute(ctx, async ({ env, request, admin }) => {
        const body = await readJsonBody(request);
        const { date, start_minute_of_day, end_minute_of_day, block_kind } = body || {};
        const allowed_visit_types = Array.isArray(body.allowed_visit_types) ? body.allowed_visit_types : null;
        const location = body.location ?? null;
        const notes = typeof body.notes === "string" ? body.notes.slice(0, 500) : null;

        if (!validateDateString(date)) return jsonError("invalid_date", 400);
        if (!Number.isInteger(start_minute_of_day) || start_minute_of_day < 0 || start_minute_of_day > 1439) {
            return jsonError("invalid_start_minute_of_day", 400);
        }
        if (!Number.isInteger(end_minute_of_day) || end_minute_of_day <= start_minute_of_day || end_minute_of_day > 1440) {
            return jsonError("invalid_end_minute_of_day", 400);
        }
        if (start_minute_of_day % 15 !== 0 || end_minute_of_day % 15 !== 0) {
            return jsonError("times_must_be_15min_aligned", 400);
        }
        if (!ALLOWED_BLOCK_KINDS.has(block_kind)) {
            return jsonError("invalid_block_kind", 400, { allowed: Array.from(ALLOWED_BLOCK_KINDS) });
        }
        if (!ALLOWED_LOCATIONS.has(location)) {
            return jsonError("invalid_location", 400, { allowed: Array.from(ALLOWED_LOCATIONS).filter(Boolean) });
        }
        if (allowed_visit_types) {
            for (const k of allowed_visit_types) {
                if (!isValidVisitTypeKey(k)) {
                    return jsonError("invalid_visit_type_key", 400, { key: k });
                }
            }
        }

        const id = newId();
        const t = now();
        await env.DB.prepare(`
            INSERT INTO clinician_availability
                (id, clinician_id, date, start_minute_of_day, end_minute_of_day,
                 block_kind, allowed_visit_types_json, location, notes, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
            id, CLINICIAN_ID, date,
            start_minute_of_day, end_minute_of_day,
            block_kind,
            allowed_visit_types ? JSON.stringify(allowed_visit_types) : null,
            location, notes,
            t, t
        ).run();

        await logAudit(env, {
            user_id: admin.user, user_role: admin.role,
            action: "availability_set",
            record_type: "clinician_availability",
            record_id: id,
            ip: request.headers.get("CF-Connecting-IP") || "",
            user_agent: request.headers.get("User-Agent") || "",
            success: true,
            details: { date, start_minute_of_day, end_minute_of_day, block_kind, location },
        });

        return jsonResponse({ ok: true, id, date, start_minute_of_day, end_minute_of_day, block_kind });
    });
}

export async function onRequestDelete(ctx) {
    return adminRoute(ctx, async ({ env, request, admin }) => {
        const url = new URL(request.url);
        const id = url.searchParams.get("id");
        if (!id) return jsonError("missing_id", 400);
        const r = await env.DB.prepare(`
            DELETE FROM clinician_availability WHERE id = ? AND clinician_id = ?
        `).bind(id, CLINICIAN_ID).run();
        const changes = r?.meta?.changes ?? 0;
        await logAudit(env, {
            user_id: admin.user, user_role: admin.role,
            action: "availability_update",
            record_type: "clinician_availability",
            record_id: id,
            ip: request.headers.get("CF-Connecting-IP") || "",
            user_agent: request.headers.get("User-Agent") || "",
            success: changes > 0,
            details: { deleted: changes > 0 },
        });
        return jsonResponse({ ok: true, deleted: changes > 0 });
    });
}
