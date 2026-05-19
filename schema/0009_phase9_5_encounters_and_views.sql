-- ============================================================================
-- Phase 9.5 — Encounter event log + clinician-side view tracking
-- ============================================================================
-- Two complementary tables that close the loop between "data was collected"
-- and "physician saw the meaningful change":
--
--   encounter_events       — chronological log of every patient-touching event
--                            (message reply, symptom threshold hit, PROM flag
--                            fired, appointment booked/completed, intake
--                            submitted, transcription note signed, …).
--   snapshot_view_history  — last-viewed cursor per (clinician_id, patient_id).
--                            Powers the "what's new since you last looked"
--                            diff panel on /admin/cases/<id>/.
--
-- The encounter_events log is the single source of truth for the
-- /admin/cases/:id/whats-new endpoint. Each insert is also paired with a
-- write to patient_dirty_flag so the Transcription app picks up the change
-- on its next sync cycle and queues an AI snapshot regen.
--
-- Idempotent. Re-running is safe.
-- ============================================================================

-- 1. Chronological encounter event log
CREATE TABLE IF NOT EXISTS encounter_events (
    id              TEXT PRIMARY KEY,
    patient_id      TEXT NOT NULL,
    event_type      TEXT NOT NULL,             -- 'message_reply' | 'symptom_threshold' | 'prom_flag' | 'appointment_booked' | 'appointment_completed' | 'intake_submitted' | 'transcription_note_signed' | 'clinical_ai_case' | 'surgical_workflow_case' | 'document_uploaded'
    event_summary   TEXT NOT NULL,             -- 1-line human-readable: "Pain 9/10 sustained 3 days + flooding bleeding"
    severity        TEXT NOT NULL DEFAULT 'info', -- 'info' | 'warning' | 'urgent'
    ref_kind        TEXT,                      -- 'message' | 'symptom_diary_entry' | 'prom_response' | 'appointment' | 'intake' | 'transcription_note' | etc.
    ref_id          TEXT,                      -- FK-like reference; not enforced (cross-table)
    details_json    TEXT,                      -- arbitrary structured detail
    occurred_at     TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_enc_events_patient_time
    ON encounter_events(patient_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_enc_events_severity_time
    ON encounter_events(severity, occurred_at DESC);

-- 2. Per-clinician per-patient last-viewed cursor (for the diff panel)
CREATE TABLE IF NOT EXISTS snapshot_view_history (
    clinician_id              TEXT NOT NULL,
    patient_id                TEXT NOT NULL,
    last_viewed_at            TEXT NOT NULL DEFAULT (datetime('now')),
    last_viewed_snapshot_id   TEXT,            -- pin so "what's new" can also include snapshot version diffs
    PRIMARY KEY (clinician_id, patient_id),
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_view_history_patient
    ON snapshot_view_history(patient_id);

-- 3. Clinician subscription rules — threshold-based alerts shown on the admin dashboard
CREATE TABLE IF NOT EXISTS clinician_subscriptions (
    id              TEXT PRIMARY KEY,
    clinician_id    TEXT NOT NULL,
    scope_kind      TEXT NOT NULL DEFAULT 'all',   -- 'all' | 'patient_panel' | 'single_patient'
    scope_ref_id    TEXT,                          -- patient_id when scope_kind='single_patient'
    rules_json      TEXT NOT NULL,                 -- JSON: { event_types:[], min_severity:'warning', prom_slugs:[], … }
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_clin_subs_active
    ON clinician_subscriptions(clinician_id, is_active);
