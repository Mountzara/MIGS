-- =====================================================================
-- 0010_phase6_stripe_billing.sql — Patient-direct-pay billing via Stripe
-- =====================================================================
-- Per CLAUDE.md §11 Phase 6.
--
-- Architecture:
--   1. We never store PANs/CVV. Stripe holds card data; we hold tokens
--      (cus_xxx for customers, pm_xxx for saved payment methods, etc.).
--   2. PHI-sensitive fields (invoice line-item descriptions that name a
--      procedure or condition) are envelope-encrypted in mountzara-phi.
--      Only opaque category tags ("office_visit", "office_procedure") and
--      money amounts live in plaintext D1.
--   3. Every state change writes to billing_event_log (separate from the
--      main audit_log for ease of payment-specific export/audit).
--   4. Tax-export rows are derived on demand from invoices + payments
--      tables via /admin/billing/reports/ — we don't denormalize.
--
-- Compliance hooks:
--   - HIPAA: BAA with Stripe required before live keys are used.
--     Tracked in baa_ledger.
--   - HSA/FSA: receipts include provider name, date, service category,
--     amount (IRS Pub 502 minimum). Patient-facing receipt download
--     pulls from PHI-decrypted line items.
--   - 1099-K: payments table preserves Stripe charge IDs + gross/fee/net
--     for reconciliation against Stripe's annual 1099-K.
-- =====================================================================

-- 1. Stripe customer mapping ------------------------------------------
CREATE TABLE IF NOT EXISTS stripe_customers (
    -- patient_id is canonical; one Stripe customer per patient
    patient_id            TEXT PRIMARY KEY,
    stripe_customer_id    TEXT NOT NULL UNIQUE,    -- cus_xxx
    -- email/name we sent to Stripe at customer create time (for diff detection)
    sent_email            TEXT,
    sent_name             TEXT,
    -- Stripe livemode flag — true once we've cut over from test to live
    livemode              INTEGER NOT NULL DEFAULT 0,
    created_at            INTEGER NOT NULL,
    updated_at            INTEGER NOT NULL,
    FOREIGN KEY (patient_id) REFERENCES patients(id)
);
CREATE INDEX IF NOT EXISTS idx_stripe_customers_stripe_id ON stripe_customers(stripe_customer_id);

-- 2. Saved payment methods (card-on-file) -----------------------------
CREATE TABLE IF NOT EXISTS payment_methods (
    id                    TEXT PRIMARY KEY,        -- our internal UUID
    patient_id            TEXT NOT NULL,
    stripe_pm_id          TEXT NOT NULL UNIQUE,    -- pm_xxx
    stripe_customer_id    TEXT NOT NULL,
    type                  TEXT NOT NULL,            -- 'card', 'us_bank_account', etc.
    -- Display fields (safe to store — Stripe returns these in PaymentMethod object)
    brand                 TEXT,                     -- 'visa', 'mastercard', etc.
    last4                 TEXT,                     -- '4242' — last 4 only, NEVER PAN
    exp_month             INTEGER,
    exp_year              INTEGER,
    is_default            INTEGER NOT NULL DEFAULT 0,
    -- Lifecycle
    attached_at           INTEGER NOT NULL,
    detached_at           INTEGER,                  -- set when patient removes the card
    created_at            INTEGER NOT NULL,
    updated_at            INTEGER NOT NULL,
    FOREIGN KEY (patient_id) REFERENCES patients(id)
);
CREATE INDEX IF NOT EXISTS idx_payment_methods_patient ON payment_methods(patient_id, detached_at);

