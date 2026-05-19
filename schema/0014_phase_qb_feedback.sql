-- ====================================================================
-- 0014_phase_qb_feedback.sql
-- Phase QB — beta-tester feedback capture + AI rec pipeline
-- ====================================================================
-- Per CLAUDE.md §11.5.1 expanded portal scope + the 2026-05-19 user
-- directive: every portal page exposes a convenient feedback affordance;
-- submissions land here; Claude (during Cowork sessions) reads the queue
-- and writes structured recommendations; the operator reviews + approves
-- on /admin/feedback/.
--
-- Privacy posture:
--   * patient_id nullable — feedback can be submitted before a patient
--     completes signup (only the preview-cookie label is captured).
--   * detail_json + ai_recommendation_json are JSON columns that store
--     PHI-conservative structured fields. NEVER store form values
--     (intake answers, names, DOBs) in those columns. The feedback
--     `comment` field is patient-volunteered free text; it goes in
--     `comment_text` and is kept verbatim because the user explicitly
--     intended to communicate it.
--   * screenshot_r2_key points into mountzara-phi (envelope-encrypted
--     at rest) so even if a patient screenshots an intake page, the
--     image is sealed behind the same encryption that protects every
--     other PHI blob.
-- ====================================================================

CREATE TABLE IF NOT EXISTS member_feedback (
    id                  TEXT PRIMARY KEY,
    patient_id          TEXT,                 -- nullable: pre-signup feedback OK
    invite_label        TEXT,                 -- 'ally' / 'admin_preview' / 'anon'
    session_id          TEXT,                 -- SHA256-hashed mz_session (links to session_trace)
    route               TEXT NOT NULL,        -- e.g. '/portal/intake/section/4'
    viewport_width      INTEGER,
    viewport_height     INTEGER,
    user_agent          TEXT,                 -- truncated to 240 chars
    feedback_type       TEXT NOT NULL,        -- bug|confusing|suggestion|praise|other
    severity            TEXT,                 -- blocker|annoying|nice_to_have (nullable for praise)
    comment_text        TEXT NOT NULL,        -- patient-volunteered, capped 4 KB
    detail_json         TEXT,                 -- {last_action, recent_traces[], scroll_pct, ...}
    screenshot_r2_key   TEXT,                 -- nullable; mountzara-phi key when screenshot uploaded
    screenshot_wrapped_dek TEXT,              -- envelope-encryption DEK if screenshot present

    status              TEXT NOT NULL,        -- new|ai_analyzed|approved|rejected|implemented|wont_fix
    status_reason       TEXT,                 -- operator note when rejected / wont_fix
    ai_recommendation_json TEXT,              -- {summary, root_cause, proposed_change, files_to_edit[],
                                              --  severity, effort, rationale, confidence, ai_model, generated_at}
    ai_generated_at     INTEGER,              -- ms epoch when AI rec was written
    approved_at         INTEGER,
    approved_by         TEXT,                 -- admin user
    implemented_at      INTEGER,
    implemented_in_commit TEXT,               -- git SHA when implementation lands

    created_at          INTEGER NOT NULL,
    updated_at          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_member_feedback_status ON member_feedback(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_member_feedback_patient ON member_feedback(patient_id);
CREATE INDEX IF NOT EXISTS idx_member_feedback_invite ON member_feedback(invite_label);
CREATE INDEX IF NOT EXISTS idx_member_feedback_route ON member_feedback(route);
CREATE INDEX IF NOT EXISTS idx_member_feedback_type ON member_feedback(feedback_type);


-- ====================================================================
-- feedback_audit_events — append-only log of every state transition
-- ====================================================================
-- Separate from session_trace (which logs every request) and audit_log
-- (HIPAA action log). This is the operator-facing changelog the admin
-- UI renders as a timeline per feedback item.
-- ====================================================================
CREATE TABLE IF NOT EXISTS feedback_audit_events (
    id              TEXT PRIMARY KEY,
    feedback_id     TEXT NOT NULL,
    ts              INTEGER NOT NULL,
    actor           TEXT NOT NULL,            -- 'patient' | 'cowork_ai' | 'admin' | 'system'
    actor_label     TEXT,                     -- 'ally' / admin username / model name
    event_kind      TEXT NOT NULL,            -- submitted|ai_analyzed|approved|rejected|implemented
    detail_json     TEXT,
    FOREIGN KEY (feedback_id) REFERENCES member_feedback(id)
);

CREATE INDEX IF NOT EXISTS idx_feedback_audit_fb ON feedback_audit_events(feedback_id, ts);
