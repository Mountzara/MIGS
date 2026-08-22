-- =====================================================================
-- 0040_orders_results_gfe.sql — the downstream-of-the-visit safety net
-- =====================================================================
-- WHY. The practice can already see a patient, bill the visit and submit
-- a claim. What it could not do was the part that actually generates
-- malpractice exposure for an independent telehealth practice: place a
-- lab or imaging order, KNOW that a result never came back, prove the
-- patient was told, and show that a referral went somewhere the patient's
-- plan would cover.
--
-- Missed/mishandled results are one of the most common outpatient
-- negligence claims, and the failure mode is silence: an order is placed,
-- nothing returns, and no system anywhere says so. `clinical_orders`
-- exists so that silence is a QUERYABLE STATE (result_due_at in the past,
-- resulted_at NULL) rather than something that depends on remembering.
--
-- Four ideas, deliberately separated:
--   clinical_orders       the order and where it stands
--   order_results         what came back, and whether it was acknowledged
--                         AND communicated (two different duties)
--   order_events          append-only lifecycle trail (who did what, when)
--   prior_authorizations  the payer gate that blocks advanced imaging
--
-- Plus the two money-side obligations that are legal, not optional:
--   referral_directory    who we refer to and which networks they take,
--                         so an HMO patient is not sent out of network
--   good_faith_estimates  No Surprises Act (45 CFR 149.610) written
--   gfe_line_items        estimate for self-pay/uninsured patients
--
-- PHI POSTURE: narrative lives in the encrypted document store, not here.
-- These tables hold the STATE that has to be queryable — codes, statuses,
-- timestamps — plus short clinician-entered summaries that the practice
-- needs at a glance. No free-text patient story.
-- =====================================================================

