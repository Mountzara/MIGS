-- ============================================================================
-- Phase 10 — Validated PROM (Patient-Reported Outcome Measures) infrastructure
-- ============================================================================
-- Per CLAUDE.md §11.5.1 (expanded portal scope) + the validated-questionnaire
-- library at ~/Documents/MZ_Validated_Questionnaires_Library.md.
--
-- Architecture:
--   prom_definitions    — every Tier-1/2/3 PROM (items, scoring, thresholds)
--   prom_assignments    — which PROMs each patient owes us, when, why
--   prom_responses      — patient-submitted answers + computed scores
--   prom_triage_flags   — threshold breaches that warrant clinician attention
--
-- AI integration:
--   - On intake submit, the existing intake_triage.js AI call is extended to
--     also recommend Tier-2 PROMs based on chief complaint, comorbidities,
--     fertility goals (endometriosis-suggestive → EHP-30 + FSFI + FSDS-R; HMB
--     → PBAC + UFS-QoL + MBQ; pelvic floor → PFDI-20 + PFIQ-7; menopause →
--     MENQOL + DIVA; PCOS → PCOSQ; fertility → FertiQoL; etc.). AI rationale
--     is recorded in prom_assignments.trigger_reason for clinician audit.
--   - PROM scores feed the patient AI snapshot regeneration (Phase 9.5).
--   - Triage flags surface in /admin/triage and on the patient case view.
--
-- All tables use TEXT primary keys (UUID v4) to match the rest of the schema.
-- ============================================================================

-- 1. Definitions — versioned, immutable canonical questionnaires
CREATE TABLE IF NOT EXISTS prom_definitions (
    slug            TEXT PRIMARY KEY,           -- 'phq-2', 'gad-2', 'bpi-sf', 'ehp-5', 'ehp-30', ...
    title           TEXT NOT NULL,              -- 'Depression screening (PHQ-2)'
    short_name      TEXT,                       -- 'PHQ-2'
    tier            INTEGER NOT NULL,           -- 1 universal, 2 condition-triggered, 3 clinician
    domain          TEXT,                       -- 'depression', 'anxiety', 'endometriosis', 'pain', 'pelvic_floor', ...
    description     TEXT,                       -- patient-facing one-liner
    estimated_minutes INTEGER,                  -- typical completion time
    items_json      TEXT NOT NULL,              -- JSON: [{id, text, type, options[], required, ...}]
    scoring_json    TEXT NOT NULL,              -- JSON: how to compute total + subscale scores
    thresholds_json TEXT,                       -- JSON: rules that fire prom_triage_flags
    citation        TEXT,                       -- 'Kroenke K, Spitzer RL. Med Care 2003 [PMID:14583691]'
    license_note    TEXT,                       -- 'public domain' or 'requires Oxford license for commercial use'
    version         TEXT NOT NULL DEFAULT '1.0',
    is_active       INTEGER NOT NULL DEFAULT 1, -- soft-deactivate without dropping rows
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. Assignments — instance of "this PROM is owed by this patient"
CREATE TABLE IF NOT EXISTS prom_assignments (
    id              TEXT PRIMARY KEY,
    patient_id      TEXT NOT NULL,
    prom_slug       TEXT NOT NULL,
    -- Provenance — who/what assigned this
    assigned_by_kind TEXT NOT NULL,             -- 'clinician' | 'ai_intake_triage' | 'scheduled_recurrence' | 'self'
    assigned_by_id  TEXT,                       -- clinician.id when kind=clinician; null otherwise
    trigger_reason  TEXT,                       -- short rationale ("endometriosis-suggestive intake — dysmenorrhea+dyspareunia+infertility-goal") or scheduled label
    period_label    TEXT,                       -- 'baseline' | '3mo follow-up' | '6mo post-op' | '12mo' | 'recurrent'
    -- Timing
    assigned_at     TEXT NOT NULL DEFAULT (datetime('now')),
    due_at          TEXT,                       -- soft deadline; patient sees a friendly nudge
    -- Status
    status          TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'in_progress' | 'completed' | 'expired' | 'skipped'
    started_at      TEXT,
    completed_at    TEXT,
    response_id     TEXT,                       -- FK → prom_responses.id once submitted
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY (prom_slug)  REFERENCES prom_definitions(slug)
);
CREATE INDEX IF NOT EXISTS idx_prom_assignments_patient_status
    ON prom_assignments(patient_id, status);
CREATE INDEX IF NOT EXISTS idx_prom_assignments_due
    ON prom_assignments(status, due_at);

-- 3. Responses — answered & scored
CREATE TABLE IF NOT EXISTS prom_responses (
    id              TEXT PRIMARY KEY,
    assignment_id   TEXT NOT NULL,
    patient_id      TEXT NOT NULL,
    prom_slug       TEXT NOT NULL,
    response_data   TEXT NOT NULL,              -- JSON: {item_id: value, ...}
    computed_scores TEXT NOT NULL,              -- JSON: {total, subscales:{...}, interpretation:'moderate'}
    threshold_flags TEXT,                       -- JSON: array of flag-type keys that fired
    submitted_at    TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (assignment_id) REFERENCES prom_assignments(id) ON DELETE CASCADE,
    FOREIGN KEY (patient_id)    REFERENCES patients(id)        ON DELETE CASCADE,
    FOREIGN KEY (prom_slug)     REFERENCES prom_definitions(slug)
);
CREATE INDEX IF NOT EXISTS idx_prom_responses_patient_slug_time
    ON prom_responses(patient_id, prom_slug, submitted_at);

-- 4. Triage flags — threshold breaches surfaced to clinician
CREATE TABLE IF NOT EXISTS prom_triage_flags (
    id              TEXT PRIMARY KEY,
    response_id     TEXT NOT NULL,
    patient_id      TEXT NOT NULL,
    prom_slug       TEXT NOT NULL,
    flag_type       TEXT NOT NULL,              -- 'phq2_positive' | 'bpi_severity_high' | 'pfdi20_severe' | etc.
    severity        TEXT NOT NULL,              -- 'info' | 'warning' | 'urgent'
    message         TEXT NOT NULL,              -- short human-readable "Pain severity 8.5/10 sustained — consider visit"
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    acknowledged_by_clinician_id TEXT,
    acknowledged_at TEXT,
    acknowledged_note TEXT,
    FOREIGN KEY (response_id) REFERENCES prom_responses(id) ON DELETE CASCADE,
    FOREIGN KEY (patient_id)  REFERENCES patients(id)        ON DELETE CASCADE,
    FOREIGN KEY (prom_slug)   REFERENCES prom_definitions(slug)
);
CREATE INDEX IF NOT EXISTS idx_prom_flags_open
    ON prom_triage_flags(patient_id, acknowledged_at);
CREATE INDEX IF NOT EXISTS idx_prom_flags_severity_open
    ON prom_triage_flags(severity, acknowledged_at);
