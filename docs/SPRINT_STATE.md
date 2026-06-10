# Mount Zara — Live Sprint State

> **READ THIS FIRST.** Per CLAUDE.md §10.14, any Cowork session that intends to work on Phase 17 / 18 / 19 / 20 sprint items MUST read this file before touching the codebase. The file records exactly where the active sprint stands, what is committed, what is deployed, what is pending, and what is awaiting your decisions.
>
> **Update protocol.** Every Cowork session that lands work updates this file at the end of the session — same commit, never silently. The "Last updated" stamp at the top must always match the last code commit on the branch.

---

## Section 0 — At-a-glance status

| Field | Value |
|---|---|
| **Active sprint** | **Phase 18 Sprint 2 — R6–R14 (9 × P1)** — the gate before `PORTAL_PUBLIC_LAUNCH=true`. (Phase 17 Sprint 1 **CLOSED 2026-06-09** — see Section 1 + Section 8.) |
| **Last updated** | 2026-06-09 by Claude (Cowork, Fable) — **Sprint 1 CLOSED + deployed.** Tasks 10 (device-check badge), 11 (smoketest), 12 (deploy) done; D7 resolved (IL+CA); R4 launch doxy-lookup 500 fixed. |
| **Branch** | `claude/setup-mountzara-landing-01M5e6zmrBbv1hX9jmgH6xz8` |
| **Last commit on branch** | `fix(sprint1 R4): launch doxy lookup uses key-value practice_settings (was 500)` `a974ba9` (pushed to origin) |
| **Last production deploy** | CF Pages `9414b044.mountzara.pages.dev` (Sprint 1 close, 2026-06-09) — supersedes `5490890b`. |
| **Deployed to production?** | **YES** — full Sprint 1 (R1–R5 + R3 licensure gate + R4 presence + Task 10 badge + Task 11 smoketest + 5 pre-sprint compliance commits) live at `9414b044`. Smoketest `scripts/smoketest_phase17.sh` = **28/28 PASS** against production; §0.2.1 visual VERIFY of the device-check badge captured. |
| **Schema migration `0018` run against D1?** | **YES** — applied 2026-05-28. |
| **Schema migration `0020` run against D1?** | **YES** — applied 2026-06-09 (`current_state` column added to `visit_launch_attestations`; verified via `PRAGMA table_info`). |
| **PORTAL_PUBLIC_LAUNCH state** | `false` (preview gate active per §11.5.2) — flips to `true` only after Sprint 2 (Phase 18) closes. |
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

### R3 wiring — ✅ DONE 2026-05-29 (commit pending sprint-close deploy)

State-licensure gate fully wired. Patient state of residence is captured in **intake Section 1** via a new `address_state` `<select>` (`portal/intake/index.html` + `US_STATES` const), stored schemaless in `intake_section_data` (no migration needed — confirmed `section/[n].js` accepts any shape). All four touchpoints landed:

1. ✅ **Intake submit gate** — `functions/api/v1/patient/intake/[intake_id]/submit.js`. After the consent check, before status → submitted: reads Section 1 `address_state`; `422 state_required` if absent, else `422 license_state_mismatch` + `recordLicensureBlock` + audit if unlicensed. Leaves intake `in_progress` so the patient can correct it.
2. ✅ **Triage short-circuit** — `functions/api/v1/patient/intake/[intake_id]/triage.js`. In `triageForIntake`, after sections load + before the Claude call, returns `license_state_mismatch` when state is present-but-unlicensed (saves the LLM call). Defense-in-depth for the standalone `/triage` path.
3. ✅ **Booking gate — fail-closed** — `functions/api/v1/patient/appointments/book.js`. Re-reads Section 1 state via `triage.intake_id` and **affirmatively confirms** licensure before writing the appointment: a missing state, malformed value, or DB/lookup error all block (`422 license_state_mismatch` if unlicensed, `422 state_required` if unconfirmable) + block-record + audit.
4. ✅ **Admin editor** — new validated endpoint `functions/api/v1/admin/practice/licensed-states.js` (GET + PUT, server-side USPS-code validation, refuses empty list, audit-logged) + a Licensed-States checkbox picker in `admin/scheduling/index.html` Practice Settings panel (UI landed there — `admin/practice-settings/` does not exist). `SYSTEM_MAP.md` updated with the `licensure.js` lock-step row + the new route.

