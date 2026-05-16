// =====================================================================
// GET /api/v1/auth/me — return the current session subject
// =====================================================================
// Returns 200 + a small JSON manifest of the active session, or 401 if
// the cookie is missing/expired/revoked. Used by the portal SPA to know
// who is logged in.
// =====================================================================

import { previewAccess, preLaunchNotFound } from "../../../_lib/preview_gate.js";
import { getSession } from "../../../_lib/auth.js";

export async function onRequestGet(ctx) {
    const { request, env } = ctx;
    const { allow } = await previewAccess(request, env);
    if (!allow) return preLaunchNotFound();

    const cookie = request.headers.get("Cookie") || "";
    const m = cookie.match(/(?:^|;\s*)mz_session=([^;]+)/);
    if (!m) {
        return new Response(JSON.stringify({ authenticated: false }), {
            status: 401,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
    }
    const token = decodeURIComponent(m[1]);
    const session = await getSession({ env, token, request });
    if (!session) {
        return new Response(JSON.stringify({ authenticated: false }), {
            status: 401,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
    }

    let display = null;
    if (session.patient_id && env.DB) {
        try {
            display = await env.DB.prepare(
                "SELECT first_name, last_name, email FROM patients WHERE id = ?"
            ).bind(session.patient_id).first();
        } catch (e) {
            console.error("me query threw", { error: String(e) });
        }
    }

    return new Response(JSON.stringify({
        authenticated: true,
        role: session.role,
        patient_id: session.patient_id || null,
        clinician_id: session.clinician_id || null,
        expires_at: session.expires_at,
        profile: display
            ? { first_name: display.first_name, last_name: display.last_name, email: display.email }
            : null,
    }), {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}
