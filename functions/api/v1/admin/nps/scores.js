// =====================================================================
// GET /api/v1/admin/nps/scores?days=30|90|365 — Phase 18 Sprint 2 R9
// =====================================================================
// Rolling NPS for the admin analytics dashboard.
// NPS = (% promoters [9-10]) − (% detractors [0-6]), reported -100..100.
// Returns the requested window plus the standard 30/90/365 set and the
// response-rate sibling metric (responses / dispatches in window — the
// spec flags <30% response rate as a survey-design tripwire).
// =====================================================================

import { adminRoute, jsonResponse } from "../../../../_lib/admin_api.js";

const WINDOWS = [30, 90, 365];

async function windowStats(env, days) {
    const r = await env.DB.prepare(`
        SELECT
            COUNT(*) AS n,
            SUM(CASE WHEN score >= 9 THEN 1 ELSE 0 END) AS promoters,
            SUM(CASE WHEN score <= 6 THEN 1 ELSE 0 END) AS detractors
        FROM nps_responses
        WHERE responded_at >= datetime('now', ?)
    `).bind(`-${days} days`).first();
    const d = await env.DB.prepare(`
        SELECT COUNT(*) AS n FROM nps_dispatches
        WHERE dispatched_at >= datetime('now', ?)
    `).bind(`-${days} days`).first();
    const n = r?.n || 0;
    const nps = n > 0
        ? Math.round(((r.promoters || 0) / n - (r.detractors || 0) / n) * 100)
        : null;
    return {
        days,
        responses: n,
        promoters: r?.promoters || 0,
        detractors: r?.detractors || 0,
        passives: n - (r?.promoters || 0) - (r?.detractors || 0),
        dispatches: d?.n || 0,
        response_rate_pct: (d?.n || 0) > 0 ? Math.round((n / d.n) * 100) : null,
        nps,
    };
}

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env, request }) => {
        const url = new URL(request.url);
        const days = parseInt(url.searchParams.get("days") || "30", 10);
        const wanted = WINDOWS.includes(days) ? days : 30;
        const out = {};
        for (const w of WINDOWS) out[`d${w}`] = await windowStats(env, w);
        return jsonResponse({ requested_days: wanted, requested: out[`d${wanted}`], windows: out });
    });
}
