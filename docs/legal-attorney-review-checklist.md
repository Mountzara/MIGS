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

## B. For counsel — could not be verified or is judgment

1. **OMBC notice-to-consumers exact text.** California regulations
   prescribe specific wording (and telephone number) for the
   notice-to-consumers requirement applicable to osteopathic physicians.
   The page currently names the board and links ombc.ca.gov but omits a
   phone number rather than risk printing a wrong one. → Confirm the
   currently prescribed text under the OMBC's regulation and paste it
   verbatim.
2. **Entity details.** Pages say "Mount Zara, LLC, Chicago, Illinois"
   (entity name taken from the site's own footer). No street address is
   published anywhere on the site, and none was invented. → Confirm
   registered entity name and whether a service address should appear on
   the NPP and Terms.
3. **NPP delivery at first in-person service.** The portal flow documents
   acknowledgment for portal users; HIPAA's duty runs to *every* patient
   at first service. → Confirm the paper workflow (copy available on
   request is stated; a clinic-side acknowledgment form may be wanted).
4. **Minors and portal access.** The NPP states parental portal access
   "where granted, is limited accordingly." The software does not yet have
   a proxy-access feature, so today this is vacuously true. → When proxy
   access is built, counsel should review its minor-confidentiality
   filtering before launch.
5. **Reproductive-health privacy framing.** Drafted as *practice policy*
   plus IL/CA shield laws, deliberately not citing the 2024 federal
   reproductive-health privacy rule, which was vacated by a federal
   district court in 2025. → Confirm current litigation posture and
   whether counsel prefers statutory citations (e.g., specific IL/CA
   shield provisions) named in the text.
6. **Telehealth consent scope.** Drafted as information + recorded
   acknowledgment. Some practices prefer a signature-style standalone
   consent with enumerated initials. → Judgment call on form.
7. **Terms: liability and venue.** Website-scoped limitation with an
   explicit carve-out preserving all care-related rights; IL law, Cook
   County venue, CA anti-waiver acknowledgment. **No arbitration clause
   was added on purpose** — medical arbitration agreements trigger
   separate statutory formalities (e.g., CCP §1295 in California) and
   should never ride inside website terms. → Confirm.
8. **CCPA/CPRA applicability.** The privacy policy states the practice is
   generally below the statutory thresholds while honouring access and
   deletion requests regardless. → Confirm threshold analysis annually.
9. **Accessibility statement.** States WCAG 2.1 AA as the working standard
   and describes real, mechanical enforcement (pixel-measured contrast
   gating, reduced-motion). It deliberately does not claim conformance. →
   Confirm comfort with the phrasing.
10. **Retention specifics.** The privacy policy says record retention is
    "measured in years" without quoting statutes, since physician
    retention rules differ from the hospital ten-year rule in IL and CA
    has its own scheme. → Counsel may wish to state exact periods in the
    practice's records policy (internal), not necessarily on the page.

## C. Mechanics counsel should know

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
