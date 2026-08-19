-- =====================================================================
-- 0042_encounter_note_sha.sql — make a retried note push safe
-- =====================================================================
-- WHY. /sync/transcription/notes is idempotent by (patient,
-- transcription_session_id) and answers a repeat push with 409
-- duplicate_session. That is correct HTTP and wrong ergonomics for the
-- client that actually exists: an offline-tolerant app queues a push,
-- the write succeeds, the RESPONSE is lost to a dropped connection, and
-- the retry now gets a 409 the client reads as failure — so it either
-- retries forever or marks a saved note as unsynced. The note is on the
-- server the whole time.
--
-- With the note's SHA-256 recorded we can tell the two cases apart:
--   * same session, same content  → the retry SUCCEEDED. Answer 200 with
--     the existing encounter id. Genuinely idempotent.
--   * same session, DIFFERENT content → a real conflict. Still 409, and
--     the second note is never silently discarded.
--
-- The hash is of plaintext the server never keeps; only the digest is
-- stored, which is not reversible and identifies nothing on its own.
-- =====================================================================

ALTER TABLE encounters ADD COLUMN note_sha256 TEXT;
CREATE INDEX IF NOT EXISTS idx_encounters_session
    ON encounters(patient_id, transcription_session_id);
