-- ====================================================================
-- 0036_membership_interest.sql — the waitlist (2026-08-13)
-- ====================================================================
-- The membership page went public with prices and "Join" buttons before
-- anything was purchasable: Stripe is not wired, the portal is gated, and
-- email is still in the SES sandbox. A price with a button that does not
-- work is worse than no page, because the first thing a prospective
-- patient learns about the practice is that it does not do what it says.
--
-- So the page says OPENING SOON and collects interest instead. That is
-- also the more useful thing at this stage: it answers "will anyone pay
-- for this" before another line of billing code is written.
--
-- NOT PHI. Deliberately. This table holds an email address, a tier and an
-- optional free-text note. It must never hold a symptom, a diagnosis or a
-- medical history — someone who wants to describe their case should
-- create a portal account, where that content is encrypted and governed.
-- `note` is length-capped and screened at the endpoint for exactly that
-- reason: a marketing form is not a place to disclose a condition, and
-- people will try.
-- ====================================================================

CREATE TABLE IF NOT EXISTS membership_interest (
    id             TEXT PRIMARY KEY,
    email          TEXT NOT NULL,
    tier           TEXT,                  -- which one they clicked
    state          TEXT,                  -- so we can see demand outside IL/CA
    has_obgyn      TEXT,                  -- 'yes' | 'no' | null — the Navigator thesis
    note           TEXT,                  -- short, non-clinical
    source         TEXT,                  -- page or campaign
    created_at     TEXT NOT NULL,
    notified_at    TEXT,                  -- when we told them it opened
    ip_hash        TEXT                   -- rate limiting only; salted, never raw
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_interest_email_tier ON membership_interest (email, tier);
CREATE INDEX IF NOT EXISTS idx_interest_created ON membership_interest (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_interest_tier    ON membership_interest (tier, created_at DESC);