-- 3. Invoices ---------------------------------------------------------
-- An invoice may be linked to one appointment (most common), to multiple
-- encounters (a billing cycle), or stand alone (patient pre-pay).
CREATE TABLE IF NOT EXISTS invoices (
    id                    TEXT PRIMARY KEY,        -- our internal UUID
    patient_id            TEXT NOT NULL,
    appointment_id        TEXT,                     -- optional FK to appointments
    encounter_id          TEXT,                     -- optional FK to encounters
    -- Stripe linkage (one of these is set depending on flow)
    stripe_invoice_id     TEXT UNIQUE,              -- in_xxx (when using Stripe's Invoice product)
    stripe_payment_intent_id TEXT UNIQUE,           -- pi_xxx (when using ad-hoc Payment Intent)
    -- Invoice-level metadata
    invoice_number        TEXT UNIQUE,              -- human-friendly "INV-2026-001"
    issue_date            TEXT NOT NULL,            -- YYYY-MM-DD
    due_date              TEXT,                     -- YYYY-MM-DD
    -- Money — all in cents per Stripe convention; currency separate
    currency              TEXT NOT NULL DEFAULT 'usd',
    subtotal_cents        INTEGER NOT NULL DEFAULT 0,
    tax_cents             INTEGER NOT NULL DEFAULT 0,
    discount_cents        INTEGER NOT NULL DEFAULT 0,
    total_cents           INTEGER NOT NULL DEFAULT 0,
    amount_paid_cents     INTEGER NOT NULL DEFAULT 0,
    amount_refunded_cents INTEGER NOT NULL DEFAULT 0,
    -- Status: draft | sent | partially_paid | paid | void | written_off | refunded
    status                TEXT NOT NULL DEFAULT 'draft',
    -- Notes — patient-visible notes (NOT PHI-bearing diagnosis info; that
    -- goes in line_items_phi_r2_key).
    public_memo           TEXT,
    -- PHI-bearing line items (encrypted in mountzara-phi)
    line_items_phi_r2_key TEXT,                     -- R2 key for encrypted line items JSON
    line_items_wrapped_dek TEXT,                    -- envelope-encrypted DEK
    -- Generic tax-export-safe summary (no PHI — used in QB exports)
    tax_export_summary    TEXT,                     -- e.g. "Office services — endometriosis follow-up consult" sanitized to "Office services"
    -- Lifecycle
    sent_at               INTEGER,
    paid_at               INTEGER,
    voided_at             INTEGER,
    created_at            INTEGER NOT NULL,
    updated_at            INTEGER NOT NULL,
    created_by_user_id    TEXT,
    FOREIGN KEY (patient_id) REFERENCES patients(id),
    FOREIGN KEY (appointment_id) REFERENCES appointments(id),
    FOREIGN KEY (encounter_id) REFERENCES encounters(id)
);
CREATE INDEX IF NOT EXISTS idx_invoices_patient ON invoices(patient_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_status_date ON invoices(status, issue_date);
CREATE INDEX IF NOT EXISTS idx_invoices_stripe_pi ON invoices(stripe_payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_invoices_stripe_inv ON invoices(stripe_invoice_id);

-- 4. Visit-type / service-code catalog --------------------------------
-- Operator-editable price book that the admin uses to populate invoices
-- without re-typing prices. Service codes here are NOT CPT codes (those
-- are in the billing_claims pipeline — Phase 8 — for insurance billing);
-- these are simple patient-direct-pay categories.
CREATE TABLE IF NOT EXISTS billing_service_catalog (
    id                    TEXT PRIMARY KEY,
    -- Generic, NOT-PHI-bearing code used in QB exports
    code                  TEXT NOT NULL UNIQUE,    -- 'office_visit_new', 'omt_treatment', etc.
    -- Patient-friendly label
    display_name          TEXT NOT NULL,
    -- Generic category used for Schedule C income classification
    tax_category          TEXT NOT NULL DEFAULT 'professional_services',
    -- Default price in cents (operator can override per invoice)
    default_unit_price_cents INTEGER NOT NULL,
    -- Whether this service is HSA/FSA eligible (Pub 502 — virtually all
    -- medical office visits + procedures are eligible)
    hsa_fsa_eligible      INTEGER NOT NULL DEFAULT 1,
    -- Whether this maps to a clinical visit-type from Phase 2 (so we can
    -- auto-populate invoices after a completed appointment)
    visit_type_key        TEXT,
    is_active             INTEGER NOT NULL DEFAULT 1,
    sort_order            INTEGER NOT NULL DEFAULT 100,
    created_at            INTEGER NOT NULL,
    updated_at            INTEGER NOT NULL
);

-- 5. Payments (successful charges + intents) --------------------------
CREATE TABLE IF NOT EXISTS payments (
    id                    TEXT PRIMARY KEY,        -- our internal UUID
    patient_id            TEXT NOT NULL,
    invoice_id            TEXT NOT NULL,
    -- Stripe linkage
    stripe_payment_intent_id TEXT UNIQUE,           -- pi_xxx
    stripe_charge_id      TEXT UNIQUE,              -- ch_xxx (post-confirmation)
    stripe_balance_transaction_id TEXT,             -- txn_xxx — for QB fee reconciliation
    stripe_pm_id          TEXT,                     -- pm_xxx (which card was used)
    -- Money — gross, fee, net (all in cents)
    gross_amount_cents    INTEGER NOT NULL,
    fee_amount_cents      INTEGER NOT NULL DEFAULT 0,    -- Stripe's cut
    net_amount_cents      INTEGER NOT NULL DEFAULT 0,    -- what hits the bank account
    currency              TEXT NOT NULL DEFAULT 'usd',
    -- Status: pending | requires_action | succeeded | failed | canceled
    status                TEXT NOT NULL,
    -- Failure reason (when status = failed)
    failure_code          TEXT,
    failure_message       TEXT,
    -- Lifecycle
    captured_at           INTEGER,                  -- when card was actually charged
    settled_at            INTEGER,                  -- when funds settled (from Stripe payout)
    created_at            INTEGER NOT NULL,
    updated_at            INTEGER NOT NULL,
    FOREIGN KEY (patient_id) REFERENCES patients(id),
    FOREIGN KEY (invoice_id) REFERENCES invoices(id)
);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_patient ON payments(patient_id, captured_at);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status, captured_at);

-- 6. Refunds ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS refunds (
    id                    TEXT PRIMARY KEY,
    payment_id            TEXT NOT NULL,
    invoice_id            TEXT NOT NULL,
    patient_id            TEXT NOT NULL,
    stripe_refund_id      TEXT UNIQUE NOT NULL,    -- re_xxx
    stripe_balance_transaction_id TEXT,             -- offsetting txn_xxx
    amount_cents          INTEGER NOT NULL,
    currency              TEXT NOT NULL DEFAULT 'usd',
    reason                TEXT,                     -- 'duplicate' | 'requested_by_customer' | 'service_not_rendered' | 'fraudulent' | <custom>
    -- Status: pending | succeeded | failed | canceled
    status                TEXT NOT NULL,
    -- Memo for admin reference + tax audit trail
    admin_memo            TEXT,
    -- Lifecycle
    initiated_at          INTEGER NOT NULL,
    settled_at            INTEGER,
    initiated_by_user_id  TEXT,
    created_at            INTEGER NOT NULL,
    updated_at            INTEGER NOT NULL,
    FOREIGN KEY (payment_id) REFERENCES payments(id),
    FOREIGN KEY (invoice_id) REFERENCES invoices(id),
    FOREIGN KEY (patient_id) REFERENCES patients(id)
);
CREATE INDEX IF NOT EXISTS idx_refunds_payment ON refunds(payment_id);
CREATE INDEX IF NOT EXISTS idx_refunds_patient ON refunds(patient_id, initiated_at);

-- 7. Stripe webhook event log -----------------------------------------
-- Idempotency: Stripe may retry events. We keep every event_id we've
-- processed so we never double-handle.
CREATE TABLE IF NOT EXISTS stripe_webhook_events (
    stripe_event_id       TEXT PRIMARY KEY,        -- evt_xxx
    event_type            TEXT NOT NULL,            -- 'payment_intent.succeeded' etc.
    livemode              INTEGER NOT NULL,
    api_version           TEXT,
    received_at           INTEGER NOT NULL,
    processed_at          INTEGER,
    processing_error      TEXT,
    -- Reference back to internal records when applicable
    related_invoice_id    TEXT,
    related_payment_id    TEXT,
    related_refund_id     TEXT,
    -- Raw event JSON for diagnostic purposes (PHI-free per Stripe Object spec)
    raw_json              TEXT
);
CREATE INDEX IF NOT EXISTS idx_stripe_events_type_time ON stripe_webhook_events(event_type, received_at);
CREATE INDEX IF NOT EXISTS idx_stripe_events_invoice ON stripe_webhook_events(related_invoice_id);

-- 8. Payment audit log ------------------------------------------------
-- Separate from main audit_log for ease of export during tax / regulatory
-- audits. Every payment-related action lands here.
CREATE TABLE IF NOT EXISTS billing_event_log (
    id                    TEXT PRIMARY KEY,
    occurred_at           INTEGER NOT NULL,
    -- Actor
    actor_user_id         TEXT,                     -- admin user or patient_id
    actor_role            TEXT NOT NULL,            -- 'admin' | 'patient' | 'system' | 'stripe_webhook'
    -- Action category
    action                TEXT NOT NULL,            -- 'invoice_created' | 'invoice_sent' | 'invoice_voided' |
                                                    -- 'payment_initiated' | 'payment_succeeded' | 'payment_failed' |
                                                    -- 'refund_initiated' | 'refund_succeeded' |
                                                    -- 'card_attached' | 'card_detached' |
                                                    -- 'tax_export_generated' | 'receipt_downloaded'
    -- Target
    invoice_id            TEXT,
    payment_id            TEXT,
    refund_id             TEXT,
    -- Money snapshot at event time (denormalized for audit immutability)
    amount_cents          INTEGER,
    currency              TEXT,
    -- IP + UA for compliance / fraud forensics
    ip                    TEXT,
    user_agent            TEXT,
    -- Free-form structured details (JSON)
    details_json          TEXT,
    -- Whether this event is included in patient-facing audit trail (per
    -- HIPAA Right of Access / accounting of disclosures)
    patient_visible       INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id),
    FOREIGN KEY (payment_id) REFERENCES payments(id),
    FOREIGN KEY (refund_id) REFERENCES refunds(id)
);
CREATE INDEX IF NOT EXISTS idx_billing_event_log_time ON billing_event_log(occurred_at);
CREATE INDEX IF NOT EXISTS idx_billing_event_log_invoice ON billing_event_log(invoice_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_billing_event_log_patient_role ON billing_event_log(actor_role, occurred_at);

-- 9. Tax-export log (one row per export generated) --------------------
-- Audit trail of every CSV export pulled by the admin — what was
-- exported, by whom, when, scope (date range, mode).
CREATE TABLE IF NOT EXISTS billing_export_log (
    id                    TEXT PRIMARY KEY,
    generated_at          INTEGER NOT NULL,
    generated_by_user_id  TEXT,
    -- Mode: 'tax_safe' (no PHI) | 'detailed' (full info, in-house only)
    mode                  TEXT NOT NULL,
    -- Format: 'qbo_csv' | 'quicken_qif' | 'detailed_csv' | 'summary_pdf'
    format                TEXT NOT NULL,
    -- Scope
    period_start          TEXT NOT NULL,            -- YYYY-MM-DD
    period_end            TEXT NOT NULL,            -- YYYY-MM-DD
    -- Counts
    invoice_count         INTEGER NOT NULL,
    payment_count         INTEGER NOT NULL,
    refund_count          INTEGER NOT NULL,
    -- Totals (cents)
    gross_total_cents     INTEGER NOT NULL,
    fee_total_cents       INTEGER NOT NULL,
    net_total_cents       INTEGER NOT NULL,
    -- SHA-256 of the exported file for tamper-evidence
    file_sha256           TEXT NOT NULL,
    -- IP + UA
    ip                    TEXT,
    user_agent            TEXT
);
CREATE INDEX IF NOT EXISTS idx_billing_export_log_time ON billing_export_log(generated_at);

-- 10. Seed initial service catalog ------------------------------------
-- Operator can edit these via /admin/billing/services. Prices in CENTS.
INSERT OR IGNORE INTO billing_service_catalog
    (id, code, display_name, tax_category, default_unit_price_cents, hsa_fsa_eligible, visit_type_key, sort_order, created_at, updated_at)
VALUES
    -- Office visits (mapped to Phase 2 visit_types)
    ('svc-001', 'office_visit_new',           'New patient office visit',           'professional_services', 35000, 1, 'new_patient_complex',                  10, strftime('%s','now')*1000, strftime('%s','now')*1000),
    ('svc-002', 'office_visit_standard',      'New patient office visit (standard)','professional_services', 25000, 1, 'new_patient_standard',                 11, strftime('%s','now')*1000, strftime('%s','now')*1000),
    ('svc-003', 'office_visit_followup',      'Established patient follow-up',      'professional_services', 15000, 1, 'routine_followup',                     12, strftime('%s','now')*1000, strftime('%s','now')*1000),
    ('svc-004', 'pelvic_pain_complex',        'Complex pelvic pain evaluation',     'professional_services', 30000, 1, 'complex_pelvic_pain_evaluation',       13, strftime('%s','now')*1000, strftime('%s','now')*1000),
    ('svc-005', 'pelvic_pain_followup',       'Pelvic pain follow-up',              'professional_services', 18000, 1, 'complex_pelvic_pain_followup',         14, strftime('%s','now')*1000, strftime('%s','now')*1000),
    ('svc-006', 'aub_evaluation',             'Heavy bleeding evaluation',          'professional_services', 18000, 1, 'aub_evaluation',                       15, strftime('%s','now')*1000, strftime('%s','now')*1000),
    ('svc-007', 'preop_visit',                'Pre-operative visit',                'professional_services', 18000, 1, 'preop_visit',                          16, strftime('%s','now')*1000, strftime('%s','now')*1000),
    ('svc-008', 'postop_early',               'Early post-op visit',                'professional_services', 10000, 1, 'postop_early',                         17, strftime('%s','now')*1000, strftime('%s','now')*1000),
    ('svc-009', 'postop_late',                'Late post-op visit',                 'professional_services', 18000, 1, 'postop_late',                          18, strftime('%s','now')*1000, strftime('%s','now')*1000),
    ('svc-010', 'annual_exam',                'Annual gyn exam',                    'professional_services', 25000, 1, 'annual_exam',                          19, strftime('%s','now')*1000, strftime('%s','now')*1000),
    ('svc-011', 'telehealth_consult',         'Telehealth consultation',            'professional_services', 18000, 1, 'telehealth_consult',                   20, strftime('%s','now')*1000, strftime('%s','now')*1000),

    -- Office procedures
    ('svc-101', 'omt_treatment',              'OMT treatment session',              'professional_services', 18000, 1, 'omt_treatment',                        30, strftime('%s','now')*1000, strftime('%s','now')*1000),
    ('svc-102', 'office_procedure',           'Office procedure (EMB / IUD / etc.)','professional_services', 30000, 1, 'office_procedure',                     31, strftime('%s','now')*1000, strftime('%s','now')*1000),

    -- Other charges
    ('svc-201', 'no_show_fee',                'No-show / late cancellation fee',    'other_income',           5000, 0, NULL,                                   80, strftime('%s','now')*1000, strftime('%s','now')*1000),
    ('svc-202', 'records_release',            'Medical records release fee',        'other_income',           2500, 0, NULL,                                   81, strftime('%s','now')*1000, strftime('%s','now')*1000),
    ('svc-203', 'forms_completion',           'Form / letter completion',           'other_income',           5000, 0, NULL,                                   82, strftime('%s','now')*1000, strftime('%s','now')*1000);
