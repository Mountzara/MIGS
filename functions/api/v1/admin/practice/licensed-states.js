// GET / PUT /api/v1/admin/practice/licensed-states
//
// Phase 17 R3 — admin editor for the clinician's licensed-states list that
// backs the telehealth state-licensure gate (functions/_lib/licensure.js).
// The list is stored in practice_settings under key 'licensed_states_json'
// as a JSON array of two-letter USPS state codes, e.g. ["IL","IA"].
//
// A dedicated endpoint (rather than the generic practice-settings PATCH) so
// the payload is validated server-side: the gate reads this list to decide
// whether an encounter may lawfully proceed, so junk values here would either
// over-block patients or fall back to the conservative ["IL"] default
// silently. See docs/compliance/licensure.md.

import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../../_lib/admin_api.js";
import { logAudit } from "../../../../_lib/audit.js";

const CLINICIAN_ID = "mabini-christopher-z";
const KEY = "licensed_states_json";
const DEFAULT_FALLBACK = ["IL"];

// USPS two-letter codes for the 50 states + DC. Server-side allow-list so a
// typo cannot write a non-existent jurisdiction into the gate.
const VALID_US_STATES = new Set([
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID",
    "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO",
    "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA",
    "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
]);

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env }) => {
        const row = await env.DB.prepare(`
            SELECT value_json, updated_at, updated_by FROM practice_settings
            WHERE clinician_id = ? AND key = ?
        `).bind(CLINICIAN_ID, KEY).first();
        let licensed_states = [];
        if (row?.value_json) {
            try {
                const parsed = JSON.parse(row.value_json);
                if (Array.isArray(parsed)) {
                    licensed_states = parsed
                        .map((s) => (typeof s === "string" ? s.trim().toUpperCase() : ""))
                        .filter((s) => VALID_US_STATES.has(s));
                }
            } catch { /* fall through to empty */ }
        }
        return jsonResponse({
            licensed_states,
            configured: !!row,
            default_fallback: DEFAULT_FALLBACK,
            effective: licensed_states.length > 0 ? licensed_states : DEFAULT_FALLBACK,
            updated_at: row?.updated_at || null,
            updated_by: row?.updated_by || null,
        });
    });
}

export async function onRequestPut(ctx) {
    return adminRoute(ctx, async ({ env, request, admin }) => {
        const body = await readJsonBody(request);
        const input = Array.isArray(body?.states) ? body.states : null;
        if (!input) return jsonError("missing_states", 400, { hint: 'body: { states: ["IL", ...] }' });

        // Normalize + validate: dedupe, uppercase, reject unknown codes.
        const seen = new Set();
        const invalid = [];
        const states = [];
        for (const raw of input) {
            const code = typeof raw === "string" ? raw.trim().toUpperCase() : "";
            if (!VALID_US_STATES.has(code)) { invalid.push(raw); continue; }
            if (!seen.has(code)) { seen.add(code); states.push(code); }
        }
        if (invalid.length > 0) return jsonError("invalid_state_codes", 400, { invalid });
        // Refuse to store an empty list — that would silently mask a misconfig
        // by letting the gate fall back to the conservative ["IL"] default.
        if (states.length === 0) {
            return jsonError("empty_states", 400, {
                hint: 'Provide at least one state. To restrict to Illinois, send ["IL"].',
            });
        }

        const value_json = JSON.stringify(states);
        const now = Date.now();
        await env.DB.prepare(`
            INSERT INTO practice_settings (clinician_id, key, value_json, updated_at, updated_by)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (clinician_id, key) DO UPDATE SET
                value_json = excluded.value_json,
                updated_at = excluded.updated_at,
                updated_by = excluded.updated_by
        `).bind(CLINICIAN_ID, KEY, value_json, now, admin.user).run();

        await logAudit(env, {
            user_id: admin.user,
            user_role: admin.role,
            action: "admin_override",
            record_type: "practice_settings",
            record_id: `${CLINICIAN_ID}/${KEY}`,
            ip: request.headers.get("CF-Connecting-IP") || "",
            user_agent: request.headers.get("User-Agent") || "",
            success: true,
            details: { key: KEY, states },
        });

        return jsonResponse({ ok: true, licensed_states: states, updated_at: now });
    });
}