Gate default `["IL"]` (fails closed). Node `--check` clean on all 4 JS files; admin picker JS re-read OK. **NOT deployed.**

**Best-practice refinement (2026-05-31):** (a) intake field reframed from "state of residence" to "state where you will be located for visits" + a hint, reflecting that telehealth jurisdiction is the patient's *physical presence* at the time of care, not residence; (b) booking gate made **fail-closed** (blocks on missing state / lookup error, not only on a present-but-unlicensed state); (c) the licensure refusal returns a **consistent `422`** across submit / triage / book (was `409` at booking), distinguished by `error` code — `403` deliberately avoided to not collide with the app's auth-failure handling; (d) patient-facing copy made kinder and no longer dumps the raw state-code list (kept as the structured `licensed_states` field for the UI). Recommended follow-up: a per-visit physical-presence attestation at the R4 launch step (gold-standard point-of-care location confirmation).

> **D7 — RESOLVED 2026-06-09:** Dr. Mabini's active telehealth-eligible states are **Illinois** (home/base) and **California**. `docs/compliance/licensure.md` §1 + §5 updated (license numbers/DEA/expiry still pending from his records). The production `practice_settings.licensed_states_json` is set to `["IL","CA"]` via `PUT /api/v1/admin/practice/licensed-states` at the sprint-close deploy (the endpoint goes live with this deploy) + verified by the Task 11 smoketest phase C.

### R4 — Privacy attestation interstitial + launch endpoint ✅ DONE 2026-05-28

5. ✅ `portal/visit/launch/index.html` — interstitial with two attestation cards (privacy + alone-or-chaperoned), Apple-glass styling, purple accent, T-15-min gate hint, opens room URL only on POST success. Dynamic appointment id resolved client-side from URL path.
6. ✅ `functions/api/v1/patient/appointments/[id]/launch.js` — POST-only. Validates ownership, status=`scheduled`, modality=`telehealth`, chaperone (if required), T-15-min release window (`launch_too_early` if early, `launch_window_closed` if >30min past end), and both attestations true. Writes a `visit_launch_attestations` row with IP hash + UA. Returns `{room_url, expires_at, appointment}` on success. Every call audit-logged.
7. ✅ `_redirects` — wildcard `/portal/visit/*/launch` → `/portal/visit/launch/index.html 200` so the dynamic path resolves to the static SPA. Patient GET endpoints already do NOT expose `doxy_room_url` (audit: only `book.js` write side + `admin/*` read sides reference it; patient read endpoints are clean).

**R4 launch doxy-lookup fix ✅ 2026-06-09 (Task 12).** The launch success path read `SELECT doxy_room_url FROM practice_settings` — a non-existent column (the table is key-value: `clinician_id`/`key`/`value_json`). It threw a Worker exception (CF error 1101 → HTTP 500) on every successful, in-window, licensed launch — a latent bug present since R4, never caught because the success path was never exercised end-to-end. `smoketest_phase17.sh` phase F caught it. Fixed to read `key='doxy_room_url'` + parse `value_json` exactly like `book.js::getDoxyRoomUrl`. `node --check` clean; smoketest phase F now 200.

**R4 enhancement — per-visit physical-presence attestation ✅ 2026-05-31.** The launch interstitial adds a third gate: a *"Which U.S. state are you in right now?"* selector. `launch.js` re-verifies licensure against the patient's **current** location (the gold-standard telehealth jurisdiction = point-of-care location, which can differ from the intake-declared state if the patient travelled) and **fails closed**: `403 location_attestation_required` if not confirmed, `422 license_state_mismatch` if the clinician isn't licensed there. The confirmed state is persisted on the `visit_launch_attestations` row + audit log, with a `licensure_blocks` row on block. **Requires schema migration `0020_phase17_visit_presence.sql` (apply at sprint-close deploy).** `node --check` clean (endpoint + interstitial inline JS). NOT deployed.

### R5 — Patient device + connection test ✅ DONE 2026-05-28

