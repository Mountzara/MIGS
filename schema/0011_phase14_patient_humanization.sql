-- =====================================================================
-- 0011_phase14_patient_humanization.sql
-- =====================================================================
-- Phase 14 — patient profile humanization + AI pre-visit briefings.
--
-- Adds:
--   patients.nickname           — informal name the patient prefers in
--                                  conversation (NOT preferred_name; that
--                                  field is the documented preferred legal/
--                                  social name. nickname is the touchpoint
--                                  the clinician uses on greeting).
--   patients.photo_r2_key       — pointer to envelope-encrypted profile
--                                  photo stored in mountzara-phi R2.
--   patients.photo_wrapped_dek  — wrapped per-record DEK for the photo.
--   patients.care_goals_json    — JSON blob: structured patient-stated
--                                  goals + preferences (e.g. avoid opioids,
--                                  return to running, fertility-preserving
--                                  options, telehealth-first, etc.).
--
-- New tables:
--   patient_personal_notes      — clinician-side personal/relationship
--                                  context (NOT shown to patient). Body is
--                                  envelope-encrypted (PHI-grade, treat any
--                                  free-text about a patient as PHI). Each
--                                  note has a category for filtering.
--
-- All photo + personal-note bodies follow the existing PHI envelope pattern
-- (see functions/_lib/phi.js): per-record AES-GCM DEK wrapped by
-- PHI_MASTER_KEY, with IVs in R2 customMetadata + wrapped_dek on this row.
-- =====================================================================

-- patients.nickname / photo_r2_key / photo_wrapped_dek / care_goals_json
-- (D1 doesn't support ADD COLUMN IF NOT EXISTS — these guards block re-run.
-- On re-apply, expect "duplicate column" SQLITE_ERRORs that are safe to
-- ignore.)
ALTER TABLE patients ADD COLUMN nickname           TEXT;
ALTER TABLE patients ADD COLUMN photo_r2_key       TEXT;
ALTER TABLE patients ADD COLUMN photo_wrapped_dek  TEXT;
ALTER TABLE patients ADD COLUMN photo_uploaded_at  INTEGER;
ALTER TABLE patients ADD COLUMN care_goals_json    TEXT;       -- JSON: { goals: [...], preferences: [...] }
ALTER TABLE patients ADD COLUMN care_goals_updated_at INTEGER;

-- ---------------------------------------------------------------------
-- patient_personal_notes — clinician-side memory.
-- Conversation touchpoints, family details, hobbies the clinician wants
-- to surface at the start of the next visit. NOT patient-visible.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS patient_personal_notes (
    id                  TEXT PRIMARY KEY,                       -- UUIDv4
    patient_id          TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    category            TEXT NOT NULL DEFAULT 'personal',       -- 'personal' | 'family' | 'preference' | 'milestone' | 'logistics'
    summary             TEXT,                                    -- short headline; safe-ish to render in lists (still PHI, still gated)
    body_r2_key         TEXT NOT NULL,                           -- mountzara-phi key, envelope-encrypted full text
    body_wrapped_dek    TEXT NOT NULL,                           -- wrapped DEK from putPhiObject
    body_iv_data        TEXT NOT NULL,
    body_iv_dek         TEXT NOT NULL,
    body_size_bytes     INTEGER NOT NULL DEFAULT 0,
    -- Optional pin flag: pinned notes always surface at the top of the
    -- pre-visit briefing's personal_touchpoints section.
    is_pinned           INTEGER NOT NULL DEFAULT 0,             -- 0 | 1
    created_at          INTEGER NOT NULL,
    created_by          TEXT,                                    -- clinician user id / 'admin'
    updated_at          INTEGER NOT NULL,
    updated_by          TEXT
);
CREATE INDEX IF NOT EXISTS idx_ppn_patient    ON patient_personal_notes(patient_id, is_pinned DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ppn_category   ON patient_personal_notes(patient_id, category);
