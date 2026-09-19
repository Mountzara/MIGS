# Response to AWS SES production-access review

Paste the section below into the AWS Support case. Everything in it is
verifiable against this repository and the live DNS.

---

Thank you for the follow-up. Details below.

**What this account sends, and what it does not**

Mount Zara is a single-physician gynecologic surgery practice
(mountzara.com). Every email this account sends is **transactional and
triggered by the recipient's own action** inside their patient portal
account. We send no marketing, no newsletters, no announcements, and no
bulk mail of any kind. There is no mailing list, and there is no
mechanism in the software capable of sending to more than one recipient
at a time.

There are exactly seven message types, and this is the complete list:

| Trigger | Message |
|---|---|
| Patient requests a sign-in link | One-time sign-in link, expires in 15 minutes, single use |
| Practice sends the patient a secure message | "A message is waiting — sign in to read it" |
| Patient books an appointment | Appointment confirmation with date and time |
| Patient's telehealth visit is about to start | "Your visit is ready" with a join link |
| An invoice is issued to the patient | "An invoice is ready in your portal" |
| Patient started intake but has not finished | One reminder to complete it before their visit |
| Patient's intake is reviewed and booking opens | "You can now choose an appointment time" |

**Sending volume**

This is one surgeon with no other clinical staff. Realistic volume at
launch is on the order of **tens of emails per month**, rising to perhaps
a few hundred per month at full patient panel. We are not requesting a
high sending quota — the default production limits are far more than we
need. What the sandbox blocks is not volume but the ability to email a
patient at all, since no patient's address can be pre-verified as an
identity.

**How recipient addresses are obtained**

Only one way: the patient types their own address when creating their own
portal account, in order to receive their own sign-in link. There are no
purchased lists, no imported lists, no scraped addresses, and no
third-party sources. An address that has never created an account can
never be mailed, because every send is keyed to an existing patient
record.

**Bounces and complaints**

An SNS topic will be subscribed to
`https://mountzara.com/api/v1/internal/ses/feedback`, which is deployed
and handling SES event notifications:

- **Hard bounce** → the address is added to a suppression list
  immediately and permanently. No further mail is attempted.
- **Soft bounce** → recorded but not suppressed, since a full mailbox
  recovers. Five consecutive soft bounces escalate to suppression.
- **Complaint** → suppressed immediately and permanently. If someone
  marks our mail as spam we stop mailing them, and we do not treat
  "it was transactional" as a reason to continue.
- **Delivery** → clears any accumulated soft-bounce count.

The suppression list is checked **before every send**, so a suppressed
address is never handed to SES at all. An administrator can clear an
entry by hand for the case that actually matters in a medical practice: a
patient who mistyped their address at signup, bounced, and then corrected
it must not be permanently unreachable.

**Unsubscribe**

Every message is a service message the recipient asked for by taking an
action in their account, so there is no marketing list to unsubscribe
from. Patients control delivery directly: they can change their address
or close their portal account at any time, which stops all mail. We are
not claiming a CAN-SPAM exemption to justify sending anything unwanted —
there is simply no category of message here that a recipient did not
trigger themselves.

**Content quality and privacy**

Because this is a healthcare practice, the emails are deliberately
**content-free**. They carry no clinical information — no diagnosis, no
symptoms, no appointment reason, no message text. Each says only that
something is waiting and links to the authenticated portal. This is
enforced in code: a sanitiser rejects any outbound subject or body
containing clinical language before it can be sent. That keeps protected
health information out of a channel that is not secure, and it also means
our mail is short, expected, and consistent — the opposite of the profile
that generates complaints.

Example, in full — the most common message we send:

> **Subject:** Your Mount Zara sign-in link
>
> Use this link to sign in to your Mount Zara patient portal:
>
> https://mountzara.com/portal/magic-link/redeem/?token=…
>
> The link expires in 15 minutes and can only be used once.
>
> If you did not request it, you can ignore this email — nothing will
> happen.

And the second most common:

> **Subject:** You have a new secure message from Mount Zara
>
> A new secure message is waiting for you in your Mount Zara patient
> portal.
>
> Sign in to read it: https://mountzara.com/portal/
>
> For your privacy, the message itself is not included in this email.
>
> This inbox is not monitored for emergencies. If this is an emergency,
> call 911.

**Verified identity and authentication**

As requested, we have a **verified domain identity** rather than
individual addresses:

- Domain identity: `mountzara.com`, verified by Easy DKIM — all three
  CNAME records are published and resolving.
- Custom MAIL FROM domain: `bounce.mountzara.com`, with the required MX
  to `feedback-smtp.us-east-2.amazonses.com` and
  `v=spf1 include:amazonses.com ~all`.
- DMARC is published at `_dmarc.mountzara.com`.
- Sending is from `no-reply@mountzara.com`, a domain we own and operate.
- The IAM user used by the application holds `ses:SendEmail` only.

Region is **us-east-2**.

We would be glad to provide anything further.

---

## Notes for Dr. Mabini — not part of the reply

**Do this before you send the reply:**

1. **Create the SNS topic and subscribe the endpoint.** The reply says
   bounce handling is deployed, which is true — the handler is live at
   `/api/v1/internal/ses/feedback`. What does not exist yet is the SNS
   topic pointing at it. In the SES console: Configuration → Configuration
   sets (or the identity's Notifications tab) → publish Bounce, Complaint
   and Delivery events to an SNS topic → subscribe that topic to
   `https://mountzara.com/api/v1/internal/ses/feedback` (HTTPS).
2. **Set `SES_SNS_TOPIC_ARN`** as a Pages secret to that topic's ARN, then
   redeploy. The endpoint refuses everything until it is set — it is an
   unauthenticated public URL that can silence a patient's email, so it
   fails closed rather than trusting anonymous input.

**One thing to check while you are in the console:** the reply states the
domain identity is verified. The DNS is unquestionably correct — I
confirmed all three DKIM CNAMEs, the MAIL FROM MX and SPF, and DMARC are
published and resolving. What I could not confirm is SES's own
verification *status*, because the IAM user is send-only and gets 403 on
`ses:GetAccount` and `ses:ListEmailIdentities`. Glance at SES → Verified
identities and make sure `mountzara.com` reads "Verified" before sending.
If it says "Pending", the DNS is fine and it just needs AWS to re-check.
