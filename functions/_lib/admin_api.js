// =====================================================================
// functions/_lib/admin_api.js — shared admin API helpers
// =====================================================================
// Every /api/v1/admin/* route runs through requireAdminAdminApi() which:
//   * Verifies admin Basic Auth (re-uses functions/admin/_middleware.js
//     PBKDF2 verification path).
//   * Returns a 401 with WWW-Authenticate if not authed.
//   * Returns a structured admin context { env, request, audit } that
//     handlers use.
//
// Routes write to audit_log via logAudit() for HIPAA traceability per
// CLAUDE.md §11 Tier 7. Failures degrade to JSON 500 with a stable
// error envelope { error: "...", request_id: "..." }.
// =====================================================================

import { verifyPbkdf2 } from "../admin/_middleware.js";
import { logAudit } from "./audit.js";

const ADMIN_REALM = 'Mount Zara Admin';

export function jsonResponse(body, init = {}) {
    const status = init.status ?? 200;
    const headers = {
        "content-type": "application/json",
        "cache-control": "no-store",
        ...(init.headers || {}),
    };
    return new Response(JSON.stringify(body), { status, headers });
}

export function jsonError(message, status = 400, extra = {}) {
    return jsonResponse({ error: message, ...extra }, { status });
}

export function unauthorizedAdminJson() {
    return new Response(JSON.stringify({ error: "admin_authentication_required" }), {
        status: 401,
        headers: {
            "WWW-Authenticate": `Basic realm="${ADMIN_REALM}", charset="UTF-8"`,
            "content-type": "application/json",
            "cache-control": "no-store",
        },
    });
}

/**
 * Verify admin Basic Auth and return the parsed admin identity. Returns
 * null on failure (caller should respond with unauthorizedAdminJson()).
 */
export async function readAdminIdentity(request, env) {
    if (!env.ADMIN_PASS_HASH) return null;

    // A signed admin session cookie is accepted first. It is minted by
    // functions/admin/_middleware.js after a real password check, and it is
    // what lets the admin SPA call this API without collecting credentials
    // a second time — the second prompt was the bug, not the solution.
    // Basic auth still works for API clients (the transcription app,
    // scripts, curl), which have no cookie jar.
    try {
        const sess = await import("./admin_session.js");
        const viaCookie = await sess.verifyAdminSession(request, env);
        if (viaCookie) return viaCookie;
    } catch { /* fall through to Basic */ }

    const auth = request.headers.get("Authorization") || "";
    if (!auth.startsWith("Basic ")) return null;
    let decoded;
    try {
        decoded = atob(auth.slice(6));
    } catch {
        return null;
    }
    const sep = decoded.indexOf(":");
    if (sep < 0) return null;
    const submitted = decoded.slice(0, sep).trim().toLowerCase();
    const pass = decoded.slice(sep + 1);
    const expected = (env.ADMIN_USER || "admin").trim().toLowerCase();
    if (submitted !== expected) return null;
    let ok = false;
    try {
        ok = await verifyPbkdf2(pass, env.ADMIN_PASS_HASH);
    } catch {
        return null;
    }
    if (!ok) return null;
    return { user: submitted, role: "clinician" };
}

/**
 * Pages Function route wrapper. Usage:
 *
 *   export async function onRequest(ctx) {
 *       return adminRoute(ctx, async ({ env, request, admin }) => {
 *           // ... handler returns a Response or { json: ... }
 *           return jsonResponse({ ok: true });
 *       });
 *   }
 */
export async function adminRoute(ctx, handler) {
    const { request, env } = ctx;
    const admin = await readAdminIdentity(request, env);
    if (!admin) return unauthorizedAdminJson();
    try {
        const resp = await handler({ env, request, admin, ctx, params: ctx.params });
        if (resp instanceof Response) return resp;
        // Convenience: returning a plain object becomes JSON 200.
        return jsonResponse(resp);
    } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        console.error("admin_api.adminRoute threw", {
            module: "_lib/admin_api",
            url: request.url,
            method: request.method,
            error: msg,
        });
        // Audit the failure for traceability (PHI-free).
        try {
            await logAudit(env, {
                user_id: admin.user,
                user_role: admin.role,
                action: "admin_override",
                record_type: "api_error",
                ip: request.headers.get("CF-Connecting-IP") || "",
                user_agent: request.headers.get("User-Agent") || "",
                success: false,
                details: { url: request.url, method: request.method, error: msg.slice(0, 240) },
            });
        } catch {}
        return jsonError("internal_error", 500, { detail: msg });
    }
}

/**
 * Parse JSON body, returning {} on empty. Throws a typed error on
 * malformed body so adminRoute's catch converts it to a 400.
 */
export async function readJsonBody(request) {
    const ct = request.headers.get("content-type") || "";
    if (!ct.toLowerCase().includes("application/json")) return {};
    try {
        return await request.json();
    } catch (e) {
        const err = new Error("invalid_json_body");
        err.status = 400;
        throw err;
    }
}
