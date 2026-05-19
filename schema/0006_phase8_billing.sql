-- =====================================================================
-- 0006_phase8_billing.sql — third-party insurance billing pipeline
-- =====================================================================
-- This is NOT patient-pay (Stripe) billing — that's Phase 6. This is
-- third-party claim billing through commercial / Medicare / Medicaid
-- payers via the 837P / 835 EDI standards.
--
-- Data flow when fully wired:
--
--   MountZaraMedicalTranscription app analyzes encounter
--   → produces CodingAnalysis (E/M code, ICD-10s, CPTs, modifiers,
--     wRVU, compliance flags, upcoding opportunities, medico-legal score,
--     1995/1997 CMS documentation audit)
--   → POSTs to /api/v1/sync/transcription/coding (auth: TRANSCRIPTION_SYNC_TOKEN)
--
--   Website
--   → inserts billing_claims row (status = pending_review)
--     + N billing_claim_lines (one per CPT)
--     + M billing_claim_diagnoses (one per ICD-10)
--     + every compliance flag, upcoding opportunity, doc suggestion
--   → clinician reviews on /admin/billing/, can edit / approve / reject
--   → on approve: status flips to ready_to_submit
--   → (future Round D) EDI 837P generator picks ready_to_submit claims
--     and POSTs to clearinghouse (Change Healthcare / Waystar / Availity /
--     Office Ally — vendor TBD, depends on insurance contracts)
--   → (future Round F) clearinghouse posts back 277CA (acknowledgment)
--     and 835 (remittance advice) — updates billing_claims.status to
--     submitted / accepted / paid / denied / appealed
--
-- Idempotent. Re-running is safe.
-- =====================================================================

