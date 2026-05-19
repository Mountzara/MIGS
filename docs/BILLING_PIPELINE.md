# Insurance Billing Pipeline

Phase 8 of the MountZara MIGS platform. This pipeline takes the AI coding
analysis already produced by the MountZara Transcription macOS app and
turns it into reviewable, audit-traceable, clearinghouse-ready insurance
claims on the website. The Transcription app does the heavy AI lift (E/M
code, ICD-10 + CPT lines, modifiers, wRVU, compliance flags, upcoding
opportunities, documentation suggestions, 1995/1997 CMS documentation
audit, medico-legal score); the website ingests, persists, surfaces it
for review, and prepares it for downstream EDI submission once
insurance contracts and a clearinghouse are connected.

This document is the operator runbook + architecture reference. It is the
single source of truth for the billing pipeline; if you are about to
change anything in `schema/0006_phase8_billing.sql`, the
`functions/api/v1/sync/transcription/coding.js` ingestion endpoint, the
`functions/api/v1/admin/billing/*` review endpoints, or `admin/billing/`,
update this document in the same commit.

---

## 0. Status & scope

| Round | Status (2026-05-16) | What it delivers |
|---|---|---|
| **A — Foundation** | **In progress** | D1 schema, sync endpoint, admin review UI, docs. No clearinghouse yet. |
| B — Payer management | Pending | `/admin/billing/payers` UI to add contracted payers + rate schedules. |
| C — Claim edit & approve | Pending | Mutating endpoints to edit lines, resolve flags, accept upcoding, mark ready_to_submit. |
| D — EDI 837P generator | Pending | Generate 837P Professional from approved claims. Vendor-pluggable transport. |
| E — Clearinghouse adapters | Pending | `AvailityFusionTransport` + `OfficeAllyTransport` implementations. |
| F — ERA 835 ingestion | Pending | Inbound 277CA acknowledgments + 835 remittance posting. |
| G — Revenue analytics | Pending | `/admin/billing/analytics` rolls up wRVU, expected vs collected, denial rates. |

Until Rounds B–G land, the pipeline operates in **review-only** mode:
claims arrive from the Transcription app, the clinician reviews them in
`/admin/billing/`, and approved claims sit at `status='ready_to_submit'`
indefinitely until a clearinghouse transport is wired up.

---

## 1. End-to-end data flow

```
┌───────────────────────────────────────┐
│  MountZara Transcription macOS app    │
│                                       │
│  CodingService.analyzeForCoding()     │
│   → CodingAnalysis JSON               │
└───────────────┬───────────────────────┘
                │  POST /api/v1/sync/transcription/coding
                │  Authorization: Bearer TRANSCRIPTION_SYNC_TOKEN
                ▼
┌───────────────────────────────────────┐
│  Pages Function: coding.js            │
│                                       │
│  ── Verify Bearer + patient_id        │
│  ── Idempotency on source_session_id  │
│  ── Insert billing_claims +           │
│        billing_claim_lines +          │
│        billing_claim_diagnoses +      │
│        billing_compliance_flags +     │
│        billing_upcoding_opportunities+│
│        billing_documentation_suggest. │
│  ── billing_audit_log: claim_created  │
│  ── audit_log: phi_write              │
└───────────────┬───────────────────────┘
                │
                ▼
┌───────────────────────────────────────┐
│  D1 mountzara-clinical                │
│  (status = 'pending_review')          │
└───────────────┬───────────────────────┘
                │
                │  GET /api/v1/admin/billing/claims
                │  GET /api/v1/admin/billing/claims/:id
                │  (admin Basic Auth)
                ▼
┌───────────────────────────────────────┐
│  /admin/billing/  (the SPA)           │
│                                       │
│  Claim queue · drill-down · flags ·   │
│  upcoding · doc suggestions ·         │
│  medico-legal gauge                   │
└───────────────┬───────────────────────┘
                │
                │  (Round C — pending)
                │  PATCH /api/v1/admin/billing/claims/:id
                │  ── edit lines / resolve flags / accept upcoding
                │  ── transition status to ready_to_submit
                ▼
┌───────────────────────────────────────┐
│  (Round D — pending)                  │
│  EDI 837P generator → transport       │
│   ─ AvailityFusionTransport           │
│   ─ OfficeAllyTransport               │
└───────────────┬───────────────────────┘
                │
                ▼  (Round E — pending)
       Clearinghouse → payer
                │
                ▼  (Round F — pending)
       277CA + 835 → website → status updates
```