CREATE TABLE IF NOT EXISTS clinical_orders (
    id                  TEXT PRIMARY KEY,
    patient_id          TEXT NOT NULL,
    clinician_id        TEXT,
    encounter_id        TEXT,
    -- lab | imaging | referral. One table because the lifecycle and the
    -- thing that goes wrong (no result / no report / no consult note) is
    -- identical across all three.
    order_type          TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'draft',
    priority            TEXT NOT NULL DEFAULT 'routine',

    -- What was ordered. tests_json: [{code, name}]. For imaging, modality
    -- + body_site. For a referral, the specialty and the consult question.
    tests_json          TEXT,
    modality            TEXT,
    body_site           TEXT,
    specialty           TEXT,
    consult_question    TEXT,

    -- Why. An order without an indication is not billable by the
    -- performing facility and not defensible in a record.
    indication          TEXT,
    icd10_json          TEXT,

    -- Where it was sent. referral_target_id points at referral_directory.
    facility_name       TEXT,
    facility_phone      TEXT,
    facility_fax        TEXT,
    referral_target_id  TEXT,
    result_routing      TEXT DEFAULT 'portal',

    -- The tracking clock. result_due_at is what makes "nothing came back"
    -- a query instead of a memory.
    placed_at           INTEGER,
    result_due_at       INTEGER,
    overdue_notified_at INTEGER,
    resulted_at         INTEGER,
    reviewed_at         INTEGER,
    reviewed_by         TEXT,
    review_note         TEXT,
    patient_notified_at INTEGER,

    prior_auth_status   TEXT DEFAULT 'unknown',
    cancelled_at        INTEGER,
    cancel_reason       TEXT,
    created_at          INTEGER NOT NULL,
    updated_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_patient ON clinical_orders(patient_id, created_at DESC);
-- The index that matters: the overdue sweep.
CREATE INDEX IF NOT EXISTS idx_orders_open    ON clinical_orders(status, result_due_at);

CREATE TABLE IF NOT EXISTS order_results (
    id                  TEXT PRIMARY KEY,
    order_id            TEXT NOT NULL,
    patient_id          TEXT NOT NULL,
    received_at         INTEGER NOT NULL,
    -- normal | abnormal | critical | incomplete. `critical` is not a
    -- severity label for the chart, it is a CLOCK: an unacknowledged
    -- critical result is the single most dangerous state in the system.
    result_status       TEXT NOT NULL DEFAULT 'normal',
    summary             TEXT,
    document_id         TEXT,
    -- Two duties, two timestamps, because clinicians confuse them and
    -- plaintiffs do not: seeing a result is not telling the patient.
    acknowledged_at     INTEGER,
    acknowledged_by     TEXT,
    patient_communicated_at INTEGER,
    communication_method    TEXT,
    communication_note      TEXT,
    created_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_results_order ON order_results(order_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_results_open  ON order_results(result_status, acknowledged_at);

CREATE TABLE IF NOT EXISTS order_events (
    id          TEXT PRIMARY KEY,
    order_id    TEXT NOT NULL,
    at          INTEGER NOT NULL,
    actor       TEXT,
    event       TEXT NOT NULL,
    detail      TEXT
);
CREATE INDEX IF NOT EXISTS idx_order_events ON order_events(order_id, at DESC);

CREATE TABLE IF NOT EXISTS prior_authorizations (
    id              TEXT PRIMARY KEY,
    order_id        TEXT,
    patient_id      TEXT NOT NULL,
    payer_name      TEXT,
    plan_type       TEXT,
    -- not_required | needed | submitted | approved | denied | expired
    status          TEXT NOT NULL DEFAULT 'needed',
    auth_number     TEXT,
    submitted_at    INTEGER,
    decision_at     INTEGER,
    valid_from      TEXT,
    valid_to        TEXT,
    units_approved  INTEGER,
    denial_reason   TEXT,
    notes           TEXT,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pa_order ON prior_authorizations(order_id);

CREATE TABLE IF NOT EXISTS referral_directory (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    org_name        TEXT,
    -- specialist | lab | imaging
    kind            TEXT NOT NULL DEFAULT 'specialist',
    specialty       TEXT,
    npi             TEXT,
    phone           TEXT,
    fax             TEXT,
    address         TEXT,
    city            TEXT,
    state           TEXT,
    zip             TEXT,
    -- The whole point of the directory: which networks this destination
    -- actually takes. ["Aetna","BCBS IL PPO"] — verified per row, never
    -- assumed, because a wrong entry sends an HMO patient to an
    -- uncovered specialist and the patient eats the bill.
    networks_json   TEXT,
    networks_verified_at TEXT,
    accepts_cash    INTEGER NOT NULL DEFAULT 0,
    cash_price_note TEXT,
    notes           TEXT,
    active          INTEGER NOT NULL DEFAULT 1,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_refdir_kind ON referral_directory(kind, active);

CREATE TABLE IF NOT EXISTS good_faith_estimates (
    id                  TEXT PRIMARY KEY,
    patient_id          TEXT NOT NULL,
    gfe_number          TEXT,
    -- draft | issued | superseded | void
    status              TEXT NOT NULL DEFAULT 'draft',
    -- The NSA clock: the deadline depends on how far out the service is
    -- from the date it was scheduled (or requested).
    trigger_kind        TEXT NOT NULL DEFAULT 'scheduled',
    scheduled_on        TEXT,
    service_date        TEXT,
    due_by              TEXT,
    issued_at           INTEGER,
    issued_by           TEXT,
    delivery_method     TEXT,
    primary_service     TEXT,
    diagnosis_json      TEXT,
    practice_total_cents INTEGER NOT NULL DEFAULT 0,
    separate_scheduling_note TEXT,
    disclaimer_version  TEXT,
    void_reason         TEXT,
    created_at          INTEGER NOT NULL,
    updated_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gfe_patient ON good_faith_estimates(patient_id, created_at DESC);

CREATE TABLE IF NOT EXISTS gfe_line_items (
    id              TEXT PRIMARY KEY,
    gfe_id          TEXT NOT NULL,
    -- practice | outside. The NSA requires items grouped by the provider
    -- or facility furnishing them, and a self-pay patient who thinks the
    -- quoted price includes the outside lab has been misled.
    kind            TEXT NOT NULL DEFAULT 'practice',
    description     TEXT NOT NULL,
    service_code    TEXT,
    code_type       TEXT DEFAULT 'CPT',
    diagnosis_code  TEXT,
    quantity        INTEGER NOT NULL DEFAULT 1,
    unit_cents      INTEGER NOT NULL DEFAULT 0,
    total_cents     INTEGER NOT NULL DEFAULT 0,
    provider_name   TEXT,
    provider_npi    TEXT,
    provider_tin    TEXT,
    provider_state  TEXT,
    note            TEXT,
    sort_order      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_gfe_lines ON gfe_line_items(gfe_id, sort_order);
