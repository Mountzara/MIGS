# Mount Zara — Controlled Substances Prescribing Policy

**Status:** DRAFT — pending Dr. Mabini review and counsel sign-off
**Document owner:** Chris Mabini, DO
**Created:** 2026-05-27
**Last reviewed:** [pending first review]
**Next review:** January [year following first review]

---

## Section 1 — Authority and scope

This policy governs the prescribing of controlled substances by Mount Zara clinicians. It is grounded in:

- The federal **Ryan Haight Online Pharmacy Consumer Protection Act of 2008** (21 USC § 829(e)), which requires at least one in-person medical evaluation of a patient before a controlled-substance prescription is issued via the internet, with narrow statutory exceptions.
- **Drug Enforcement Administration (DEA) registration requirements** (21 CFR Part 1300 et seq.).
- **State controlled-substances acts** in every state where Mount Zara clinicians hold an active license.
- The Mount Zara internal policy posture, which is intentionally more conservative than the most lenient interpretation of federal rules.

The policy applies to every prescription issued under the Mount Zara name — whether composed during an in-person visit, a telehealth visit, by phone, by secure message, or by any electronic prescribing system (currently DoseSpot, per Phase 16) — and to every clinician practicing under the practice.

---

## Section 2 — Controlled-substance schedule definitions

The U.S. federal Controlled Substances Act defines five schedules:

- **Schedule I** (e.g., heroin, MDMA, LSD): no accepted medical use; prescribing is prohibited under any circumstances.
- **Schedule II** (e.g., oxycodone, hydrocodone, morphine, fentanyl, methylphenidate, methamphetamine): highest abuse potential among medications with accepted medical use; subject to the most stringent prescribing, refilling, and dispensing requirements.
- **Schedule III** (e.g., buprenorphine, ketamine, some testosterone formulations): moderate-to-low physical and high psychological dependence potential.
- **Schedule IV** (e.g., benzodiazepines, tramadol, zolpidem, modafinil): lower abuse potential than Schedule III with accepted medical use.
- **Schedule V** (e.g., pregabalin, certain low-dose codeine preparations): lowest abuse potential among controlled substances with accepted medical use.

Buprenorphine carries a federal DATA-2000 / SUPPORT Act carve-out permitting initial telehealth prescribing for opioid use disorder treatment in certain situations. **This carve-out is not currently applicable to the scope of Mount Zara's CBG/MIGS practice** and is documented here only for completeness.

---

## Section 3 — Mount Zara baseline prescribing standard

**Mount Zara will not issue any Schedule II, III, IV, or V prescription via telehealth without a prior in-person evaluation of the patient by the prescribing clinician within the past twenty-four (24) months.** This standard applies to all controlled-substance schedules without exception.

The in-person evaluation:

1. Must be documented in the patient's chart with a dated encounter note.
2. Must include a clinical assessment of the indication for which a controlled substance might subsequently be prescribed.
3. Is verified against the appointments table at the time of e-prescription composition (the DoseSpot integration enforces this read-back).

This baseline is **more conservative** than the most recent DEA proposed rules in some respects, and aligns Mount Zara with the most likely final-rule outcome under current regulatory trajectory.

Prescriptions issued without a documented in-person evaluation within the qualifying window are **policy violations** and are subject to internal review.

---

## Section 4 — Exception conditions (not currently applicable)

The Ryan Haight Act recognizes limited exceptions to the in-person-evaluation requirement. **None of these exceptions currently apply to Mount Zara**, and this section is preserved to document that fact:

- **Declared public health emergency.** Mount Zara does not operate within a presently declared public health emergency that suspends the in-person-evaluation requirement. Should one be declared and applicable, this policy will be reviewed before relying on the exception.
- **DEA-registered prescribing facility.** Mount Zara is a solo private practice; it does not operate within a DEA-registered hospital, clinic, or institutional prescribing facility.
- **Indian Health Service (IHS).** Not applicable.
- **Veterans Affairs Health System (VA).** Not applicable.
- **Buprenorphine carve-out for opioid use disorder.** Not within current scope of practice.

If any of these exceptions becomes applicable in the future, this policy will be amended in writing before relying on it.

---

## Section 5 — State-by-state additional restrictions

Several states impose restrictions beyond federal requirements. The table below summarizes additions in every state where Mount Zara holds an active license. **This table must be reviewed and re-confirmed at every license addition, license renewal, and policy review.**

| State | Federal baseline applies | Notable state additions |
|---|---|---|
| Illinois | Yes | Schedule II quantity limits per single prescription (per Illinois Controlled Substances Act); PDMP query required before Schedule II/III prescription; e-prescribing of controlled substances is required (no paper Rx) for most schedules per Illinois statute. |
| _[add additional licensed states here as they are added]_ | | |

**Specific topical restrictions that may affect CBG/MIGS practice in particular states** (audit at every license addition):

- Some states prohibit telehealth prescribing of abortion medication.
- Some states prohibit telehealth prescribing of erectile-dysfunction medication.
- Some states prohibit telehealth prescribing of dermatology-specific drugs.
- South Carolina prohibits Schedule II prescribing via telehealth without separate board approval.

---

## Section 6 — DoseSpot e-Rx integration controls (Phase 16 — currently planned, not live)

When the Phase 16 DoseSpot integration goes live, the following operational controls apply:

