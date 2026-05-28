-- ====================================================================
-- 0018_phase17_telehealth_safety.sql
-- Phase 17 — Telehealth Compliance Foundation (Sprint 1 of audit roadmap)
-- ====================================================================
-- Per CLAUDE.md §11.7 + the Mount Zara Telehealth Implementation
-- Specifications (Joshi & Welch 2023 framework). This migration adds
-- the data tables backing recommendations R1, R4, and R5 of the audit:
--
--   R1 — GU-exam chaperone flag enforcement on appointments
--   R4 — Pre-visit privacy attestation interstitial
--   R5 — Patient device + connection test page
--
-- All three new tables and columns are PHI-adjacent. Per §10.2 / §10.3
-- they follow the established envelope-encryption posture where
-- applicable; the columns here are operational state (flags + timestamps
-- + hashed network metadata) rather than encrypted blobs, so they live
-- in D1 in plaintext.
--
-- Migration is idempotent — every CREATE uses IF NOT EXISTS, every
-- ALTER is guarded by the SQLite "schema_migrations" registry that the
-- deploy script honors.
-- ====================================================================

-- --------------------------------------------------------------------
-- R1: Chaperone enforcement on the appointments table
-- --------------------------------------------------------------------
-- The visit-type catalog at functions/_lib/visit_types.js carries the
-- per-type requires_chaperone flag. When an appointment is booked,
-- we record:
--   chaperone_required        — copied from the visit type at book time
--                               (defensive: visit-type catalog can change
--                               but the booking's posture is frozen).
--   chaperone_confirmed_at    — timestamp of patient confirmation that
--                               an adult chaperone will be present.
--                               NULL until the patient confirms.
--   chaperone_confirmation_method — who the chaperone will be.
-- --------------------------------------------------------------------
ALTER TABLE appointments ADD COLUMN chaperone_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE appointments ADD COLUMN chaperone_confirmed_at TEXT;
ALTER TABLE appointments ADD COLUMN chaperone_confirmation_method TEXT;

-- --------------------------------------------------------------------
-- R4: Pre-visit privacy attestation interstitial state
-- --------------------------------------------------------------------
-- Joshi & Welch 2023 p. 135 — "Have patients confirm that they're alone
-- and in a satisfactory, comfortable, and private location."
-- The launch interstitial at /portal/visit/[id]/launch records:
--   privacy_confirmed         — patient affirmed privacy is satisfactory.
--   alone_confirmed           — patient affirmed alone (or chaperone).
--   device_check_passed       — snapshot of the most recent tech-check
--                               result at launch time (carried over so
--                               the audit log captures the attested state).
--   id_verified               — for first-visit appointments only.
--   ip_hash / user_agent      — for security-trace and abuse detection.
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS visit_launch_attestations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    appointment_id TEXT NOT NULL,
    patient_id TEXT NOT NULL,
    privacy_confirmed INTEGER NOT NULL DEFAULT 0,
    alone_confirmed INTEGER NOT NULL DEFAULT 0,
    device_check_passed INTEGER,
    id_verified INTEGER,
    attested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ip_hash TEXT,
    user_agent TEXT,
    FOREIGN KEY (appointment_id) REFERENCES appointments(id),
    FOREIGN KEY (patient_id) REFERENCES patients(id)
);
CREATE INDEX IF NOT EXISTS idx_visit_attestations_appt
    ON visit_launch_attestations(appointment_id);
CREATE INDEX IF NOT EXISTS idx_visit_attestations_patient
    ON visit_launch_attestations(patient_id);

-- --------------------------------------------------------------------
-- R5: Patient device + connection test results
-- --------------------------------------------------------------------
-- Joshi & Welch 2023 p. 79 — "Most issues actually tend to occur on the
-- patient side, especially if they're an older patient. 30 percent of
-- adults often or sometimes experience problems connecting to the
-- internet at home."
-- The /portal/tech-check/ page records:
--   browser / os              — UA-derived (not cryptographically
--                               authoritative; for triage only).
--   camera_ok / microphone_ok / speaker_ok — boolean results.
--   network_kbps              — measured downlink throughput in kbps.
--   network_ok                — passes if >= 600 kbps (Doxy.me floor).
--   overall_ok                — true iff all four components pass.
--   failure_reasons_json      — array of {component, reason} entries
--                               for the failing checks.
-- One row per check; the most recent row per appointment / patient is
-- surfaced in the admin appointment view.
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tech_check_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id TEXT NOT NULL,
    appointment_id TEXT,
    browser TEXT,
    os TEXT,
    camera_ok INTEGER NOT NULL DEFAULT 0,
    microphone_ok INTEGER NOT NULL DEFAULT 0,
    speaker_ok INTEGER NOT NULL DEFAULT 0,
    network_kbps INTEGER,
    network_ok INTEGER NOT NULL DEFAULT 0,
    overall_ok INTEGER NOT NULL DEFAULT 0,
    failure_reasons_json TEXT,
    checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id),
    FOREIGN KEY (appointment_id) REFERENCES appointments(id)
);
CREATE INDEX IF NOT EXISTS idx_tech_check_patient
    ON tech_check_results(patient_id);
CREATE INDEX IF NOT EXISTS idx_tech_check_appointment
    ON tech_check_results(appointment_id);
CREATE INDEX IF NOT EXISTS idx_tech_check_checked_at
    ON tech_check_results(checked_at DESC);

-- --------------------------------------------------------------------
-- R3: Licensure blocks audit table
-- --------------------------------------------------------------------
-- The functions/_lib/licensure.js module records every intake submission
-- attempt that gets blocked because the patient's state is not in the
-- active licensed-states list. The records inform IMLC strategic
-- decisions (see docs/compliance/licensure.md §2): the practice can
-- see which states are producing intake demand the practice cannot
-- currently serve.
-- Privacy: this table carries patient_id + state + reason; the state
-- is non-PHI (geographic only), the patient_id is the same opaque
-- identifier used throughout the platform. Not encrypted; D1 plaintext.
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS licensure_blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id TEXT NOT NULL,
    state TEXT NOT NULL,
    reason TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id)
);
CREATE INDEX IF NOT EXISTS idx_licensure_blocks_patient
    ON licensure_blocks(patient_id);
CREATE INDEX IF NOT EXISTS idx_licensure_blocks_state
    ON licensure_blocks(state);
CREATE INDEX IF NOT EXISTS idx_licensure_blocks_created
    ON licensure_blocks(created_at DESC);
