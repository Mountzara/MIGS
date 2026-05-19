// =====================================================================
// functions/_lib/session_trace.js — Phase QA fine-grained request tracing
// =====================================================================
// Per CLAUDE.md §4.4 (Mandatory Debug Logging) + §4.4.4 (PHI safety).
//
// This is the lighter-weight, finer-granularity companion to audit.js:
//
//   audit_log        — fixed action allowlist, 6-year retention, used
//                      for HIPAA reporting + breach-notification trail.
//   session_trace    — every portal-facing request, 30-day retention
//                      target, used for real-time debugging + operator
//                      live view at /admin/debug/sessions/.
//
// The two are complementary. session_trace.event() logs an event for
// every request; audit.logAudit() captures the state-change semantics
// when applicable. Critical events get both calls.
//
// Privacy invariants (HARD):
//   * detail_json is PHI-free — sizes, counts, step numbers, content
//     types, error class names. NO names, DOBs, free-text answers,
//     email addresses (beyond @-prefix mask).
//   * ip is stored hashed (SHA256(ip + env.IP_HASH_SALT)) — never raw.
//   * session token is stored hashed (SHA256(token)) — never raw.
//
// Failure mode:
//   * Never throws. A failed trace-write is logged to console (visible
//     in `wrangler tail`) but never breaks the user request.
// =====================================================================

import { newId } from "./db.js";

const MAX_DETAIL_JSON_BYTES = 4 * 1024;   // 4 KB hard cap per row
const MAX_USER_AGENT_LEN = 200;

const _enc = new TextEncoder();
const _dec = new TextDecoder();

