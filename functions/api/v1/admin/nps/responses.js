// =====================================================================
// GET /api/v1/admin/nps/responses?days=30&limit=100 — Phase 18 Sprint 2 R9
// =====================================================================
// The "Why?" free-text list for the analytics dashboard. Per the R9 spec
// the list carries a patient HASH, not a name — feedback should read as
// anonymous to soften the negative-feedback-feels-exposed dynamic, while
// the hash still lets the clinician correlate repeat feedback.
// =====================================================================

import { adminRoute, jsonResponse } from "../../../../_lib/admin_api.js";

async function shortHash(s) {
    const dg = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`nps|${s}`));
    return [...new Uint8Array(dg)].slice(0, 4).map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env, request }) => {
        const url = new URL(request.url);
        const days = Math.min(Math.max(parseInt(url.searchParams.get("days") || "30", 10), 1), 365);
        const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "100", 10), 1), 500);
        const r = await env.DB.prepare(`
            SELECT patient_id, score, why, responded_at
            FROM nps_responses
            WHERE responded_at >= datetime('now', ?)
            ORDER BY responded_at DESC
            LIMIT ?
        `).bind(`-${days} days`, limit).all();
        const out = [];
        for (const row of (r?.results || [])) {
            out.push({
                patient_hash: await shortHash(row.patient_id),
                score: row.score,
                why: row.why,
                responded_at: row.responded_at,
            });
        }
        return jsonResponse({ days, count: out.length, responses: out });
    });
}
