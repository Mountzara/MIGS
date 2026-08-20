# MountZaraMedicalTranscription → mountzara.com
## Integration contract + what must improve before production

**Audience:** the Claude session working in
`/Users/beans/Developer/MountZara/MountZaraMedicalTranscription`.
**Written:** 2026-08-19, by the session that owns the mountzara.com platform.
**Status of the platform side:** every endpoint below is live and was
exercised request-by-request against production today. If a call fails,
assume the app's payload, not the server — then read §6.

---

## 0. The one thing to understand first

The app is no longer a standalone dictation tool. It is the **input stage
of a patient-facing platform**. Everything it emits now lands somewhere a
patient or a payer eventually sees:

| The app emits | Where it ends up | Who reads it |
|---|---|---|
| the note | `encounters`, encrypted | Dr. Mabini |
| `patient_visible_summary` | the portal, after his approval | **the patient** |
| coding analysis | `/admin/billing/` claims queue | Dr. Mabini, then a payer |
| dictated orders | the orders board, with a result clock | Dr. Mabini, and the safety net |
| snapshot | the patient's case view | Dr. Mabini |

That changes the quality bar. A note that is merely "good enough to
remind him what happened" is no longer good enough, because two of those
rows are read by someone who was not in the room.

---

## 1. Credentials

```
Base URL:  https://mountzara.com/api/v1/sync/transcription
Header:    Authorization: Bearer mztx_Poi0w8iqiwuGYPjOJi7aYEu8eT5922
```

Store both in the app's existing
`~/Library/Application Support/MedicalTranscription/config.json` as
`syncBaseURL` / `syncToken` (Keychain for the token if the app already has
a Keychain helper). Today the app has neither key in that file.

Verify from the Mac before touching Swift:

```bash
T="mztx_Poi0w8iqiwuGYPjOJi7aYEu8eT5922"
B="https://mountzara.com/api/v1/sync/transcription"
curl -s -o /dev/null -w "auth %{http_code} (want 200)\n" -H "Authorization: Bearer $T" "$B/patients"
```

---

## 2. The endpoints, exactly

### 2.1 `GET /patients[?since=<ms>]`
Patients whose context changed. Rows carry `patient_id`, `first_name`,
`last_name`, `date_of_birth`, `dirty_reason`, `updated_at`.
Call at launch and every ~15 min. **Match local patients to
`patient_id` on name + DOB and store it. Ask the user to confirm an
ambiguous match; never guess silently.**

### 2.2 `GET /patients/<id>/context`
Returns `{ ok, context: { patient, intake, active_triage,
prior_encounters, current_snapshot, recent_claims,
symptom_diary_recent_90d } }`.

**Use this to seed the note before the visit.** The 19-section intake,
the triage decision and the prior encounters are already there. A note
that re-asks what the intake already answered is the most visible way
the app can look worse than the platform it feeds.

### 2.3 `POST /notes` — on every saved note
```jsonc
{
  "patient_id": "…",                      // required, from §2.1
  "transcription_session_id": "…",        // required, a UUID per encounter
  "visit_date": "2026-08-19",             // required, YYYY-MM-DD
  "note_body": "S: … O: … A: … P: …",     // required, ≤200 KB
  "visit_type_actual": "routine_followup",// SEE §3.2 — must be a catalog key
  "chief_complaint": "…",
  "patient_visible_summary": "…",         // SEE §3.1 — currently never sent
  "clinician_full_summary": "…",
  "plan_summary": "…", "next_step_summary": "…",
  "medications_list": ["…"],
  "icd10_codes": ["N92.0"], "cpt_codes": ["…"],
  "note_pdf_base64": "…",                 // optional, ≤5 MB
  "ai_model": "…", "ai_prompt_version": "…"
}
```
→ `201 { ok, encounter_id, ai_summary_id, auto_drafted }`.
Persist `encounter_id` locally.

**Retries are safe.** Idempotent on `(patient_id,
transcription_session_id)` *by content*:
* identical repeat → `200 { ok:true, duplicate:true, encounter_id }` —
  treat as success, nothing was written twice;
