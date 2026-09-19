-- =====================================================================
-- 0037_documents_phi_aad.sql — record the AAD a document was sealed with
-- =====================================================================
-- Every object in `documents` is AES-GCM encrypted with additional
-- authenticated data. AAD is not a hint — decryption FAILS if it does not
-- match byte for byte. But the AAD was never stored: each writer chose its
-- own convention and every reader had to guess which one.
--
-- Four conventions exist in the codebase today:
--
--   documents:<patient_id>:<doc_id>      patient uploads      (patient/documents.js)
--   message_attachment/<attachment_id>   message attachments  (patient + admin attachments.js)
--   encounter/<encounter_id>/photo_<n>   intraop photos       (sync/surgical/cases.js)
--   encounter/<encounter_id>/ios_photo_<n>  iOS captures      (sync/ios/encounters.js)
--   clinical_ai/<session_id>/html|pdf    AI reports           (sync/clinical-ai/cases.js)
--
-- GET /api/v1/patient/documents/<id> assumed the FIRST one for every row.
-- The patient document list returns all kinds, so a member who tapped a
-- file they had sent in a message got HTTP 500 "could not retrieve file" —
-- their own attachment, undownloadable, with no way to tell it apart from
-- a genuinely corrupt object.
--
-- Storing the AAD makes the reader stop guessing, and means a new writer
-- with a new convention cannot break the reader again. NULL keeps the
-- historical default, so nothing that works today changes.
--
-- Idempotent-ish: D1 has no ADD COLUMN IF NOT EXISTS. Re-running raises
-- "duplicate column name", which is safe to ignore.
-- =====================================================================

ALTER TABLE documents ADD COLUMN phi_aad TEXT;

-- Backfill the one case that is recoverable from data we already hold:
-- message attachments, whose AAD is derived from the attachment row's id.
UPDATE documents
   SET phi_aad = (
        SELECT 'message_attachment/' || ma.id
          FROM message_attachments ma
         WHERE ma.document_id = documents.id
         LIMIT 1
   )
 WHERE kind = 'message_attachment'
   AND phi_aad IS NULL
   AND EXISTS (SELECT 1 FROM message_attachments ma WHERE ma.document_id = documents.id);

-- Everything else keeps NULL and therefore keeps the historical default
-- (`documents:<patient_id>:<doc_id>`), which is correct for patient
-- uploads and intake attachments — the rows a patient can actually reach.
