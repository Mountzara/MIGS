# Patient AI Snapshot Pipeline (Phase 9)

The continuous patient-record loop between mountzara.com (intake + portal +
clinician workspace) and the MountZara Transcription macOS app (SOAP +
coding + AI snapshot). The website is the canonical source of patient
identity and longitudinal data; the app is the canonical AI-clinical
intelligence engine. This pipeline is what wires them together so the
patient's information flows from the website into the app on encounter
start, and the app's AI snapshot flows back to the website's EMR-style
dashboard.

This document is the website-side runbook. The companion Swift-side
integration guide is at `docs/TRANSCRIPTION_APP_INTEGRATION.md`.

---

## 1. The three connections

```
                            ┌──────────────────┐
                            │   mountzara.com  │
   ┌────────── intake ─────▶│                  │
   │                        │  D1: patients,   │
   │                        │   intake_*,      │
   │                        │   symptom_diary, │
   │                        │   appointments,  │
   │                        │   encounters,    │
   │                        │   patient_       │
   │                        │   snapshots*     │
   │                        └────────┬─────────┘
   │                                 │
   │                  (1) GET patients?since=… (delta cursor)
   │                  (2) GET patients/:id/context (full bundle)
   │                                 │
   │                                 ▼
   │                        ┌──────────────────┐
   │                        │  Transcription   │
   │                        │  macOS app       │
   │                        │                  │
   │                        │  PatientIntel-   │
   │                        │  ligenceService  │
   │                        │  .generate-      │
   │                        │  ProgressSummary │
   │                        └────────┬─────────┘
   │                                 │
   │                  (3) POST /sync/transcription/snapshot
   │                                 │
   │                                 ▼
   │                        ┌──────────────────┐
   │                        │  D1:             │
   │                        │   patient_       │
   │                        │   snapshots +    │
   │                        │   children       │
   │                        └────────┬─────────┘
   │                                 │
   │                  GET /admin/snapshots/:patient_id
   │                                 │
   │                                 ▼
   │                        ┌──────────────────┐
   │                        │  /admin/cases/   │
   │                        │  <id>/snapshot/  │
   │                        │   EMR dashboard  │
   └────────────────────────│   SPA            │
                            └──────────────────┘
```

**Connection 1 (Website → App, list).** `GET /api/v1/sync/transcription/patients?since=<epoch-ms>`
returns the delta of patients whose context has materially changed since
`since`. Used as a cursor — the app records the last value it processed and
uses that as `since` on the next pull. Surfaces patients in two cases:
the patient row updated_at advanced (covers brand new patients) or the
`patient_dirty_flag` table has a row newer than `since` (covers
intake-submit, profile-update, symptom-log, anything we want the app to
re-pull).

**Connection 2 (Website → App, detail).** `GET /api/v1/sync/transcription/patients/:id/context`
returns the full bundle the app needs to start a new encounter
pre-populated:

- `patient` — demographics, contact, pronouns, DOB.
- `intake.sections` — every section of the most-recent submitted
  intake, JSON-parsed.
- `symptom_diary_recent_90d` — every logged entry in the last 90 days.
- `active_triage` — the most-recent appointment-triage row (visit type,
  urgency, secondary concerns).
- `prior_encounters` — last 40 by visit_date.
- `current_snapshot` — the version number + metadata of any AI snapshot
  already on file (so the app can decide whether to regenerate).
- `recent_claims` — last 10 billing claims for cross-check.

The GET also writes `patient_sync_state.last_pulled_at` and clears the
`patient_dirty_flag` — so once the app has pulled, that patient won't
re-surface in the `since` cursor until another change happens.

**Connection 3 (App → Website, push).** `POST /api/v1/sync/transcription/snapshot`
accepts a `PatientProgressSummary` JSON (verbatim mapped from the Swift
struct of the same name in
`Sources/MedicalTranscriptionKit/Models/PatientProgressSummary.swift`).
It appends a new `patient_snapshots` row, archives the prior `is_current=1`
row, inserts every child entity (problem list, diagnostic trends,
imaging measurements, timeline events, action items), updates
`patient_sync_state.last_pushed_at`, prunes versions beyond 50, and
writes both the HIPAA `audit_log` and a billing-style audit trail.

---

## 2. Schema

`schema/0007_phase9_snapshots.sql`. Eight tables:

