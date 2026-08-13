// =====================================================================
// ai_router.js — decide whether AI work runs on the API or the CLI bridge
// =====================================================================
// The owner's rule, verbatim: "I only will use the API key for actual
// billing sent to clearinghouses."
//
// That is a sound split, and not only on cost:
//
//   REVENUE PATH -> direct Anthropic API (needs ANTHROPIC_API_KEY)
//     Claim preflight, coding assistance, appeal letters. This work must
//     run unattended and synchronously at the moment a claim is worked;
//     it cannot wait for a laptop to be awake. It is also the work that
//     earns money, so per-token cost is trivially justified.
//
//   EVERYTHING ELSE -> queued for the local Claude CLI bridge
//     Message drafts, intake summaries, triage narratives. This is work
//     the owner is present for anyway, latency of a minute is fine, and
//     it runs on the Claude subscription he already pays for.
//
// FAILURE POSTURE. If a bridge job is enqueued and no bridge ever runs,
// the job sits in `ai_jobs` as pending and the admin console shows the
// bridge as offline. It never silently disappears, and it never blocks
// the request that created it. (The missing email transport taught this:
// the dangerous failure is the silent one.)
//
// ENV
//   AI_BRIDGE_ENABLED   "yes" to route non-billing work to the bridge.
//                       Unset => fall back to the API when a key exists,
//                       else queue anyway so nothing is lost.
//   ANTHROPIC_API_KEY   required for the revenue path.
// =====================================================================

/**
 * Job kinds that MUST use the direct API. Everything not listed here is
 * bridge-eligible. Keeping the list explicit means a new AI feature
 * defaults to the cheap path rather than silently spending API tokens.
 */
export const API_ONLY_KINDS = new Set([
    "claim_preflight",
    "claim_coding",
    "claim_appeal",
    "claim_scrub",
    "era_explain",
]);

export function isApiOnly(kind) {
    return API_ONLY_KINDS.has(String(kind || ""));
}

export function bridgeEnabled(env) {
    return String(env?.AI_BRIDGE_ENABLED || "").toLowerCase() === "yes";
}

export function apiKeyPresent(env) {
    return Boolean(env?.ANTHROPIC_API_KEY);
}

/**
 * Where should this kind of work run?
 *   "api"    — call Anthropic now (revenue path, or bridge disabled)
 *   "bridge" — enqueue for the local Claude CLI bridge
 *   "blocked"— cannot run: API-only work with no API key configured
 */
export function routeFor(env, kind) {
    if (isApiOnly(kind)) {
        return apiKeyPresent(env) ? "api" : "blocked";
    }
    if (bridgeEnabled(env)) return "bridge";
    if (apiKeyPresent(env)) return "api";
    // Neither configured: still queue. The work is recorded and runs as
    // soon as a bridge appears, instead of erroring into the void.
    return "bridge";
}

function jobId() {
    return `aij_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

/**
 * Enqueue work for the bridge.
 *
 * @param payload REFERENCES ONLY (ids, kinds, short non-clinical hints).
 *        Never message bodies, never clinical text — see schema/0029.
 */
export async function enqueueAiJob(env, { kind, payload = {}, patient_id = null, requested_by = null }) {
    if (!env?.DB) throw new Error("enqueueAiJob: DB unbound");
    const id = jobId();
    await env.DB.prepare(
        `INSERT INTO ai_jobs (id, kind, payload_json, patient_id, requested_by,
                              status, attempts, created_at)
         VALUES (?, ?, ?, ?, ?, 'pending', 0, ?)`
    ).bind(
        id, String(kind), JSON.stringify(payload),
        patient_id, requested_by, new Date().toISOString()
    ).run();
    return { id, status: "pending" };
}

/** Most recent completed job of a kind for a given reference, if any. */
export async function latestResultFor(env, { kind, refKey, refValue }) {
    const rows = await env.DB.prepare(
        `SELECT id, status, result_r2_key, result_dek_wrapped, result_meta_json,
                error, created_at, completed_at, payload_json
           FROM ai_jobs
          WHERE kind = ?
          ORDER BY created_at DESC
          LIMIT 25`
    ).bind(String(kind)).all();
    for (const r of (rows?.results || [])) {
        try {
            const p = JSON.parse(r.payload_json || "{}");
            if (String(p[refKey]) === String(refValue)) return r;
        } catch { /* skip malformed */ }
    }
    return null;
}

/** Is a bridge alive? Used so the console can explain a missing draft. */
export async function bridgeStatus(env, staleSeconds = 300) {
    if (!env?.DB) return { online: false, reason: "db unbound" };
    try {
        const row = await env.DB.prepare(
            `SELECT bridge_id, last_seen_at, jobs_done, jobs_failed, version
               FROM ai_bridge_heartbeat ORDER BY last_seen_at DESC LIMIT 1`
        ).first();
        if (!row) return { online: false, reason: "no bridge has ever checked in" };
        const age = (Date.now() - Date.parse(row.last_seen_at)) / 1000;
        return {
            online: age <= staleSeconds,
            lastSeenSecondsAgo: Math.round(age),
            bridge_id: row.bridge_id,
            version: row.version || null,
            jobs_done: row.jobs_done,
            jobs_failed: row.jobs_failed,
            reason: age <= staleSeconds ? null : `last check-in ${Math.round(age)}s ago`,
        };
    } catch (e) {
        return { online: false, reason: `heartbeat unavailable: ${String(e).slice(0, 120)}` };
    }
}
