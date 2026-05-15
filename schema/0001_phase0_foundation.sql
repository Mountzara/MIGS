-- =====================================================================
-- 0001_phase0_foundation.sql — Phase 0 foundation schema
-- =====================================================================
-- Per CLAUDE.md §11 Tier 2 (Data Stores) and §11.6 / §11.7.
-- Apply via:  npx wrangler d1 execute mountzara-clinical --remote --file=schema/0001_phase0_foundation.sql
--
-- Design choices:
--   * All ids are TEXT (UUIDv4) generated client-side in the Pages Function.
--   * Timestamps are INTEGER unix epoch in MILLISECONDS (Date.now() friendly).
--   * Soft-delete is not used; deletions write to audit_log first, then
--     remove the row, with an off-database backup of the row body if needed.
--   * Foreign keys are declared but D1 currently treats them as advisory;
--     ON DELETE behavior is enforced in application code.
--   * JSON sub-documents are stored as TEXT (D1 has no JSONB) — index by
--     extracting fields into separate columns where queryable.
--   * PHI bodies that exceed D1 row size or contain free-text live in
--     R2 (mountzara-phi) and are referenced here by r2_key. The D1 row
--     stores only non-PHI metadata + the R2 pointer.
-- =====================================================================

-- ---------------------------------------------------------------------
-- patients — canonical patient record. The website's patient_id is the
-- single source of truth across every MountZara app per §11.5.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS patients (
    id                    TEXT PRIMARY KEY,                  -- UUIDv4
    email                 TEXT NOT NULL UNIQUE,              -- lowercase, normalized
    phone                 TEXT,                              -- E.164
    first_name            TEXT NOT NULL,
    last_name             TEXT NOT NULL,
    preferred_name        TEXT,
    dob                   TEXT NOT NULL,                     -- ISO YYYY-MM-DD
    mrn                   TEXT UNIQUE,                       -- internal MRN, optional
    pronouns              TEXT,
    preferred_language    TEXT NOT NULL DEFAULT 'en',
    timezone              TEXT NOT NULL DEFAULT 'America/Chicago',
    password_hash         TEXT,                              -- pbkdf2$<iter>$<salt>$<hash>; NULL if magic-link-only
    password_set_at       INTEGER,                           -- ms epoch
    email_verified_at     INTEGER,
    phone_verified_at     INTEGER,
    totp_secret_encrypted TEXT,                              -- envelope-encrypted TOTP seed; NULL if no 2FA
    status                TEXT NOT NULL DEFAULT 'active',    -- 'active' | 'suspended' | 'closed'
    created_at            INTEGER NOT NULL,
    updated_at            INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_patients_email ON patients(email);
CREATE INDEX IF NOT EXISTS idx_patients_mrn ON patients(mrn);
CREATE INDEX IF NOT EXISTS idx_patients_last_first ON patients(last_name, first_name);

-- ---------------------------------------------------------------------
-- clinicians — Dr. Mabini and any future clinicians/staff.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clinicians (
    id              TEXT PRIMARY KEY,
    email           TEXT NOT NULL UNIQUE,
    first_name      TEXT NOT NULL,
    last_name       TEXT NOT NULL,
    credentials     TEXT,                                    -- "DO, MSAEd, AAGL Fellow, MIGS"
    npi             TEXT,
    role            TEXT NOT NULL DEFAULT 'clinician',       -- 'clinician' | 'staff'
    active          INTEGER NOT NULL DEFAULT 1,              -- 0/1
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);

-- ---------------------------------------------------------------------
-- auth_sessions — active session records. Mirrored in KV for fast lookup;
-- D1 row is the durable record + audit anchor.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth_sessions (
    id              TEXT PRIMARY KEY,                        -- opaque random id (256 bits, base64url)
    patient_id      TEXT,                                    -- nullable for non-patient roles
    clinician_id    TEXT,                                    -- nullable for non-clinician roles
    role            TEXT NOT NULL,                           -- 'patient' | 'clinician' | 'staff'
    created_at      INTEGER NOT NULL,
    expires_at      INTEGER NOT NULL,
    last_seen_at    INTEGER NOT NULL,
    ip              TEXT,
    user_agent      TEXT,
    revoked_at      INTEGER,
    revocation_reason TEXT,                                  -- 'logout' | 'admin_revoke' | 'rotate' | 'expire'
    CHECK ((patient_id IS NULL) OR (clinician_id IS NULL))   -- a session is for one entity, not both
);
CREATE INDEX IF NOT EXISTS idx_sessions_patient ON auth_sessions(patient_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_clinician ON auth_sessions(clinician_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_active ON auth_sessions(expires_at) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------
-- magic_link_tokens — single-use signed-link tokens for passwordless flows.
-- Store only the SHA-256 hash of the token, never the token itself.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS magic_link_tokens (
    token_hash      TEXT PRIMARY KEY,                        -- SHA-256(token), base64url
    patient_id      TEXT,
    email           TEXT NOT NULL,                           -- in case patient doesn't exist yet (signup)
    purpose         TEXT NOT NULL,                           -- 'login' | 'signup' | 'password_reset' | 'email_verify'
    issued_at       INTEGER NOT NULL,
    expires_at      INTEGER NOT NULL,
    consumed_at     INTEGER,
    ip              TEXT,
    user_agent      TEXT
);
CREATE INDEX IF NOT EXISTS idx_magic_email_purpose ON magic_link_tokens(email, purpose, expires_at);

-- ---------------------------------------------------------------------
-- intake_responses — top-level intake submission per patient.
-- Per §11.6 Thorek 19-section schema.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS intake_responses (
    id              TEXT PRIMARY KEY,
    patient_id      TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'in_progress',     -- 'in_progress' | 'submitted' | 'reviewed' | 'archived'
    locale          TEXT NOT NULL DEFAULT 'en',
    started_at      INTEGER NOT NULL,
    submitted_at    INTEGER,
    reviewed_at     INTEGER,
    reviewed_by_clinician_id TEXT,
    updated_at      INTEGER NOT NULL,
    completion_pct  INTEGER NOT NULL DEFAULT 0               -- 0..100, last computed value
);
CREATE INDEX IF NOT EXISTS idx_intake_patient ON intake_responses(patient_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_intake_status ON intake_responses(status, submitted_at DESC);

-- ---------------------------------------------------------------------
-- intake_section_data — per-section JSON payload. One row per section
-- per intake. Sections numbered 1..19 per §11.6. data_json holds the
-- entire section's field set.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS intake_section_data (
    id              TEXT PRIMARY KEY,
    intake_id       TEXT NOT NULL,
    section_number  INTEGER NOT NULL,                        -- 1..19
    section_key     TEXT NOT NULL,                           -- 'patient_information' | 'consent' | 'office_use_only' | ...
    data_json       TEXT NOT NULL,                           -- the section payload as JSON string
    last_updated_at INTEGER NOT NULL,
    UNIQUE(intake_id, section_number)
);
CREATE INDEX IF NOT EXISTS idx_intake_section_intake ON intake_section_data(intake_id, section_number);

-- ---------------------------------------------------------------------
-- appointment_triage — §11.7 AI triage decisions for each completed intake.
-- One row per intake submission; populated by /api/v1/intake/<id>/triage.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appointment_triage (
    id                              TEXT PRIMARY KEY,
    intake_id                       TEXT NOT NULL,
    patient_id                      TEXT NOT NULL,
    ai_prompt_version               TEXT NOT NULL,           -- e.g. 'v1.0-2026-05-15'
    ai_visit_type                   TEXT NOT NULL,           -- key from §11.7.1
    ai_duration_min                 INTEGER NOT NULL,
    ai_urgency                      TEXT NOT NULL,           -- 'urgent' | 'routine'
    ai_in_person_required           INTEGER NOT NULL,        -- 0/1
    ai_preferred_time_of_day        TEXT,                    -- 'morning' | 'afternoon' | 'any'
    ai_rationale                    TEXT,                    -- Claude's reasoning, ≤ 500 chars
    ai_secondary_concerns_json      TEXT,                    -- JSON array of ERAS / perioperative flags
    clinician_override_visit_type   TEXT,
    clinician_override_duration_min INTEGER,
    clinician_override_reason       TEXT,
    clinician_reviewed_at           INTEGER,
    clinician_reviewer_id           TEXT,
    final_visit_type                TEXT,
    final_duration_min              INTEGER,
    appointment_id                  TEXT,                    -- FK once booked
    actual_visit_type               TEXT,                    -- documented at end of visit
    actual_duration_min             INTEGER,                 -- actual elapsed minutes
    created_at                      INTEGER NOT NULL,
    updated_at                      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_triage_intake ON appointment_triage(intake_id);
CREATE INDEX IF NOT EXISTS idx_triage_patient ON appointment_triage(patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_triage_pending ON appointment_triage(clinician_reviewed_at) WHERE clinician_reviewed_at IS NULL;

-- ---------------------------------------------------------------------
-- clinician_availability — drag-to-set blocks at 15-min granularity.
-- Per §11.7.3 daily template + day-of-week patterns.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clinician_availability (
    id                          TEXT PRIMARY KEY,
    clinician_id                TEXT NOT NULL,
    date                        TEXT NOT NULL,               -- ISO YYYY-MM-DD
    start_minute_of_day         INTEGER NOT NULL,            -- 0..1439, 15-min aligned
    end_minute_of_day           INTEGER NOT NULL,            -- > start, 15-min aligned
    block_kind                  TEXT NOT NULL,               -- 'open' | 'blocked' | 'admin' | 'lunch' | 'procedure' | 'surgery'
    allowed_visit_types_json    TEXT,                        -- JSON array of visit_type keys; NULL = any
    location                    TEXT,                        -- 'clinic' | 'telehealth_only' | 'procedure_room'
    notes                       TEXT,
    created_at                  INTEGER NOT NULL,
    updated_at                  INTEGER NOT NULL,
    CHECK (start_minute_of_day < end_minute_of_day),
    CHECK (start_minute_of_day % 15 = 0 AND end_minute_of_day % 15 = 0)
);
CREATE INDEX IF NOT EXISTS idx_avail_clinician_date ON clinician_availability(clinician_id, date);
CREATE INDEX IF NOT EXISTS idx_avail_open ON clinician_availability(date, block_kind) WHERE block_kind = 'open';

-- ---------------------------------------------------------------------
-- appointments — scheduled appointments.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appointments (
    id                      TEXT PRIMARY KEY,
    patient_id              TEXT NOT NULL,
    clinician_id            TEXT NOT NULL,
    visit_type              TEXT NOT NULL,                   -- key from §11.7.1
    starts_at               INTEGER NOT NULL,                -- ms epoch
    ends_at                 INTEGER NOT NULL,                -- ms epoch
    duration_min            INTEGER NOT NULL,
    modality                TEXT NOT NULL,                   -- 'in_person' | 'telehealth'
    status                  TEXT NOT NULL DEFAULT 'scheduled', -- 'scheduled' | 'completed' | 'no_show' | 'cancelled' | 'rescheduled'
    cancellation_reason     TEXT,
    chief_complaint_summary TEXT,                            -- denormalized for fast display
    doxy_room_url           TEXT,                            -- only set for telehealth
    doxy_join_logged_at     INTEGER,                         -- when patient clicked Join, per /api/v1/visit/<id>/join
    triage_id               TEXT,                            -- FK to appointment_triage
    google_calendar_event_id TEXT,                           -- synced to clinician's GCal
    created_at              INTEGER NOT NULL,
    updated_at              INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_appts_patient ON appointments(patient_id, starts_at DESC);
CREATE INDEX IF NOT EXISTS idx_appts_clinician_date ON appointments(clinician_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_appts_status_starts ON appointments(status, starts_at);

-- ---------------------------------------------------------------------
-- encounters — clinical visit records. Note body lives in R2 (mountzara-phi).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS encounters (
    id                  TEXT PRIMARY KEY,
    patient_id          TEXT NOT NULL,
    clinician_id        TEXT NOT NULL,
    appointment_id      TEXT,
    visit_date          TEXT NOT NULL,                       -- ISO YYYY-MM-DD
    visit_type_actual   TEXT,                                -- clinician-documented type post-visit
    chief_complaint     TEXT,
    note_r2_key         TEXT,                                -- key into mountzara-phi for encrypted SOAP note
    note_pdf_r2_key     TEXT,                                -- optional signed PDF in mountzara-phi
    note_source         TEXT,                                -- 'transcription_app' | 'manual' | 'imported'
    transcription_session_id TEXT,                           -- FK back to MountZaraMedicalTranscription session
    omt_codes_json      TEXT,                                -- e.g. ["98926","M99.03"]
    cpt_codes_json      TEXT,
    icd10_codes_json    TEXT,
    created_at          INTEGER NOT NULL,
    updated_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_enc_patient_date ON encounters(patient_id, visit_date DESC);
CREATE INDEX IF NOT EXISTS idx_enc_clinician_date ON encounters(clinician_id, visit_date DESC);

-- ---------------------------------------------------------------------
-- messages — secure threads (Phase 3). Body envelope-encrypted in R2.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
    id              TEXT PRIMARY KEY,
    thread_id       TEXT NOT NULL,
    patient_id      TEXT NOT NULL,
    from_role       TEXT NOT NULL,                           -- 'patient' | 'clinician' | 'staff'
    from_user_id    TEXT NOT NULL,
    body_r2_key     TEXT NOT NULL,                           -- encrypted body in mountzara-phi
    subject         TEXT,
    has_attachments INTEGER NOT NULL DEFAULT 0,              -- 0/1
    created_at      INTEGER NOT NULL,
    read_at         INTEGER,                                 -- when recipient first viewed it
    deleted_at      INTEGER                                  -- soft-delete for thread cleanup (audit_log still has it)
);
CREATE INDEX IF NOT EXISTS idx_msg_thread ON messages(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_msg_patient ON messages(patient_id, created_at DESC);

-- ---------------------------------------------------------------------
-- documents — patient uploads + clinician-generated docs.
-- R2 key always lives in mountzara-phi for PHI; non-PHI may live elsewhere.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS documents (
    id                  TEXT PRIMARY KEY,
    patient_id          TEXT NOT NULL,
    kind                TEXT NOT NULL,                       -- 'patient_upload' | 'intake_attachment' | 'encounter_note' | 'imaging' | 'op_note' | 'aagl_report' | 'clinical_ai_analysis' | 'surgical_workflow_doc'
    r2_key              TEXT NOT NULL,
    r2_bucket           TEXT NOT NULL DEFAULT 'mountzara-phi',
    filename            TEXT NOT NULL,
    mime_type           TEXT,
    size_bytes          INTEGER,
    sha256              TEXT,                                -- content hash for dedup + integrity
    encrypted           INTEGER NOT NULL DEFAULT 1,          -- 0/1 — virtually always 1 for PHI bucket
    envelope_dek_wrapped TEXT,                               -- wrapped DEK (base64) when encrypted=1
    uploaded_by_role    TEXT NOT NULL,                       -- 'patient' | 'clinician' | 'staff' | 'app'
    uploaded_by_id      TEXT NOT NULL,
    source_app          TEXT,                                -- 'transcription' | 'clinical_ai' | 'surgical_workflow' | 'ios' | 'web'
    description         TEXT,
    uploaded_at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_docs_patient_kind ON documents(patient_id, kind, uploaded_at DESC);

-- ---------------------------------------------------------------------
-- audit_log — append-only audit trail. Required for HIPAA §164.312(b).
-- Six-year retention per §11 Tier 7. Never delete rows; archive only.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
    id              TEXT PRIMARY KEY,
    ts              INTEGER NOT NULL,                        -- ms epoch
    user_id         TEXT,                                    -- patient_id, clinician_id, or NULL for anon
    user_role       TEXT NOT NULL,                           -- 'patient' | 'clinician' | 'staff' | 'anonymous' | 'app'
    action          TEXT NOT NULL,                           -- 'login_success' | 'login_fail' | 'phi_read' | 'phi_write' | 'phi_delete' | 'intake_submit' | 'appointment_book' | 'appointment_cancel' | 'doxy_join' | 'message_send' | 'document_upload' | 'document_download' | 'role_grant' | 'admin_override' | 'data_export' | ...
    record_type     TEXT,                                    -- 'patient' | 'intake' | 'appointment' | 'encounter' | 'document' | 'message' | 'session' | 'triage'
    record_id       TEXT,
    ip              TEXT,
    user_agent      TEXT,
    success         INTEGER NOT NULL,                        -- 0/1
    details_json    TEXT                                     -- additional context; PHI redacted at call site
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_record ON audit_log(record_type, record_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action, ts DESC);

-- ---------------------------------------------------------------------
-- billing_invoices — Phase 6 stub. Schema added now so future migrations
-- are additive and we never have to ALTER once live billing data exists.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing_invoices (
    id                  TEXT PRIMARY KEY,
    patient_id          TEXT NOT NULL,
    encounter_id        TEXT,
    appointment_id      TEXT,
    amount_cents        INTEGER NOT NULL,
    currency            TEXT NOT NULL DEFAULT 'USD',
    status              TEXT NOT NULL DEFAULT 'draft',       -- 'draft' | 'sent' | 'paid' | 'overdue' | 'void' | 'refunded'
    stripe_invoice_id   TEXT,
    stripe_charge_id    TEXT,
    line_items_json     TEXT,                                -- JSON array of {cpt, description, qty, unit_cents}
    description         TEXT,
    issued_at           INTEGER,
    paid_at             INTEGER,
    created_at          INTEGER NOT NULL,
    updated_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invoice_patient ON billing_invoices(patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoice_status ON billing_invoices(status, issued_at);

-- ---------------------------------------------------------------------
-- app_sync_tokens — Phase 4 per-app push tokens for the MountZara desktop
-- and iOS apps. Apps cannot create patients — only resolve them, then push
-- encounter / note / case data referencing patient_id.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_sync_tokens (
    id              TEXT PRIMARY KEY,
    app_name        TEXT NOT NULL UNIQUE,                    -- 'transcription' | 'clinical_ai' | 'surgical_workflow' | 'ios' | 'research_digest'
    token_hash      TEXT NOT NULL,                           -- SHA-256 of the raw token; raw token never stored
    issued_at       INTEGER NOT NULL,
    last_used_at    INTEGER,
    last_used_ip    TEXT,
    expires_at      INTEGER,                                 -- NULL = no expiry; rotate annually per CLAUDE.md §11.5
    revoked_at      INTEGER
);

-- ---------------------------------------------------------------------
-- baa_ledger — vendor BAA tracking. Source of truth lives in
-- docs/compliance/BAA-ledger.md but this table backs /admin/compliance.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS baa_ledger (
    id              TEXT PRIMARY KEY,
    vendor          TEXT NOT NULL UNIQUE,                    -- 'Cloudflare' | 'Stripe' | 'Twilio' | 'Doxy.me' | ...
    status          TEXT NOT NULL,                           -- 'signed' | 'pending' | 'na' | 'expired'
    signed_at       INTEGER,
    expires_at      INTEGER,
    contract_url    TEXT,                                    -- pointer to PDF in mountzara-content/legal/
    notes           TEXT,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);

-- ---------------------------------------------------------------------
-- Seed: register Cloudflare BAA as signed (per §11.4 confirmed by user 2026-05-15).
-- Other vendors enter as 'pending' or 'na' when they come online.
-- ---------------------------------------------------------------------
INSERT OR IGNORE INTO baa_ledger (id, vendor, status, signed_at, contract_url, notes, created_at, updated_at)
VALUES (
    'baa-cloudflare',
    'Cloudflare',
    'signed',
    1747267200000,
    NULL,
    'Cloudflare BAA confirmed signed by user 2026-05-15 (CLAUDE.md §11.4). Covers Pages, Workers, Functions, D1, R2, KV, Queues, Access.',
    1747267200000,
    1747267200000
);

-- =====================================================================
-- End of 0001_phase0_foundation.sql
-- =====================================================================