---

## 2. Schema reference

Defined in `schema/0006_phase8_billing.sql`. Eight tables:

| Table | Purpose |
|---|---|
| `billing_payers` | One row per contracted insurance. Rate schedules + clearinghouse routing. |
| `billing_claims` | One row per encounter/claim instance. Status machine (11 states). |
| `billing_claim_lines` | CPT/HCPCS/E-M service lines on the claim. Aligns with 837P SV1 segment. |
| `billing_claim_diagnoses` | ICD-10 diagnosis codes (max 12 per claim = 837P HI cap). |
| `billing_compliance_flags` | error/warning/info notes from the AI's compliance check. |
| `billing_upcoding_opportunities` | AI-identified higher-paying codes if documentation supports. |
| `billing_documentation_suggestions` | Section-tagged (HPI/ROS/PE/A/P) documentation-improvement recommendations. |
| `billing_audit_log` | Append-only lifecycle events. 7-year retention. |

### Status machine on `billing_claims.status`

```
pending_review ──┬─► edited ──► (back to pending_review via re-sync)
                 │
                 ├─► rejected (clinician dismisses the AI suggestion outright)
                 │
                 └─► ready_to_submit
                         │
                         ▼
                    submitting
                         │
                         ▼
                    submitted ──► accepted_by_clearinghouse
                                          │
                                          ▼
                    paid / partially_paid / denied
                                                │
                                                ▼
                                          appealed ──► rebilled ──► paid
                                                                       OR
                                                                    written_off
```

