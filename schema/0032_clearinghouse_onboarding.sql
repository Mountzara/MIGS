-- ====================================================================
-- 0032_clearinghouse_onboarding.sql
-- A real, resumable clearinghouse setup wizard (2026-08-13)
-- ====================================================================
-- WHY
-- The go-live page used to be a prose checklist: "enroll with a
-- clearinghouse, then come back." That is not a wizard, it is a sign
-- pointing at the work. A solo physician with no billing staff needs the
-- software to DO the parts software can do:
--
--   * ask for each identifier ONCE and reuse it on every downstream form
--   * score the vendors against his actual payer mix instead of handing
--     him a paragraph of hedged advice
--   * emit the exact field values each application asks for, so enrollment
--     is copy-and-paste rather than hunting through a CV and a W-9
--   * track per-payer EDI enrollment, which is the step that actually
--     stalls practices for months and which nothing else in the system
--     was watching
--   * test the credentials against the live vendor before anything real
--     is submitted
--
-- STATE, NOT DOCUMENTATION
-- Every table here exists so the wizard can be CLOSED and REOPENED without
-- losing a thing. Enrollment runs for weeks; a wizard that forgets is
-- worse than no wizard.
--
-- PHI
-- None of this is patient data. It is practice identity (NPI, TIN,
-- addresses) and vendor credentials. Credentials are nonetheless stored
-- encrypted with the same envelope scheme as PHI (_lib/phi.js): a
-- clearinghouse key can submit claims for real money, so it gets the
-- strongest protection the system has. The TIN is likewise encrypted --
-- it is an EIN or, for a sole proprietor, an SSN.
-- ====================================================================

-- One row. The practice's own identity, entered once, reused everywhere.
CREATE TABLE IF NOT EXISTS clearinghouse_profile (
    id                  TEXT PRIMARY KEY DEFAULT 'default',

    -- Legal identity
    legal_name          TEXT,      -- name on the W-9 / IRS record
    dba_name            TEXT,      -- practice name, if different
    entity_type         TEXT,      -- 'sole_proprietor' | 'llc' | 'pc' | 'corp'
    tin_ciphertext      TEXT,      -- EIN or SSN — encrypted, never plain
    tin_dek_wrapped     TEXT,
    tin_iv_data         TEXT,
    tin_iv_dek          TEXT,
    tin_last4           TEXT,      -- for display: "**-***1234"

    -- Provider identifiers
    npi_individual      TEXT,      -- NPI Type 1
    npi_group           TEXT,      -- NPI Type 2, if billing under a group
    taxonomy_code       TEXT,      -- e.g. 207V00000X (OB/GYN)
    license_state       TEXT,
    license_number      TEXT,
    medicare_ptan       TEXT,
    medicaid_id         TEXT,
    caqh_id             TEXT,

    -- Addresses (payers distinguish service location from pay-to)
    practice_street     TEXT,
    practice_street2    TEXT,
    practice_city       TEXT,
    practice_state      TEXT,
    practice_zip        TEXT,      -- ZIP+4 required by many payers
    payto_street        TEXT,
    payto_street2       TEXT,
    payto_city          TEXT,
    payto_state         TEXT,
    payto_zip           TEXT,

    -- Contact of record for the enrollment application
    contact_name        TEXT,
    contact_title       TEXT,
    contact_phone       TEXT,
    contact_fax         TEXT,
    contact_email       TEXT,

    updated_at          TEXT,
    updated_by          TEXT
);

