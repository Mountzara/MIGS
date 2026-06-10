-- ====================================================================
-- 0023_phase18_nps.sql
-- Phase 18 — Sprint 2 R9: NPS post-visit survey (2 questions)
-- ====================================================================
-- Joshi & Welch (2023) — NPS is the single most actionable rolling
-- patient-experience metric. Flow: the daily mountzara-cron trigger
-- (11:00 UTC ≈ 6:00am CT) POSTs to /api/v1/internal/nps/dispatch
-- (X-Pipeline-Token), which finds yesterday's completed appointments,
-- mints a one-time token per appointment (30-day per-patient cooldown),
-- writes nps_dispatches, and delivers the survey link via secure
-- messaging. The patient lands on /portal/nps/<token>/ and submits
-- {score 0-10, why?} to /api/v1/patient/nps/respond — idempotent
-- (re-submission overwrites the same row), token expires 14 days after
-- dispatch. Rolling 30/90/365-day scores surface in /admin/analytics/.
-- NPS = (% promoters [9-10]) − (% detractors [0-6]).
--
-- NOTE: appointments.id / patients.id are TEXT in this schema (the docx
-- spec sketched INTEGER — corrected here). Idempotent (CREATE IF NOT
-- EXISTS) so re-runs are safe.
-- ====================================================================
CREATE TABLE IF NOT EXISTS nps_dispatches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id TEXT NOT NULL,
    appointment_id TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    dispatched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    responded_at TEXT,
    FOREIGN KEY (patient_id) REFERENCES patients(id),
    FOREIGN KEY (appointment_id) REFERENCES appointments(id)
);
CREATE INDEX IF NOT EXISTS idx_nps_dispatch_token ON nps_dispatches(token);
CREATE INDEX IF NOT EXISTS idx_nps_dispatch_patient ON nps_dispatches(patient_id, dispatched_at DESC);
CREATE INDEX IF NOT EXISTS idx_nps_dispatch_appt ON nps_dispatches(appointment_id);

CREATE TABLE IF NOT EXISTS nps_responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id TEXT NOT NULL,
    appointment_id TEXT NOT NULL,
    score INTEGER NOT NULL CHECK (score >= 0 AND score <= 10),
    why TEXT,
    responded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    response_token TEXT UNIQUE,
    FOREIGN KEY (patient_id) REFERENCES patients(id),
    FOREIGN KEY (appointment_id) REFERENCES appointments(id)
);
CREATE INDEX IF NOT EXISTS idx_nps_responded_at ON nps_responses(responded_at);
