-- ====================================================================
-- 0033_clearinghouse_documents.sql
-- Upload a practice document, get the fields filled in (2026-08-13)
-- ====================================================================
-- WHY
-- Every number the enrollment wizard asks for already exists on paper the
-- physician owns: a W-9, a CMS-855 approval, a PTAN letter, a Medicaid
-- welcome packet. Retyping them into a dozen boxes is where the typos come
-- from, and a typo here is not a small thing -- a legal name that does not
-- match the IRS record, or an NPI with two digits swapped, comes back as a
-- rejected EDI enrollment weeks later with no explanation.
--
-- So the wizard reads the document instead.
--
-- WHAT THIS IS NOT
-- This is NOT the patient-correspondence pipeline (schema 0031 +
-- _lib/correspondence_extract.js). That one Safe-Harbor scrubs its input
-- before any model sees it. This one deliberately does not, because the
-- identifiers ARE what it is reading. The two are kept apart on purpose,
-- and _lib/enrollment_extract.js refuses admission -- BEFORE any model
-- call -- to anything carrying an MRN, a member ID or clinical language.
--
-- ENCRYPTION
-- A W-9 carries an EIN or, for a sole proprietor, an SSN. The file itself
-- therefore lives in R2 under the same envelope encryption as PHI
-- (_lib/phi.js): ciphertext there, key material here. D1 keeps only
-- metadata and the extraction OUTCOME -- never the document text, which
-- would put the tax ID back into a database column in plaintext.
--
-- PROPOSALS, NOT WRITES
-- extracted_json holds PROPOSED values with the verbatim quote each came
-- from. Nothing reaches clearinghouse_profile until the physician accepts
-- it field by field. accepted_json records what he took, so "where did
-- this number come from" stays answerable a year from now.
-- ====================================================================

CREATE TABLE IF NOT EXISTS clearinghouse_documents (
    id                TEXT PRIMARY KEY,
    doc_type          TEXT NOT NULL,          -- 'w9' | 'cms855' | 'ptan' | ...
    filename          TEXT,
    content_type      TEXT,
    byte_size         INTEGER,

    -- Ciphertext in R2, key material here -- same split as `messages`.
    r2_key            TEXT,
    dek_wrapped       TEXT,

    -- Extraction outcome. NEVER the document text itself.
    status            TEXT NOT NULL DEFAULT 'uploaded'
                      CHECK (status IN ('uploaded','queued','extracted','failed','rejected')),
    route             TEXT,                   -- 'api' | 'bridge'
    ai_job_id         TEXT,                   -- when queued to the CLI bridge
    prompt_version    TEXT,
    extracted_json    TEXT,                   -- {field: {value, quote, confidence}}
    rejected_json     TEXT,                   -- fields dropped, and why
    notes_json        TEXT,
    accepted_json     TEXT,                   -- which proposals the physician took
    error             TEXT,

    uploaded_at       TEXT NOT NULL,
    uploaded_by       TEXT,
    extracted_at      TEXT,
    accepted_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_ch_docs_status ON clearinghouse_documents (status, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_ch_docs_type   ON clearinghouse_documents (doc_type, uploaded_at DESC);

-- Autosave. The wizard writes a draft on every field blur so a closed tab
-- never costs the physician a screen of retyping, but a draft is NOT the
-- saved profile -- it may be half-finished or fail validation, and
-- promoting it silently would let an invalid NPI reach an application.
-- Kept separate, applied only when he saves.
CREATE TABLE IF NOT EXISTS clearinghouse_profile_draft (
    id           TEXT PRIMARY KEY DEFAULT 'default',
    draft_json   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    updated_by   TEXT
);
