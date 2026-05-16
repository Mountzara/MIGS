-- =====================================================================
-- 0005_phase3_message_attachments.sql — secure-messaging attachments
-- =====================================================================
-- Per CLAUDE.md §11.5.1. Patient ↔ clinician messages already exist; the
-- bodies are envelope-encrypted in mountzara-phi. This migration adds a
-- join table linking individual messages to documents rows (which are
-- the canonical attachment store — same envelope encryption + sha256 +
-- mime + size as any other document).
--
-- Idempotent.
-- =====================================================================

CREATE TABLE IF NOT EXISTS message_attachments (
    id              TEXT PRIMARY KEY,
    message_id      TEXT NOT NULL,
    thread_id       TEXT NOT NULL,          -- denormalized for fast thread-scope lookup
    patient_id      TEXT NOT NULL,          -- denormalized for ownership scoping
    document_id     TEXT NOT NULL,          -- FK to documents.id
    filename        TEXT NOT NULL,
    mime_type       TEXT,
    size_bytes      INTEGER,
    created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_msg_att_message  ON message_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_msg_att_thread   ON message_attachments(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_msg_att_document ON message_attachments(document_id);

-- documents.kind enum gets a new value: 'message_attachment'. The CHECK
-- column doesn't exist on the documents table so we don't need to alter
-- a constraint; the column comment in 0001 already lists the allowed
-- values and we extend by usage.
