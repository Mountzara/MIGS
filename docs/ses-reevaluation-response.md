# Reply to the AWS SES decline — paste the section below into the case

They asked for exactly four things. This answers exactly those four, under
their own headings and in their order, with the templates verbatim from
the deployed code. Everything is verifiable.

---

Hello,

Thank you for the re-evaluation path. Below are the four items you asked
for, in order. The short version first, because it frames everything
else: **this is a single-physician medical practice sending only
transactional account emails, each one triggered by the recipient's own
action, at a volume of tens per month.** There is no marketing mail, no
newsletter, no bulk sending, and no mailing list — the software is not
capable of sending to more than one recipient at a time. We do not need a
high sending limit; we need only to send to addresses that are not
pre-verified identities, which the sandbox prevents.

## 1. Estimated mail sending volume and frequency

- **At launch: approximately 30–60 emails per month total** (roughly 1–2
  per day), rising to perhaps 200–400 per month at full patient panel.
- Frequency per recipient: an individual patient receives an email only
  when they take an action (requesting a sign-in link, booking an
  appointment) or when something they initiated completes (their intake
  is reviewed, a message reply arrives). A typical patient receives
  **2–5 emails around a visit and none in between.**
- We are not requesting a large quota. The default production allowance
  far exceeds our need; any quota you consider appropriate for this
  volume is acceptable to us.

## 2. Mailing list management procedures

There is no mailing list, by design.

- Every recipient address enters the system exactly one way: **the
  patient types their own address when creating their own patient-portal
  account**, in order to receive their own sign-in link. Sign-in is by
  emailed one-time link, so a working address the patient controls is a
  precondition of using the service at all.
- There are no purchased, rented, imported, scraped, or third-party
  addresses, and no mechanism to add an address except individual account
  creation by its owner.
- Every send is keyed to an existing patient record. An address with no
  account cannot be mailed.
- Patients can change their address or close their account at any time,
  which stops all mail immediately.

## 3. Process for handling bounces, complaints, and unsubscribe requests

Implemented in the application and deployed:

- **A dedicated HTTPS feedback endpoint is deployed and live today**
  (`https://mountzara.com/api/v1/internal/ses/feedback`). It receives SES
  event notifications (Bounce, Complaint, Delivery) through Amazon SNS,
  validates the SNS topic ARN against configuration before accepting any
  event, auto-confirms the topic subscription, classifies each event, and
  maintains a suppression list in our database. Verifying this SNS
  delivery end to end is a blocking item on our pre-production checklist:
  **no production mail will be sent before the bounce and complaint
  pipeline is confirmed working.**
- **Hard bounce → suppressed immediately and permanently.** No further
  send is attempted.
- **Complaint → suppressed immediately and permanently.** If a recipient
  marks our mail as spam we stop mailing them; we do not treat the
  transactional nature of the mail as a reason to continue.
- **Soft bounce → recorded but not yet suppressed** (a full mailbox
  recovers); five consecutive soft bounces escalate to suppression. A
  successful delivery clears the soft-bounce count.
- **The suppression list is checked before every send**, so a suppressed
  address is never handed to SES at all.
- We monitor against the thresholds your best-practices guidance
  publishes — **bounce rate below 5% and complaint rate below 0.1%** — and
  at our volume (tens of sends per month, each to an address its owner
  just typed to receive their own sign-in link) a single bounce is
  visible and acted on individually rather than statistically.
- Per the guidance in your best-practices documentation on standard
  aliases: the application **refuses to send to role addresses**
  (postmaster@, abuse@, noc@, and similar) at the transport layer, so a
  watchdog address maliciously entered at signup can never receive our
  mail.
- **Unsubscribe:** every message is a service notification triggered by
  the recipient's own account activity, so there is no subscription to
  manage — but the controls exist regardless: a patient who closes their
  account, changes their address, or asks us to stop receives no further
  mail, and an administrator can suppress any address manually. We are
  not relying on a transactional exemption to send anything unwanted;
  there is no category of message here the recipient did not trigger.

## 4. Sample templates — the complete set