Allowed transitions (enforced in Round C's mutation endpoint):

| From | To | Trigger |
|---|---|---|
| pending_review | edited / rejected / ready_to_submit | Clinician action |
| edited | ready_to_submit / rejected | Clinician action |
| ready_to_submit | submitting | EDI generator picks it up |
| submitting | submitted | Clearinghouse acknowledged (Round F) |
| submitted | accepted_by_clearinghouse | 277CA accepted |
| submitted | denied | 277CA denied |
| accepted_by_clearinghouse | paid / partially_paid / denied | 835 posted |
| denied | appealed | Clinician initiates appeal |
| appealed | rebilled | Resubmitted with corrections |
| rebilled | paid / written_off | Resolution |
| any | written_off | Administrative close |

---

## 3. Sync endpoint contract — `POST /api/v1/sync/transcription/coding`

### Auth
Bearer `TRANSCRIPTION_SYNC_TOKEN` (Cloudflare Pages secret; rotated
annually; stored in macOS Keychain on the app side per
`mountzara-transcription-sync-token`).

### Request body
Mirrors the Swift `CodingAnalysis` struct serialized to JSON. Full schema
documented in `coding.js` header comment; key shape:

```json
{
  "patient_id": "ptn_xxx",
  "source_session_id": "tx_session_xxx",
  "encounter_id": null,
  "appointment_id": null,
  "visit_date": "2026-05-16",
  "visit_type": "complex_pelvic_pain_endometriosis_eval",
  "payer_id": null,

  "em": {
    "code": "99214",
    "mdm_level": "moderate",
    "wRVU": 1.50,
    "confidence": 0.86,
    "ai_rationale": "...",
    "supporting_evidence": ["..."],
    "alternatives_considered": [{ "code": "99213", "reason_not_chosen": "...", "wrvu": 0.97 }]
  },

  "diagnoses": [
    {
      "icd10_code": "N80.9", "description": "Endometriosis, unspecified",
      "confidence": 0.92, "ai_rationale": "...",
      "supporting_evidence": ["..."], "sequence_number": 1
    }
  ],

  "procedures": [
    {
      "code_type": "cpt", "code": "58662", "description": "Laparoscopy, surgical; with fulguration or excision of lesions",
      "modifier_1": "LT", "modifier_rationale": "Laterality — left adnexal endo lesion",
      "units": 1, "place_of_service": "22", "diagnosis_pointers": "1,2",
      "confidence": 0.81, "wrvu": 17.31,
      "ai_rationale": "...", "supporting_evidence": ["..."], "alternatives_considered": [],
      "charge_cents": 182550, "expected_cents": 137250
    }
  ],

  "compliance": {
    "status": "warnings",
    "medico_legal_score": 87,
    "em_documentation_audit": { },
    "flags": [
      { "severity": "warning", "kind": "missing_modifier",
        "title": "Modifier 25 needed", "description": "...",
        "referenced_code": "99214", "suggested_fix": "Add modifier 25 to E/M for separately-identifiable service." }
    ]
  },

  "upcoding_opportunities": [
    {
      "current_code": "99213", "potential_code": "99214",
      "wrvu_delta": 0.53, "revenue_delta_cents": 4250,
      "required_documentation": "Add at least one moderate-complexity dx + ROS finding.",
      "confidence": 0.78, "rationale": "..."
    }
  ],

  "documentation_suggestions": [
    {
      "priority": "high", "section": "HPI",
      "issue": "HPI missing onset and duration.",
      "suggestion": "Add onset and duration of pelvic pain.",
      "revenue_impact": "Protects E/M level 99214 against downcode."
    }
  ],

  "totals": {
    "total_wrvu": 18.81,
    "total_charge_cents": 198650,
    "expected_collection_cents": 152340
  },

  "ai_meta": {
    "model": "claude-opus-4-6",
    "prompt_version": "coding-v3.2",
    "compliance_metrics": { "field_completeness": 0.97 }
  }
}
```

### Response
| Status | Body | Meaning |
|---|---|---|
| 201 | `{ ok: true, claim_id, replaced_prior_pending, lines_inserted, diagnoses_inserted, flags_inserted, upcoding_inserted, doc_suggestions_inserted }` | Claim created or replaced. |
| 400 | `{ error: "missing_patient_id" }` etc. | Validation failure. |
| 401 | `{ error: "unauthorized" }` | Bearer token invalid. |
| 404 | `{ error: "patient_not_found" }` | Resolve via `/sync/patients/lookup` first. |
| 409 | `{ error: "claim_already_in_review", existing_claim_id, status }` | A non-pending claim already exists for the session; do not auto-overwrite. |
| 500 | `{ error: "internal_error", detail }` | Logged to audit_log. |

### Idempotency
`(patient_id, source_session_id)` is unique-in-spirit. If the
Transcription app re-runs the AI on the same session AND the existing
claim is still `pending_review`, the new payload replaces the old one
(returns `replaced_prior_pending: true`). If the claim has moved past
`pending_review` (clinician started editing, or it's been submitted),
the endpoint returns 409 to protect clinician work.

---

## 4. Admin endpoints

### `GET /api/v1/admin/billing/claims`

Lists claims for the review queue.

Query params:
- `status` — comma-separated. Default `pending_review,edited`.
- `payer_id` — filter by payer.
- `patient_id` — filter by patient.
- `q` — free-text search across patient name, em_code, visit_type.
- `days` — visit_date within N days (default 60, max 365).
- `limit` — pagination (default 50, max 200).
- `offset` — pagination (default 0).

Returns each claim with denormalized patient name, payer name, flag
counts (`unresolved_errors`, `unresolved_warnings`, `unaccepted_upcoding`,
`unapplied_high_docsugg`), and the standard totals.

### `GET /api/v1/admin/billing/claims/:id`

Full drill-down. Returns the claim row + every `billing_claim_lines` row
+ every diagnosis + every flag + every upcoding opportunity + every doc
suggestion + the last 40 `billing_audit_log` events + a severity tally
for header rendering.

---

## 5. Admin UI — `/admin/billing/`

§3.10-compliant Apple-glass purple SPA. Filter chips by status group,
search bar, KPI strip (open claims, unresolved errors, pending upcoding,
total wRVU, expected $), claim queue list with per-row flag pills, and a
drill-down detail panel that shows:

- Patient strip with deep-link to `/admin/cases/:patient_id/`.
- Coding summary grid (E/M, MDM, wRVU, charge, expected, compliance).
- Medico-legal gauge (SVG half-circle, red→amber→green gradient).
- Service-lines table (line_number, code, description, modifiers,
  wRVU, charge, expected, AI confidence).
- Diagnoses table.
- Compliance flags — color-coded by severity, with suggested-fix block.
- Upcoding opportunities — green-tinted cards showing
  current_code → potential_code, +wRVU/+revenue deltas, required
  documentation, AI rationale.
- Documentation suggestions — amber-tinted by priority, with
  section (HPI/ROS/PE/A/P) chip, issue, suggestion, revenue impact.

Edit/approve actions are stubbed pending Round C.

---

## 6. Vendor strategy — chosen 2026-05-16

After review (see chat log: vendor analysis on session resume), the
plan is **Availity Essentials primary + Office Ally fallback**, both
free for a solo practice on the volumes a MIGS clinic produces:

- **Availity Essentials** — REST API (Availity Fusion). Direct
  connections to major commercials including BCBS-IL, Aetna, Humana,
  UnitedHealthcare, Cigna. Free Essentials tier covers 837P + 277CA +
  835 + eligibility/benefits for direct payers.
  https://developer.availity.com
- **Office Ally** — SFTP/REST hybrid. ~5,300+ participating payers free.
  Backstop for any payer Availity doesn't direct-connect (regional
  Medicaid managed care, workers' comp carriers, niche commercial).
  https://officeally.com/payer-list/

Per-payer routing lives on `billing_payers.clearinghouse_vendor` (free
text: `'availity'` or `'office_ally'`). Round D's EDI generator
implements a pluggable `BillingTransport` interface with two adapters
matching these two vendors.

Per CLAUDE.md §3.6, before the first real submission we run a
validated-API verification pass on both Availity and Office Ally to
confirm current pricing, payer participation, and API surface area.

---

## 7. HIPAA + audit posture

- The sync endpoint writes one row to the general `audit_log` (HIPAA
  PHI-write event) and one row to `billing_audit_log` (claim-lifecycle
  event) on every successful ingestion. PHI is NOT in either row — only
  IDs, code values, and aggregate counts.
- `billing_audit_log` is append-only, 7-year retention to match payer
  audit standards. No update or delete endpoints exist for it.
- The Cloudflare BAA covers D1, R2, KV, Queues, Pages, Workers — the
  entire data path used here. Anthropic BAA outstanding (see
  `docs/compliance/BAA-ledger.md`); when present, the medico-legal
  scoring and audit are produced by the Transcription app under that
  BAA, and the website never re-calls Claude on PHI.
- Clearinghouse-specific BAAs are required before going live with
  Availity / Office Ally — both publish their BAA process on their
  dashboards. File the signed BAA in `docs/compliance/BAA-ledger.md`
  before flipping any claim from `ready_to_submit` to `submitting`.

---

## 8. Failure modes & how to debug

| Symptom | Likely cause | Fix |
|---|---|---|
| Sync returns 401 | `TRANSCRIPTION_SYNC_TOKEN` missing/wrong | `wrangler pages secret put TRANSCRIPTION_SYNC_TOKEN --project-name=mountzara`; copy from macOS Keychain `mountzara-transcription-sync-token`. |
| Sync returns 404 patient_not_found | App didn't run `/sync/patients/lookup` first | Wire the Swift app to resolve patient_id before posting coding. |
| Sync returns 409 claim_already_in_review | Existing claim past pending_review | Manually rebill from `/admin/billing/` or write off the prior claim, then resync. |
| Admin UI 401 | Admin Basic Auth not authenticated | `/admin/_signout` to drop cached creds, then sign back in. |
| Claim totals off | App rounded cents differently than expected | Inspect `billing_claim_lines.charge_cents` vs the Transcription app's internal value; the website trusts the app's totals. |
| Medico-legal score gauge missing | `compliance.medico_legal_score` not sent | Confirm the app's `CodingService` populated `medicoLegalAssessment` field. |

---

## 9. Deploy verification (§0.2 VERIFY + §0.4.1 regression audit)

Before declaring a billing-pipeline change "done":

1. **Apply schema migration** (idempotent, safe to re-run):
   ```
   npx wrangler@latest d1 execute mountzara-clinical --remote \
       --file=schema/0006_phase8_billing.sql
   ```
2. **Deploy Pages** (parallel-session check per §9.8.2 first):
   ```
   git fetch origin
   npx wrangler@latest pages deployment list --project-name=mountzara | head -10
   # If a newer deploy than this session's exists, merge first.
   npx wrangler@latest pages deploy . --branch=main --commit-dirty=true
   ```
3. **Smoke the sync endpoint:**
   ```
   curl -i -X POST https://mountzara.com/api/v1/sync/transcription/coding \
       -H "Authorization: Bearer $TRANSCRIPTION_SYNC_TOKEN" \
       -H "Content-Type: application/json" \
       -d @docs/samples/coding-sample.json
   ```
   Expect HTTP 201 with `claim_id`. (See §10 for the sample payload.)
4. **Smoke the admin list:**
   ```
   curl -i -u "admin:$ADMIN_PASS" https://mountzara.com/api/v1/admin/billing/claims
   ```
   Expect HTTP 200 with the new claim in the `claims[]` array.
5. **Smoke the admin detail:**
   ```
   curl -i -u "admin:$ADMIN_PASS" https://mountzara.com/api/v1/admin/billing/claims/<claim_id>
   ```
   Expect HTTP 200 with `claim`, `lines`, `diagnoses`, `flags`,
   `upcoding_opportunities`, `documentation_suggestions`, `audit_tail`,
   `tally`.
6. **§3.10 regression audit** — billing surfaces should NOT have caused
   any homepage / about / nav drift. Re-run the audit checklist from
   `CLAUDE.md §3.10` against `index.html`, `about/index.html`,
   `admin/index.html`, and the shared style. Document the result.

---

## 10. Sample payload

A minimal `coding-sample.json` lives at `docs/samples/coding-sample.json`
(to be added in Round A wrap-up). Use it to smoke the sync endpoint
without standing up the full Transcription app.

---

## 11. Open follow-ons (not blocking Round A)

- Round B — `/admin/billing/payers` UI to add contracts.
- Round C — claim mutation endpoint (edit lines, resolve flags, accept
  upcoding, status transitions).
- Round D — EDI 837P generator + `BillingTransport` interface.
- Round E — `AvailityFusionTransport` + `OfficeAllyTransport` impls.
- Round F — 277CA + 835 inbound handlers; queue-based posting back
  onto `billing_claims.status` + `billing_audit_log`.
- Round G — `/admin/billing/analytics` rollup (case-mix wRVU, expected
  vs collected, denial rate by payer, days-to-pay distribution).
- Anthropic BAA signature so the Transcription app can run on patient
  PHI under HIPAA cover (parallel work; see
  `docs/compliance/BAA-ledger.md`).
