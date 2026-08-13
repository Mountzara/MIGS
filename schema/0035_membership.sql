-- ====================================================================
-- 0035_membership.sql — membership enrolment (2026-08-13)
-- ====================================================================
-- Stripe is the source of truth for BILLING state: what was charged,
-- when, and whether the card worked. This table is the source of truth
-- for PRACTICE state: who is a member, at what tier, and — the part
-- Stripe cannot hold — the eligibility decision that let them enrol.
--
-- That last column matters. _lib/membership.js refuses to enrol a
-- Medicare or Medicaid patient without a documented, attributed override,
-- because offering something of value to a federal beneficiary is the
-- inducement fact pattern at 42 U.S.C. 1320a-7a(a)(5). If that decision
-- lives only in someone's memory it is not a decision, it is a liability.
-- So the rationale and who approved it are stored beside the enrolment,
-- for as long as the enrolment exists.
-- ====================================================================

CREATE TABLE IF NOT EXISTS memberships (
    id                   TEXT PRIMARY KEY,
    patient_id           TEXT NOT NULL,
    tier                 TEXT NOT NULL,         -- 'navigator' | 'priority' | 'complete'
    interval             TEXT NOT NULL DEFAULT 'month' CHECK (interval IN ('month','year')),
    status               TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','active','past_due','cancelling','cancelled')),

    stripe_customer_id   TEXT,
    stripe_subscription_id TEXT,
    stripe_price_id      TEXT,
    current_period_end   TEXT,
    cancel_at_period_end INTEGER NOT NULL DEFAULT 0,

    -- The eligibility decision, kept because it is a compliance record.
    payer_kind_at_enrol  TEXT,
    override_rationale   TEXT,
    override_approved_by TEXT,

    -- What they were shown and agreed to. Prices change; a member's terms
    -- should not change retroactively, and "what did it say when they
    -- signed up" must stay answerable.
    price_month_cents    INTEGER,
    terms_version        TEXT,

    created_at           TEXT NOT NULL,
    activated_at         TEXT,
    cancelled_at         TEXT,
    updated_at           TEXT
);

CREATE INDEX IF NOT EXISTS idx_membership_patient ON memberships (patient_id, status);
CREATE INDEX IF NOT EXISTS idx_membership_sub     ON memberships (stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_membership_status  ON memberships (status, tier);
CREATE UNIQUE INDEX IF NOT EXISTS idx_membership_active_one
    ON memberships (patient_id) WHERE status IN ('pending','active','past_due','cancelling');
