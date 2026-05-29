# Mount Zara — Live Sprint State

> **READ THIS FIRST.** Per CLAUDE.md §10.14, any Cowork session that intends to work on Phase 17 / 18 / 19 / 20 sprint items MUST read this file before touching the codebase. The file records exactly where the active sprint stands, what is committed, what is deployed, what is pending, and what is awaiting your decisions.
>
> **Update protocol.** Every Cowork session that lands work updates this file at the end of the session — same commit, never silently. The "Last updated" stamp at the top must always match the last code commit on the branch.

---

## Section 0 — At-a-glance status

| Field | Value |
|---|---|
| **Active sprint** | Phase 17 Sprint 1 — Telehealth Compliance Foundation (P0 items R1–R5) |
| **Last updated** | 2026-05-28 by Claude |
| **Branch** | `claude/setup-mountzara-landing-01M5e6zmrBbv1hX9jmgH6xz8` |
| **Last commit on branch** | `phase17(sprint1 R4): privacy attestation interstitial + launch endpoint` |
| **Deployed to production?** | **PARTIAL** — R4 page + endpoint shipped; schema migration `0018` still pending |
| **Schema migration `0018` run against D1?** | **NO** — runs as part of Sprint 1 close (item 12) |
| **PORTAL_PUBLIC_LAUNCH state** | `false` (preview gate active per §11.5.2) |
| **Reference docs** | `/Users/beans/Documents/MountZara_Telehealth_Audit_2026-05-27.docx` · `/Users/beans/Documents/MountZara_Telehealth_Implementation_Specs_2026-05-27.docx` |
| **Source benchmark** | Joshi & Welch (2023) *Telehealth Success*, Forbes Books, ISBN 979-8-88750-139-0 |

---

## Section 1 — Phase 17 Sprint 1 — Completed (committed, NOT deployed)

The Sprint 1 commit lands the **backend safety-critical pieces** of recommendations R1, R2, R3 from the telehealth audit. UI + endpoint plumbing for R3 wiring + R4 + R5 + the chaperone-confirm modal is the remaining Sprint 1 follow-up work (see Section 2).

### R1 — Visit-type chaperone flag (GU-exam rule, Joshi & Welch p. 51)

- ✅ `functions/_lib/visit_types.js` — all 14 visit types carry `requires_chaperone` + `chaperone_rationale`. Annual exam, OMT, new_patient_complex, endo_pain_evaluation, post_op_late, office_procedure all marked `true`. `visitTypeOptions()` surfaces the fields; helper `requiresChaperone(key)` added.
- ✅ `functions/_lib/intake_triage.js` — `TRIAGE_PROMPT_VERSION` bumped to `triage-v2.0-2026-05-27`. The system prompt teaches Claude the chaperone rule; `visitTypeCatalogForPrompt` now includes the flag + rationale; `validateTriage` enforces "catalog floor cannot be overridden" — Claude can set `chaperone_required=true` on a `flag=false` visit defensively, but it cannot set `false` on a `flag=true` visit. Missing field defaults to the catalog floor.
- ✅ `schema/0018_phase17_telehealth_safety.sql` — adds 3 columns to `appointments`: `chaperone_required` INTEGER NOT NULL DEFAULT 0, `chaperone_confirmed_at` TEXT, `chaperone_confirmation_method` TEXT.
- ✅ `functions/api/v1/patient/appointments/book.js` — rejects telehealth booking of a chaperone-required visit type with `409 chaperone_confirmation_required` + structured `chaperone_rationale` in the error body. Accepts `{chaperone_confirmed: true, chaperone_confirmation_method: "partner_present" | "adult_family_member" | "clinic_assistant"}` to proceed; persists to the new columns; audit log carries chaperone state.

### R2 — Controlled-substance prescribing policy (Joshi & Welch Ch. 17)

- ✅ `docs/compliance/controlled-substances.md` — 12-section policy doc:
  - §1 Authority & scope · §2 Schedule definitions · §3 Mount Zara 24-month in-person baseline · §4 Exception conditions (none currently applicable) · §5 State-by-state additions (template — Illinois pre-filled, others awaiting license expansion) · §6 DoseSpot integration controls · §7 PDMP query workflow · §8 Per-prescription documentation requirements · §9 Standard-of-care floor · §10 Cerebral cautionary precedent · §11 Annual review · §12 Signature page
