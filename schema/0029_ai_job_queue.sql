-- ====================================================================
-- 0029_ai_job_queue.sql
-- AI job queue for the local Claude CLI bridge (2026-08-12)
-- ====================================================================
-- WHY
-- The owner runs this practice alone and wants AI doing the work he would
-- otherwise do by hand — drafting message replies in his voice, triage,
-- documentation. But he does not want to pay per-token API costs for all
-- of it: "I only will use the API key for actual billing sent to
-- clearinghouses."
--
-- So AI work is ROUTED by kind:
--   * REVENUE PATH (claim preflight, coding, appeals) -> direct Anthropic
--     API. It must run unattended, synchronously, at the moment a claim is
--     worked, and it is the path that earns money.
--   * EVERYTHING ELSE -> queued here and executed by a bridge process on
--     the owner's own machine using his Claude CLI subscription. No
--     per-token cost, and it is work he is present for anyway.
--
-- PHI DISCIPLINE
-- This table holds NO clinical content. `payload_json` carries only
-- REFERENCES (e.g. {"thread_id":"..."}), and the bridge fetches the
-- content it needs over the authenticated admin API. Results are clinical
-- text, so they are stored in R2 under the same envelope encryption as
-- message bodies (see _lib/phi.js): `result_r2_key` +
-- `result_dek_wrapped` here, ciphertext there. D1 keeps metadata only,
-- matching the model used by `messages`.
--
-- LEASE MODEL
-- A bridge claims a job by setting status='claimed' and claimed_at. A job
-- claimed longer than the lease window is reclaimable, so a bridge that
-- dies mid-job does not strand work forever. attempts bounds retries so a
-- poison job cannot loop indefinitely.
-- ====================================================================

CREATE TABLE IF NOT EXISTS ai_jobs (
    id                 TEXT PRIMARY KEY,
    kind               TEXT NOT NULL,           -- 'message_draft' | 'intake_summary' | ...
    payload_json       TEXT NOT NULL,           -- REFERENCES ONLY — never clinical text
    patient_id         TEXT,
    requested_by       TEXT,                    -- admin identity that asked for it
    status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'claimed', 'done', 'failed', 'cancelled')),
    attempts           INTEGER NOT NULL DEFAULT 0,
    max_attempts       INTEGER NOT NULL DEFAULT 3,
    -- Result: ciphertext lives in R2, keys live here (same as `messages`).
    result_r2_key      TEXT,
    result_dek_wrapped TEXT,
    result_meta_json   TEXT,                    -- non-PHI flags e.g. {"escalate":true}
    error              TEXT,
    created_at         TEXT NOT NULL,
    claimed_at         TEXT,
    completed_at       TEXT
);

-- The bridge's hot query: oldest pending job of any kind it handles.
CREATE INDEX IF NOT EXISTS idx_ai_jobs_pending
    ON ai_jobs (status, created_at);
-- Reclaiming stale leases.
CREATE INDEX IF NOT EXISTS idx_ai_jobs_claimed
    ON ai_jobs (status, claimed_at);
-- "what did we run for this patient / this thread"
CREATE INDEX IF NOT EXISTS idx_ai_jobs_patient
    ON ai_jobs (patient_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_kind
    ON ai_jobs (kind, status, created_at);

-- Bridge liveness. One row per bridge instance so the admin console can
-- say "the bridge last checked in 40 seconds ago" instead of leaving the
-- operator guessing why a draft never appeared — the same
-- silent-failure trap that hid the missing email transport.
CREATE TABLE IF NOT EXISTS ai_bridge_heartbeat (
    bridge_id     TEXT PRIMARY KEY,
    last_seen_at  TEXT NOT NULL,
    version       TEXT,
    jobs_done     INTEGER NOT NULL DEFAULT 0,
    jobs_failed   INTEGER NOT NULL DEFAULT 0,
    note          TEXT
);