* different note, same session id → `409
  duplicate_session_different_content` — push the revision under a new
  session id.

So the offline queue needs no special-casing: **retry until 2xx.**

### 2.4 `POST /coding` — after the coding pass
```jsonc
{ "patient_id":"…", "encounter_id":"…", "source_session_id":"…",
  "visit_date":"2026-08-19", "visit_type":"routine_followup",
  "em": { "code":"99214", "mdm_level":"moderate", "wRVU":1.92, "confidence":0.86 },
  "diagnoses": [ { "icd10":"N92.0", "description":"…", "primary":true } ],
  "procedures": [ … ], "totals": { "total_wrvu":1.92, "expected_collection_cents":15000 },
  "compliance": [ … ], "upcoding_opportunities": [ … ],
  "documentation_suggestions": [ … ], "ai_meta": { … } }
```
→ response includes `diagnoses_inserted`, **`diagnoses_dropped`**,
**`warning`**, `expected_collection_cents`, `expected_priced_from`.

**Never ignore `warning`.** A claim whose diagnoses were dropped is a
guaranteed payer rejection discovered weeks later. Surface it in the app.

### 2.5 `POST /orders` — orders spoken during the visit
```jsonc
{ "patient_id":"…", "transcription_session_id":"…", "dry_run": true,
  "orders": [ { "order_type":"lab|imaging|referral", "priority":"routine|urgent|stat",
                "indication":"…", "icd10":["N92.0"],
                "tests":[{"name":"CBC","code":"85025"}],
                "modality":"…", "specialty":"…", "consult_question":"…",
                "facility_name":"…" } ] }
```
**Always `dry_run: true` first**, show the physician what would be
created, then repeat without it on confirm. Dictation mishears; a
tracked clinical order must never be where that first surfaces.
Rejected orders come back with exactly which fields are missing — show
that, do not silently drop them.

Each committed order starts a **result-tracking clock**. If nothing comes
back by the expected date it appears on his overdue board and emails the
practice. This is the single highest-value thing the app can feed.

### 2.6 `POST /snapshot`
`{ patient_id, clinical_overview, chief_complaint, cc_history?,
ai_recommendations?, action_items?: [{description,status}], ai_meta? }`
Versioned, never overwritten. **Do not re-push an unchanged snapshot** —
it creates version churn with no new information.

---

## 3. What the app is NOT sending, and why each matters

Observed in production data on 2026-08-19, from real app pushes
(`User-Agent: MountZaraTranscription/1.0`).

### 3.1 `patient_visible_summary` — never sent, on any push
This is the biggest gap. **The after-visit summary is the product** as
far as the patient is concerned; it is the only clinical artefact she
ever reads.

Because the app sends none, the platform now drafts one by lifting the
note's Assessment and Plan **verbatim**, which is honest but blunt: the
patient reads *"Abnormal uterine bleeding with suspected leiomyoma"*
unless he rewrites it. The app already has the note, the plan and the
patient's own words from the visit — it is far better positioned to
write this than a server-side text extraction.

**Send the recap the app already generates.** Requirements in §4.2.

### 3.2 `visit_type_actual` is free text
Observed values: `"Problem Visit"`, `"endo_pain_evaluation"`,
`"new_patient_telehealth"`, and `null`. The practice's service catalog is
keyed by slug, so free text prices nothing — **every claim the app synced
landed at $0** until an alias layer was written to rescue it.

Send one of these exactly:
```
new_patient_complex   new_patient_standard   routine_followup
complex_pelvic_pain_evaluation   complex_pelvic_pain_followup
aub_evaluation   preop_visit   postop_early   postop_late
annual_exam   telehealth_consult   omt_treatment   office_procedure
```

### 3.3 `totals.expected_collection_cents` — never sent
Left every claim at $0. Now inferred from the catalog by visit type, but
that is the practice's **cash** price and is only sound while every
patient is self-pay. Send the real figure when the app knows it.