- ⚠️ **AWAITING DR. MABINI SIGNATURE** — signature page in §12 is blank. Per the implementation specs B.4, the document should also be reviewed by external counsel before signing. Open decision in Section 4.

### R3 — Licensure tracker + per-state intake gate (Joshi & Welch Ch. 21)

- ✅ `docs/compliance/licensure.md` — 10-section policy:
  - §1 Active licenses inventory (Illinois pre-filled, others templated) · §2 Interstate Medical Licensure Compact posture · §3 Established-patient temporary out-of-state rules (Iowa / Kansas / Connecticut / Oregon) · §4 Code-level enforcement architecture · §5 Renewal calendar · §6 Verification at intake · §7 Patient-facing copy · §8 Federalized clinicians · §9 Annual review · §10 Signature page
- ⚠️ **AWAITING DR. MABINI SIGNATURE** — §10 blank.
- ✅ `functions/_lib/licensure.js` — helper module:
  - `getLicensedStates(env)` reads `practice_settings.licensed_states_json` keyed by `mabini-christopher-z` clinician id; 60-second in-memory cache; conservative `["IL"]`-only fallback so misconfigured deploys fail closed.
  - `isLicensedInState(env, state)` predicate (case-insensitive on input).
  - `recordLicensureBlock(env, {patient_id, state, reason})` best-effort write to the audit table; never throws.
  - `_resetCache()` test-only escape hatch.
- ✅ `schema/0018_phase17_telehealth_safety.sql` — adds the `licensure_blocks` audit table (patient_id, state, reason, created_at + 3 indexes).

---

## Section 2 — Phase 17 Sprint 1 — REMAINING WORK (the next Cowork session picks up here)

This is the precise work list for the next session. Each item is independently scoped; the items can be done in any order except items 11 + 12 + 13 which must come last.

### R3 wiring — 4 small Edits (≈45 min total)

1. **Intake submit endpoint integration** — `functions/api/v1/patient/intake/[intake_id]/submit.js`. Import `isLicensedInState` from `_lib/licensure.js`. Before LLM call, look up the patient's `address_state` from intake section 1; if not licensed, write a `licensure_blocks` row, return `422 license_state_mismatch` with `{licensed_states: [...]}` payload.
2. **Triage endpoint short-circuit** — `functions/api/v1/patient/intake/[intake_id]/triage.js`. Same import + state check; if not licensed, short-circuit before the Claude API call.
3. **Booking endpoint defense-in-depth** — `functions/api/v1/patient/appointments/book.js`. Re-check at booking time (patient may have edited their address since intake); reject with `409 license_state_mismatch` if not.
4. **Admin practice-settings UI for editing `licensed_states_json`** — `admin/practice-settings/index.html` + `functions/api/v1/admin/practice/licensed-states.js`. Read-side endpoint returns the JSON array; write-side admin-gated; audit-logged.

### R4 — Privacy attestation interstitial + launch endpoint ✅ DONE 2026-05-28

5. ✅ `portal/visit/launch/index.html` — interstitial with two attestation cards (privacy + alone-or-chaperoned), Apple-glass styling, purple accent, T-15-min gate hint, opens room URL only on POST success. Dynamic appointment id resolved client-side from URL path.
6. ✅ `functions/api/v1/patient/appointments/[id]/launch.js` — POST-only. Validates ownership, status=`scheduled`, modality=`telehealth`, chaperone (if required), T-15-min release window (`launch_too_early` if early, `launch_window_closed` if >30min past end), and both attestations true. Writes a `visit_launch_attestations` row with IP hash + UA. Returns `{room_url, expires_at, appointment}` on success. Every call audit-logged.
7. ✅ `_redirects` — wildcard `/portal/visit/*/launch` → `/portal/visit/launch/index.html 200` so the dynamic path resolves to the static SPA. Patient GET endpoints already do NOT expose `doxy_room_url` (audit: only `book.js` write side + `admin/*` read sides reference it; patient read endpoints are clean).

### R5 — Patient device + connection test (≈3 h)

