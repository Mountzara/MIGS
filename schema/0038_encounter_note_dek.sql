-- =====================================================================
-- 0038_encounter_note_dek.sql — store the key the encounter note is
-- encrypted with
-- =====================================================================
-- THE NOTE WAS BEING THROWN AWAY AT THE MOMENT IT WAS SAVED.
--
-- `putPhiObject` generates a per-record DEK, encrypts with it, wraps the
-- DEK under PHI_MASTER_KEY, and RETURNS the wrapped DEK for the caller to
-- persist. R2 custom metadata carries the IVs and the AAD, but
-- deliberately NOT the wrapped DEK — `getPhiObject` documents that it will
-- not trust R2 metadata for key material, by design.
--
-- All three encounter writers dropped it:
--
--   sync/transcription/notes.js   captured `notePut` and never used
--                                 `.wrapped_dek`; the PDF put was not even
--                                 assigned to a variable
--   sync/surgical/cases.js        same, for the operative note
--   sync/ios/encounters.js        `await putPhiObject(...)` with no
--                                 assignment at all
--
-- `encounters` had nowhere to put it either — no DEK column has ever
-- existed on the table. So the key was generated, used once, and garbage
-- collected. The ciphertext in R2 is unreadable by anything, forever.
--
-- Downstream, both readers passed `null` for the DEK *and* `null` for the
-- AAD (admin/encounters/[id]/summary.js and sync/ai-bridge). That hid the
-- problem: with a null AAD, getPhiObject skips its AAD check, so the call
-- failed on the missing key rather than on the mismatch, and the visit
-- summary generator reported a decrypt failure that read like a transient
-- error instead of permanent data loss.
--
-- AAD is stored too, rather than recomputed, because the three writers
-- already use three different strings — `encounter/<id>/note` for
-- transcription and iOS but `encounter/<id>/op_note` for surgical — and a
-- reader that reconstructs the wrong one gets an AAD-mismatch throw.
--
-- EXISTING ROWS ARE NOT RECOVERABLE. Four encounters exist, all seed
-- records for the "Jane Doe" test patient; no real note was lost. They are
-- marked so the UI can say "this note cannot be decrypted" instead of
-- rendering an empty visit.
-- =====================================================================

ALTER TABLE encounters ADD COLUMN note_wrapped_dek TEXT;
ALTER TABLE encounters ADD COLUMN note_pdf_wrapped_dek TEXT;
ALTER TABLE encounters ADD COLUMN note_aad TEXT;
ALTER TABLE encounters ADD COLUMN note_pdf_aad TEXT;

-- Every note written before this migration has no key. Recording that as
-- data means a reader can distinguish "no note" from "note we cannot
-- open", which are very different things to show a clinician.
ALTER TABLE encounters ADD COLUMN note_key_lost INTEGER NOT NULL DEFAULT 0;

UPDATE encounters
   SET note_key_lost = 1
 WHERE note_r2_key IS NOT NULL
   AND note_wrapped_dek IS NULL;
