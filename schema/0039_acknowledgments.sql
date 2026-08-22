-- =====================================================================
-- 0039_acknowledgments.sql — durable record of legal acknowledgments
-- =====================================================================
-- WHY. Two acknowledgments are legally load-bearing and neither was
-- recorded anywhere:
--
--   * HIPAA (45 CFR 164.520(c)) requires a direct-treatment provider to
--     make a GOOD-FAITH EFFORT to obtain the patient's written
--     acknowledgment of receipt of the Notice of Privacy Practices, and
--     to DOCUMENT the effort. An acknowledgment that leaves no record is
--     legally the same as never having asked.
--   * Illinois (225 ILCS 150) and California (Bus. & Prof. Code §2290.5)
--     both provide for telehealth consent DOCUMENTED in the record.
--
-- The row is the document. It records WHICH version of the document was
-- acknowledged (the effective date), because "the patient agreed" is
-- meaningless without "agreed to what" — an NPP revision resets nothing
-- retroactively, but a dispute will ask what text was in force that day.
--
-- ip_hash, not ip: enough to corroborate "this happened from the
-- patient's session" without storing raw addresses for years. Same
-- SHA-256+salt posture as session_trace (§ SYSTEM_MAP).
-- =====================================================================

CREATE TABLE IF NOT EXISTS patient_acknowledgments (
    id              TEXT PRIMARY KEY,
    patient_id      TEXT NOT NULL,
    doc_key         TEXT NOT NULL,      -- 'npp' | 'terms' | 'telehealth_consent'
    doc_version     TEXT NOT NULL,      -- the document's effective date, e.g. '2026-08-14'
    acknowledged_at INTEGER NOT NULL,   -- ms epoch
    ip_hash         TEXT,
    user_agent      TEXT
);
CREATE INDEX IF NOT EXISTS idx_ack_patient_doc
    ON patient_acknowledgments(patient_id, doc_key, acknowledged_at DESC);