8. **New page** — `portal/tech-check/index.html` + sibling `_app.js`. Four checkpoint cards (camera / microphone / speaker / network). `getUserMedia` for cam+mic; click-to-confirm sound test; 2 MB CDN-fetch speed test. Per-component remediation copy with browser-specific instructions.
9. **New endpoint** — `functions/api/v1/patient/tech-check.js` (POST). Writes one `tech_check_results` row per successful run. Optional `?appointment_id=` query param to associate with a specific upcoming visit.
10. **Admin badge** — small badge on each upcoming appointment row in `/admin/cases/[id]/` + `/admin/appointments/`: "Device check passed Mon 4:32pm" / "Device check not yet run" / "Device check FAILED [reason]."

### Chaperone-confirm modal UI (≈1 h)

11. **`portal/appointments/book/index.html`** — when the user selects a telehealth slot for a `requires_chaperone` visit type, intercept the "Confirm" click. Open a small modal with the verbatim copy from the implementation specs R1 UI section: three radio buttons + a "Switch to in-person" button + a "Cancel" button. On confirmation, the existing book.js POST already accepts `chaperone_confirmed + chaperone_confirmation_method` — just pass through.

### Sprint-close (must come last)

12. **Schema migration deploy** — `wrangler d1 execute mountzara-clinical --remote --file=schema/0018_phase17_telehealth_safety.sql`. Idempotent (every CREATE uses IF NOT EXISTS) so re-runs are safe.
13. **Smoketests** — new `scripts/smoketest_phase17.sh` covering:
    - Chaperone-required telehealth booking rejected without confirmation (curl)
    - Chaperone-required telehealth booking accepted with confirmation (curl)
    - Out-of-license-state intake submission rejected (curl)
    - Launch endpoint rejects early (curl with T-30:00)
    - Launch endpoint accepts at T-14:59 (curl)
    - Tech-check POST persists (curl)
    - §0.4.1 comprehensive regression audit: `/opt/homebrew/bin/python3 scripts/regression_audit.py --all` returns exit code 0
14. **Deploy + visual VERIFY** — `./scripts/deploy-prod.sh "phase17(sprint1): R1+R2+R3+R4+R5 complete"`. After deploy: load `https://mountzara.com/portal/` with admin Basic Auth, walk the flows, capture Playwright screenshots per §0.2.1. Update Section 0 of this file: change `Deployed to production?` to `YES` + record the production deployment ID.
15. **Update this file** — mark Sprint 1 complete; flip the active-sprint pointer to Sprint 2.

---

## Section 3 — Pending sprints (Roadmap)

The full 22-recommendation roadmap is in `/Users/beans/Documents/MountZara_Telehealth_Implementation_Specs_2026-05-27.docx`. Snapshot here for quick reference:

| Sprint | Phase | Items | Effort estimate | Gate |
|---|---|---|---|---|
| Sprint 1 (active) | Phase 17 | R1–R5 (5 × P0) | 6 dev-days + 3 clin-days | First real patient visit cannot proceed without these |
| Sprint 2 | Phase 18 | R6–R14 (9 × P1) | 7 dev-days + 3 clin/admin-days | Public launch (PORTAL_PUBLIC_LAUNCH=true) cannot proceed without these |
| Sprint 3 | Phase 19 | R15–R20 (6 × P2) | 6 dev-days + 4 clin-days + ongoing | Mid-quarter NPS / SLA / false-positive check at week 12 |
| Sprint 4+ | Phase 20+ | R21–R22 (2 × P3) | 2.5 dev-days | Opportunistic |

---

## Section 4 — Open decisions awaiting Dr. Mabini

These are the explicit decision points raised in the audit and the implementation specs. The next Cowork session should not re-derive these from scratch — they are listed here so they can be resolved once and recorded.