async function _sha256Hex(input) {
    const data = typeof input === "string" ? _enc.encode(input) : input;
    const buf = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

/**
 * Best-effort hash for IP correlation across requests. If env.IP_HASH_SALT
 * is unset we fall back to a stable per-day salt (so an attacker who
 * obtains a snapshot of session_trace cannot reverse a single IP without
 * the salt, but cross-day correlation degrades — which is fine for
 * debugging-grade traces).
 */
async function _hashIp(env, ip) {
    if (!ip) return null;
    const salt = env?.IP_HASH_SALT
        ? String(env.IP_HASH_SALT)
        : `mz-fallback-${new Date().toISOString().slice(0, 10)}`;
    const h = await _sha256Hex(`${ip}|${salt}`);
    return h.slice(0, 24); // truncate — 24 hex chars is enough collision-resistance for correlation
}

async function _hashSessionToken(token) {
    if (!token) return null;
    const h = await _sha256Hex(token);
    return h.slice(0, 24);
}

function _truncate(s, n) {
    if (typeof s !== "string") return null;
    if (s.length <= n) return s;
    return s.slice(0, n);
}

/**
 * Best-effort safe-stringify with size cap. If detail can't serialize,
 * we log _detail_serialization_error rather than dropping the row.
 */
function _safeDetailJson(detail) {
    if (detail === null || detail === undefined) return null;
    let json;
    try {
        json = JSON.stringify(detail);
    } catch (e) {
        json = JSON.stringify({ _detail_serialization_error: String(e) });
    }
    if (_enc.encode(json).length > MAX_DETAIL_JSON_BYTES) {
        // Truncate aggressively rather than reject — debugging values
        // partial data over no data.
        json = json.slice(0, MAX_DETAIL_JSON_BYTES - 32) + '..._truncated"}';
        try { JSON.parse(json); }
        catch { json = JSON.stringify({ _detail_truncated: true, _orig_size_bytes: _enc.encode(JSON.stringify(detail)).length }); }
    }
    return json;
}

/**
 * Try to read the recipient label from a request — looks at the
 * preview-invite cookie first, then falls back to "anon" / "admin_preview".
 */
export function readInviteLabel(request) {
    const c = request.headers.get("Cookie") || "";
    const m = c.match(/(?:^|;\s*)mz_preview_label=([^;]+)/);
    if (m && m[1]) {
        const v = decodeURIComponent(m[1]).trim().toLowerCase();
        if (/^[a-z0-9_\-]{1,32}$/.test(v)) return v;
    }
    // Admin Basic Auth header → "admin_preview"
    const auth = request.headers.get("Authorization") || "";
    if (auth.startsWith("Basic ")) return "admin_preview";
    return "anon";
}

/**
 * Record one event into session_trace. Never throws.
 *
 * @param {object} env - Pages env with .DB bound
 * @param {object} evt
 * @param {Request} evt.request               - the inbound Request (read-only header inspection)
 * @param {string=} evt.patient_id            - set when known
 * @param {string=} evt.session_token         - raw mz_session token (hashed before storage)
 * @param {string=} evt.invite_label          - explicit override (else read from cookie)
 * @param {string} evt.action                 - free-form short identifier, e.g. "intake_section_save"
 * @param {string=} evt.outcome               - "ok" | "error" | "blocked" | "redirect" | "validation_fail"
 * @param {number=} evt.http_status
 * @param {number=} evt.duration_ms
 * @param {object=} evt.detail                - PHI-FREE JSON
 */
export async function recordTrace(env, evt) {
    if (!env || !env.DB) {
        // The trace surface is best-effort; if DB isn't wired, console
        // so the wrangler tail picks it up.
        console.warn("session_trace: DB not bound; event lost", {
            action: evt?.action, outcome: evt?.outcome,
        });
        return;
    }
    try {
        const req = evt.request;
        if (!req) {
            console.warn("session_trace: evt.request missing", { action: evt?.action });
            return;
        }
        const url = new URL(req.url);
        const route = url.pathname; // search/query intentionally excluded — querystrings can carry sensitive tokens
        const method = req.method || "GET";
        const ip = req.headers.get("CF-Connecting-IP") || "";
        const ua = _truncate(req.headers.get("User-Agent") || "", MAX_USER_AGENT_LEN);
        const ipHash = await _hashIp(env, ip);

        // Resolve session id from raw token (if provided) or from cookie.
        let sessionId = null;
        if (evt.session_token) {
            sessionId = await _hashSessionToken(evt.session_token);
        } else {
            const cookie = req.headers.get("Cookie") || "";
            const m = cookie.match(/(?:^|;\s*)mz_session=([^;]+)/);
            if (m && m[1]) sessionId = await _hashSessionToken(m[1]);
        }

        const inviteLabel = evt.invite_label || readInviteLabel(req);

        const id = newId();
        const ts = Date.now();
        const detailJson = _safeDetailJson(evt.detail);

        await env.DB.prepare(`
            INSERT INTO session_trace
                (id, ts, session_id, patient_id, invite_label,
                 route, http_method, http_status, action, outcome,
                 duration_ms, detail_json, ip_hash, user_agent, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
            id, ts, sessionId, evt.patient_id || null, inviteLabel,
            route, method, evt.http_status || null, String(evt.action || "unknown"),
            evt.outcome || null, evt.duration_ms || null, detailJson,
            ipHash, ua, ts
        ).run();
    } catch (e) {
        console.error("session_trace.recordTrace threw — event lost from D1 but logged", {
            module: "_lib/session_trace",
            error: e && e.message ? e.message : String(e),
            action: evt?.action, outcome: evt?.outcome,
        });
    }
}

/**
 * Wraps an async request handler with start/end trace events.
 * The handler returns the Response; we record duration_ms + http_status
 * after the handler resolves.
 *
 * Usage:
 *   export async function onRequestGet(ctx) {
 *     return traceWrap(ctx, "patient_profile_get", async () => {
 *       // ... real handler returning Response ...
 *     });
 *   }
 */
export async function traceWrap(ctx, action, handler) {
    const start = Date.now();
    let resp;
    let outcome = "ok";
    try {
        resp = await handler();
    } catch (e) {
        outcome = "error";
        // Log the failure trace, then rethrow so Pages can turn it into 500.
        await recordTrace(ctx.env, {
            request: ctx.request,
            action, outcome,
            duration_ms: Date.now() - start,
            detail: { error_class: e?.constructor?.name || "Error", error_message: String(e?.message || e).slice(0, 240) },
        });
        throw e;
    }
    const status = resp?.status || 0;
    if (status >= 500) outcome = "error";
    else if (status === 404 || status === 401 || status === 403) outcome = "blocked";
    else if (status >= 300 && status < 400) outcome = "redirect";
    else if (status >= 400) outcome = "validation_fail";
    await recordTrace(ctx.env, {
        request: ctx.request,
        action,
        outcome,
        http_status: status,
        duration_ms: Date.now() - start,
    });
    return resp;
}

/**
 * Query the most recent trace events for the operator live view.
 *
 * @param {object} env
 * @param {object=} filters
 * @param {string=} filters.invite_label   - e.g. "ally"
 * @param {string=} filters.patient_id
 * @param {string=} filters.outcome
 * @param {number=} filters.since_ts       - ms epoch lower bound
 * @param {number=} filters.limit          - default 100, cap 500
 * @returns {Promise<object[]>}
 */
export async function listRecentTraces(env, filters = {}) {
    if (!env || !env.DB) return [];
    const limit = Math.min(Math.max(parseInt(filters.limit, 10) || 100, 1), 500);
    const where = [];
    const args = [];
    if (filters.invite_label) {
        where.push("invite_label = ?");
        args.push(String(filters.invite_label).toLowerCase());
    }
    if (filters.patient_id) {
        where.push("patient_id = ?");
        args.push(String(filters.patient_id));
    }
    if (filters.outcome) {
        where.push("outcome = ?");
        args.push(String(filters.outcome));
    }
    if (filters.since_ts) {
        where.push("ts >= ?");
        args.push(parseInt(filters.since_ts, 10));
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    args.push(limit);
    const res = await env.DB.prepare(`
        SELECT id, ts, session_id, patient_id, invite_label,
               route, http_method, http_status, action, outcome,
               duration_ms, detail_json
        FROM session_trace
        ${whereSql}
        ORDER BY ts DESC
        LIMIT ?
    `).bind(...args).all();
    return (res?.results || []).map((r) => ({
        ...r,
        detail: r.detail_json ? _safeParse(r.detail_json) : null,
    }));
}

function _safeParse(s) {
    try { return JSON.parse(s); } catch { return { _parse_error: true, _raw: s.slice(0, 120) }; }
}