### 3.4 One claim arrived with **zero diagnoses**
A claim with no diagnosis code is unbillable. The E/M code and wRVU were
present; the diagnoses array was empty. Whatever produced that must fail
loudly in-app rather than sync a claim that cannot be submitted.

### 3.5 One encounter arrived with **nothing usable**
No chief complaint, no visit type, no ICD codes, and a note body with no
recognisable Assessment or Plan — the platform's drafter correctly
refused it (*"a draft assembled from fragments would be worse than
none"*). **The app should not be able to sync an encounter in that
state.** Block it locally with a clear message.

### 3.6 Present in the app, not mapped into the payload
`cpt_codes`, `procedures`, `compliance`, `upcoding_opportunities`,
`documentation_suggestions`, `note_pdf_base64`.

**Corrected:** the app session confirms `compliance` and
`upcoding_opportunities` already exist in `CodingAnalysis` and simply are
not mapped into the sync body. So this is a serialisation gap, not a
missing feature — my earlier phrasing ("sending zero flags means the
check is not running") was wrong. Mapping them across is a small change
with immediate value: the platform's compliance-flag queue and upcoding
review are built, wired into the claim approval gate, and currently
empty. A claim with unresolved error-severity flags is blocked from
approval, so those flags do real work the moment they arrive.

---

## 4. The content quality bar

This is the part the owner is unhappy about, and it is separate from
plumbing. Plumbing is done. **Content is not production-ready.**

### 4.1 The clinical note
* Every note must parse as **S / O / A / P**. One in eight did not.
* The Assessment must be an assessment — a named clinical impression —
  not a restatement of the complaint.
* The Plan must be **specific and actionable**: what test, what
  medication with dose, what interval, what follow-up. "Discussed
  options" is not a plan.
* Anything ambiguous in the dictation must be marked, not smoothed over.
  A note that silently guesses is worse than one that flags uncertainty:
  the platform's own clinician summary ends with an `UNCERTAIN:` line for
  exactly this reason. Adopt that convention.
* No invented findings. If the physical exam was deferred, the note says
  deferred — it does not describe a normal exam that never happened.

### 4.2 The patient-visible summary (the AVS)
Written for a frightened, non-medical adult reading it alone at 11pm.

* **Second person, plain language.** Explain any medical word the first
  time it appears, or do not use it. The platform flags terms a patient
  would have to look up (`leiomyoma → fibroid`, `ferritin → iron stores
  blood test`); aim for zero flags.
* Structure: **What we talked about · The plan · Your medicines · What
  happens next.** Short paragraphs.
* **Contains only what is in the note.** No reassurance, advice or
  clinical fact that was not said in the room. This is not a style
  preference — it is what makes it safe for him to approve quickly.
* **Never promises an outcome**, never minimises what she raised, never
  speculates about what a symptom "could be".
* Where the note records uncertainty, say so: *"we do not know yet"* is a
  real and useful sentence for a patient.
* State follow-up **with its timing**.
* If the patient's `preferred_language` is not English, the platform can
  render it in her language with an English copy for his review — send
  the English and let the platform handle the pair, or send both.

**Do not attach patient education.** The platform does that from the
visit's ICD-10 codes using Dr. Mabini's own ACOG-anchored primers, with
the reason shown in her words. The app supplying its own education text
would bypass the curated library, which is a hard rule on this project:
clinical content comes from his library, never from a model's general
knowledge.

### 4.3 The coding analysis
* Diagnoses must be present, coded, and **sequenced** — primary first.
* The E/M level must be defensible from the documentation, with the MDM
  basis stated. `confidence` is already sent; keep it honest.
* Compliance flags and documentation gaps already exist in
  `CodingAnalysis` — map them into the payload. The platform blocks
  approval of a claim carrying unresolved error-severity flags, so they
  are load-bearing the moment they arrive.
* Never upcode. The platform screens for it and the practice's
  double-dip guard refuses membership-covered services on claims.

### 4.4 Encounters arrive in pairs — layer not yet identified
**Corrected 2026-08-19 after the app session pushed back, and they were
right to.** My first reading ("a sync loop") was wrong. The data:

```
22:13:13  sid=B4D38E26…  sha=bec1bb12
22:13:22  sid=4255C6B2…  sha=23550a34     ← 9s later, DIFFERENT content
22:19:36  sid=3D70EB29…  sha=741c508e
22:19:44  sid=E75F9013…  sha=95328068     ← 8s later, DIFFERENT content
22:21:55  sid=A463FAEC…  sha=2ffc7573
22:22:03  sid=95750C75…  sha=2e15c161     ← 8s later, DIFFERENT content
```

Three runs, each producing **two** encounters 8–9 seconds apart, each
with a distinct session id **and a distinct note hash**. So this is not
a retry (sync is idempotent per session id, and identical content
returns `200 duplicate:true` without writing twice) and not identical
content re-sent. Two genuinely different notes are being created per
run.

That is either two local encounters per visit, or a test harness pushing
twice — **only the app side can tell, and it should confirm before
either layer "fixes" it.** The platform cannot distinguish them, because
each note is legitimately distinct.

It still matters clinically: two encounters for one visit means two
claims for one visit. The platform now flags this rather than
accumulating silently — see §7.

---

## 4.5 Validate against REAL notes before syncing them

Everything tested so far used synthetic notes, which proves the plumbing
and nothing about whether the practice's own dictation survives it. The
app holds ~23 real encounters locally that have never been through this
rail.

`POST /notes` accepts **`"dry_run": true`**. It parses the note, shows
the draft that would be produced, names the jargon a patient would meet,
lists the education that would attach — and **stores nothing**.

```jsonc
// response
{ "ok": true, "dry_run": true, "wrote_nothing": true,
  "parsed_sections": ["subjective","objective","assessment","plan"],
  "would_draft_summary": true, "draft_source": "note_extract",
  "draft_preview": "What we talked about\nYou came in about …",
  "jargon_a_patient_would_look_up": ["menorrhagia → heavy periods", …],
  "education_that_would_attach": ["Endometriosis — what it is …", …],
  "warnings": [] }
```

**Run every real note through this first and read the `warnings`.** The
ones that matter:
* *no Assessment section found* — no summary can be drafted from it;
* *no icd10_codes sent* — no patient education can be matched to the
  visit;
* a long `jargon_a_patient_would_look_up` list — the summary is written
  in clinician language and the patient will need a dictionary.

That single pass over the existing 23 encounters will tell both sides
more about production readiness than any amount of synthetic testing.

---

## 5. Suggested build order

1. **Send `patient_visible_summary`** to §4.2 quality. Highest value:
   it is what the patient reads.
2. **Use the catalog `visit_type` keys** (§3.2) and send
   `expected_collection_cents`.
3. **Block syncing an unusable encounter** (§3.5) and a claim with no
   diagnoses (§3.4).
4. **Wire `POST /orders`** with the dry-run → confirm flow. Dictated
   orders become tracked orders with an overdue clock — this is the
   feature that prevents a missed result.
5. Seed notes from `GET /patients/<id>/context` (§2.2).
6. Send compliance flags, CPT/procedures, and the note PDF.

---

## 6. When something fails

* `401` — token wrong or missing. Verify with the curl in §1.
* `404 patient_not_found` — the app used a local id, not the platform
  `patient_id` from §2.1.
* `409 duplicate_session_different_content` — a different note under a
  used session id; push under a new one.
* `413` — note over 200 KB, summary over 16 KB, PDF over 5 MB.
* `422` on a draft — the note had no recognisable Assessment or Plan.
* Anything else — capture the request body and the response and hand
  them to the platform session; the server-side contract is
  `docs/transcription-app-integration.md` in the MIGS repo.

**Definition of done for this integration:** a real visit is dictated,
the note syncs, its coded claim shows a real dollar figure in the billing
queue, dictated orders appear on the orders board with their clocks
running, and the patient reads a summary in plain language with the right
education attached — without anyone re-typing anything.
