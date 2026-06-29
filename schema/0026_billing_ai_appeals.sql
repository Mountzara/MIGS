-- 0026_billing_ai_appeals.sql — AI denial-remediation + pre-flight persistence
-- Backs two new AI-assisted billing surfaces:
--   * billing_preflight_reviews — the AI pre-flight denial-prevention review
--     run before submission (advisory; feeds the Coding Coach + audit trail).
--   * billing_appeals — the denial-response drafts (corrected claim / appeal /
--     reconsideration) authored from the claim's 835 CARC codes.
-- Apply: npx wrangler d1 execute mountzara-clinical --remote --file=schema/0026_billing_ai_appeals.sql

CREATE TABLE IF NOT EXISTS billing_preflight_reviews (
    id             TEXT PRIMARY KEY,
    claim_id       TEXT NOT NULL,                 -- FK billing_claims.id
    risk_level     TEXT,                          -- 'low' | 'medium' | 'high'
    ready          INTEGER NOT NULL DEFAULT 0,    -- scrub.clean && review.ready_to_submit
    scrub_clean    INTEGER NOT NULL DEFAULT 0,
    issues_json    TEXT,                          -- { issues:[...], summary, blocks, warnings }
    ai_used        INTEGER NOT NULL DEFAULT 0,    -- 1 = Claude review, 0 = rule-based fallback
    model          TEXT,
    prompt_version TEXT,
    created_by     TEXT,
    created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_preflight_claim ON billing_preflight_reviews(claim_id, created_at);

CREATE TABLE IF NOT EXISTS billing_appeals (
    id               TEXT PRIMARY KEY,
    claim_id         TEXT NOT NULL,               -- FK billing_claims.id
    strategy         TEXT,                        -- corrected_claim | appeal | reconsideration | patient_bill | write_off
    status           TEXT NOT NULL DEFAULT 'drafted',  -- drafted | sent | won | lost | partial | withdrawn
    carc_codes       TEXT,                        -- JSON array of the appealed CARC codes
    letter_text      TEXT,                        -- the drafted appeal letter (PHI — D1 is the system of record)
    remediation_json TEXT,                        -- { carc_explanations, corrected_claim_changes, supporting_points, strategy_rationale }
    deadline_note    TEXT,
    ai_used          INTEGER NOT NULL DEFAULT 0,
    model            TEXT,
    prompt_version   TEXT,
    sent_at          INTEGER,
    outcome_note     TEXT,
    created_by       TEXT,
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_appeals_claim ON billing_appeals(claim_id, created_at);
CREATE INDEX IF NOT EXISTS idx_appeals_status ON billing_appeals(status);
