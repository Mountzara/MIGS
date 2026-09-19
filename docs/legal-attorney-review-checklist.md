# Attorney review checklist — mountzara.com legal pages

Prepared 2026-08-14 for review by the practice's healthcare attorney. The
five pages are live: `/privacy/`, `/privacy-practices/` (NPP), `/terms/`,
`/telehealth-consent/`, `/accessibility/`.

This file records (a) the adversarial self-review already performed and
what it changed, so counsel does not re-derive it, and (b) the items
**deliberately left for counsel** because they turn on facts or judgment
the drafter could not verify. Section (b) is the review.

---

## A. Adversarial self-review — findings already fixed

Reviewed against: 45 CFR 164.520 element-by-element; 225 ILCS 150; Cal.
Bus. & Prof. Code §2290.5; CalOPPA (Bus. & Prof. Code §22575–22579); IL
MHDDCA / AIDS Confidentiality Act / GIPA; CMIA; Civil Code §1798.82;
815 ILCS 530 (PIPA).

1. **NPP lacked the required appointment-reminder statement.**
   §164.520(b)(1)(iii)(A) requires the notice to state that the provider
   may contact the individual for appointment reminders — and the practice
   sends exactly such emails. Added, with the treatment-alternatives
   statement alongside.
2. **NPP contact block lacked a telephone number.** §164.520(b)(1)(vii)
   requires the name/title *and telephone number* of the contact. Added:
   (872) 365-3866, in both the complaints and contact sections.
3. **No specially-protected-categories section.** The practice administers
   PHQ-2/GAD-2 (mental health → IL MHDDCA), orders HIV/STI testing (IL
   AIDS Confidentiality Act; CA H&S Code), and performs family-history
   risk mapping (IL GIPA; GINA). Each is more stringent than HIPAA and
   preempts it. Added a section stating the more-protective-law rule and
   the consent posture per category.
4. **No minors' confidentiality paragraph.** IL and CA minor-consent
   statutes (contraception, pregnancy care, STI) with confidentiality
   against parental disclosure. Added, stated generally.
5. **Telehealth consent lacked the California board notice.** Because Dr.
   Mabini is a DO, the applicable board is the **Osteopathic Medical Board
   of California**, not MBC. Added the notice naming OMBC + IDFPR for
   Illinois.
6. **Telehealth consent said nothing about controlled substances.** Added
   a Ryan-Haight-shaped paragraph: telehealth prescribing of controlled
   substances is restricted and may require in-person evaluation; no
   prescription is guaranteed by booking.
7. **Privacy policy lacked the CalOPPA-mandated Do-Not-Track disclosure**
   (§22575(b)(5)–(7) — CalOPPA has *no* business-size threshold). Added.
8. **Acknowledgments were asserted but not implemented.** The telehealth
   page claimed "the portal asks you to acknowledge" before any code did.
   Now implemented end to end: signup requires and records NPP + Terms
   acknowledgment (§164.520(c) good-faith written acknowledgment,
   documented); a telehealth booking is refused (HTTP 428) until the
   telehealth consent is acknowledged once, and the acknowledgment row —
   patient, document, **document version**, timestamp — is the
   documentation contemplated by 225 ILCS 150 and B&P §2290.5.

## B. Resolved since first draft — verify rather than research

1. **OMBC notice — RESOLVED with the prescribed text.** The regulation is
   **16 CCR §1606** (not 1653.5 as first guessed). The verbatim notice —
   including (916) 928-8390, https://search.dca.ca.gov/ and
   osteopathic@dca.ca.gov — was extracted from the OMBC's own rulemaking
   document (ombc.ca.gov/laws_regulations/ntc_proplang.pdf) and
   corroborated by a county agency form in active use. It now appears
   verbatim on /telehealth-consent/ and, with a signature line, on the
   printable acknowledgment form — the latter satisfying §1606(b)(2)'s
   "written statement for all new patients, signed and dated" method.
   → Counsel: confirm the adopted text matches the proposal (Justia
   indexes §1606 as an adopted CCR section).
2. **Entity/service address — RESOLVED from the public record.** The NPP
   contact now lists 355 Ridge Ave., Evanston, IL 60202, taken from the
   practice's federal NPI registration (NPI 1992265797, practice
   location). → Counsel/owner: confirm this is the address the LLC wants
   for legal notices, vs. its registered-agent address.
3. **Paper-side NPP workflow — RESOLVED.**
   /privacy-practices/acknowledgment-form/ is a print-optimized combined
   form: NPP receipt acknowledgment + the §1606 notice with signature +
   a staff good-faith-effort section for a patient who declines to sign
   (which is what 164.520(c) actually requires be documented).
4. **2024 reproductive-privacy rule posture — RESOLVED and verified
   against HHS.** Per HHS OCR's current page: the June 18, 2025 order in
   the Texas litigation vacated most of the 2024 rule INCLUDING the
   reproductive-health NPP provisions (§164.520(b)(1)(ii)(F)–(H)) — so
   the practice-policy framing was correct and is retained — while the
   Part 2 (substance-use-disorder) NPP modifications SURVIVED with a
   compliance date of February 16, 2026, which has passed. The NPP's
   Part 2 statement was strengthened accordingly (no use/disclosure in
   proceedings against the individual absent written consent or a
   Part 2 court order). The shield citations are now specific and were
   verified against ilga.gov: **735 ILCS 40** (Lawful Health Care
   Activity Act) and **775 ILCS 55** (Reproductive Health Act) — note
   these were initially conflated and are now correct.
5. **Arbitration — RESOLVED BY DESIGN, nothing pending.** No arbitration
   clause, deliberately: medical arbitration triggers separate statutory
   formalities (e.g., CCP §1295 in California) and must never ride
   inside website terms. Counsel should simply confirm agreement.

## C. Still genuinely for counsel

1. **Proxy/parental portal access** — the software has no proxy-access
   feature yet; when built, its minor-confidentiality filtering needs
   review before launch (the NPP's minors language anticipates it).
2. **Consent form style** — information page + recorded electronic
   acknowledgment vs. a signature-style enumerated consent: judgment.
3. **CCPA/CPRA thresholds** — reconfirm annually.
4. **Internal records-retention policy** — exact IL/CA retention periods
   belong in an internal policy; the public page deliberately says
   "as required by law."
5. **California adopted-text check** for §1606 as noted in B.1.

## D. Mechanics counsel should know

- Every acknowledgment is stored in `patient_acknowledgments` with the
  **document version string** (its effective date). Revising a document
  and bumping its version automatically forces re-acknowledgment for
  telehealth consent at next booking.
- Every outbound email footer links Privacy and Terms.
- The pages are deployment-gated: a deploy fails if any of the five stops
  rendering with its expected title.
- Change process: edits to these pages should update the effective date
  in the page header and the version string in
  `functions/_lib/acknowledgments.js` in the same commit.
