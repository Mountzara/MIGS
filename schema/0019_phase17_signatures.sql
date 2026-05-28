-- ====================================================================
-- 0019_phase17_signatures.sql
-- Phase 17 follow-on — clinician e-signature for compliance documents
-- ====================================================================
-- Per the Mount Zara Telehealth Audit (R2 controlled-substance policy
-- + R3 licensure policy + R12 standard-of-care + R14 Doxy.me config +
-- R15 webside-manner standard) — every compliance policy document has
-- a signature page that Dr. Mabini must affirm before the document is
-- legally operational. This migration stores:
--
--   clinician_signatures — the stored signature PNG, envelope-encrypted
--                          in R2 mountzara-phi/signatures/<id>.png.enc.
--                          Multiple signatures may coexist (e.g. an old
--                          one retired in favor of a newer scan); only
--                          one is active per clinician at a time.
--
--   document_signatures   — one row per (document, signature, signing
--                          event). Persists the typed attestation +
--                          typed name + timestamp + a content_hash of
--                          the document body at the moment of signing,
--                          so future amendments to the document do not
--                          silently invalidate the signature.
--
-- Privacy posture: signature images are personal-identity material and
-- treated as PHI-adjacent. They live in mountzara-phi (envelope-
-- encrypted per _lib/phi.js). D1 carries only metadata + the wrapped
-- DEK + IVs. The signature image NEVER appears in plaintext outside
-- the decrypted-in-memory render path of the admin endpoint.
-- ====================================================================

CREATE TABLE IF NOT EXISTS clinician_signatures (
    id TEXT PRIMARY KEY,                  -- UUID-style id
    clinician_id TEXT NOT NULL,           -- e.g., 'mabini-christopher-z'
    display_name TEXT NOT NULL,           -- e.g., 'Chris Mabini, DO, FMIGS'
    r2_key TEXT NOT NULL,                 -- 'signatures/<id>.png.enc'
    wrapped_dek TEXT NOT NULL,            -- per _lib/phi.js
    iv_data TEXT NOT NULL,
    iv_dek TEXT NOT NULL,
    width_px INTEGER,                     -- image dimensions (informational)
    height_px INTEGER,
    bytes_size INTEGER NOT NULL,
    sha256_hex TEXT NOT NULL,             -- hash of the plaintext PNG bytes (integrity check)
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    retired_at TEXT,                      -- NULL while active; set when superseded
    uploaded_by_user_id TEXT,             -- admin user who uploaded
    notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_clinician_sig_clinician
    ON clinician_signatures(clinician_id);
CREATE INDEX IF NOT EXISTS idx_clinician_sig_active
    ON clinician_signatures(clinician_id, retired_at);

CREATE TABLE IF NOT EXISTS document_signatures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_slug TEXT NOT NULL,          -- e.g. 'controlled-substances', 'licensure'
    document_path TEXT NOT NULL,          -- e.g. 'docs/compliance/controlled-substances.md'
    document_sha256 TEXT NOT NULL,        -- hash of the doc body at signing time
    signature_id TEXT NOT NULL,           -- FK -> clinician_signatures.id
    signed_by_user_id TEXT NOT NULL,      -- admin user who signed
    signed_by_display_name TEXT NOT NULL, -- e.g. 'Chris Mabini, DO, FMIGS' (mirror of signature display_name at signing time)
    typed_attestation TEXT NOT NULL,      -- the verbatim attestation text the signer typed (or selected)
    typed_initials TEXT NOT NULL,         -- short e.g. 'CRM' typed as live-affirmation
    signed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ip_hash TEXT,                         -- per §10.4 session_trace pattern
    user_agent TEXT,
    next_review_date TEXT,                -- e.g. '2027-01-01' — surfaces on the admin dashboard
    superseded_at TEXT,                   -- set when the document is re-signed (annual renewal)
    superseded_by INTEGER,                -- FK -> document_signatures.id of the renewal
    notes TEXT,
    FOREIGN KEY (signature_id) REFERENCES clinician_signatures(id)
);
CREATE INDEX IF NOT EXISTS idx_doc_sig_doc
    ON document_signatures(document_slug);
CREATE INDEX IF NOT EXISTS idx_doc_sig_active
    ON document_signatures(document_slug, superseded_at);
CREATE INDEX IF NOT EXISTS idx_doc_sig_next_review
    ON document_signatures(next_review_date)
    WHERE superseded_at IS NULL;
