// =====================================================================
// GET /api/v1/patient/symptoms/diary — list diary entries in a window
// =====================================================================
// Query params:
//   from:  YYYY-MM-DD (default = today - 30 days)
//   to:    YYYY-MM-DD (default = today)
//
// Response: { from, to, entries: [{ id, entry_date, values, note, updated_at }, ...] }
// =====================================================================

import { previewAccess, preLaunchNotFound } from "../../../../_lib/preview_gate.js";
import { requireRole } from "../../../../_lib/auth.js";
import { checkWindow } from "../../../../_lib/iso_date.js";

function err(status, code, message) {
    return new Response(JSON.stringify({ error: code, message }), {
        status,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

// Shape-only date checks accepted 2026-02-31 and an unbounded window.
// Both now go through _lib/iso_date.js::checkWindow.
function todayISO() {
    const d = new Date();
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    return `${y}-${mo}-${da}`;
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
    const today = todayISO();
    const from = url.searchParams.get("from") || addDaysISO(today, -30);
    const to = url.searchParams.get("to") || today;
    // A range query with no ceiling is a denial of service on our own
    // database and on the patient's phone: ?from=1900-01-01 returned a
    // 46,000-point series in 1.6 MB of JSON, to be drawn in a chart 300
    // pixels wide. 400 days is a bound on one REQUEST, not on what may
    // be stored — a patient with five years of entries reads all of it, a
    // window at a time.
    const win = checkWindow(from, to, 400);
    if (!win.ok) {
        return err(400, win.error, win.error === "window_too_large"
            ? `that is ${win.days} days; ask for at most ${win.max_days} at a time`
            : undefined);
    }
    if (to < from) return err(400, "invalid_window", "to < from");

    const res = await env.DB.prepare(`
        SELECT id, entry_date, values_json, note, created_at, updated_at
        FROM symptom_diary_entries
        WHERE patient_id = ? AND entry_date >= ? AND entry_date <= ?
        ORDER BY entry_date DESC
    `).bind(session.patient_id, from, to).all();

    const entries = (res?.results || []).map(r => ({
        id: r.id,
        entry_date: r.entry_date,
        values: safeJson(r.values_json) || {},
        note: r.note,
        created_at: r.created_at,
        updated_at: r.updated_at,
    }));

    return new Response(JSON.stringify({ from, to, count: entries.length, entries }), {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

function safeJson(s) {
    try { return JSON.parse(s); } catch { return null; }
}
