-- ====================================================================
-- 0021_phase18_id_verify.sql
-- Phase 18 — Sprint 2 R6: identity verification at first visit
-- ====================================================================
-- Joshi & Welch (2023) — video-based photo-ID verification at the first
-- encounter, then "two or more pieces of identifying information" on
-- subsequent encounters. Protects against misdirected prescribing,
-- insurance fraud, misidentification claims, and wrong-party HIPAA
-- disclosures.
--
-- The clinician flips a one-tap toggle in /admin/cases/<id>/ during the
-- opening seconds of the first visit; the endpoint at
-- functions/api/v1/admin/patients/[id]/id-verify.js stamps these columns
-- and writes the audit row.
--
-- NOTE: ALTER TABLE ADD COLUMN is NOT idempotent (same as 0020) — apply
-- exactly once at the sprint-close deploy:
--   wrangler d1 execute mountzara-clinical --remote \
--       --file=schema/0021_phase18_id_verify.sql
-- ====================================================================
ALTER TABLE patients ADD COLUMN identity_verified_at TEXT;
ALTER TABLE patients ADD COLUMN identity_verified_method TEXT
    CHECK (identity_verified_method IS NULL OR identity_verified_method IN
      ('drivers_license_video','passport_video','state_id_video',
       'two_factor_information','deferred'));
ALTER TABLE patients ADD COLUMN identity_verification_notes TEXT;