-- ---------------------------------------------------------------------
-- billing_payers — insurance / payer contracts.
-- One row per payer the practice has a contract with. Seeded as needed
-- by the operator from /admin/billing/payers (Round B).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing_payers (
    id                      TEXT PRIMARY KEY,             -- UUIDv4
    payer_id                TEXT,                          -- payer ID used by clearinghouse (e.g., '00514' for BCBS-IL)
    payer_name              TEXT NOT NULL,                 -- 'Blue Cross Blue Shield of Illinois'
    payer_kind              TEXT NOT NULL,                 -- 'commercial' | 'medicare' | 'medicaid' | 'workers_comp' | 'self_pay'
    contract_status         TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'signed' | 'active' | 'terminated'
    contract_effective_date TEXT,                          -- ISO YYYY-MM-DD
    contract_termination_date TEXT,
    rate_schedule_json      TEXT,                          -- JSON: { "99213": 75.00, "58662": 1825.50, ... } — practice-specific rates
    fee_schedule_pct_medicare REAL,                        -- if contract pays % of Medicare allowable (e.g., 1.30 = 130%)
    submission_address      TEXT,                          -- claims-submission electronic or paper address
    appeals_address         TEXT,
    clearinghouse_vendor    TEXT,                          -- 'change_healthcare' | 'waystar' | 'availity' | 'office_ally' | 'direct'
    notes                   TEXT,
    created_at              INTEGER NOT NULL,
    updated_at              INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payers_kind   ON billing_payers(payer_kind);
CREATE INDEX IF NOT EXISTS idx_payers_status ON billing_payers(contract_status);

-- ---------------------------------------------------------------------
-- billing_claims — one row per encounter / claim instance.
-- Idempotent on (patient_id, encounter_id, source_session_id). One claim
-- per transcription session — re-running the AI analysis on the same
-- encounter REPLACES the prior claim if it's still pending_review;
-- otherwise it creates a new claim version.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing_claims (
    id                          TEXT PRIMARY KEY,
    patient_id                  TEXT NOT NULL,
    encounter_id                TEXT,                      -- FK to encounters.id when synced
    appointment_id              TEXT,                      -- FK to appointments.id
    payer_id                    TEXT,                      -- FK to billing_payers.id (NULL if payer unknown yet)
    source_app                  TEXT NOT NULL,             -- 'transcription' | 'clinical_ai' | 'surgical_workflow' | 'manual'
    source_session_id           TEXT,                      -- transcription_session_id or equivalent
    visit_date                  TEXT NOT NULL,             -- ISO YYYY-MM-DD
    visit_type                  TEXT,                      -- 'new_patient_complex' | 'omt_treatment' | etc. (matches §11.7.1)

    -- E/M coding (denormalized for fast querying; also exists as a line below)
    em_code                     TEXT,                      -- '99214', '99205', etc.
    em_mdm_level                TEXT,                      -- 'straightforward' | 'low' | 'moderate' | 'high'
    em_wrvu                     REAL,
    em_confidence               REAL,

    -- Totals (computed from claim lines, denormalized for fast list rendering)
    total_wrvu                  REAL NOT NULL DEFAULT 0,
    total_charge_cents          INTEGER NOT NULL DEFAULT 0,   -- billed amount in cents
    expected_collection_cents   INTEGER NOT NULL DEFAULT 0,   -- expected from payer based on rate schedule

    -- Compliance / quality scores from the analysis
    compliance_status           TEXT,                      -- 'compliant' | 'warnings' | 'errors' (from CodingAnalysis)
    medico_legal_score          INTEGER,                   -- 0..100 from CodingAnalysis.medicoLegalAssessment
    em_documentation_audit_json TEXT,                      -- full 1995/1997 CMS audit object

    -- AI metadata
    ai_model                    TEXT,                      -- 'claude-opus-4-6' etc.
    ai_prompt_version           TEXT,
    ai_compliance_metrics_json  TEXT,                      -- field-completeness check from CodingService

    -- Status machine
    status                      TEXT NOT NULL DEFAULT 'pending_review',
                                                            -- 'pending_review' | 'edited' | 'rejected'
                                                            -- | 'ready_to_submit' | 'submitting'
                                                            -- | 'submitted' | 'accepted_by_clearinghouse'
                                                            -- | 'paid' | 'partially_paid'
                                                            -- | 'denied' | 'appealed' | 'rebilled'
                                                            -- | 'written_off'
    status_reason               TEXT,                      -- last reason / denial code / appeal note

    clinician_reviewed_at       INTEGER,
    clinician_reviewer_id       TEXT,
    clinician_review_action     TEXT,                      -- 'approved_as_is' | 'edited_and_approved' | 'rejected'
    clinician_review_notes      TEXT,

    submitted_at                INTEGER,
    accepted_at                 INTEGER,
    paid_at                     INTEGER,

    clearinghouse_claim_id      TEXT,                      -- vendor's tracking id after submission
    clearinghouse_response_json TEXT,                      -- last response payload (277CA / 835 fragment)

    created_at                  INTEGER NOT NULL,
    updated_at                  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_claims_patient    ON billing_claims(patient_id, visit_date DESC);
CREATE INDEX IF NOT EXISTS idx_claims_status     ON billing_claims(status, visit_date DESC);
CREATE INDEX IF NOT EXISTS idx_claims_encounter  ON billing_claims(encounter_id);
CREATE INDEX IF NOT EXISTS idx_claims_session    ON billing_claims(source_session_id);
CREATE INDEX IF NOT EXISTS idx_claims_payer_date ON billing_claims(payer_id, visit_date DESC);

-- ---------------------------------------------------------------------
-- billing_claim_lines — CPT/HCPCS lines on the claim.
-- One row per service-line per claim. Aligns with 837P SV1 segment.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing_claim_lines (
    id                  TEXT PRIMARY KEY,
    claim_id            TEXT NOT NULL,
    line_number         INTEGER NOT NULL,                  -- sequence on the claim (1..N)
    code_type           TEXT NOT NULL,                     -- 'cpt' | 'hcpcs' | 'em'
    code                TEXT NOT NULL,                     -- '99213', '58662', 'A4550', etc.
    code_description    TEXT,                              -- denormalized for display
    modifier_1          TEXT,                              -- e.g. '25', '59', 'LT', 'RT'
    modifier_2          TEXT,
    modifier_3          TEXT,
    modifier_4          TEXT,
    modifier_rationale  TEXT,                              -- WHY the modifier was attached (AI-generated)
    units               INTEGER NOT NULL DEFAULT 1,
    minutes             INTEGER,                           -- timed services (e.g., OMT)
    place_of_service    TEXT,                              -- POS code: '11' office, '02' telehealth, etc.
    diagnosis_pointers  TEXT,                              -- comma-separated indices into billing_claim_diagnoses (e.g., '1,2')
    charge_cents        INTEGER,                           -- billed amount for this line in cents
    expected_cents      INTEGER,                           -- expected payer reimbursement
    wrvu                REAL,
    confidence          REAL,                              -- AI confidence 0..1
    ai_rationale        TEXT,
    supporting_evidence_json TEXT,                         -- array of strings — quotes from note
    alternatives_considered_json TEXT,                     -- array of AlternativeCode objects from CodingRecommendation
    user_override_code  TEXT,                              -- clinician changed the code during review
    user_notes          TEXT,
    is_accepted         INTEGER,                           -- 0/1/NULL = pending
    created_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lines_claim       ON billing_claim_lines(claim_id, line_number);
CREATE INDEX IF NOT EXISTS idx_lines_code        ON billing_claim_lines(code);

-- ---------------------------------------------------------------------
-- billing_claim_diagnoses — ICD-10 diagnosis codes on the claim.
-- Aligns with 837P HI segment (up to 12 diagnoses per claim).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing_claim_diagnoses (
    id                  TEXT PRIMARY KEY,
    claim_id            TEXT NOT NULL,
    diagnosis_index     INTEGER NOT NULL,                  -- 1..12 (837P max)
    icd10_code          TEXT NOT NULL,                     -- 'N80.9'
    icd10_description   TEXT,
    confidence          REAL,
    ai_rationale        TEXT,
    supporting_evidence_json TEXT,
    user_override_code  TEXT,
    user_notes          TEXT,
    is_accepted         INTEGER,
    created_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_diagnoses_claim ON billing_claim_diagnoses(claim_id, diagnosis_index);
CREATE INDEX IF NOT EXISTS idx_diagnoses_code  ON billing_claim_diagnoses(icd10_code);

-- ---------------------------------------------------------------------
-- billing_compliance_flags — compliance items surfaced by CodingService.
-- Severity drives the admin-review urgency.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing_compliance_flags (
    id              TEXT PRIMARY KEY,
    claim_id        TEXT NOT NULL,
    severity        TEXT NOT NULL,                         -- 'error' | 'warning' | 'info'
    flag_kind       TEXT NOT NULL,                         -- 'missing_modifier' | 'documentation_gap' | 'mdm_mismatch' | 'time_not_documented' | etc.
    title           TEXT NOT NULL,
    description     TEXT,
    referenced_code TEXT,                                  -- which CPT / ICD this applies to
    suggested_fix   TEXT,
    resolved        INTEGER NOT NULL DEFAULT 0,            -- clinician marked it addressed
    resolved_at     INTEGER,
    resolved_by     TEXT,
    resolved_note   TEXT,
    created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_flags_claim_severity ON billing_compliance_flags(claim_id, severity);

-- ---------------------------------------------------------------------
-- billing_upcoding_opportunities — AI-identified upcoding suggestions.
-- These are recommendations to bill higher; clinician decides if the
-- documentation supports them.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing_upcoding_opportunities (
    id                      TEXT PRIMARY KEY,
    claim_id                TEXT NOT NULL,
    current_code            TEXT NOT NULL,                 -- '99213'
    potential_code          TEXT NOT NULL,                 -- '99214'
    wrvu_delta              REAL NOT NULL,                 -- additional wRVU if accepted
    revenue_delta_cents     INTEGER,                       -- expected $ delta (based on rate schedule)
    required_documentation  TEXT NOT NULL,                 -- markdown: what would need to be documented
    confidence              REAL,                          -- AI confidence 0..1
    rationale               TEXT,
    accepted                INTEGER NOT NULL DEFAULT 0,    -- clinician accepted the upcode
    accepted_at             INTEGER,
    accepted_by             TEXT,
    created_at              INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_upcoding_claim ON billing_upcoding_opportunities(claim_id);

-- ---------------------------------------------------------------------
-- billing_documentation_suggestions — AI's documentation improvement
-- recommendations to support the codes that ARE billed.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing_documentation_suggestions (
    id              TEXT PRIMARY KEY,
    claim_id        TEXT NOT NULL,
    priority        TEXT NOT NULL,                         -- 'high' | 'medium' | 'low'
    section         TEXT,                                  -- which SOAP section ('HPI' | 'ROS' | 'PE' | 'A' | 'P')
    issue           TEXT NOT NULL,
    suggestion      TEXT NOT NULL,                         -- what to add
    original_text   TEXT,                                  -- found in the note
    revised_text    TEXT,                                  -- proposed replacement
    revenue_impact  TEXT,                                  -- 'protects E/M', 'enables upcode', 'audit-defense', etc.
    applied         INTEGER NOT NULL DEFAULT 0,
    applied_at      INTEGER,
    created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_docsugg_claim_priority ON billing_documentation_suggestions(claim_id, priority);

-- ---------------------------------------------------------------------
-- billing_audit_log — claim lifecycle events.
-- Append-only. Every transition recorded with who + when + what.
-- 7-year retention to match payer audit standards.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing_audit_log (
    id              TEXT PRIMARY KEY,
    claim_id        TEXT NOT NULL,
    ts              INTEGER NOT NULL,
    actor_id        TEXT,                                  -- clinician id, 'app', 'system'
    actor_role      TEXT NOT NULL,                         -- 'clinician' | 'staff' | 'app' | 'system'
    action          TEXT NOT NULL,                         -- 'claim_created' | 'claim_edited' | 'flag_resolved'
                                                            -- | 'upcoding_accepted' | 'doc_suggestion_applied'
                                                            -- | 'claim_approved' | 'claim_rejected'
                                                            -- | 'claim_submitted' | 'response_received'
                                                            -- | 'claim_paid' | 'claim_denied' | 'claim_appealed'
    details_json    TEXT,                                  -- structured action details (no PHI; just claim state delta)
    ip              TEXT,
    user_agent      TEXT
);
CREATE INDEX IF NOT EXISTS idx_billaudit_claim_ts ON billing_audit_log(claim_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_billaudit_action   ON billing_audit_log(action, ts DESC);

-- =====================================================================
-- End of 0006_phase8_billing.sql
-- =====================================================================
