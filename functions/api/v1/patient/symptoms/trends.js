// =====================================================================
// GET /api/v1/patient/symptoms/trends?key=<symptom_key>&from=&to=
// =====================================================================
// Returns a time-series for one symptom over the window. Numeric scales
// return raw values; boolean returns 0/1; enum returns the count of
// occurrences per day (sum across multi-select array values); text is
// not supported (returns 400).
//
// Response:
//   {
//     key, kind, window: { from, to, days },
//     series: [{ date: "YYYY-MM-DD", value: <number|null> }, ...]
//   }
//
// Days with no entry are returned with value=null so the client can
// draw gaps rather than zero-fill (which would mislead).
// =====================================================================

import { previewAccess, preLaunchNotFound } from "../../../../_lib/preview_gate.js";
import { requireRole } from "../../../../_lib/auth.js";

function err(status, code, message, extra = {}) {
    return new Response(JSON.stringify({ error: code, message, ...extra }), {
        status,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}
function isDate(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDaysISO(s, days) {
    const [y, m, d] = s.split("-").map(n => parseInt(n, 10));
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + days);
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
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
    const key = url.searchParams.get("key");
    const to = url.searchParams.get("to") || todayISO();
    const from = url.searchParams.get("from") || addDaysISO(to, -30);
    if (!key) return err(400, "missing_key");
    if (!isDate(from)) return err(400, "invalid_from");
    if (!isDate(to)) return err(400, "invalid_to");
    if (to < from) return err(400, "invalid_window");

    // Look up the symptom in the catalog so we know how to extract the value.
    const def = await env.DB.prepare(`
        SELECT key, scale_kind FROM symptom_definitions WHERE key = ?
    `).bind(key).first();
    if (!def) return err(404, "unknown_symptom_key");
    if (def.scale_kind === "text") return err(400, "text_kind_not_chartable");

    const res = await env.DB.prepare(`
        SELECT entry_date, values_json
        FROM symptom_diary_entries
        WHERE patient_id = ? AND entry_date >= ? AND entry_date <= ?
        ORDER BY entry_date ASC
    `).bind(session.patient_id, from, to).all();

    const byDate = new Map();
    for (const r of (res?.results || [])) {
        let v = null;
        try {
            const obj = JSON.parse(r.values_json || "{}");
            const raw = obj[key];
            if (raw === undefined || raw === null) {
                v = null;
            } else if (def.scale_kind === "boolean") {
                v = raw === true || raw === 1 ? 1 : 0;
            } else if (def.scale_kind === "enum") {
                v = Array.isArray(raw) ? raw.length : (raw ? 1 : 0);
            } else {
                const n = Number(raw);
                v = Number.isFinite(n) ? n : null;
            }
        } catch {}
        byDate.set(r.entry_date, v);
    }

    // Walk every day in [from, to] so the client gets a dense series with nulls.
    const series = [];
    let cur = from;
    while (cur <= to) {
        series.push({ date: cur, value: byDate.has(cur) ? byDate.get(cur) : null });
        cur = addDaysISO(cur, 1);
    }

    return new Response(JSON.stringify({
        key,
        kind: def.scale_kind,
        window: { from, to, days: series.length },
        series,
    }), {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}
