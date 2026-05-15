// =====================================================================
// functions/_lib/preview_gate.js — admin-only preview gate
// =====================================================================
// Per user directive 2026-05-15: every patient-facing surface (the
// /portal/ SPA and its supporting /api/v1/auth|intake|appointments
// routes) is hidden from the public until the operator (Dr. Mabini)
// approves the design + drafts. The mechanism:
//
//   * env.PORTAL_PUBLIC_LAUNCH (Pages secret/var) — when "true" the
//     gate opens and the patient-facing surface goes public. Default
//     false so a forgotten flag never accidentally exposes a draft.
//   * Admin HTTP Basic Auth (same path as /admin/*) — admin can always
//     preview, regardless of the launch flag, so the operator can
//     review the in-progress build.
//
// Public, anonymous visitors hitting /portal/ get a designed Coming
// Soon page (functions/portal/_middleware.js handles the HTML
// response). Public visitors hitting /api/v1/auth|intake|appointments
// get JSON 404 (we don't even acknowledge the route exists until
// launch, matching standard "leak nothing pre-launch" pattern).
// =====================================================================

import { verifyPbkdf2 } from "../admin/_middleware.js";

const ADMIN_REALM = 'Mount Zara Admin';

/**
 * Returns true if the request carries a valid admin Basic Auth header.
 * Re-uses the same PBKDF2 verification path as /admin/_middleware.js so
 * a single rotation of ADMIN_PASS_HASH covers all admin surfaces.
 */
export async function isAdminAuthed(request, env) {
    if (!env.ADMIN_PASS_HASH) return false;
    const auth = request.headers.get("Authorization") || "";
    if (!auth.startsWith("Basic ")) return false;
    let decoded;
    try {
        decoded = atob(auth.slice(6));
    } catch {
        return false;
    }
    const sep = decoded.indexOf(":");
    if (sep < 0) return false;
    const submitted = decoded.slice(0, sep).trim().toLowerCase();
    const pass = decoded.slice(sep + 1);
    const expected = (env.ADMIN_USER || "admin").trim().toLowerCase();
    if (submitted !== expected) return false;
    try {
        return await verifyPbkdf2(pass, env.ADMIN_PASS_HASH);
    } catch {
        return false;
    }
}

/**
 * Is the patient portal publicly launched? Reads env.PORTAL_PUBLIC_LAUNCH
 * (a Pages env var or secret). Anything other than the exact string
 * "true" (lowercase) keeps the gate closed. Defaults closed.
 */
export function isPortalLaunched(env) {
    const v = (env.PORTAL_PUBLIC_LAUNCH || "false").toString().trim().toLowerCase();
    return v === "true";
}

/**
 * Returns { allow, reason } indicating whether this request may access
 * the patient-facing surface.
 *
 *   allow=true if launched OR admin-authed
 *   reason describes why for logs (never displayed to the user)
 */
export async function previewAccess(request, env) {
    if (isPortalLaunched(env)) {
        return { allow: true, reason: "launched" };
    }
    if (await isAdminAuthed(request, env)) {
        return { allow: true, reason: "admin_preview" };
    }
    return { allow: false, reason: "preview_gate_closed" };
}

/**
 * Build a 401 response that prompts the admin Basic Auth dialog.
 * Used on routes where we want admin-only access during pre-launch.
 * Coming-Soon HTML is handled separately in functions/portal/_middleware.js.
 */
export function adminAuthRequiredResponse() {
    return new Response(JSON.stringify({ error: "preview_gate_admin_required" }), {
        status: 401,
        headers: {
            "WWW-Authenticate": `Basic realm="${ADMIN_REALM}", charset="UTF-8"`,
            "content-type": "application/json",
            "cache-control": "no-store",
        },
    });
}

/**
 * Stub-404 response for the API surface pre-launch. We deliberately
 * return 404 (not 401) for anonymous API requests so the existence of
 * unfinished patient endpoints isn't even acknowledged.
 */
export function preLaunchNotFound() {
    return new Response(JSON.stringify({ error: "not_found" }), {
        status: 404,
        headers: {
            "content-type": "application/json",
            "cache-control": "no-store",
        },
    });
}
