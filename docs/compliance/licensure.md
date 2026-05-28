# Mount Zara — State Licensure Policy and Tracker

**Status:** DRAFT — pending Dr. Mabini review and verification of active license inventory
**Document owner:** Chris Mabini, DO
**Created:** 2026-05-27
**Last reviewed:** [pending first review]
**Next review:** at every license addition, renewal, or compact-status change

---

## Section 1 — Active medical licenses

Dr. Chris Mabini, DO, holds active medical licenses in the states listed below. **This table is the source of truth for the per-state intake gate** (see `functions/_lib/licensure.js`). Any change to this table must also update `practice_settings.licensed_states_json` (see §4).

| State | License number | Active dates | DEA registration | Compact status |
|---|---|---|---|---|
| Illinois | _[to fill]_ | _[from]_ – _[renewal date]_ | _[number]_ | Compact member state |
| _[Add additional states as licensure expands]_ | | | | |

---

## Section 2 — Interstate Medical Licensure Compact (IMLC) posture

The **Interstate Medical Licensure Compact**, administered by the Federation of State Medical Boards (FSMB), allows physicians licensed in one compact-member state to obtain a license in another compact-member state through a single application path (rather than full per-state license application). As of 2026 the compact has approximately forty member states.

**Cost structure (as of 2026 — re-verify at every use):**

- Single IMLC application fee: $700.
- Per-state additional license fee: set by each receiving state (typically $100–$700).
- Per-state ongoing renewal: standard renewal cycle for that state.

**Mount Zara's posture toward the IMLC:** [active / passive / not participating — to be set by Dr. Mabini]

The strategic decision on which states to add via IMLC is informed by:

1. Patient-source-state analytics from `/admin/analytics/` (which states are producing intake attempts that get blocked under §4 below).
2. CBG/MIGS demand in candidate states (population, OB/GYN capacity, subspecialty gap).
3. Operational complexity of adding the state (per-state malpractice coverage confirmation, e-Rx state restrictions, PDMP integration).

---

## Section 3 — Established-patient temporary out-of-state encounters

Four states explicitly permit an established patient temporarily traveling outside their home state to be seen by their out-of-state clinician without requiring the clinician to hold a license in the temporary state:

- **Iowa**
- **Kansas**
- **Connecticut**
- **Oregon**

All other states are either silent or expressly require the clinician to hold a license. Joshi & Welch (2023, p. 156) read state silence as "have more important things to worry about," but this is not a legal defense in a malpractice action.

**Mount Zara's policy is conservative:** established patients temporarily in any non-listed state require an admin override before the visit can proceed, with the rationale documented in the chart. Patients should be informed of this constraint at the time of any out-of-state travel.

---

## Section 4 — Code-level enforcement

The `functions/_lib/licensure.js` module is the **single source of truth** for license-state validation in the platform. All of the following code paths consult this module:

- The intake submission endpoint (`functions/api/v1/patient/intake/[intake_id]/submit.js`) — blocks submission when the patient's state is not in the licensed list.
- The AI scheduling triage (`functions/api/v1/patient/intake/[intake_id]/triage.js`) — short-circuits before LLM call if the patient's state is not licensed.
- The appointment booking flow (`functions/api/v1/patient/appointments/book.js`) — final check at book time as defense-in-depth.
- The admin practice-settings UI (`/admin/practice-settings/`) — read/write surface for the licensed-states list.

The list is stored at `practice_settings.licensed_states_json` as a JSON array of two-letter state codes (e.g., `["IL","IN","WI","MI","FL"]`). Any change to this list is audit-logged with the editing clinician's user ID.

---

## Section 5 — Annual renewal calendar

| State | License renewal due | Action lead time | DEA renewal due |
|---|---|---|---|
| Illinois | _[date]_ | 60 days | _[date]_ |
| _[Add additional states]_ | | | |

A calendar entry for each renewal is set at 60 days before the due date. Failure to renew on time means immediate suspension of patient bookings in that state (the `licensure.js` helper reads the active-states list dynamically; removing a state from the list is a one-line admin change).

---

## Section 6 — License verification at intake

When a new patient submits the intake form, the platform performs the following validation chain:

1. **State capture.** The patient's home address state is recorded in `patients.address_state` (already shipped per §11.6).
2. **License check.** The intake submission endpoint calls `isLicensedInState(state)` against the active list.
3. **If licensed:** intake proceeds to AI triage.
4. **If not licensed:** intake submission is refused with a friendly out-of-license-state message (see §7). A row is written to the `licensure_blocks` table for visibility into demand from non-licensed states (informs §2 strategic decisions).

---

## Section 7 — Patient-facing copy when state is not licensed

The following copy is shown in the portal intake form when a non-licensed state is entered, and on any subsequent attempt to submit:

> Mount Zara is currently licensed to provide care in [Illinois, Indiana, Wisconsin, Michigan, Florida]. We're not able to accept new patients in [Your State] at this time. If you're an established patient temporarily traveling, please contact us directly at info@mountzara.com so we can confirm whether your visit is permitted under your home-state license.

The state list in the copy is rendered dynamically from `practice_settings.licensed_states_json` so the copy never drifts from the enforcement.

---

## Section 8 — Federalized clinicians and special practice settings

Joshi & Welch (2023, p. 156) note that federalized clinicians practicing under the Department of Veterans Affairs, the Department of Defense, the Indian Health Service, or under federally declared disaster service do not require state licensure for cross-state encounters in those capacities. **None of these settings currently apply to Mount Zara.** If any does in the future, this policy will be amended accordingly.

---

## Section 9 — Annual review

This policy is reviewed annually in January, alongside the controlled-substances policy review (see `controlled-substances.md`) and the standard-of-care policy review (see `standard-of-care.md`). Revisions are dated; the prior version is retained as `licensure-YYYY.md`.

---

## Section 10 — Signature page

By signing below, I affirm that:

1. The Active Medical Licenses table in §1 is current and accurate as of the date of signing.
2. I will update §1, `practice_settings.licensed_states_json`, and the annual renewal calendar within seven days of any license addition, renewal, suspension, or expiration.
3. I will route any cross-state-licensure question (established-patient temporary out-of-state encounter, federalized practice scenario, IMLC application) through this policy before proceeding.

**Signed:** ____________________________________________
**Print name:** Chris Mabini, DO, FMIGS
**Date:** __________________

---

## References

- Federation of State Medical Boards. *Interstate Medical Licensure Compact.* https://www.imlcc.org
- Joshi, A. U., & Welch, B. M. (2023). *Telehealth Success: How to Thrive in the New Age of Remote Care.* Forbes Books. Chapter 21 — Medical Boards.
- Illinois Department of Financial and Professional Regulation — Medical Licensing Board.
