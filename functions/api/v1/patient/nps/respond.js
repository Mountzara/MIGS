// =====================================================================
// POST /api/v1/patient/nps/respond — Phase 18 Sprint 2 R9
// =====================================================================
// Records an NPS response. The one-time token (minted by the dispatcher,
// delivered via secure message) IS the authentication for this endpoint —
// the same token-is-auth pattern as the magic-link redeem. No session is
// required, so a patient can answer from the link alone; the token maps
// to exactly one (patient, appointment) pair server-side.
//
//   POST { token, score: 0-10, why?: string }
//
// Semantics per the R9 spec:
//   * token must exist in nps_dispatches and be ≤14 days old.
//   * Idempotent — re-submission overwrites the same nps_responses row
//     (keyed by response_token), so a patient can revise their answer
//     while the token is live.
//   * Audit-logged; PHI-light (score + free text only).
//
// Preview gate: honored like every patient surface — pre-launch the
// patient reaching this arrived via a secure-message link, so they carry
// an mz_session cookie (which satisfies the gate). Post-launch the
// endpoint is public and the token is the gate.
// =====================================================================

import { previewAccess, preLaunchNotFound } from "../../../../_lib/preview_gate.js";
import { logAudit } from "../../../../_lib/audit.js";

const TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const MAX_WHY = 2000;
const TOKEN_RX = /^[0-9a-f]{32,64}$/i;

function jres(status, body) {
    return new Response(JSON.stringify(body), {
        status, headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

export async function onRequestPost(ctx) {
    const { request, env } = ctx;
    const { allow } = await previewAccess(request, env);
    if (!allow) return preLaunchNotFound();
    if (!env.DB) return jres(500, { error: "server_error" });

    let body;
    try { body = await request.json(); }
    catch { return jres(400, { error: "invalid_json" }); }

    const token = String(body.token || "").trim();
    if (!TOKEN_RX.test(token)) return jres(400, { error: "invalid_token" });

    const score = Number(body.score);
    if (!Number.isInteger(score) || score < 0 || score > 10) {
        return jres(400, { error: "invalid_score", message: "Score must be a whole number from 0 to 10." });
    }
    const why = typeof body.why === "string" ? body.why.slice(0, MAX_WHY).trim() || null : null;

    const dispatch = await env.DB.prepare(`
        SELECT id, patient_id, appointment_id, dispatched_at, responded_at
        FROM nps_dispatches WHERE token = ?
    `).bind(token).first();
    if (!dispatch) return jres(404, { error: "token_not_found" });

    const dispatchedMs = Date.parse(String(dispatch.dispatched_at).replace(" ", "T") + "Z");
    if (Number.isFinite(dispatchedMs) && Date.now() - dispatchedMs > TOKEN_TTL_MS) {
        return jres(410, { error: "token_expired", message: "This survey link has expired. Thank you anyway!" });
    }

    try {
        // Idempotent upsert keyed by response_token.
        const existing = await env.DB.prepare(`
            SELECT id FROM nps_responses WHERE response_token = ?
        `).bind(token).first();
        if (existing) {
            await env.DB.prepare(`
                UPDATE nps_responses
                SET score = ?, why = ?, responded_at = datetime('now')
                WHERE response_token = ?
            `).bind(score, why, token).run();
        } else {
            await env.DB.prepare(`
                INSERT INTO nps_responses
                    (patient_id, appointment_id, score, why, responded_at, response_token)
                VALUES (?, ?, ?, ?, datetime('now'), ?)
            `).bind(dispatch.patient_id, dispatch.appointment_id, score, why, token).run();
        }
        await env.DB.prepare(`
            UPDATE nps_dispatches SET responded_at = datetime('now') WHERE id = ?
        `).bind(dispatch.id).run();
    } catch (e) {
        console.error("nps respond write threw", { error: String(e?.message || e) });
        return jres(500, { error: "persist_failed", message: "Could not save your answer; please retry." });
    }

    await logAudit(env, {
        user_id: dispatch.patient_id,
        user_role: "patient",
        action: "nps_response_recorded",
        record_type: "appointment",
        record_id: dispatch.appointment_id,
        ip: request.headers.get("CF-Connecting-IP") || "",
        user_agent: request.headers.get("User-Agent") || "",
        success: true,
        details: { score, has_why: !!why, revised: !!dispatch.responded_at },
    }, ctx);

    return jres(200, { ok: true, score });
}
