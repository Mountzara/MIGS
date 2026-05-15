-- =====================================================================
-- 0002_phase2_practice_settings.sql — Phase 2 additive schema
-- =====================================================================
-- Apply via: npx wrangler d1 execute mountzara-clinical --remote --file=schema/0002_phase2_practice_settings.sql
-- Idempotent. Re-running is safe.
-- =====================================================================

-- ---------------------------------------------------------------------
-- practice_settings — single-row config for the practice. Holds the
-- Doxy.me clinic URL, default business hours, timezone, and any future
-- practice-level toggle. One row per clinician per setting key, so the
-- multi-clinician future just works without a migration.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS practice_settings (
    clinician_id    TEXT NOT NULL,
    key             TEXT NOT NULL,
    value_json      TEXT NOT NULL,
    updated_at      INTEGER NOT NULL,
    updated_by      TEXT,
    PRIMARY KEY (clinician_id, key)
);
CREATE INDEX IF NOT EXISTS idx_practice_settings_key ON practice_settings(key);

-- ---------------------------------------------------------------------
-- Seed Dr. Mabini as the active clinician of record.
-- ID is a stable canonical UUID so all future references (appointments,
-- encounters, availability blocks) bind to the same row.
-- ---------------------------------------------------------------------
INSERT OR IGNORE INTO clinicians
    (id, email, first_name, last_name, credentials, npi, role, active, created_at, updated_at)
VALUES (
    'mabini-christopher-z',
    'chris.mabini@gmail.com',
    'Christopher',
    'Mabini',
    'DO, MSAEd, AAGL Fellow, MIGS',
    NULL,
    'clinician',
    1,
    1747267200000,
    1747267200000
);

-- ---------------------------------------------------------------------
-- Seed default practice settings for Dr. Mabini. Values are JSON-encoded
-- in value_json. Admin UI can update via PATCH /api/v1/admin/practice-settings.
-- ---------------------------------------------------------------------
INSERT OR IGNORE INTO practice_settings (clinician_id, key, value_json, updated_at, updated_by)
VALUES
    ('mabini-christopher-z', 'doxy_room_url',         '""',                                1747267200000, 'phase-2-seed'),
    ('mabini-christopher-z', 'timezone',              '"America/Chicago"',                 1747267200000, 'phase-2-seed'),
    ('mabini-christopher-z', 'practice_address',      '"PRIME Healthcare St. Francis Hospital, Evanston, IL"', 1747267200000, 'phase-2-seed'),
    ('mabini-christopher-z', 'phone_office',          '""',                                1747267200000, 'phase-2-seed'),
    ('mabini-christopher-z', 'reminders_email_from',  '"appointments@mountzara.com"',      1747267200000, 'phase-2-seed'),
    ('mabini-christopher-z', 'business_hours_json',
        '{"mon":{"open":"08:30","close":"17:00"},"tue":{"closed":true,"reason":"surgery"},"wed":{"open":"08:30","close":"17:00"},"thu":{"closed":true,"reason":"surgery"},"fri":{"open":"08:30","close":"17:00"},"sat":{"open":"09:00","close":"12:00"},"sun":{"closed":true}}',
        1747267200000, 'phase-2-seed'),
    ('mabini-christopher-z', 'workflow_rules_json',
        '{"max_complex_new_patients_per_day":3,"buffer_min_after_long_visit":5,"min_buffer_between_complex":10,"telehealth_clustered":true,"afternoon_preferred_for_quick":true}',
        1747267200000, 'phase-2-seed');

-- =====================================================================
-- End of 0002_phase2_practice_settings.sql
-- =====================================================================
