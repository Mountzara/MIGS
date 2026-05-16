// =====================================================================
// functions/_lib/sync_auth.js — per-app Bearer token validation
// =====================================================================
// Per CLAUDE.md §11 Tier 5 App Sync Layer. Each external app
// (MountZaraMedicalTranscription, MountZaraClinicalAI,
// MountZaraSurgicalWorkflow, MountZaraAI-iOS) carries its own pipeline
// token, stored in macOS / iOS Keychain on the app side and pushed to
// Cloudflare Pages as a per-app secret. Sync endpoints validate the
// Bearer header against the relevant secret.
//
// Secrets (each set via wrangler pages secret put):
//   TRANSCRIPTION_SYNC_TOKEN
//   CLINICAL_AI_SYNC_TOKEN
//   SURGICAL_WORKFLOW_SYNC_TOKEN
//   IOS_SYNC_TOKEN
//
// Tokens are randomly generated 32-byte base64 strings, rotated
// annually. Pattern: openssl rand -base64 32
//
// All token comparisons run through constantTimeEq() to defeat timing
// attacks against partial-match guesses.
// =====================================================================

import { logAudit } from "./audit.js";

export const APP_TO_TOKEN_ENV = {
    "transcription":     "TRANSCRIPTION_SYNC_TOKEN",
    "clinical_ai":       "CLINICAL_AI_SYNC_TOKEN",
    "surgical_workflow": "SURGICAL_WORKFLOW_SYNC_TOKEN",
    "ios":               "IOS_SYNC_TOKEN",
};

function constantTimeEq(a, b) {
    if (typeof a !== "string" || typeof b !== "string") return false;
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

/**
 * Verify that the request carries a Bearer token matching the
 * configured token for `app`. Returns true on success; false on any
 * failure (missing header, malformed header, unknown app, wrong token).
 *
 * @param {Request} request
 * @param {object} env
 * @param {string} app — one of APP_TO_TOKEN_ENV keys
 */
export function isSyncAuthed(request, env, app) {
    const envKey = APP_TO_TOKEN_ENV[app];
    if (!envKey) return false;
    const expected = env[envKey];
    if (!expected || typeof expected !== "string" || expected.length < 16) return false;
    const auth = request.headers.get("Authorization") || "";
    if (!auth.toLowerCase().startsWith("bearer ")) return false;
    const submitted = auth.slice(7).trim();
    if (!submitted) return false;
    return constantTimeEq(submitted, expected);
}

/**
 * Pages-Function wrapper for sync routes. Mirrors functions/_lib/admin_api.js
 * adminRoute pattern — converts a clean handler signature into a Response
 * + handles 401s + emits audit_log rows on auth failure.
 *
 *   export async function onRequestPost(ctx) {
 *       return syncRoute(ctx, "transcription", async ({ env, request, app }) => {
 *           // ... handler body
 *           return jsonResponse({ ok: true });
 *       });
 *   }
 */
export async function syncRoute(ctx, app, handler) {
    const { request, env } = ctx;
    if (!isSyncAuthed(request, env, app)) {
        // PHI-free audit row.
        try {
            await logAudit(env, {
                user_id: null, user_role: "app",
                action: "login_fail",
                record_type: "sync",
                record_id: app,
                ip: request.headers.get("CF-Connecting-IP") || "",
                user_agent: request.headers.get("User-Agent") || "",
                success: false,
                details: { reason: "missing_or_invalid_bearer", app },
            });
        } catch {}
        return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: {
                "content-type": "application/json",
                "WWW-Authenticate": `Bearer realm="Mount Zara Sync (${app})"`,
                "cache-control": "no-store",
            },
        });
    }

    try {
        const resp = await handler({ env, request, app, ctx });
        if (resp instanceof Response) return resp;
        return new Response(JSON.stringify(resp), {
            status: 200,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
    } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        console.error("sync_auth.syncRoute threw", { app, url: request.url, error: msg });
        try {
            await logAudit(env, {
                user_id: null, user_role: "app",
                action: "phi_write",
                record_type: "sync_error",
                ip: request.headers.get("CF-Connecting-IP") || "",
                user_agent: request.headers.get("User-Agent") || "",
                success: false,
                details: { app, url: request.url, error: msg.slice(0, 240) },
            });
        } catch {}
        return new Response(JSON.stringify({ error: "internal_error", detail: msg }), {
            status: 500,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
    }
}

/**
 * Convenience JSON helpers — match _lib/admin_api.js semantics so sync
 * handlers can use the same patterns.
 */
export function syncJson(body, init = {}) {
    return new Response(JSON.stringify(body), {
        status: init.status ?? 200,
        headers: {
            "content-type": "application/json",
            "cache-control": "no-store",
            ...(init.headers || {}),
        },
    });
}
export function syncError(message, status = 400, extra = {}) {
    return syncJson({ error: message, ...extra }, { status });
}