| Table | Purpose |
|---|---|
| `patient_snapshots` | One row per generated AI snapshot. Versioned. `is_current=1` for the latest per patient. |
| `snapshot_problem_list` | Structured problem rows (problem / status / last_visit_plan). Mirrors Swift `ClinicalProblem`. |
| `snapshot_diagnostic_trends` | Labs/imaging/procedures with trend summary + entries JSON. Mirrors Swift `DiagnosticTrend`. |
| `snapshot_imaging_measurements` | Organ measurements with prior comparison. Mirrors Swift `ImagingMeasurement`. |
| `snapshot_timeline_events` | Chronological treatment timeline. Mirrors Swift `TimelineEvent`. |
| `snapshot_action_items` | AI-suggested next actions awaiting clinician triage. |
| `patient_sync_state` | Per-app bookkeeping — last_pulled_at, last_pushed_at, last_snapshot_id. |
| `patient_dirty_flag` | Marker that a patient's context changed and the app should re-pull. |

Snapshots are **versioned, not overwritten.** Each push increments
`version_number` for that patient and flips the prior `is_current=1` to
`0`. Up to 50 versions are kept per patient (matches the app-side
`SnapshotHistoryStore` cap).

---

## 3. Auth

All three sync endpoints (Connections 1, 2, 3) require
`Authorization: Bearer $TRANSCRIPTION_SYNC_TOKEN` per `_lib/sync_auth.js`.
Stored in macOS Keychain on the app side as
`mountzara-transcription-sync-token`. Rotated annually.

The admin endpoint `GET /api/v1/admin/snapshots/:patient_id` requires
admin Basic Auth via `_lib/admin_api.js`.

---

## 4. Endpoint reference

### `GET /api/v1/sync/transcription/patients?since=<ts>&limit=<n>&cursor=<n>`

Query params:
- `since` — ISO-8601 string or epoch-ms. Optional. Default 0 = full list.
- `limit` — default 100, max 500.
- `cursor` — opaque integer offset for pagination.

Response 200:
```json
{
  "ok": true,
  "patients": [
    {
      "patient_id": "ptn_xxx",
      "first_name": "...",
      "last_name": "...",
      "date_of_birth": "1992-04-12",
      "updated_at": 1715792400000,
      "dirty_reason": "intake_submitted",
      "dirty_since": 1715792400000,
      "last_intake_submitted_at": 1715792400000,
      "app_last_pulled_at": null
    }
  ],
  "next_cursor": "100",
  "server_time": 1715792500000,
  "since": 1715789000000
}
```

### `GET /api/v1/sync/transcription/patients/:id/context`

Response 200:
```json
{
  "ok": true,
  "context": {
    "patient": { /* demographics */ },
    "intake": {
      "intake_id": "in_xxx",
      "head": { /* row */ },
      "sections": [
        { "section_number": 1, "section_key": "patient_information", "data": { ... } },
        ...
      ]
    },
    "symptom_diary_recent_90d": [ { "entry_date": "...", "symptoms": {...}, "notes": "..." } ],
    "active_triage": { /* row */ },
    "prior_encounters": [ /* up to 40 */ ],
    "current_snapshot": { /* head row of is_current=1 if any */ },
    "recent_claims": [ /* up to 10 */ ]
  }
}
```

### `POST /api/v1/sync/transcription/snapshot`

Body (verbatim PatientProgressSummary serialization — see
`coding.js`-style schema doc in the endpoint header). Required:
`patient_id`. Everything else optional but recommended.

Response 201:
```json
{
  "ok": true,
  "snapshot_id": "snp_xxx",
  "version_number": 4,
  "prior_current_archived": true,
  "children": {
    "problems": 7,
    "diagnostic_trends": 5,
    "imaging": 3,
    "timeline": 12,
    "action_items": 6
  }
}
```

Response 409:
```json
{
  "error": "duplicate_source_app_snapshot_id",
  "existing_snapshot_id": "snp_xxx"
}
```

Returned when the app sends a `source_app_snapshot_id` that already
exists — protects against the app's retry-on-network-error duplicating
a snapshot.

### `GET /api/v1/admin/snapshots/:patient_id`

Admin Basic Auth. Returns: the current snapshot, every child entity,
plus website-only supplementary data (symptom diary 30 days, education
progress, appointment summary, recent claims, recent encounters, sync
state). Powers `/admin/cases/<id>/snapshot/`.

---

## 5. The admin EMR dashboard

Route: `/admin/cases/<patient_id>/snapshot/`. Cloudflare Pages rewrite in
`_redirects` maps any `/admin/cases/*/snapshot/` to the static SPA at
`admin/cases/[id]/snapshot/index.html`. The SPA reads patient_id from
`window.location.pathname`.

Per §3.10 Apple-glass purple. Sections:

1. **Hero** — patient name, age, pronouns, DOB, email, phone, snapshot version, dominant category. Three quick-action pills (Full case / Messages / Billing).
2. **Meta strip** — 5 KPI cards: snapshot version + generated date, active problems, AI recommendations + action items, imaging structures tracked, source app + model.
3. **Patient goals** — chip list.
4. **Surgical history** — chip list.
5. **Clinical overview + narrative** — purple-bordered overview block, chief complaint + history, full narrative patient story (150-300 words).
6. **Problem list** — status-chipped rows (Active / Resolving / Resolved / Monitoring) with last visit plan.
7. **Diagnostic trends** — per-trend card with category chip, trend summary, numeric sparkline (parses values for plottable numbers), and entries table with abnormal/critical interpretation tinting.
8. **Imaging measurements** — per-organ rows with current dimension, prior dimension, computed delta in cm + %, color-coded up/down.
9. **Treatment timeline** — vertical purple-rail timeline with type-chipped events.
10. **AI recommendations** — numbered cards (ACOG-anchored on the app side).
11. **Action items** — priority-colored cards (high amber-tinted, medium purple-bordered).
12. **Symptom diary 30-day sparklines** — per-symptom sparkline grid (extracts numeric values from symptom JSON).
13. **Engagement** — education assigned / viewed, symptom days logged.
14. **Appointments** — total / past / upcoming / last visit / next visit.
15. **Recent encounters** — last 8.
16. **Recent billing** — last 8 claims with quick-link to billing UI.
17. **Sync state** — app last pulled / last pushed.

All animated with `mzRise` stagger, `prefers-reduced-motion` override,
hover-lift on cards. No blue tokens. Nunito Sans + Avenir Next.

---

## 6. Dirty-flag triggers

When the website needs the app to re-pull a patient on the next `since`
cursor, it writes (UPSERT) a row to `patient_dirty_flag` with a reason.
Current writers:

- `POST /patient/intake/:id/submit` → `dirty_reason: "intake_submitted"`.

Future writers (planned, document them here when added):

- `PATCH /portal/profile` → `dirty_reason: "profile_updated"`.
- `POST /portal/symptoms/diary` → `dirty_reason: "symptom_logged"` (debounced
  — don't trigger on every single entry, only on a meaningful change like
  a new severe-pain day).
- `POST /portal/appointments` → `dirty_reason: "appointment_booked"`.
- `POST /admin/cases/:id/note` → `dirty_reason: "clinician_note_added"`.

The app's pull endpoint clears the flag after a successful pull.

---

## 7. Deploy verification

```
# Apply schema (idempotent)
npx wrangler@latest d1 execute mountzara-clinical --remote \
    --file=schema/0007_phase9_snapshots.sql

# Deploy Pages — parallel-session check first per §9.8.2
git fetch origin
npx wrangler@latest pages deployment list --project-name=mountzara | head -10
npx wrangler@latest pages deploy . --branch=main --commit-dirty=true

# Smoke: patient list
curl -s -H "Authorization: Bearer $TRANSCRIPTION_SYNC_TOKEN" \
    "https://mountzara.com/api/v1/sync/transcription/patients?since=0&limit=5" | jq '.'

# Smoke: patient context for a known id
curl -s -H "Authorization: Bearer $TRANSCRIPTION_SYNC_TOKEN" \
    "https://mountzara.com/api/v1/sync/transcription/patients/ptn_jane/context" | jq '.context | keys'

# Smoke: snapshot push
curl -s -X POST -H "Authorization: Bearer $TRANSCRIPTION_SYNC_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"patient_id":"ptn_jane","clinical_overview":"smoke test","generated_at":"2026-05-16T00:00:00Z","encounter_count":0}' \
    "https://mountzara.com/api/v1/sync/transcription/snapshot" | jq '.'

# Smoke: admin dashboard endpoint
curl -s -u "admin:$ADMIN_PASS" \
    "https://mountzara.com/api/v1/admin/snapshots/ptn_jane" | jq '.snapshot.version_number'

# Open the dashboard
open "https://mountzara.com/admin/cases/ptn_jane/snapshot/"
```

Per §0.4.1 + §3.10 — the snapshot deploy touches `admin/_nav.js` and
`_redirects`; run the regression-risk audit before declaring done.

---

## 8. Roadmap

- **Round B** — Diff view: `GET /admin/snapshots/:id/diff?from=<v>&to=<v>`
  showing added/resolved problems, changed statuses, new
  recommendations between two snapshot versions.
- **Round C** — Action-item promotion: clinician promotes a
  `snapshot_action_items` row into a real patient_action_items / care-plan
  task with one click.
- **Round D** — Snapshot history viewer in the admin UI — slide through
  versions with the timeline.
- **Round E** — Live snapshot regeneration trigger from the admin UI:
  clinician clicks "regenerate," website sets the dirty flag, the app
  picks it up on next pull and regenerates.
- **Round F** — Clinical AI app + Surgical Workflow app integration —
  same pattern, separate `source_app` values.
