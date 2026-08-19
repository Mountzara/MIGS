# MedicalTranscription.app ↔ mountzara.com — the integration contract

Written 2026-08-19, after end-to-end verification of every rail below
against production. Three defects that had silently broken the seam were
found and fixed in the same pass (§ History), so this document describes
what is PROVEN to work, not what was intended to.

## Credentials

* Base URL: `https://mountzara.com/api/v1/sync/transcription`
* Auth header on every request: `Authorization: Bearer <token>`
* The token lives in `~/.config/mountzara/transcription-sync-token.txt`
  on the operations machine, and as the `TRANSCRIPTION_SYNC_TOKEN` Pages
  secret on the server. Rotated 2026-08-19 (the previous value had never
  been used by anything).

## The visit loop, in order

1. **App launch / periodic** — `GET /patients[?since=<ms>]`
   Patients whose context changed since the last pull. Each row carries
   `patient_id`, names, DOB, `dirty_reason`, timestamps.

2. **Before the visit** — `GET /patients/<id>/context`
   Everything needed to seed a SOAP encounter: `patient` demographics,
   `intake` (19 sections), `active_triage`, `prior_encounters`,
   `current_snapshot`, `recent_claims`, `symptom_diary_recent_90d`.

3. **Note saved** — `POST /notes`
   `{ patient_id, transcription_session_id, visit_date, note_body,
      visit_type_actual?, chief_complaint?, patient_visible_summary?,
      clinician_full_summary?, plan_summary?, next_step_summary?,
      medications_list?, note_pdf_base64?, ai_model?, ai_prompt_version? }`
   → the note is envelope-encrypted, an `encounters` row links it, and a
   `patient_visible_summary` becomes a portal-visible after-visit summary
   **once Dr. Mabini approves it** in /admin/visits/. Nothing reaches the
   patient unreviewed.

4. **Coding analysis** — `POST /coding`
   `{ patient_id, encounter_id?, source_session_id, visit_date,
      em:{code,mdm_level,wRVU,confidence}, diagnoses:[{icd10|code|icd10_code,
      description,...}], procedures?, totals?, compliance?,
      upcoding_opportunities?, documentation_suggestions?, ai_meta? }`
   → a `pending_review` claim in /admin/billing/. The response reports
   `diagnoses_dropped` and a `warning` whenever a row was not stored —
   check it; a claim with no diagnoses is a guaranteed payer rejection.

5. **Dictated orders** — `POST /orders`   *(new 2026-08-19)*
   `{ patient_id, transcription_session_id?, dry_run?, orders:[
      { order_type: lab|imaging|referral, priority?, indication, icd10:[...],
        tests:[{name,code?}], modality?, specialty?, consult_question?,
        facility_name? } ] }`
   Call once with `dry_run:true`, show the physician what would be
   created, then commit. Each order lands with its result-tracking clock
   already running, feeding the overdue sweep and the orders board.
   Invalid orders are REPORTED with what is missing, never guessed at.

6. **Cross-encounter intelligence** — `POST /snapshot`
   Versioned; never overwrites. Renders at /admin/cases/<id>/snapshot.

## Verifying from the Mac

    TRANSCRIPTION_SYNC_TOKEN=<token> ./scripts/transcription_smoke.sh

Five checks, read-only plus one dry-run. All PASS means any remaining
problem is inside the app's own configuration.

The admin setup checklist (/admin/) shows "Connect the Medical
Transcription app" until a real (non-test) encounter has synced, and
flips on evidence, not on configuration.

## History — why this document exists

The seam looked wired for three months and had never worked once:

1. `syncRoute` never passed route `params` through, so
   `GET /patients/<id>/context` returned 400 on every call it ever
   received. Every handler looked correct in isolation.
2. `/coding` silently dropped any diagnosis whose code field was not one
   of two exact spellings, while still returning `ok:true` — a claim
   with no diagnoses, invisibly. It now accepts `icd10` too and reports
   `diagnoses_dropped` loudly.
3. The app's summaries were sealed with one AAD convention and read with
   another, so an approved after-visit summary was marked visible and
   was permanently undecryptable — the patient got an error. Both
   readers now try both conventions (safe: AAD is authenticated data;
   the wrong string fails closed).

The lesson is standing policy: a rail is not "integrated" until data has
made the round trip in production and been read back by the person it
was for.
