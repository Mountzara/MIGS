// =====================================================================
// GET / PUT /api/v1/patient/symptoms/diary/<YYYY-MM-DD>
// =====================================================================
// Per-day diary entry. Upsert semantics on PUT (one row per patient
// per date, enforced by UNIQUE(patient_id, entry_date)).
//
// PUT body:
//   {
//     values: { "<symptom_key>": <value>, ... },
//     note: "<optional short patient note, ≤500 chars>"
//   }
//
// Each value is validated against the catalog's scale_kind / scale_min /
// scale_max / enum_options before being persisted. Unknown keys are
// dropped (forward-compatible).
//
// Audit: each upsert writes a `symptom_log` row to audit_log with the
// keys that were updated (NOT the values, per §4.2 — values can be
// reconstructed from D1 if needed, but the audit trail captures
// "patient logged today's pain + sleep + bleeding").
// =====================================================================

import { previewAccess, preLaunchNotFound } from "../../../../../_lib/preview_gate.js";
import { requireRole, nowMs } from "../../../../../_lib/auth.js";
import { logAudit } from "../../../../../_lib/audit.js";
import { newId } from "../../../../../_lib/db.js";

function err(status, code, message, extra = {}) {
    return new Response(JSON.stringify({ error: code, message, ...extra }), {
        status,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

function isDate(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }

async function loadCatalog(env) {
    const res = await env.DB.prepare(`
        SELECT key, scale_kind, scale_min, scale_max, enum_options_json
        FROM symptom_definitions
    `).all();
    const map = new Map();
    for (const r of (res?.results || [])) {
        let options = null;
        if (r.enum_options_json) {
            try { options = JSON.parse(r.enum_options_json); } catch {}
        }
        map.set(r.key, {
            kind: r.scale_kind,
            min: r.scale_min,
            max: r.scale_max,
            options,
        });
    }
    return map;
}

function validateAndCleanValues(rawValues, catalog) {
    const out = {};
    const errors = [];
    if (!rawValues || typeof rawValues !== "object") return { out, errors: ["values_not_object"] };
    for (const [key, val] of Object.entries(rawValues)) {
        const def = catalog.get(key);
        if (!def) continue; // silently drop unknown keys
        if (val === null || val === undefined || val === "") continue; // patient cleared this field
        try {
            switch (def.kind) {
                case "numeric_0_10":
                case "numeric_0_4":
                case "count_per_day":
                case "minutes":
                case "mm_per_day": {
                    const n = Number(val);
                    if (!Number.isFinite(n)) { errors.push(`${key}_not_a_number`); break; }
                    if (def.min != null && n < def.min) { errors.push(`${key}_below_min`); break; }
                    if (def.max != null && n > def.max) { errors.push(`${key}_above_max`); break; }
                    out[key] = n;
                    break;
                }
                case "boolean": {
                    if (typeof val === "boolean") out[key] = val;
                    else if (val === "true" || val === 1 || val === "1") out[key] = true;
                    else if (val === "false" || val === 0 || val === "0") out[key] = false;
                    else errors.push(`${key}_not_boolean`);
                    break;
                }
                case "enum": {
                    const allowed = def.options || [];
                    if (Array.isArray(val)) {
                        const filtered = val.filter(x => typeof x === "string" && allowed.includes(x));
                        if (filtered.length > 0) out[key] = filtered;
                    } else if (typeof val === "string" && allowed.includes(val)) {
                        out[key] = val;
                    } else {
                        errors.push(`${key}_not_in_enum`);
                    }
                    break;
                }
                case "text": {
                    if (typeof val !== "string") { errors.push(`${key}_not_string`); break; }
                    const cleaned = val.trim().slice(0, 240);
                    if (cleaned.length > 0) out[key] = cleaned;
                    break;
                }
                default:
                    // Unknown scale_kind: store as-is if a primitive.
                    if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
                        out[key] = val;
                    }
            }
        } catch (e) {
            errors.push(`${key}_validation_failed`);
        }
    }
    return { out, errors };
}

async function loadEntry(env, patient_id, entry_date) {
    return env.DB.prepare(`
        SELECT id, entry_date, values_json, note, created_at, updated_at
        FROM symptom_diary_entries
        WHERE patient_id = ? AND entry_date = ?
    `).bind(patient_id, entry_date).first();
}

export async function onRequestGet(ctx) {
    const { request, env, params } = ctx;
    const { allow } = await previewAccess(request, env);
    if (!allow) return preLaunchNotFound();

    let session;
    try { session = await requireRole(ctx, ["patient"]); }
    catch (resp) { return resp; }
    if (!session.patient_id || !env.DB) return err(500, "server_error", "DB not bound");

    const entry_date = String(params?.date || "");
    if (!isDate(entry_date)) return err(400, "invalid_date", "YYYY-MM-DD");

    const r = await loadEntry(env, session.patient_id, entry_date);
    if (!r) {
        return new Response(JSON.stringify({ entry: null, entry_date }), {
            status: 200,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
    }
    let values = {};
    try { values = JSON.parse(r.values_json || "{}"); } catch {}
    return new Response(JSON.stringify({
        entry: { ...r, values, values_json: undefined },
    }), {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

export async function onRequestPut(ctx) {
    const { request, env, params } = ctx;
    const { allow } = await previewAccess(request, env);
    if (!allow) return preLaunchNotFound();

    let session;
    try { session = await requireRole(ctx, ["patient"]); }
    catch (resp) { return resp; }
    if (!session.patient_id || !env.DB) return err(500, "server_error", "DB not bound");

    const entry_date = String(params?.date || "");
    if (!isDate(entry_date)) return err(400, "invalid_date", "YYYY-MM-DD");

    let body;
    try { body = await request.json(); } catch { return err(400, "invalid_json_body"); }

    const catalog = await loadCatalog(env);
    const { out: cleanValues, errors } = validateAndCleanValues(body.values, catalog);
    if (errors.length > 0 && Object.keys(cleanValues).length === 0) {
        return err(400, "all_values_invalid", "no value passed validation", { errors });
    }
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : null;
    const values_json = JSON.stringify(cleanValues);
    const t = nowMs();

    const existing = await loadEntry(env, session.patient_id, entry_date);
    let id;
    if (existing) {
        id = existing.id;
        await env.DB.prepare(`
            UPDATE symptom_diary_entries
            SET values_json = ?, note = ?, updated_at = ?
            WHERE id = ?
        `).bind(values_json, note, t, id).run();
    } else {
        id = newId();
        await env.DB.prepare(`
            INSERT INTO symptom_diary_entries
                (id, patient_id, entry_date, values_json, note, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(id, session.patient_id, entry_date, values_json, note, t, t).run();
    }

    await logAudit(env, {
        user_id: session.patient_id, user_role: "patient",
        action: "symptom_log",
        record_type: "symptom_diary",
        record_id: id,
        ip: request.headers.get("CF-Connecting-IP") || "",
        user_agent: request.headers.get("User-Agent") || "",
        success: true,
        details: {
            entry_date,
            keys_set: Object.keys(cleanValues),
            value_count: Object.keys(cleanValues).length,
            had_note: !!note,
            validation_errors: errors.length > 0 ? errors : undefined,
            op: existing ? "update" : "create",
        },
    });

    return new Response(JSON.stringify({
        ok: true,
        entry: {
            id,
            entry_date,
            values: cleanValues,
            note,
            updated_at: t,
        },
        warnings: errors.length > 0 ? errors : undefined,
    }), {
        status: existing ? 200 : 201,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}
