# Business Associate Agreement (BAA) Ledger

This is the source-of-truth ledger of every vendor that handles PHI on behalf of the MountZara practice. Per CLAUDE.md §11 Tier 7 and HIPAA §164.502(e), every Business Associate must have a signed BAA on file **before** PHI flows to them.

The structure of this ledger mirrors the D1 `baa_ledger` table; the markdown file is the human-readable record + audit anchor and the D1 table backs the `/admin/compliance` admin view.

---

## Status legend

| Status | Meaning |
|---|---|
| **signed** | BAA fully executed by both parties; on file. |
| **pending** | Engagement underway but BAA not yet executed — PHI MUST NOT flow until signed. |
| **na** | Vendor is in scope but does not require a BAA (e.g. they don't handle PHI). |
| **expired** | Previously signed but the agreement term elapsed without renewal — PHI flow paused. |

---

## Vendors

### 1. Cloudflare, Inc.

| Field | Value |
|---|---|
| Status | **signed** |
| Signed date | 2026-05-15 (user confirmed) |
| Scope | Cloudflare Pages, Workers, Pages Functions, D1, R2, KV, Queues, Access. All MountZara platform PHI at rest + in transit. |
| Contract location | (TBD — upload PDF to `mountzara-content/legal/cloudflare-baa.pdf` and link here) |
| Renewal cadence | Per Cloudflare standard BAA — re-confirm annually. |
| Notes | Cloudflare BAA covers their default at-rest encryption. The application adds per-record AES-GCM envelope encryption on top of R2 (per `functions/_lib/phi.js`). |

### 2. Stripe, Inc.

| Field | Value |
|---|---|
| Status | **pending** |
| Scope | Phase 6 billing — invoices, payment links, payment methods on file. Stripe will NOT see clinical PHI; only billing metadata + amounts. |
| Contract location | Not yet executed. |
| Notes | Stripe HIPAA BAA is available on request; required before activating any Phase 6 functionality. Do NOT flip Phase 6 live without signed BAA. |

### 3. Twilio, Inc.

| Field | Value |
|---|---|
| Status | **pending** |
| Scope | Phase 2/3 — appointment reminder SMS, magic-link email delivery (via SendGrid, a Twilio subsidiary). Message bodies are short, non-clinical reminders (e.g. "Reminder: your visit with Dr. Mabini is tomorrow at 10:00 AM"). |
| Contract location | Not yet executed. |
| Notes | Twilio's standard BAA (Twilio + SendGrid combined) is required before activating Phase 2 reminders. Keep message bodies appointment-metadata only; never embed visit_type details or chief complaint. |

### 4. Doxy.me, Inc.

| Field | Value |
|---|---|
| Status | **na** (BAA exists with Doxy.me directly; PHI never leaves the Doxy.me domain — video is peer-to-peer WebRTC on `dr-mabini.doxy.me`) |
| Scope | Telehealth video session. Patient session metadata (start time, duration) optionally returned via webhook on Doxy.me enterprise tier. |
| Contract location | Doxy.me HIPAA terms accepted in their portal — no separate BAA needed for the launch-button integration model. |
| Notes | Per CLAUDE.md §11 Tier 6, mountzara.com hosts only the launch button; the video session lives entirely on `dr-mabini.doxy.me` where Doxy.me's HIPAA boundary applies. |

### 5. Anthropic (Claude API for AI triage)

| Field | Value |
|---|---|
| Status | **na — but mitigations required** |
| Scope | §11.7 AI triage prompt. Receives PHI from intake (chief complaint, pain scores, ERAS factors) to produce a visit-type categorization. |
| Notes | Anthropic does NOT currently offer a HIPAA BAA. **Mitigation:** all PHI sent to Claude in the triage prompt is de-identified per §4.2 (no patient name, no DOB, no contact info, MRN replaced with `appointment_triage.id`). The decision rationale returned by Claude is stored in `appointment_triage.ai_rationale`. If a future Anthropic BAA becomes available, switch to identified prompts for richer triage. |

### 6. Google Workspace (Calendar API for clinician sync)

| Field | Value |
|---|---|
| Status | **na** for Phase 0 (no PHI flows to Google Calendar yet) |
| Scope | Phase 2 — clinician availability mirrors to Google Calendar so the clinician's calendar reflects portal-booked appointments. |
| Notes | Google Workspace BAA is included with Business Plus / Enterprise plans. **Before activating Phase 2 GCal sync, confirm the clinician's Google Workspace plan includes a BAA.** Until then, mirror only non-PHI event metadata (event title = visit_type chip, no patient name; description blank). |

---

## Annual risk assessment

Per CLAUDE.md §11 Tier 7, every signed BAA is re-confirmed annually. Set a scheduled task to remind the operator 30 days before each `expires_at`. The Cloudflare BAA was confirmed signed 2026-05-15 → next confirmation 2027-04-15.

---

## Breach notification playbook

If a Business Associate notifies the practice of a breach affecting PHI:

1. Record the notification in `audit_log` with action `data_breach_notification` and details_json containing the notification body, date received, and the BA's incident reference.
2. Confirm scope: number of patients affected, types of PHI involved, dates of unauthorized access.
3. Within 60 days of discovery, notify affected patients via certified mail + email per HIPAA §164.404. Template lives in `docs/compliance/breach-notification-template.md` (TBD).
4. If ≥500 patients affected: notify HHS within 60 days via the OCR breach portal AND notify prominent media in the practice's state.
5. If <500: include in the annual HHS breach log submitted within 60 days of year-end.
6. Update this ledger with the incident reference + resolution date.

---

*Last updated: 2026-05-15 by Phase 0 foundation work.*