-- One row. Where the wizard is, and what it decided.
CREATE TABLE IF NOT EXISTS clearinghouse_onboarding (
    id                    TEXT PRIMARY KEY DEFAULT 'default',
    current_step          TEXT NOT NULL DEFAULT 'profile',
    -- Step completion is derived, but recording it lets the wizard show
    -- "you finished this on the 4th" instead of only a checkmark.
    profile_done_at       TEXT,
    selection_done_at     TEXT,
    packet_done_at        TEXT,
    credentials_done_at   TEXT,
    testclaim_done_at     TEXT,
    golive_done_at        TEXT,

    -- Step 2 output
    selected_vendor       TEXT,
    selection_answers_json TEXT,   -- the interview responses
    selection_scores_json  TEXT,   -- why each vendor scored what it did

    -- Step 2 context that drives scoring
    states_json           TEXT,    -- ["IL","CA"]
    payer_mix_json        TEXT,    -- {"medicare":30,"medicaid":10,"commercial":60}
    monthly_claims        INTEGER,

    -- Free-form operator notes, e.g. "rep said 3 wks, ticket #44812"
    notes                 TEXT,
    updated_at            TEXT
);

-- Vendor credentials, encrypted. One row per vendor so switching
-- clearinghouses -- or running two, which is common (Availity for
-- eligibility, Claim.MD for claims) -- does not destroy the other's keys.
CREATE TABLE IF NOT EXISTS clearinghouse_credentials (
    vendor           TEXT PRIMARY KEY,
    -- Each field is an independently encrypted envelope; a vendor uses
    -- some subset (key OR client id+secret OR user+pass).
    fields_ciphertext TEXT,        -- JSON object, encrypted as one blob
    fields_dek_wrapped TEXT,
    fields_iv_data    TEXT,
    fields_iv_dek     TEXT,
    field_names_json  TEXT,        -- non-secret: which keys are present
    last_test_at      TEXT,
    last_test_ok      INTEGER,     -- 1 / 0
    last_test_detail  TEXT,        -- vendor's own message, truncated
    updated_at        TEXT,
    updated_by        TEXT
);

-- The step that actually stalls practices. A clearinghouse account does
-- NOT mean you can bill a payer: most government payers and many
-- commercial ones require a separate per-payer EDI enrollment, each with
-- its own form, its own turnaround, and its own silent failure mode.
CREATE TABLE IF NOT EXISTS clearinghouse_payer_enrollment (
    id                TEXT PRIMARY KEY,
    vendor            TEXT NOT NULL,
    payer_id          TEXT,                    -- billing_payers.id when known
    payer_name        TEXT NOT NULL,
    payer_kind        TEXT,                    -- 'medicare'|'medicaid'|'commercial'|'blues'
    edi_required      INTEGER NOT NULL DEFAULT 1,
    era_required      INTEGER NOT NULL DEFAULT 0,   -- 835 remittance enrollment
    eft_required      INTEGER NOT NULL DEFAULT 0,   -- direct deposit
    form_name         TEXT,
    form_url          TEXT,
    status            TEXT NOT NULL DEFAULT 'not_started'
                      CHECK (status IN ('not_started','in_progress','submitted','approved','rejected','not_required')),
    submitted_at      TEXT,
    approved_at       TEXT,
    expected_days     INTEGER,                 -- NULL when the payer publishes none
    reference_number  TEXT,                    -- the payer's ticket / confirmation
    note              TEXT,
    updated_at        TEXT
);

CREATE INDEX IF NOT EXISTS idx_ch_enroll_vendor  ON clearinghouse_payer_enrollment (vendor, status);
CREATE INDEX IF NOT EXISTS idx_ch_enroll_payer   ON clearinghouse_payer_enrollment (payer_name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ch_enroll_uniq
    ON clearinghouse_payer_enrollment (vendor, payer_name);

-- An audit line per wizard action. Enrollment disputes are common
-- ("we never received your form") and a dated local record is the only
-- thing that settles them.
CREATE TABLE IF NOT EXISTS clearinghouse_events (
    id          TEXT PRIMARY KEY,
    at          TEXT NOT NULL,
    actor       TEXT,
    step        TEXT,
    action      TEXT NOT NULL,
    detail      TEXT,
    ok          INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ch_events_at ON clearinghouse_events (at DESC);
