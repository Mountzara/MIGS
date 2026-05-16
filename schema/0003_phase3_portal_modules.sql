-- =====================================================================
-- 0003_phase3_portal_modules.sql — symptom tracker, education materials,
-- AI visit summaries, content subscriptions, and patient education
-- assignments.
-- =====================================================================
-- Adds the schema for the expanded patient-portal scope announced
-- 2026-05-15 (user directive):
--   * symptom tracker / diary
--   * women's-health-specific tooling (cycle, perimenopause, postpartum)
--   * Trending blog + Evidence digest integration
--   * AI-summarized prior-encounter recaps
--   * Education materials Dr. Mabini has authored
--   * Latest-literature feed subscriptions
--
-- Apply via:
--   npx wrangler d1 execute mountzara-clinical --remote --file=schema/0003_phase3_portal_modules.sql
-- Idempotent. Re-running is safe. Additive only — no ALTER on prior tables.
-- =====================================================================

-- ---------------------------------------------------------------------
-- symptom_definitions — catalog of trackable symptoms / metrics with
-- metadata. System table; seeded below. Patient diary entries reference
-- a symptom by its `key`.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS symptom_definitions (
    key             TEXT PRIMARY KEY,
    domain          TEXT NOT NULL,            -- 'pain' | 'bleeding' | 'mood' | 'sleep' | 'sexual' | 'gi' | 'gu' | 'cycle' | 'menopause' | 'postpartum' | 'eras' | 'other'
    display_name    TEXT NOT NULL,
    description     TEXT,
    scale_kind      TEXT NOT NULL,            -- 'numeric_0_10' | 'numeric_0_4' | 'boolean' | 'enum' | 'text' | 'count_per_day' | 'minutes' | 'mm_per_day'
    scale_min       REAL,                     -- numeric scales only
    scale_max       REAL,                     -- numeric scales only
    enum_options_json TEXT,                   -- enum scales only — JSON array of allowed values
    unit            TEXT,                     -- 'pad/h' | 'days' | 'min' | etc.
    migs_relevant   INTEGER NOT NULL DEFAULT 1,    -- 1 = show by default in MIGS portal
    sort_order      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_symptom_domain ON symptom_definitions(domain, sort_order);

-- ---------------------------------------------------------------------
-- symptom_diary_entries — one row per patient per day. Values for that
-- day live as a JSON object keyed by symptom_definitions.key. Sparse —
-- the patient logs only what they want to log.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS symptom_diary_entries (
    id              TEXT PRIMARY KEY,         -- UUIDv4
    patient_id      TEXT NOT NULL,
    entry_date      TEXT NOT NULL,            -- ISO YYYY-MM-DD in patient timezone
    values_json     TEXT NOT NULL,            -- {"pelvic_pain_0_10": 6, "pain_location": ["center","right"], "bleeding_pads_per_hour": 1, "sleep_quality_0_10": 4, ...}
    note            TEXT,                     -- optional free-text note from patient (PHI — short)
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    UNIQUE(patient_id, entry_date)
);
CREATE INDEX IF NOT EXISTS idx_diary_patient_date ON symptom_diary_entries(patient_id, entry_date DESC);

-- ---------------------------------------------------------------------
-- cycle_log — first-class table for menstrual / fertility / menopause
-- events. A subset of these are also derivable from symptom_diary_entries
-- but a normalized table makes cycle charting + ovulation prediction
-- queries simple.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cycle_log (
    id              TEXT PRIMARY KEY,
    patient_id      TEXT NOT NULL,
    event_date      TEXT NOT NULL,            -- ISO YYYY-MM-DD
    event_kind      TEXT NOT NULL,            -- 'period_start' | 'period_end' | 'ovulation_suspected' | 'spotting' | 'pregnancy_test_positive' | 'pregnancy_test_negative' | 'pregnancy_loss' | 'menopause_symptom_day' | 'last_menstrual_period_marked'
    flow_intensity  TEXT,                     -- 'light' | 'moderate' | 'heavy' | 'flooding' (when applicable)
    details_json    TEXT,                     -- event-kind-specific extras (e.g. {hot_flashes:3, night_sweats:2})
    note            TEXT,
    created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cycle_patient_date ON cycle_log(patient_id, event_date DESC);
CREATE INDEX IF NOT EXISTS idx_cycle_patient_kind ON cycle_log(patient_id, event_kind, event_date DESC);

-- ---------------------------------------------------------------------
-- womens_health_profile — slowly-changing facts that color symptom
-- interpretation: parity, contraception in use, menopause status,
-- breastfeeding, fertility goals. One row per patient, optional.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS womens_health_profile (
    patient_id              TEXT PRIMARY KEY,
    parity_g                INTEGER,
    parity_p                INTEGER,
    parity_t                INTEGER,
    parity_a                INTEGER,
    parity_l                INTEGER,
    contraception_kind      TEXT,             -- 'none' | 'coc' | 'pop' | 'lng_iud' | 'cu_iud' | 'implant' | 'dmpa' | 'ring' | 'patch' | 'sterilization' | 'other'
    contraception_details   TEXT,
    menopause_status        TEXT,             -- 'premenopausal' | 'perimenopausal' | 'postmenopausal' | 'surgical' | 'unknown'
    menopause_last_period   TEXT,             -- ISO YYYY-MM-DD if postmenopausal
    breastfeeding           INTEGER,          -- 0/1
    fertility_goal          TEXT,             -- 'ttc' | 'avoiding' | 'undecided' | 'preserving_fertility' | 'not_applicable'
    family_history_json     TEXT,             -- {"endometriosis":["mother"],"breast_ca":["aunt"], ...}
    updated_at              INTEGER NOT NULL,
    updated_by_role         TEXT
);

-- ---------------------------------------------------------------------
-- education_materials — Dr. Mabini's authored patient-facing primers.
-- Short bodies live inline in `body_md`; longer pieces or those with
-- images live in mountzara-content R2 (referenced by r2_key).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS education_materials (
    id              TEXT PRIMARY KEY,
    slug            TEXT NOT NULL UNIQUE,     -- 'endometriosis-101' etc.
    title           TEXT NOT NULL,
    summary         TEXT,
    body_md         TEXT,                     -- inline markdown (small/medium primers)
    r2_key          TEXT,                     -- for larger primers; mountzara-content
    topic_tags_json TEXT,                     -- ["endometriosis","pain","perioperative", ...]
    target_audience TEXT,                     -- 'all' | 'preop' | 'postop' | 'menopause' | 'pregnancy' | 'pcos' | etc.
    status          TEXT NOT NULL DEFAULT 'draft',  -- 'draft' | 'published' | 'archived'
    version         INTEGER NOT NULL DEFAULT 1,
    author_clinician_id TEXT,
    published_at    INTEGER,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_edu_status_published ON education_materials(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_edu_slug ON education_materials(slug);

-- ---------------------------------------------------------------------
-- patient_education_assignments — which patient was assigned which
-- material (by Dr. Mabini, by an automation rule, or self-assigned).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS patient_education_assignments (
    id              TEXT PRIMARY KEY,
    patient_id      TEXT NOT NULL,
    material_id     TEXT NOT NULL,
    assigned_by_role TEXT NOT NULL,           -- 'clinician' | 'patient' | 'system_rule'
    assigned_by_id  TEXT,                     -- clinician_id, or NULL for system
    reason          TEXT,                     -- 'pre_op_prep' | 'newly_diagnosed' | 'related_to_intake' | 'requested_by_patient'
    assigned_at     INTEGER NOT NULL,
    first_opened_at INTEGER,
    completed_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_assign_patient ON patient_education_assignments(patient_id, assigned_at DESC);
CREATE INDEX IF NOT EXISTS idx_assign_material ON patient_education_assignments(material_id);

-- ---------------------------------------------------------------------
-- encounter_ai_summaries — AI-generated post-visit summaries.
-- Generated from MountZaraMedicalTranscription session output (via the
-- Phase 4 app sync layer), then clinician-reviewed before patient sees
-- it. Body lives in R2 (mountzara-phi) because it carries clinical PHI.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS encounter_ai_summaries (
    id                          TEXT PRIMARY KEY,
    encounter_id                TEXT NOT NULL,
    patient_id                  TEXT NOT NULL,
    clinician_id                TEXT NOT NULL,
    source                      TEXT NOT NULL,        -- 'transcription_app' | 'manual' | 'imported'
    transcription_session_id    TEXT,
    ai_model                    TEXT,                 -- e.g. 'claude-opus-4-6'
    ai_prompt_version           TEXT,                 -- pinned prompt id
    patient_visible_r2_key      TEXT,                 -- mountzara-phi key for patient-facing summary (plain language)
    clinician_full_r2_key       TEXT,                 -- mountzara-phi key for fuller clinician-side note
    patient_visible_wrapped_dek TEXT,
    clinician_full_wrapped_dek  TEXT,
    plan_summary                TEXT,                 -- short denormalized plain-language plan, ≤ 200 chars
    medications_list_json       TEXT,                 -- ["amitriptyline 25 mg qhs", ...] — denormalized for patient widgets
    next_step_summary           TEXT,
    status                      TEXT NOT NULL DEFAULT 'pending_clinician_review',  -- 'pending_clinician_review' | 'approved' | 'rejected' | 'archived'
    clinician_reviewed_at       INTEGER,
    clinician_review_action     TEXT,                 -- 'approved_as_is' | 'edited_and_approved' | 'rejected'
    clinician_review_note       TEXT,
    patient_first_viewed_at     INTEGER,
    created_at                  INTEGER NOT NULL,
    updated_at                  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_summary_encounter ON encounter_ai_summaries(encounter_id);
CREATE INDEX IF NOT EXISTS idx_ai_summary_patient ON encounter_ai_summaries(patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_summary_pending ON encounter_ai_summaries(status, created_at) WHERE status = 'pending_clinician_review';

-- ---------------------------------------------------------------------
-- patient_content_subscriptions — patient opts in to a topic feed so
-- the latest matching Trending posts + Evidence digest entries surface
-- in their portal home. Topic tags align with the Research Digest
-- pipeline's topic taxonomy (pubmed_query_definitions.py 13-topic set).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS patient_content_subscriptions (
    id              TEXT PRIMARY KEY,
    patient_id      TEXT NOT NULL,
    topic_tag       TEXT NOT NULL,            -- 'endometriosis' | 'fibroids' | 'pcos' | 'menopause' | etc.
    subscribed_at   INTEGER NOT NULL,
    unsubscribed_at INTEGER,
    notification_pref TEXT NOT NULL DEFAULT 'in_portal',  -- 'in_portal' | 'in_portal_plus_email'
    UNIQUE(patient_id, topic_tag)
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_patient ON patient_content_subscriptions(patient_id) WHERE unsubscribed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_subscriptions_topic ON patient_content_subscriptions(topic_tag) WHERE unsubscribed_at IS NULL;

-- ---------------------------------------------------------------------
-- patient_content_views — track which Trending / Evidence / Education
-- piece a patient has viewed. Drives unread badges, completion percent
-- on education plans, and analytics (which materials are actually read).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS patient_content_views (
    id              TEXT PRIMARY KEY,
    patient_id      TEXT NOT NULL,
    content_kind    TEXT NOT NULL,            -- 'trending_post' | 'evidence_post' | 'education_material'
    content_id      TEXT NOT NULL,            -- post slug for Trending/Evidence; education_materials.id for primers
    first_viewed_at INTEGER NOT NULL,
    last_viewed_at  INTEGER NOT NULL,
    view_count      INTEGER NOT NULL DEFAULT 1,
    completed       INTEGER NOT NULL DEFAULT 0,   -- 1 if reader hit the bottom / finished
    UNIQUE(patient_id, content_kind, content_id)
);
CREATE INDEX IF NOT EXISTS idx_views_patient ON patient_content_views(patient_id, last_viewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_views_content ON patient_content_views(content_kind, content_id);

-- ---------------------------------------------------------------------
-- Seed the standard symptom catalog. Covers the high-yield trackable
-- symptoms a MIGS gynecology patient is likely to enter. Patient sees
-- only those flagged migs_relevant=1; clinician can extend per-patient.
-- ---------------------------------------------------------------------
INSERT OR IGNORE INTO symptom_definitions (key, domain, display_name, description, scale_kind, scale_min, scale_max, enum_options_json, unit, migs_relevant, sort_order) VALUES
    -- pain
    ('pelvic_pain_0_10',         'pain',       'Pelvic pain intensity',           '0 = none, 10 = worst pain imaginable',         'numeric_0_10', 0, 10, NULL, NULL, 1, 10),
    ('pain_location',            'pain',       'Pelvic pain location',            'Multi-select.',                                'enum',         NULL, NULL, '["center","right","left","both","bladder","rectal","low_back","other"]', NULL, 1, 11),
    ('pain_triggers',            'pain',       'Pain triggers today',             'Multi-select.',                                'enum',         NULL, NULL, '["with_period","constant","with_intercourse","with_ovulation","full_bladder","with_bowel_movement","stress","other"]', NULL, 1, 12),
    ('dyspareunia_0_10',         'pain',       'Pain with intercourse',           '0 = none, 10 = worst.',                        'numeric_0_10', 0, 10, NULL, NULL, 1, 13),
    -- bleeding
    ('bleeding_pads_per_hour',   'bleeding',   'Pads per hour (heaviest)',        'Count of fully soaked pads per hour today.',   'count_per_day', 0, 12, NULL, 'pads/h', 1, 20),
    ('bleeding_days_in_cycle',   'bleeding',   'Days of bleeding this cycle',     NULL,                                          'count_per_day', 0, 31, NULL, 'days', 1, 21),
    ('clots_quarter_size_plus',  'bleeding',   'Clots larger than a quarter',     'Yes/no for the day.',                          'boolean',      NULL, NULL, NULL, NULL, 1, 22),
    ('flooding_episodes',        'bleeding',   'Flooding episodes today',         'Sudden gushing bleeding.',                    'count_per_day', 0, 12, NULL, NULL, 1, 23),
    -- cycle / menopause
    ('cycle_day',                'cycle',      'Cycle day',                       'Day 1 = first day of last period.',            'count_per_day', 1, 60, NULL, 'day', 1, 30),
    ('hot_flashes_count',        'menopause',  'Hot flashes today',               'Total count.',                                'count_per_day', 0, 50, NULL, NULL, 1, 40),
    ('night_sweats_count',       'menopause',  'Night sweats overnight',          NULL,                                          'count_per_day', 0, 20, NULL, NULL, 1, 41),
    -- mood / sleep
    ('mood_0_10',                'mood',       'Mood',                            '0 = very low, 10 = great.',                    'numeric_0_10', 0, 10, NULL, NULL, 1, 50),
    ('anxiety_0_10',             'mood',       'Anxiety',                         '0 = none, 10 = worst.',                        'numeric_0_10', 0, 10, NULL, NULL, 1, 51),
    ('sleep_quality_0_10',       'sleep',      'Sleep quality',                   '0 = terrible, 10 = restorative.',              'numeric_0_10', 0, 10, NULL, NULL, 1, 60),
    ('sleep_hours',              'sleep',      'Sleep duration',                  NULL,                                          'minutes',       0, 24, NULL, 'h', 1, 61),
    -- sexual function
    ('sexual_desire_0_10',       'sexual',     'Sexual desire',                   '0 = none, 10 = high.',                         'numeric_0_10', 0, 10, NULL, NULL, 1, 70),
    -- GI
    ('bm_pain_with',             'gi',         'Painful bowel movements',         'Yes/no.',                                      'boolean',      NULL, NULL, NULL, NULL, 1, 80),
    ('diarrhea_episodes',        'gi',         'Diarrhea episodes',               NULL,                                          'count_per_day', 0, 20, NULL, NULL, 1, 81),
    ('constipation_days',        'gi',         'Days since last BM',              NULL,                                          'count_per_day', 0, 14, NULL, 'days', 1, 82),
    ('bloating_0_10',            'gi',         'Bloating',                        '0 = none, 10 = severe.',                       'numeric_0_10', 0, 10, NULL, NULL, 1, 83),
    -- GU
    ('urinary_urgency_0_10',     'gu',         'Urinary urgency',                 '0 = none, 10 = constant.',                     'numeric_0_10', 0, 10, NULL, NULL, 1, 90),
    ('urinary_frequency_count',  'gu',         'Urinary frequency',               'Daytime voids.',                              'count_per_day', 0, 30, NULL, NULL, 1, 91),
    ('nocturia_count',           'gu',         'Nighttime voids',                 NULL,                                          'count_per_day', 0, 10, NULL, NULL, 1, 92),
    -- functional impact
    ('work_school_impact_0_10',  'other',      'Symptoms impact on work/school',  '0 = none, 10 = couldn''t function.',           'numeric_0_10', 0, 10, NULL, NULL, 1, 100),
    ('medication_taken_today',   'other',      'Pain meds taken today',           'Free text (e.g. naproxen 500 mg x2).',         'text',         NULL, NULL, NULL, NULL, 1, 101);

-- ---------------------------------------------------------------------
-- Seed a single placeholder education material so the portal has
-- something to render in the admin preview. Real content fills in later.
-- ---------------------------------------------------------------------
INSERT OR IGNORE INTO education_materials
    (id, slug, title, summary, body_md, topic_tags_json, target_audience, status, version, author_clinician_id, published_at, created_at, updated_at)
VALUES (
    'edu-placeholder-welcome',
    'welcome-to-the-portal',
    'Welcome to the Mount Zara patient portal',
    'A short orientation to what the portal is, what it isn''t, and how to use it.',
    '# Welcome\n\nThis is a placeholder. Dr. Mabini''s authored primers will replace this seed as the education library is built out.',
    '["orientation"]',
    'all',
    'draft',
    1,
    'mabini-christopher-z',
    NULL,
    1747267200000,
    1747267200000
);

-- =====================================================================
-- End of 0003_phase3_portal_modules.sql
-- =====================================================================
