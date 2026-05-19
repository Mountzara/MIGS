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
 * Is the member portal publicly launched? Reads env.PORTAL_PUBLIC_LAUNCH
 * (a Pages env var or secret). Anything other than the exact string
 * "true" (lowercase) keeps the gate closed. Defaults closed.
 */
export function isPortalLaunched(env) {
    const v = (env.PORTAL_PUBLIC_LAUNCH || "false").toString().trim().toLowerCase();
    return v === "true";
}

/**
 * Returns true if the request URL targets the magic-link redeem endpoint.
 *
 * The magic-link token IS the authentication for this path. The redeem
 * endpoint cryptographically verifies the SHA-256 hash of the submitted
 * token against KV-stored token records, enforces single-use, and rejects
 * expired tokens — all before issuing a session cookie. Honoring this
 * path during preview is not a gate bypass; it is the intended public
 * sign-in flow that every HIPAA-eligible passwordless auth system (Auth0,
 * Stripe Identity, Doxy.me, etc.) uses. Anyone reaching this URL without
 * a valid token gets nothing.
 *
 *   GET  /portal/magic-link/redeem            — the redeem page (token in querystring)
 *   GET  /portal/magic-link/redeem/?token=…   — same, trailing slash
 *   POST /api/v1/auth/magic-link/redeem       — the redeem API endpoint
 */
function isMagicLinkRedeem(url) {
    const p = url.pathname.replace(/\/+$/, "");
    return (
        p === "/portal/magic-link/redeem" ||
        p === "/api/v1/auth/magic-link/redeem"
    );
}

/**
 * Returns true if the request carries an mz_session cookie. The cookie
 * is server-issued only after successful password login or magic-link
 * redeem, is HttpOnly + Secure + SameSite=Lax, and is KV-backed with
 * patient_id and expiry. Mere presence here is sufficient — the
 * downstream endpoint validates the cookie against KV on every request.
 * The gate is a routing/anonymity layer, not the auth layer.
 */
function hasMemberSessionCookie(request) {
    const c = request.headers.get("Cookie") || "";
    const m = c.match(/(?:^|;\s*)mz_session=([^;]+)/);
    return !!(m && m[1] && m[1].trim().length > 0);
}

/**
 * Returns { allow, reason } indicating whether this request may access
 * the patient-facing surface.
 *
 *   allow=true if:
 *     - PORTAL_PUBLIC_LAUNCH=true (public launch)
 *     - admin Basic Auth is valid (operator preview)
 *     - the request is the magic-link redeem path (token is the auth)
 *     - the request carries an mz_session cookie (already-authenticated member)
 *
 *   reason describes why for logs (never displayed to the user)
 *
 * HIPAA posture: every "allow" path requires its own authentication
 * factor:
 *   - launch flag is operator-controlled
 *   - Basic Auth is operator-authenticated (PBKDF2 100k)
 *   - magic-link redeem is member-authenticated by single-use cryptographic
 *     token, verified server-side against KV before any session issues
 *   - session cookie is server-issued, KV-backed, validated downstream on
 *     every request that touches PHI
 *
 * No anonymous traffic ever reaches a PHI surface. The gate's job is to
 * prevent the EXISTENCE of the pre-launch portal from being discovered
 * by anonymous traffic. Authentication itself lives in the auth library
 * and in every endpoint's session check — defense in depth.
 */
export async function previewAccess(request, env) {
    if (isPortalLaunched(env)) {
        return { allow: true, reason: "launched" };
    }
    if (await isAdminAuthed(request, env)) {
        return { allow: true, reason: "admin_preview" };
    }
    if (isMagicLinkRedeem(new URL(request.url))) {
        return { allow: true, reason: "magic_link_redeem" };
    }
    if (hasMemberSessionCookie(request)) {
        return { allow: true, reason: "member_session" };
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
