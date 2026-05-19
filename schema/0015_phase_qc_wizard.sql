-- ====================================================================
-- 0015_phase_qc_wizard.sql
-- Phase QC — onboarding wizard state + per-patient preferences
-- ====================================================================
-- Per the 2026-05-19 user directive: "a wizard completion tool that
-- will guide the user in modal popups integration of next steps to
-- take to complete the user profile from beginning to end... ability
-- to turn wizard on or off at anytime".
--
-- Stores per-patient progress through the onboarding checklist + the
-- on/off toggle + per-step dismissal/remind-later state. The wizard
-- itself is a portal-wide widget (portal/_wizard.js) that consults
-- /api/v1/patient/wizard/state to decide which step to show next.
-- ====================================================================

CREATE TABLE IF NOT EXISTS wizard_state (
    patient_id          TEXT PRIMARY KEY,

    -- Master on/off toggle. When 'off' the wizard never auto-pops; the
    -- patient can still re-enable via /portal/profile/.
    enabled             INTEGER NOT NULL DEFAULT 1,         -- 1=on, 0=off

    -- Per-step JSON state: { step_key: { completed: bool, completed_at: ms,
    --                                    skipped: bool, snoozed_until: ms } }
    -- Step keys (canonical list — additions are backward-compatible):
    --   profile_basics     — email confirmed, phone present, pronouns/language set
    --   photo_and_nickname — Phase 14 humanization fields
    --   care_goals         — Section 4-derived goals + manual additions
    --   intake             — intake_responses row submitted (all 19 sections)
    --   appointment        — at least one scheduled appointment (any type)
    --   education_ack      — ack'd at least one assigned education topic
    --   symptom_diary      — at least one diary entry
    progress_json       TEXT,

    -- Timestamps
    started_at          INTEGER,                            -- first wizard open
    last_opened_at      INTEGER,
    completed_at        INTEGER,                            -- when ALL steps done
    disabled_at         INTEGER,                            -- last time enabled flipped to 0

    -- For "remind me later" — global next-prompt time
    snooze_until        INTEGER,

    created_at          INTEGER NOT NULL,
    updated_at          INTEGER NOT NULL,
    FOREIGN KEY (patient_id) REFERENCES patients(id)
);

CREATE INDEX IF NOT EXISTS idx_wizard_state_enabled ON wizard_state(enabled);
CREATE INDEX IF NOT EXISTS idx_wizard_state_completed ON wizard_state(completed_at);
