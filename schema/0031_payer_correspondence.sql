-- 0029_payer_correspondence.sql — paper/fax/portal payer mail intake.
--
-- WHY (2026-08-12): the electronic loop (835 ERA) only covers claims the payer
-- adjudicates and remits. The items that actually kill practices arrive on
-- PAPER and announce themselves nowhere electronic:
--   * ADR / additional-documentation requests (short fuse, often ~30-45 days)
--   * medical-records requests tied to an audit (TPE / RAC / UPIC)
--   * appeal determinations (start the clock on the NEXT level)
--   * overpayment / recoupment demand letters
--   * credentialing + contracting correspondence
-- Every one carries a hard deadline, and a letter that sits in a pile is
-- indistinguishable from a letter that was never sent.
--
-- This table is the intake surface: scan/photo/fax -> OCR -> AI extraction ->
-- routed into the SAME denial router and deadline watcher as electronic
-- denials, so paper and electronic converge on one queue.
--
-- PHI: the scanned image and full OCR text are PHI and live in R2/D1 under the
-- Cloudflare BAA (see functions/_lib/phi.js envelope encryption). Only
-- Safe-Harbor de-identified text is ever sent to an AI processor.
--
-- Apply: npx wrangler d1 execute mountzara-clinical --remote --file=schema/0029_payer_correspondence.sql

CREATE TABLE IF NOT EXISTS billing_correspondence (
    id                  TEXT PRIMARY KEY,
    received_channel    TEXT NOT NULL,          -- 'mail' | 'fax' | 'portal' | 'email'
    received_date       TEXT,                   -- date ON the letter (drives deadlines)
    scanned_at          TEXT NOT NULL DEFAULT (datetime('now')),

    -- Source artifact (PHI — encrypted in R2 via putPhiObject)
    r2_key              TEXT,
    wrapped_dek         TEXT,
    iv_data             TEXT,
    iv_dek              TEXT,
    page_count          INTEGER,
    ocr_engine          TEXT,                   -- 'vision_macos' | 'other'
    ocr_confidence      REAL,
    ocr_text_r2_key     TEXT,                   -- full OCR text, encrypted

    -- AI classification + extraction (run on DE-IDENTIFIED text only)
    doc_type            TEXT,                   -- 'denial' | 'adr_records_request' | 'appeal_determination'
                                                -- | 'overpayment_demand' | 'audit_notice' | 'credentialing'
                                                -- | 'eob_paper' | 'other'
    payer_id            TEXT,
    payer_name_guess    TEXT,
    claim_id            TEXT,                   -- FK billing_claims.id once matched
    payer_claim_control TEXT,                   -- ICN/DCN printed on the letter
    carc_codes          TEXT,                   -- JSON array if the letter states them
    requested_action    TEXT,                   -- what the payer wants, plain language
    amount_cents        INTEGER,                -- demanded/adjusted amount if stated

    -- THE FIELD THAT MATTERS MOST
    response_due_date   TEXT,                   -- extracted deadline (NULL = unknown → escalate)
    deadline_basis      TEXT,                   -- verbatim quote the date came from
    deadline_confidence REAL,

    extraction_json     TEXT,                   -- full structured extraction
    deid_verified       INTEGER NOT NULL DEFAULT 0,  -- 1 = scrubber passed before any AI call
    ai_used             INTEGER NOT NULL DEFAULT 0,
    model               TEXT,
    prompt_version      TEXT,

    -- Routing / disposition
    autonomy_tier       TEXT,                   -- from denial_router
    status              TEXT NOT NULL DEFAULT 'needs_review',
                                                -- 'needs_review' | 'routed' | 'actioned' | 'filed' | 'ignored'
    linked_appeal_id    TEXT,                   -- FK billing_appeals.id when it spawns a response
    reviewed_by         TEXT,
    reviewed_at         TEXT,
    notes               TEXT,

    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_corr_status   ON billing_correspondence(status, response_due_date);
CREATE INDEX IF NOT EXISTS idx_corr_due      ON billing_correspondence(response_due_date);
CREATE INDEX IF NOT EXISTS idx_corr_claim    ON billing_correspondence(claim_id);
CREATE INDEX IF NOT EXISTS idx_corr_type     ON billing_correspondence(doc_type, scanned_at);