1. **Only Dr. Mabini** holds the EPCS (Electronic Prescription of Controlled Substances) DEA token. No other practice staff member may compose, transmit, or modify a controlled-substance order.
2. **In-person-evaluation read-back gate.** Every controlled-substance composition triggers a read-back of the patient's most recent in-person evaluation date from the `appointments` table. If the most recent in-person evaluation is more than 24 months in the past, or absent entirely, the order cannot be sent.
3. **Audit-log copy.** Every controlled-substance prescription is automatically copied to the audit log with: patient ID, drug name and schedule, quantity, refills authorized, indication code, prescribing clinician user ID, and timestamp.
4. **PDMP query proof.** The audit log entry includes a reference to the Prescription Drug Monitoring Program query result (state-specific) that was reviewed before the prescription was sent.
5. **No batch signing.** Multi-patient batch prescriptions (the operational signature of the Cerebral-style fraud pattern documented in Joshi & Welch 2023 p. 130–131) are technically impossible under Mount Zara's policy. Each prescription requires the prescribing clinician's individual review of that specific patient's clinical context.

---

## Section 7 — PDMP query workflow

For every controlled-substance prescription:

1. Dr. Mabini queries the appropriate state's Prescription Drug Monitoring Program **before** composing the order in DoseSpot.
2. In states where PDMP query is mandated by statute (Illinois, and most others where Mount Zara may add licensure), this is non-negotiable.
3. In states where PDMP query is permitted but not required, **Mount Zara's policy is to query nonetheless.** The marginal time cost is small; the safety benefit (catching multi-prescriber patterns, identifying patients at risk for drug interactions or diversion) is large.
4. The PDMP query result — flagged, unflagged, or with notable findings — is documented in the patient's chart entry corresponding to the prescription.

---

## Section 8 — Documentation requirements per prescription

Every controlled-substance prescription is documented in the patient's chart with all of the following, at a minimum:

- **Indication.** Specific clinical reason for the prescription (not just an ICD-10 code; the clinical reasoning).
- **In-person-evaluation date.** Pulled from the `appointments` table read-back.
- **Alternative treatments considered.** Specifically: which non-controlled-substance options were considered and why they were not selected for this patient at this time.
- **Quantity prescribed and refills authorized.** With explicit clinical justification for any refill authorization.
- **PDMP query result.** As documented in §7 above.
- **Patient counseling provided.** Specifically: addiction potential, safe storage, safe disposal, interaction warnings, and signs that should prompt earlier contact with the clinician.

---

## Section 9 — Standard-of-care floor

Telehealth visits at Mount Zara are held to the same standard of care as in-person visits (see `standard-of-care.md`). When a clinician determines during a telehealth encounter that a controlled-substance prescription is clinically appropriate but the patient does not have a qualifying in-person evaluation within the past 24 months, the standard-of-care response is:

1. Schedule an in-person evaluation at the earliest mutually feasible time.
2. Bridge with non-controlled alternatives where clinically reasonable.
3. Refer to an emergency department or local in-person provider when the clinical situation does not permit a wait.
4. Document the decision rationale in the chart.

A telehealth-only patient with an acute pain or anxiety complaint **is not refused care**; the care is bridged with non-controlled options and routed appropriately. The policy is about controlled-substance prescribing specifically, not about the clinical relationship.

---

## Section 10 — Cerebral cautionary precedent (informational)

Joshi & Welch (2023) document on pages 130–131 the DOJ investigation of Cerebral, a telehealth-only ADHD-treatment company that allegedly fell below the standard of care in controlled-substance prescribing. The investigation focused on operational patterns that included:

- Rapid back-to-back visits with average review times below clinical reasonableness.
- Signing of pre-filled prescription orders without independent clinical evaluation.
- Compensation incentives misaligned with patient outcomes.

Mount Zara's policy structurally prevents each of these patterns: the §11.7 AI scheduling triage allocates clinically-appropriate visit duration (45–60 minutes for complex visits), the DoseSpot composition workflow requires individual per-patient review by the prescribing clinician, and the practice is solo-clinician with no production-incentive structure that misaligns time-with-patient against prescription volume.

---

## Section 11 — Annual review and revision

This policy is reviewed annually in January by Dr. Mabini, with explicit cross-reference to:

1. **DEA regulatory updates** issued in the prior year.
2. **State controlled-substances act amendments** in every active-license state.
3. **The practice's own controlled-substance prescribing patterns** from the prior year, pulled from `/admin/analytics/`.
4. **Any incident, near-miss, or audit finding** that surfaced in the prior year.

Revisions are dated; the prior version is retained as `controlled-substances-YYYY.md` in this directory so the policy evolution is reviewable.

---

## Section 12 — Signature page

By signing below, I affirm that:

1. I have reviewed this policy in full.
2. I will operate Mount Zara's controlled-substance prescribing in accordance with the standards and workflows described above.
3. I will surface any deviation from this policy in writing within seven days of becoming aware of the deviation.

**Signed:** ____________________________________________
**Print name:** Chris Mabini, DO, FMIGS
**Date:** __________________
**Next review:** January __________________

---

## References

- Ryan Haight Online Pharmacy Consumer Protection Act of 2008 (21 USC § 829(e))
- Drug Enforcement Administration regulations (21 CFR Part 1300)
- Joshi, A. U., & Welch, B. M. (2023). *Telehealth Success: How to Thrive in the New Age of Remote Care.* Forbes Books. ISBN 979-8-88750-139-0. Chapters 15–17 on malpractice, fraud, and prescribing laws.
- Illinois Controlled Substances Act (720 ILCS 570/) — as amended.
- DEA "Telemedicine Prescribing of Controlled Substances When the Practitioner and the Patient Have Not Had a Prior In-Person Medical Evaluation" (proposed rule, 88 Fed. Reg. 12875).
