// =====================================================================
// /api/v1/sync/ai-bridge/*  — the local Claude CLI bridge
// =====================================================================
// The owner runs this practice alone and pays for a Claude CLI
// subscription. His rule: "I only will use the API key for actual billing
// sent to clearinghouses." So non-billing AI work is queued here and
// executed by a bridge process on his own machine, at no per-token cost.
//
// ROUTES (all authenticated with AI_BRIDGE_TOKEN via _lib/sync_auth):
//   GET  /api/v1/sync/ai-bridge/next            claim the oldest pending job
//   POST /api/v1/sync/ai-bridge/<id>/result     return the finished work
//   POST /api/v1/sync/ai-bridge/heartbeat       "the bridge is alive"
//   GET  /api/v1/sync/ai-bridge/status          queue depth + bridge liveness
//
// PHI: job rows carry references only. Results ARE clinical text, so they
// are written to R2 under the same envelope encryption as message bodies
// (_lib/phi.js) — D1 stores the key material and non-clinical metadata,
// exactly as the `messages` table does.
// =====================================================================

import { syncRoute, syncJson, syncError } from "../../../../_lib/sync_auth.js";
import { putPhiObject } from "../../../../_lib/phi.js";

// A claim older than this is considered abandoned and may be re-claimed,
// so a bridge that is killed mid-job does not strand work forever.
const LEASE_SECONDS = 600;

function nowIso() { return new Date().toISOString(); }

async function claimNext(env, bridge_id) {
    const stale = new Date(Date.now() - LEASE_SECONDS * 1000).toISOString();

    // Pending, or claimed-but-abandoned. Oldest first so nothing starves.
    const row = await env.DB.prepare(
        `SELECT id, kind, payload_json, patient_id, attempts, max_attempts
           FROM ai_jobs
          WHERE (status = 'pending')
             OR (status = 'claimed' AND claimed_at < ?)
          ORDER BY created_at ASC
          LIMIT 1`
    ).bind(stale).first();
    if (!row) return null;

    if (row.attempts >= row.max_attempts) {
        await env.DB.prepare(
            `UPDATE ai_jobs SET status='failed', error='max attempts exceeded',
                    completed_at=? WHERE id=?`
        ).bind(nowIso(), row.id).run();
        return null;
    }

    // Conditional update = the lock. If another bridge claimed it between
    // our SELECT and here, meta.changes is 0 and we simply return nothing
    // rather than handing the same job to two workers.
    const res = await env.DB.prepare(
        `UPDATE ai_jobs
            SET status='claimed', claimed_at=?, attempts=attempts+1
          WHERE id=? AND (status='pending' OR (status='claimed' AND claimed_at < ?))`
    ).bind(nowIso(), row.id, stale).run();
    if (!res?.meta?.changes) return null;

    let payload = {};
    try { payload = JSON.parse(row.payload_json || "{}"); } catch { /* keep {} */ }
    return { id: row.id, kind: row.kind, payload, patient_id: row.patient_id, attempt: row.attempts + 1 };
}

export async function onRequest(ctx) {
    return syncRoute(ctx, "ai_bridge", async ({ env, request }) => {
        const url = new URL(request.url);
        const parts = url.pathname.split("/").filter(Boolean);
        // .../v1/sync/ai-bridge/<seg>[/<sub>]
        const i = parts.indexOf("ai-bridge");
        const seg = parts[i + 1] || "";
        const sub = parts[i + 2] || "";
        const method = request.method.toUpperCase();

        // ---- GET /next ------------------------------------------------
        if (method === "GET" && seg === "next") {
            const bridge_id = url.searchParams.get("bridge_id") || "unknown";
            const job = await claimNext(env, bridge_id);
            return syncJson({ ok: true, job: job || null });
        }

        // ---- POST /heartbeat ------------------------------------------
        if (method === "POST" && seg === "heartbeat") {
            let b = {};
            try { b = await request.json(); } catch { /* tolerate empty */ }
            const bridge_id = String(b.bridge_id || "default");
            await env.DB.prepare(
                `INSERT INTO ai_bridge_heartbeat (bridge_id, last_seen_at, version, jobs_done, jobs_failed, note)
                 VALUES (?, ?, ?, COALESCE(?,0), COALESCE(?,0), ?)
                 ON CONFLICT(bridge_id) DO UPDATE SET
                    last_seen_at=excluded.last_seen_at,
                    version=excluded.version,
                    jobs_done=excluded.jobs_done,
                    jobs_failed=excluded.jobs_failed,
                    note=excluded.note`
            ).bind(bridge_id, nowIso(), b.version || null,
                   b.jobs_done ?? 0, b.jobs_failed ?? 0, b.note || null).run();
            return syncJson({ ok: true });
        }

        // ---- GET /status ----------------------------------------------
        if (method === "GET" && seg === "status") {
            const q = await env.DB.prepare(
                `SELECT status, COUNT(*) AS n FROM ai_jobs GROUP BY status`
            ).all();
            const hb = await env.DB.prepare(
                `SELECT bridge_id, last_seen_at, jobs_done, jobs_failed
                   FROM ai_bridge_heartbeat ORDER BY last_seen_at DESC LIMIT 5`
            ).all();
            return syncJson({
                ok: true,
                queue: (q?.results || []).reduce((a, r) => (a[r.status] = r.n, a), {}),
                bridges: hb?.results || [],
            });
        }

        // ---- POST /<id>/result ----------------------------------------
        if (method === "POST" && seg && sub === "result") {
            const job_id = seg;
            let b;
            try { b = await request.json(); } catch { return syncError("invalid json", 400); }

            const job = await env.DB.prepare(
                `SELECT id, kind, patient_id, status FROM ai_jobs WHERE id = ? LIMIT 1`
            ).bind(job_id).first();
            if (!job) return syncError("job not found", 404);

            if (b?.error) {
                await env.DB.prepare(
                    `UPDATE ai_jobs SET status='failed', error=?, completed_at=? WHERE id=?`
                ).bind(String(b.error).slice(0, 800), nowIso(), job_id).run();
                return syncJson({ ok: true, status: "failed" });
            }

            const text = String(b?.result || "");
            if (!text) return syncError("result or error required", 400);

            // Clinical text -> R2, envelope-encrypted. Same discipline as
            // message bodies; D1 never holds the plaintext.
            const r2_key = `ai-jobs/${job_id}.txt`;
            let wrapped;
            try {
                const put = await putPhiObject(env, r2_key, new TextEncoder().encode(text), `ai_job:${job_id}`);
                wrapped = put?.wrapped_dek || put?.envelope_dek_wrapped || null;
            } catch (e) {
                return syncError(`could not store result: ${String(e).slice(0, 160)}`, 500);
            }

            await env.DB.prepare(
                `UPDATE ai_jobs
                    SET status='done', result_r2_key=?, result_dek_wrapped=?,
                        result_meta_json=?, completed_at=?, error=NULL
                  WHERE id=?`
            ).bind(
                r2_key, wrapped,
                JSON.stringify(b?.meta || {}),
                nowIso(), job_id
            ).run();

            return syncJson({ ok: true, status: "done" });
        }

        return syncError("unknown ai-bridge route", 404);
    });
}
