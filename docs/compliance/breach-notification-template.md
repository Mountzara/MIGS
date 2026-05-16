# Breach Notification Template

Per HIPAA §§164.402–164.414 (Breach Notification Rule). Activated when a confirmed PHI breach affects one or more patients. Substitute the bracketed placeholders before sending. Keep a copy of every sent notification in `r2://mountzara-content/legal/breach-notifications/<YYYY-MM-DD>-<incident-id>.pdf`.

## 0. Definitions

A **breach** is the acquisition, access, use, or disclosure of PHI in a manner not permitted under the Privacy Rule that compromises the security or privacy of the PHI. Unauthorized exposure of encrypted PHI where the encryption key was NOT also compromised is presumed NOT a breach for notification purposes (HHS Safe Harbor) — but document the incident regardless. When in doubt, notify.

## 1. Initial decision tree (run within 24 hours of discovery)

1. **Is PHI involved?** If no — log incident in `audit_log` with action='security_incident' and a short description. No notification needed.
2. **Was the PHI encrypted at rest AND in transit AND was the key NOT compromised?** If yes — log Safe-Harbor incident in `audit_log` with action='security_incident', set details.safe_harbor=true, document why we believe the key is uncompromised. No notification needed but keep a paper trail.
3. **Was PHI exposed in plaintext, or was the master key potentially compromised?** Proceed to §2.
4. **Number of affected patients?** Count from `audit_log` queries scoped to the incident window.

## 2. Risk assessment (HIPAA §164.402(2))

Four-factor analysis — document each:

1. **Nature & extent of PHI involved.** Which data elements? (Identifiers + clinical content + financial?) What types of PHI? (Diagnosis, treatment, etc.) Re-identification risk?
2. **Identity of the unauthorized recipient.** External attacker, internal staff, business associate, anonymous web visitor?
3. **Whether PHI was actually acquired or viewed.** Logs / forensics confirm vs. merely possible.
4. **Mitigation extent.** Were access credentials revoked? Were the systems patched? Was the unauthorized party compelled to delete copies?

If the four-factor analysis concludes a **low probability** that PHI was compromised, the operator MAY choose not to notify — but document the conclusion in writing and keep the analysis on file for six years.

## 3. Notification timeline

- **< 60 days** from discovery: notify affected patients via certified mail (preferred) or email (acceptable if the patient elected electronic notice in the portal).
- **< 60 days** from discovery: notify HHS via the OCR Breach Portal at https://ocrportal.hhs.gov/ocr/breach/wizard_breach.jsf
- If **≥ 500 patients** affected: also notify HHS within 60 days AND notify "prominent media outlets serving the state" (in practice: state newspapers + radio if any operate in the practice's state).
- If **< 500 patients** affected: include in the annual aggregate report submitted to HHS by 60 days after year-end.

## 4. Patient notification letter template

(Send via certified mail OR email if the patient elected portal notifications.)

> Subject: Important notice about your protected health information
>
> Dear [Patient first name],
>
> We are writing to inform you of an event that may have affected the privacy of your protected health information (PHI) held by Mount Zara LLC, your gynecologic surgery practice.
>
> **What happened**
> On [discovery date], we identified [brief plain-language description — e.g. "an unauthorized access to one of our digital systems," or "a misdirected email containing your records"]. The unauthorized event occurred on [event date] and was discovered on [discovery date].
>
> **What information was involved**
> The information potentially affected was: [list — e.g. your name, date of birth, contact information, and a summary of clinical notes from your [DATE] visit]. The information involved [did/did not] include your Social Security Number, full date of birth, or financial information.
>
> **What we are doing**
> We immediately [revoked the unauthorized access / contained the system / engaged forensic experts / rotated all credentials / updated our security controls]. We have notified the U.S. Department of Health and Human Services as required by law. We have also [other specific remediation].
>
> **What you can do**
> [If financial PHI involved:] We recommend you place a fraud alert on your credit reports with the three credit bureaus: Equifax (1-800-685-1111), Experian (1-888-397-3742), and TransUnion (1-888-909-8872).
> [Always:] Watch for any suspicious activity on accounts and statements that may relate to your care or insurance. If you see anything unusual, contact your insurance carrier and us directly.
>
> **For more information**
> If you have questions about this incident or your information, contact us at info@mountzara.com or [practice phone]. We have set up a dedicated phone line at [number] staffed Monday–Friday 9:00 AM – 5:00 PM Central time for at least 90 days following this notice.
>
> We deeply regret this incident and the worry it may cause you. Your trust is the foundation of our practice, and we are committed to safeguarding it.
>
> Sincerely,
>
> Chris Mabini, DO
> Mount Zara LLC

## 5. HHS Breach Portal submission

The portal walks the operator through these fields (have all of them ready before logging in):

- Covered entity name, NPI, address, point-of-contact email/phone
- Number of individuals affected
- Type of breach (theft, loss, unauthorized access/disclosure, hacking/IT incident, improper disposal, other)
- Location of breached information (laptop, network server, email, EHR, paper records, other electronic media)
- Type of PHI involved (demographic, financial, clinical, other)
- Brief description of the breach (10,000 character cap; redact patient identifiers)
- Safeguards in place before the breach
- Actions taken in response

## 6. Internal audit row

Every notification sent gets one row in `audit_log`:

- `action = 'data_breach_notification'`
- `record_type = 'patient'` (one row per affected patient)
- `record_id = <patient_id>`
- `details_json = { incident_id, notification_method, notification_sent_at, notification_received_confirmation_at }`

A separate row with `action = 'data_breach_hhs_filing'` records the HHS portal submission with the OCR-assigned case number.

## 7. Post-incident review

Within 30 days of the notification deadline, the operator runs a blameless post-incident review:

- What was the root cause?
- What controls failed?
- What controls would have caught this earlier?
- What changes are required (technical + procedural)?
- When will the changes be implemented?

The review document goes in `r2://mountzara-content/legal/breach-notifications/<incident-id>-postmortem.md`. The §11.6 / §11.7 sections of CLAUDE.md may need to be updated based on root cause; if so, do so in the same PR that lands the technical fix.

## 8. Last reviewed

2026-05-16 (Phase 7 Round A initial draft).
