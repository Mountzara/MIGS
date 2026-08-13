-- 0028_billing_denial_automation.sql — the autonomous denial loop
--
-- Closes the three gaps that stopped denial handling from being autonomous:
--   1. NOTHING DETECTED THE DENIAL. clearinghouse.js could submit but never
--      ingested an 835/ERA or polled 276/277, so a human had to notice a claim
--      came back. billing_remittances + billing_claim_status_checks are the
--      trigger surface.
--   2. DEADLINES WERE PROSE. billing_appeals.deadline_note held a sentence
--      ("commonly 90-180 days"). A missed appeal window is the one
--      unrecoverable failure in the whole pipeline, and it is pure calendar
--      math. billing_payer_deadlines holds per-payer windows AS DATA, with a
--      source_url + verified_on so the number is never assumed, and the
--      appeal rows carry real computed due dates.
--   3. NO TIERED AUTONOMY RECORD. Every automated action must be attributable
--      and reversible: autonomy_tier + approval columns make it explicit
--      whether a machine acted alone (Tier A clerical) or the physician
--      attested (Tier B clinical).
--
-- Apply: npx wrangler d1 execute mountzara-clinical --remote --file=schema/0028_billing_denial_automation.sql

-- ---------------------------------------------------------------------------
-- Per-payer timely-filing + appeal windows, AS DATA, WITH PROVENANCE.
-- Every row must carry source_url + verified_on. A NULL window means "not
-- verified" and the deadline watcher escalates to the physician rather than
-- computing a due date from an assumption.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing_payer_deadlines (
    id                      TEXT PRIMARY KEY,
    payer_id                TEXT,                    -- FK billing_payers.id (NULL = default row for payer_kind)
    payer_kind              TEXT,                    -- 'medicare' | 'medicaid' | 'commercial' | 'bcbs' | 'tricare'
    timely_filing_days      INTEGER,                 -- from date of service
    appeal_level1_days      INTEGER,                 -- from remittance/denial date
    appeal_level2_days      INTEGER,
    external_review_days    INTEGER,
    corrected_claim_days    INTEGER,
    source_url              TEXT,                    -- REQUIRED for a verified row
    verified_on             TEXT,                    -- ISO date the source was read
    notes                   TEXT,
    created_at              TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payer_deadlines_payer ON billing_payer_deadlines(payer_id);
CREATE INDEX IF NOT EXISTS idx_payer_deadlines_kind  ON billing_payer_deadlines(payer_kind);

-- ---------------------------------------------------------------------------
-- 835/ERA remittances — the denial TRIGGER. One row per remittance line that
-- lands against a claim. raw_json keeps the payer's own payload for audit.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing_remittances (
    id                  TEXT PRIMARY KEY,
    claim_id            TEXT,                        -- FK billing_claims.id (NULL until matched)
    payer_id            TEXT,
    payer_claim_control TEXT,                        -- payer's ICN/DCN
    remittance_date     TEXT,                        -- ISO date — starts every appeal clock
    check_eft_number    TEXT,
    billed_cents        INTEGER,
    allowed_cents       INTEGER,
    paid_cents          INTEGER,
    patient_resp_cents  INTEGER,
    carc_codes          TEXT,                        -- JSON array
    rarc_codes          TEXT,                        -- JSON array
    is_denial           INTEGER NOT NULL DEFAULT 0,  -- computed on ingest
    ingest_source       TEXT,                        -- 'era_835' | 'clearinghouse_api' | 'manual'
    raw_json            TEXT,
    processed_at        TEXT,                        -- set when the denial router has run
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_remit_claim     ON billing_remittances(claim_id);
CREATE INDEX IF NOT EXISTS idx_remit_denial    ON billing_remittances(is_denial, processed_at);
CREATE INDEX IF NOT EXISTS idx_remit_date      ON billing_remittances(remittance_date);

-- ---------------------------------------------------------------------------
-- 276/277 claim-status polling history — so a silent claim (never remitted)
-- is still detectable before timely filing lapses.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing_claim_status_checks (
    id            TEXT PRIMARY KEY,
    claim_id      TEXT NOT NULL,
    checked_at    TEXT NOT NULL DEFAULT (datetime('now')),
    status_code   TEXT,
    status_text   TEXT,
    payer_claim_control TEXT,
    raw_json      TEXT
);
CREATE INDEX IF NOT EXISTS idx_status_claim ON billing_claim_status_checks(claim_id, checked_at);

-- ---------------------------------------------------------------------------
-- Tiered-autonomy + deadline columns on the existing appeals table.
-- SQLite has no "ADD COLUMN IF NOT EXISTS"; these run once. Re-running the
-- migration will error on the ALTERs — that is expected and harmless.
-- ---------------------------------------------------------------------------
ALTER TABLE billing_appeals ADD COLUMN autonomy_tier      TEXT;     -- 'A_auto' | 'B_physician_approve' | 'C_hold'
ALTER TABLE billing_appeals ADD COLUMN approval_state     TEXT;     -- 'awaiting_physician' | 'approved' | 'declined' | 'auto_executed'
ALTER TABLE billing_appeals ADD COLUMN approved_by        TEXT;
ALTER TABLE billing_appeals ADD COLUMN approved_at        TEXT;
ALTER TABLE billing_appeals ADD COLUMN denial_date        TEXT;     -- remittance date the clock runs from
ALTER TABLE billing_appeals ADD COLUMN deadline_due_date  TEXT;     -- COMPUTED due date (NULL when unverified window)
ALTER TABLE billing_appeals ADD COLUMN deadline_source    TEXT;     -- source_url the window came from
ALTER TABLE billing_appeals ADD COLUMN escalation_level   INTEGER NOT NULL DEFAULT 1;
ALTER TABLE billing_appeals ADD COLUMN remittance_id      TEXT;
ALTER TABLE billing_appeals ADD COLUMN evidence_json      TEXT;     -- Tier B package: note passages, policy cites, records manifest

CREATE INDEX IF NOT EXISTS idx_appeals_approval ON billing_appeals(approval_state, deadline_due_date);
CREATE INDEX IF NOT EXISTS idx_appeals_due      ON billing_appeals(deadline_due_date);

-- ---------------------------------------------------------------------------
-- Outcome learning loop: win/loss by CARC x payer x strategy. Feeds the
-- preflight so a denial beaten once is never filed the same way again.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing_denial_outcomes (
    id             TEXT PRIMARY KEY,
    appeal_id      TEXT NOT NULL,
    claim_id       TEXT NOT NULL,
    payer_id       TEXT,
    payer_kind     TEXT,
    carc_code      TEXT,
    strategy       TEXT,
    autonomy_tier  TEXT,
    outcome        TEXT,                              -- 'won' | 'lost' | 'partial' | 'withdrawn'
    recovered_cents INTEGER,
    days_to_resolution INTEGER,
    argument_key   TEXT,                              -- short key of the winning argument, for reuse
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_outcomes_lookup ON billing_denial_outcomes(carc_code, payer_kind, outcome);
