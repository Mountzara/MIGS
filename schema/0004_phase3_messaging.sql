-- =====================================================================
-- 0004_phase3_messaging.sql — Phase 3 secure messaging additions
-- =====================================================================
-- Per CLAUDE.md §11 Tier 4 "Secure Messaging" + §11.5.1 expanded portal
-- scope. The Phase 0 foundation defined a bare `messages` table with
-- thread_id + body_r2_key but no envelope DEK column and no top-level
-- thread metadata for fast thread-list rendering. This migration:
--
--   1. Adds `envelope_dek_wrapped` to messages so encrypted bodies in
--      mountzara-phi can be decrypted via functions/_lib/phi.js
--      getPhiObject() / decryptPhi(). The IVs live in R2
--      customMetadata per the phi.js convention; the wrapped DEK lives
--      here in D1 for defense-in-depth.
--
--   2. Adds a `message_threads` table so the thread-list endpoint runs
--      a single indexed scan instead of an aggregate-over-messages
--      query. Stores subject, last-message snippet, last_message_at,
--      and unread counts per side.
--
--   3. Backfills both columns to NULL / 0 for any pre-existing rows
--      (CREATE TABLE IF NOT EXISTS + ALTER TABLE ADD COLUMN are idempotent
--      under D1's "applied migrations" tracking).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Extend messages with the wrapped DEK column.
-- ---------------------------------------------------------------------
ALTER TABLE messages ADD COLUMN envelope_dek_wrapped TEXT;

-- ---------------------------------------------------------------------
-- message_threads — one row per conversation between a patient and the
-- practice. The "to-side" of any thread is always the practice/clinician
-- collectively; staff and clinician roles both see every thread for
-- their patients via the admin endpoints.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS message_threads (
    id                       TEXT PRIMARY KEY,
    patient_id               TEXT NOT NULL,
    clinician_id             TEXT NOT NULL,                 -- 'mabini-christopher-z' for now
    subject                  TEXT NOT NULL,
    last_message_at          INTEGER NOT NULL,              -- ms epoch
    last_message_from_role   TEXT NOT NULL,                 -- 'patient' | 'clinician' | 'staff'
    last_message_preview     TEXT,                          -- first 120 chars of last body; PHI but already
                                                            -- protected by admin/patient access scoping
    patient_unread_count     INTEGER NOT NULL DEFAULT 0,
    clinician_unread_count   INTEGER NOT NULL DEFAULT 0,
    status                   TEXT NOT NULL DEFAULT 'active', -- 'active' | 'archived' | 'closed'
    related_appointment_id   TEXT,                          -- optional FK to appointments
    related_intake_id        TEXT,                          -- optional FK to intake_responses
    created_at               INTEGER NOT NULL,
    updated_at               INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_threads_patient ON message_threads(patient_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_threads_clinician ON message_threads(clinician_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_threads_unread_clin ON message_threads(clinician_id, clinician_unread_count) WHERE clinician_unread_count > 0;
