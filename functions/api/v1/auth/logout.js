// =====================================================================
// POST /api/v1/auth/logout — revoke the current session
// =====================================================================
// Reads the session cookie, parses out the session_id, marks the D1 row
// revoked, deletes the KV cache, and clears the cookie on the response.
// Idempotent — calling without a session still returns 200 with a
// clearing cookie.
// =====================================================================

import { previewAccess, preLaunchNotFound } from "../../../_lib/preview_gate.js";
import { revokeSession, clearSessionCookie, getSession } from "../../../_lib/auth.js";

export async function onRequestPost(ctx) {
    const { request, env } = ctx;
    const { allow } = await previewAccess(request, env);
    if (!allow) return preLaunchNotFound();

    const cookie = request.headers.get("Cookie") || "";
    const m = cookie.match(/(?:^|;\s*)mz_session=([^;]+)/);
    if (!m) {
        // No cookie — already logged out, return success with clearing cookie.
        return new Response(JSON.stringify({ ok: true, already: "logged_out" }), {
            status: 200,
            headers: {
                "content-type": "application/json",
                "set-cookie": clearSessionCookie(),
                "cache-control": "no-store",
            },
        });
    }
    const token = decodeURIComponent(m[1]);
    const dot = token.indexOf(".");
    const session_id = dot > 0 ? token.slice(0, dot) : null;

    if (session_id) {
        // Resolve the session to know who is logging out (for audit).
        const session = await getSession({ env, token, request }).catch(() => null);
        await revokeSession({
            env,
            session_id,
            reason: "logout",
            actor_id: session?.patient_id || session?.clinician_id,
            actor_role: session?.role || "anonymous",
            request,
        });
    }

    return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
            "content-type": "application/json",
            "set-cookie": clearSessionCookie(),
            "cache-control": "no-store",
        },
    });
}
