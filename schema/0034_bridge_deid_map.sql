-- ====================================================================
-- 0034_bridge_deid_map.sql
-- Reversible de-identification for the CLI bridge (2026-08-13)
-- ====================================================================
-- WHY
-- The bridge runs `claude -p` on the owner's Mac against his personal
-- Claude subscription. His Anthropic BAA covers the API; it does NOT
-- cover a consumer CLI subscription. So anything reaching the bridge has
-- left BAA-covered infrastructure and must carry no PHI.
--
-- Blanket Safe-Harbor scrubbing would work for compliance and be useless
-- for the task: a reply that says "your surgery on [DATE]" is not a reply
-- anyone can send. So names and dates become INDEXED tokens -- [NAME_1],
-- [DATE_2] -- the model reasons over tokens, and the server puts the real
-- values back before the physician reads the draft.
--
-- That reverse map is the sensitive artifact. It is, by construction, a
-- list of real names and real dates: PHI in its purest form. It therefore
-- never sits in a plaintext column. It is envelope-encrypted with the
-- same scheme as message bodies (_lib/phi.js) and lives beside the job.
--
-- IT ALSO EXPIRES. The map is needed only between dispatching a job and
-- rehydrating its result -- minutes, usually. `map_expires_at` lets a
-- sweeper drop maps for jobs that were never completed, so an abandoned
-- job does not leave a name/date table lying around indefinitely.
-- ====================================================================

ALTER TABLE ai_jobs ADD COLUMN deid_map_ciphertext TEXT;
ALTER TABLE ai_jobs ADD COLUMN deid_map_dek_wrapped TEXT;
ALTER TABLE ai_jobs ADD COLUMN deid_map_iv_data TEXT;
ALTER TABLE ai_jobs ADD COLUMN deid_map_iv_dek TEXT;
ALTER TABLE ai_jobs ADD COLUMN map_expires_at TEXT;

-- What was actually scrubbed, and whether verification passed. Non-PHI by
-- construction (counts and rule names only, never matched values), so it
-- can be shown in the console: the operator should be able to see
-- "3 phone numbers, 2 dates removed; verification passed" for any job
-- that left the building.
ALTER TABLE ai_jobs ADD COLUMN deid_findings_json TEXT;
ALTER TABLE ai_jobs ADD COLUMN deid_verified INTEGER;

CREATE INDEX IF NOT EXISTS idx_ai_jobs_map_expiry ON ai_jobs (map_expires_at);

-- An append-only record of every de-identified payload that left for the
-- bridge. This is the artifact that answers "prove no PHI was disclosed"
-- -- it stores the FINDINGS and the verification result, never the text.
CREATE TABLE IF NOT EXISTS bridge_disclosure_log (
    id             TEXT PRIMARY KEY,
    at             TEXT NOT NULL,
    job_id         TEXT,
    kind           TEXT NOT NULL,
    bridge_id      TEXT,
    verified       INTEGER NOT NULL,        -- 1 = scrub re-scan found nothing
    findings_json  TEXT,                    -- [{key, count, risk}] -- counts only
    residual_json  TEXT,                    -- non-empty only on a REFUSED send
    chars_sent     INTEGER,
    refused        INTEGER NOT NULL DEFAULT 0,
    refuse_reason  TEXT
);
CREATE INDEX IF NOT EXISTS idx_bridge_disclosure_at ON bridge_disclosure_log (at DESC);
CREATE INDEX IF NOT EXISTS idx_bridge_disclosure_refused ON bridge_disclosure_log (refused, at DESC);
