// =====================================================================
// functions/_lib/licensure.js — single source of truth for the
// licensed-states list backing Phase 17 R3 (state-licensure intake gate)
// =====================================================================
// Per CLAUDE.md + docs/compliance/licensure.md. Reads the active-state
// list from practice_settings.licensed_states_json (keyed by clinician)
// and provides isLicensedInState() + getLicensedStates() helpers used
// by:
//   - /api/v1/patient/intake/[intake_id]/submit.js — pre-LLM gate
//   - /api/v1/patient/intake/[intake_id]/triage.js — short-circuit gate
//   - /api/v1/patient/appointments/book.js — defense-in-depth final gate
//   - /admin/practice-settings/ — read/write UI for the state list
//
// The default fallback when practice_settings has no row is a
// conservative ["IL"] (Illinois-only) so a misconfigured deploy
// fails closed rather than wide-open.
// =====================================================================

const CLINICIAN_ID = "mabini-christopher-z";

// Conservative fallback if practice_settings lookup fails. Set to the
// state where the practice is physically located.
const DEFAULT_LICENSED_STATES = ["IL"];

// Cache lifetime in ms — the licensed-states list changes rarely
// (license addition / renewal). A 60-second cache reduces D1 reads on
// hot booking paths but stays fresh enough that admin edits are
// visible within a minute.
const CACHE_TTL_MS = 60 * 1000;

let _cache = null;
let _cache_loaded_at = 0;

/**
 * Read the licensed-states array from practice_settings. Cached for
 * CACHE_TTL_MS. Always returns an array of upper-case two-letter codes.
 */
export async function getLicensedStates(env) {
    const now = Date.now();
    if (_cache && (now - _cache_loaded_at) < CACHE_TTL_MS) {
        return _cache;
    }
    if (!env || !env.DB) {
        _cache = DEFAULT_LICENSED_STATES;
        _cache_loaded_at = now;
        return _cache;
    }
    try {
        const row = await env.DB.prepare(`
            SELECT value_json FROM practice_settings
            WHERE clinician_id = ? AND key = 'licensed_states_json'
        `).bind(CLINICIAN_ID).first();
        if (row?.value_json) {
            const parsed = JSON.parse(row.value_json);
            if (Array.isArray(parsed) && parsed.length > 0) {
                _cache = parsed
                    .map((s) => typeof s === "string" ? s.trim().toUpperCase() : "")
                    .filter((s) => /^[A-Z]{2}$/.test(s));
                _cache_loaded_at = now;
                return _cache;
            }
        }
    } catch (e) {
        // Fall through to default. Log via caller; this helper stays silent.
    }
    _cache = DEFAULT_LICENSED_STATES;
    _cache_loaded_at = now;
    return _cache;
}

/**
 * Predicate. Returns true if `state` is in the active licensed-states
 * list. Case-insensitive on the input. Returns false on empty / invalid
 * input rather than throwing — callers handle the "no state provided"
 * case as a missing-data error separately.
 */
export async function isLicensedInState(env, state) {
    if (!state || typeof state !== "string") return false;
    const code = state.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) return false;
    const list = await getLicensedStates(env);
    return list.includes(code);
}

/**
 * Write a row to the licensure_blocks audit table so the practice can
 * see which states are producing intake attempts that get blocked
 * (informs IMLC strategic decisions per docs/compliance/licensure.md §2).
 * Best-effort — never throws.
 */
export async function recordLicensureBlock(env, { patient_id, state, reason }) {
    if (!env?.DB || !patient_id || !state) return;
    try {
        await env.DB.prepare(`
            INSERT INTO licensure_blocks (patient_id, state, reason)
            VALUES (?, ?, ?)
        `).bind(patient_id, String(state).toUpperCase(), String(reason || "").slice(0, 500)).run();
    } catch {
        // best-effort
    }
}

/**
 * Test-only escape hatch to reset the cache (used by smoketests).
 */
export function _resetCache() {
    _cache = null;
    _cache_loaded_at = 0;
}