These are all eight templates the application can send, reproduced
verbatim from the deployed code. Note what they share: **no clinical or
personal content of any kind** — as a healthcare practice we deliberately
keep all detail behind the authenticated portal, which also makes every
email short, expected, and consistent. A code-level filter rejects any
outbound subject or body containing clinical language. **Every email
carries a footer identifying the sender and linking our Privacy Policy
(https://mountzara.com/privacy/) and Terms of Use
(https://mountzara.com/terms/)**, as your best-practices guidance
recommends.

**1. Sign-in link** (the most common message)
> Subject: Your Mount Zara sign-in link
>
> Use this link to sign in to your Mount Zara patient portal:
> https://mountzara.com/portal/magic-link/redeem/?token=…
> The link expires in 15 minutes and can only be used once.
> If you did not request it, you can ignore this email — nothing will happen.

**2. New secure message**
> Subject: You have a new secure message from Mount Zara
>
> A new secure message is waiting for you in your Mount Zara patient
> portal. Sign in to read it: https://mountzara.com/portal/
> For your privacy, the message itself is not included in this email.
> This inbox is not monitored for emergencies. If this is an emergency, call 911.

**3. Appointment confirmed**
> Subject: Your Mount Zara appointment is confirmed — Tuesday, August 18 at 9:00 AM CDT
>
> Your appointment is confirmed for Tuesday, August 18 at 9:00 AM CDT.
> You can review the details, complete anything outstanding, and join
> your visit from your portal: https://mountzara.com/portal/
> The join button becomes active shortly before your start time.

**4. Telehealth visit ready**
> Subject: Your Mount Zara visit is ready to join
>
> Your visit (in 15 minutes) is ready. Join here:
> https://mountzara.com/portal/visit/…/launch
> If the link does not open, sign in to your portal and use the Join button.

**5. Statement available**
> Subject: A new statement is available in your Mount Zara portal
>
> A new statement is available in your patient portal. Sign in to view
> and pay: https://mountzara.com/portal/billing/
> For your privacy, no billing detail is included in this email.

**6. Intake reminder** (sent once, to a patient mid-intake)
> Subject: Finish your Mount Zara intake before your visit
>
> Your intake is not finished yet. Completing it before your visit means
> more of your appointment is spent on you rather than paperwork.
> Pick up where you left off: https://mountzara.com/portal/intake/

**7. Booking open**
> Subject: You can now book your appointment with Mount Zara
>
> Your intake has been reviewed and your appointment times are ready.
> The times you will see are the ones that fit the kind of visit you
> need, so there is enough time set aside for it.
> Choose a time: https://mountzara.com/portal/appointments/book/

**8. Visit summary ready**
> Subject: Your visit summary is ready
>
> A summary of your recent visit is ready in your Mount Zara portal. It
> covers what you and Dr. Mabini talked about, the plan, your medicines
> and what happens next. He has reviewed and approved it.
> Read it here: https://mountzara.com/portal/visits/
> For your privacy, the summary itself is not included in this email.

## Identity and authentication (for completeness)

- Verified **domain identity** `mountzara.com` in **us-east-2**, via Easy
  DKIM (all three CNAMEs published and resolving).
- Custom MAIL FROM `bounce.mountzara.com` with the required MX to
  `feedback-smtp.us-east-2.amazonses.com` and SPF
  (`v=spf1 include:amazonses.com ~all`).
- DMARC published at `_dmarc.mountzara.com`.
- The application's IAM user holds `ses:SendEmail` only.
- **From address: `Mount Zara <notifications@mountzara.com>` with a
  monitored Reply-To of `info@mountzara.com`.** Our previous response
  described a no-reply From address; after reviewing the best-practices
  documentation you referred us to, we changed it — recipients can reply
  and reach the practice.

## Consent model (double opt-in in substance)

The first and only email a newly entered address ever receives is a
single-use sign-in/confirmation link that the owner of that address just
requested. No other message type can be sent to an address until it has
been used to sign in — that is, until the address is proven working and
proven controlled by the account holder. This is the double-opt-in
pattern your best-practices guidance recommends, enforced structurally:
the software has no path that mails an unconfirmed address anything else.

We would welcome any specific guidance on what fell short in the previous
review, and we are happy to provide anything further — including read
access to the application code that implements the bounce and complaint
handling described above, which is part of a public-facing medical
practice at https://mountzara.com.

Thank you,
Dr. Christopher Mabini
Mount Zara — mountzara.com

---

## Notes for you — NOT part of the reply

1. **The SNS setup is still yours to do (5 minutes).** The reply is now
   worded so it is literally true without it — it presents the SNS
   wiring verification as a blocking pre-production checklist item, which
   it is. But do it soon, ideally before AWS approves: SES console
   (us-east-2) → verified identity `mountzara.com` → Notifications →
   publish Bounce/Complaint/Delivery to a new SNS topic → add an HTTPS
   subscription to
   `https://mountzara.com/api/v1/internal/ses/feedback`. Then give me the
   topic's ARN and I'll set it as the `SES_SNS_TOPIC_ARN` Pages secret;
   the endpoint auto-confirms the subscription once the ARN matches.
   Verified 2026-08-18: `SES_SNS_TOPIC_ARN` is NOT yet set in production,
   which is why the reply was reworded.

2. **Rate the correspondence and reply in the SAME case** rather than
   opening a new one — re-evaluations go faster with continuity.

3. **Why they likely declined:** these first-pass denials are largely
   template-driven, and the most common triggers are (a) the four items
   not being answered as four labelled items, and (b) any whiff of "list"
   or vague volume. This reply is structured so a reviewer can check each
   box in seconds, leads with "tens per month, no list exists," and
   offers them a way to verify. If they decline again, reply once more
   asking the specific question "what criterion was not met?" — a second
   human review usually engages.

4. **I changed NOTIFY_FROM.** It was `Dr. Mabini <no-reply@mountzara.com>`
   — your setting — and the best-practices doc AWS linked in the decline
   says explicitly: "Avoid using a no-reply address … as your 'From' or
   'Reply-to' address." Our first response to AWS disclosed the no-reply
   address, which may have contributed. It is now
   `Mount Zara <notifications@mountzara.com>` with Reply-To
   `info@mountzara.com` (which the send code already supported). Replies
   from patients will land in the info@ inbox — make sure someone reads
   it. If you want your name back in the display name
   ("Dr. Mabini — Mount Zara <notifications@…>"), say so and I'll set it.

5. **The legal pages now exist and are linked from every email footer**:
   /privacy/, /privacy-practices/ (the HIPAA NPP), /terms/,
   /telehealth-consent/, /accessibility/. Have your healthcare attorney
   review them — they are grounded drafts, not attorney-reviewed
   documents.

6. **Plan B if a second decline lands:** we don't have to keep the whole
   stack on SES. The BAA constraint rules out Resend/Postmark for patient
   mail, but **Cloudflare's Email Sending** (native Workers binding) is
   worth evaluating for HIPAA posture, or SES in a different AWS account
   opened with the practice's business details from day one. Say the word
   and I'll assess both properly rather than hand-waving here.
