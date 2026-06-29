-- 0025_patient_insurance.sql — per-patient insurance for the billing pipeline
-- Closes the data-model gap: member id / group / subscriber / gender / billing
-- address that the 837 needs (and the scrubber blocks on). Entered once per
-- patient (front desk or patient self-service), then the submit endpoint
-- auto-populates the claim — zero per-claim manual entry.
-- Apply: npx wrangler d1 execute mountzara-clinical --remote --file=schema/0025_patient_insurance.sql

CREATE TABLE IF NOT EXISTS patient_insurance (
    id                    TEXT PRIMARY KEY,
    patient_id            TEXT NOT NULL,
    rank                  TEXT NOT NULL DEFAULT 'primary',   -- 'primary' | 'secondary'
    payer_id              TEXT,                              -- FK billing_payers.id
    member_id             TEXT,
    group_number          TEXT,
    relationship          TEXT NOT NULL DEFAULT 'self',      -- 'self' | 'spouse' | 'child' | 'other'
    subscriber_first_name TEXT,                              -- when relationship != self
    subscriber_last_name  TEXT,
    subscriber_dob        TEXT,                              -- ISO YYYY-MM-DD
    patient_gender        TEXT,                              -- 'M' | 'F' | 'U'
    address_line1         TEXT,
    address_city          TEXT,
    address_state         TEXT,
    address_zip           TEXT,
    active                INTEGER NOT NULL DEFAULT 1,
    created_at            INTEGER NOT NULL,
    updated_at            INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_patient_insurance_patient ON patient_insurance(patient_id, rank, active);