8. ✅ `portal/tech-check/index.html` — four checkpoint cards (camera / microphone / speaker / network). `getUserMedia` for cam preview + mic level detection (3-sec sample, threshold 3 in 0-128 byte deviation), 440Hz oscillator tone with click-to-confirm hearing, speed test fetches a known CDN asset and computes kbps. Per-component failure copy includes remediation hint. "Run all" button sequences the checks. POSTs to `/api/v1/patient/tech-check` when all 4 have a verdict. §3.10-compliant Apple-glass cards, purple accent.
9. ✅ `functions/api/v1/patient/tech-check.js` — POST-only. Validates patient session + preview gate. `network_ok = (network_kbps >= 600)` (Doxy.me floor). `overall_ok = AND of all four`. Persists one `tech_check_results` row per call. If `appointment_id` supplied, defense-checks ownership before binding. Audit-logged with the result summary.
10. ✅ **Admin device-check badge — DONE 2026-06-09 (Task 10).** `functions/api/v1/admin/appointments.js` (GET list) + `functions/api/v1/admin/cases/[patient_id].js` (keystone, `upcoming` only) LEFT-JOIN the most-recent `tech_check_results` row per appointment (correlated subquery on `idx_tech_check_appointment`; no N+1) and emit a compact `device_check` `{status, checked_at, network_kbps, failures}` per row. Rendered as an inline badge — "Device check passed · <time>" (green) / "Device check FAILED · <components>" (red) / "Device check not yet run" (neutral) — by `admin/scheduling/index.html::deviceCheckBadge` (scheduled telehealth rows) + `admin/cases/_t/index.html::deviceCheckBadge` (upcoming telehealth rows). `node --check` clean on all 4 files; no blue tokens (§3.10). `SYSTEM_MAP.md` §6 + §10 updated same-commit. **Visual VERIFY deferred to the post-deploy step (§0.2.1) — badge needs admin auth + seeded tech-check data on the deployed env.** NOT deployed.

### Chaperone-confirm modal UI (≈1 h)

11. ✅ **Chaperone-confirm modal — DONE 2026-05-31.** `portal/appointments/book/index.html` intercepts the Confirm click when a telehealth slot is selected for a `requires_chaperone` visit type and opens a §3.10 modal (3 radio methods — `partner_present` / `adult_family_member` / `clinic_assistant` — plus "Switch to an in-person visit" + "Cancel"). Continue passes `chaperone_confirmed` + `chaperone_confirmation_method` through the existing book.js POST (refactored into `doBook(extra)`); "Switch to in-person" flips the modality toggle + reloads slots. `available.js` now surfaces `requires_chaperone` + `chaperone_rationale` on the triage response. `node --check` clean (available.js + book inline JS); 0 blue tokens. NOT deployed.

### Sprint-close (must come last)

12. **Schema migration deploy** — `wrangler d1 execute mountzara-clinical --remote --file=schema/0018_phase17_telehealth_safety.sql`. Idempotent (every CREATE uses IF NOT EXISTS) so re-runs are safe.
13. ✅ **BUILT 2026-06-09 (Task 11)** — `scripts/smoketest_phase17.sh` (sources `_lib_admin_auth.sh::resolve_admin_auth` §10.3.1; logs in as the seeded Jane via the operator-preview gate path; uses wrangler D1 for the released-triage + telehealth-appt fixtures with teardown). `bash -n` clean; the non-mutating live subset (anonymous-gate 404s + R5 tech-check 200) passes 9/9 against production. The R3/R4 fixture assertions (licensure 422s, chaperone 409, launch ladder) run green only once the unpushed R3/R4 code is deployed — that's the authoritative run at Task 12 step 5. **Smoketests** — coverage:
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
| Sprint 1 ✅ **CLOSED 2026-06-09** | Phase 17 | R1–R5 (5 × P0) | 6 dev-days + 3 clin-days | First real patient visit cannot proceed without these — **met; deployed `9414b044`** |
| Sprint 2 (**ACTIVE**) | Phase 18 | R6–R14 (9 × P1) | 7 dev-days + 3 clin/admin-days | Public launch (PORTAL_PUBLIC_LAUNCH=true) cannot proceed without these |
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
