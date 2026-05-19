-- ====================================================================
-- 0013_phase_qa_session_trace.sql
-- Phase QA — real-time session tracing for the test-user pathway
-- (Ally O'Flinn) and the comprehensive audit pass.
--
-- Per CLAUDE.md §4.4 (Mandatory Debug Logging) and §4.4.4 (PHI safety):
--   * Captures every portal-facing request at finer granularity than
--     audit_log (which is constrained to a fixed action allowlist).
--   * NO PHI in detail_json — events log size_bytes, step_number,
--     content_type, error_class, NOT names/DOBs/free text.
--   * ip is stored hashed (SHA256(ip + IP_HASH_SALT)) so a session can
--     be correlated across requests without retaining the raw IP.
--   * 30-day retention is enforced by a future cron sweep; for now we
--     leave rows in place (debugging takes precedence).
--
-- Per §11.5.2 preview gate — the same migration also adds the
-- preview_invites table so the operator can mint signed pre-launch
-- invitations for external test users without flipping
-- PORTAL_PUBLIC_LAUNCH globally.
-- ====================================================================

CREATE TABLE IF NOT EXISTS session_trace (
    id              TEXT PRIMARY KEY,
    ts              INTEGER NOT NULL,        -- ms epoch when the event was recorded
    session_id      TEXT,                    -- SHA256 hash of mz_session token (never the raw token)
    patient_id      TEXT,                    -- when known
    invite_label    TEXT,                    -- "ally", "jane", "anon", "admin_preview"
    route           TEXT NOT NULL,           -- e.g. "/portal/intake/section/4"
    http_method     TEXT NOT NULL,           -- GET / POST / PATCH / DELETE / PUT
    http_status     INTEGER,                 -- response status when known at log time
    action          TEXT NOT NULL,           -- "page_view" | "auth_login" | "intake_section_save" | ...
    outcome         TEXT,                    -- "ok" | "error" | "blocked" | "redirect" | "validation_fail"
    duration_ms     INTEGER,                 -- handler duration if measured
    detail_json     TEXT,                    -- JSON; PHI-free (size_bytes, step_number, content_type, error_class)
    ip_hash         TEXT,                    -- SHA256(ip + salt); never the raw IP
    user_agent      TEXT,                    -- truncated to 200 chars
    created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_trace_ts ON session_trace(ts DESC);
CREATE INDEX IF NOT EXISTS idx_session_trace_patient ON session_trace(patient_id);
CREATE INDEX IF NOT EXISTS idx_session_trace_invite ON session_trace(invite_label);
CREATE INDEX IF NOT EXISTS idx_session_trace_session ON session_trace(session_id);
CREATE INDEX IF NOT EXISTS idx_session_trace_outcome ON session_trace(outcome);


CREATE TABLE IF NOT EXISTS preview_invites (
    id              TEXT PRIMARY KEY,
    email           TEXT NOT NULL,            -- normalized lowercase
    label           TEXT,                     -- short tag (e.g., "ally") used to filter session_trace
    full_name       TEXT,                     -- "Ally O'Flinn" — for the invitation page greeting
    token_hash      TEXT NOT NULL UNIQUE,     -- SHA256 of the one-time grant token (the URL ?t= param)
    grant_used_at   INTEGER,                  -- when the recipient clicked the invitation URL
    expires_at      INTEGER NOT NULL,         -- token expiry (default 14 days from issuance)
    cookie_jti      TEXT,                     -- JWT-id of the preview-access cookie minted on grant
    cookie_exp      INTEGER,                  -- cookie expiry (default 90 days from grant)
    patient_id      TEXT,                     -- set after the recipient completes signup
    revoked_at      INTEGER,                  -- non-null = manually revoked
    revoke_reason   TEXT,
    issued_by       TEXT,                     -- admin user id / username
    notes           TEXT,                     -- operator free text
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_preview_invites_email ON preview_invites(email);
CREATE INDEX IF NOT EXISTS idx_preview_invites_label ON preview_invites(label);
CREATE INDEX IF NOT EXISTS idx_preview_invites_patient ON preview_invites(patient_id);
CREATE INDEX IF NOT EXISTS idx_preview_invites_expires ON preview_invites(expires_at);