| ID | Question | Status | Notes |
|---|---|---|---|
| **D1** | Should the controlled-substance policy (R2) be reviewed by external counsel before signing? | **Open** | Recommended yes. The doc itself is content-complete; only the signature page is blank. |
| **D2** | Sprint 1 calendar window — which calendar weeks should the remaining Sprint 1 work occupy? | **Default: starting now** | Effort estimate is 12 hours; assume it lands in the next focused session. |
| **D3** | R17 Spanish translation budget — is professional medical translator budget available, or defer until budget allocated? | **Default: defer, ship i18n plumbing only** | Spanish strings remain TODO; English baseline ships. |
| **D4** | R19 pricing transparency — which rates and which payers should be listed publicly? | **Default: placeholder values in `practice_settings.rate_card`** | User to fill actual rates later via /admin/practice-settings/. |
| **D5** | R20 partnership-review cadence — quarterly per book, or monthly initially? | **Default: quarterly** | Can move to monthly if early-operations volatility warrants. |
| **D6** | Anthropic BAA status — should R10 (patient AI summary) ship with template-fallback now, or wait for BAA-signed LLM version? | **Default: template fallback now** | LLM path stubbed; activates without UI change once BAA signs. |
| **D7** | Active medical-license inventory — what is the actual current list of licensed states + numbers + DEA registrations to fill into `docs/compliance/licensure.md` §1? | **Open** | Currently shows Illinois only as placeholder. |
| **D8** | Doxy.me account credentials + admin-panel URL for R14 configuration audit | **Open** | Dr. Mabini personally walks the Doxy admin panel; results go to `docs/compliance/doxy-config.md`. |

---

## Section 5 — Awaiting clinician sign-off (compliance posture)

The following compliance documents are content-complete but the signature pages are blank. These are not blocking for Sprint 1 *implementation* but ARE blocking for any first-patient encounter (per §0.4 a clinical operation cannot claim "compliant" without signed policies).

| Document | Signature line state | Next action |
|---|---|---|
| `docs/compliance/controlled-substances.md` | Blank | Dr. Mabini review + (recommended) counsel review + sign + date |
| `docs/compliance/licensure.md` | Blank | Dr. Mabini fills in §1 active-license table from actual records + signs §10 |
| `docs/compliance/standard-of-care.md` | **NOT YET CREATED** | Sprint 2 R12 work — Implementation Specs §B.3 has the verbatim template |
| `docs/compliance/doxy-config.md` | **NOT YET CREATED** | Sprint 2 R14 — Dr. Mabini walks Doxy panel, fills template |
| `docs/compliance/malpractice-coverage-2026.md` | **NOT YET CREATED** | Sprint 2 R13 — Dr. Mabini sends letter using template in Implementation Specs §B.4 |
| `docs/clinician/webside-standard.md` | **NOT YET CREATED** | Sprint 3 R15 — Implementation Specs §B.5 has the verbatim template |

---

## Section 6 — Update protocol (binding on every future Cowork session)

This file is the **single source of truth** for sprint state. Every session that lands work on a Phase 17+ recommendation must:

1. **Read this file at session start** before opening any code file.
2. **Update Section 0** (timestamp + last commit + deployed-state) and the relevant items in Section 1 / Section 2 in the **same commit** that lands the code change. Never land code without updating the state file; never update the state file without a corresponding code commit (the two must travel together).
3. **Resolve Section 4 decisions inline** if the user has answered them in the session — move the row from "Open" to a brief one-line answer with a `(resolved YYYY-MM-DD)` stamp.
4. **Add Section 5 sign-off entries** for any new compliance document created.
5. **Promote sprint-completion** by updating Section 0's `Active sprint` field and adding a new row to Section 3 indicating which sprint just closed. The prior sprint's Section 1 detail is preserved (don't delete completed work; future sessions and audits depend on the historical detail).

**Tripwire.** Any Cowork session that finishes a Phase 17+ work item without updating this file is a §0.4 violation in progress. The file should be the second file opened (after `CLAUDE.md`) and the second-to-last edited (the last is the git commit).

---

## Section 7 — Quick command reference

For the next session — the exact commands to pick up cleanly:

```bash
# Confirm work-tree state
cd /Users/beans/Developer/MountZara/MIGS
git status
git log -1 --stat                      # see the Phase 17 backend commit
git diff HEAD                          # confirm clean tree (no uncommitted work)

# Read state on a fresh session
cat docs/SPRINT_STATE.md               # this file
cat docs/compliance/controlled-substances.md  # R2 policy posture
cat docs/compliance/licensure.md       # R3 policy posture
cat functions/_lib/licensure.js        # the licensure helper

# When Sprint 1 follow-up work is done — the schema deploy
wrangler d1 execute mountzara-clinical --remote \
    --file=schema/0018_phase17_telehealth_safety.sql

# When ready to deploy
./scripts/deploy-prod.sh "phase17(sprint1): R1+R2+R3+R4+R5 complete"

# After deploy — the comprehensive audit
/opt/homebrew/bin/python3 scripts/regression_audit.py --all
```
