// =====================================================================
// notify.js — outbound notification transport (2026-08-12)
// =====================================================================
// WHY THIS EXISTS
// The site had NO email transport of any kind. `grep -rl
// "resend|sendgrid|mailchannels|smtp|postmark" functions/` returned zero
// files across 146 endpoints. issueMagicLink() in _lib/auth.js minted and
// stored a sign-in token but never delivered it; startThread()/
// replyInThread() in _lib/messaging.js wrote a message and told nobody.
//
// The owner found this the only way anyone could: "the messaging system -
// i tried it and it doesn't notify members via their email of the message
// to login - they would never know". The same gap silently disables
// magic-link sign-in, appointment confirmations, visit links, and invoice
// notices — every "why isn't this connected" symptom shares this root.
//
// DESIGN
//   * Provider-agnostic over plain HTTPS (no SDK — Workers have fetch).
//     Cloudflare removed free MailChannels for Workers in 2024, so a
//     provider is required to actually deliver.
//
//     PROVIDER CHOICE IS A COMPLIANCE DECISION, NOT A PRICE ONE.
//     Even the content-free notices below reveal that an identifiable
//     person is a patient of a gynecology practice — that is
//     individually identifiable health information, so the sender needs a
//     signed BAA. Verified 2026-08-12:
//       * Resend   — does NOT sign a BAA. Unusable here.
//       * Postmark — does NOT sign a BAA. Unusable here.
//       * AWS SES  — HIPAA-eligible, AWS signs a BAA. ~$0.10 per 1,000
//                    emails, no monthly minimum. THIS IS THE DEFAULT.
//     Resend/Postmark remain implemented for non-PHI use (e.g. a pure
//     marketing list that never touches a patient), and are rejected for
//     patient traffic unless NOTIFY_ALLOW_NON_BAA=yes is explicitly set.
//   * NEVER SILENTLY DROPS. If no provider is configured, or the provider
//     call fails, the notification is written to the `notification_outbox`
//     table with its error. Nothing is lost, the queue is inspectable, and
//     a later run can retry. Silence is what caused this bug; a transport
//     that fails quietly would recreate it.
//   * PHI-SAFE BY CONSTRUCTION. Email is not a secure channel. Templates
//     here carry NO clinical content, no message body, no appointment
//     reason, no diagnosis — only "you have something waiting, sign in to
//     read it" plus a link. sanitizeForEmail() strips anything that looks
//     like clinical text before it can reach a subject or body.
//   * Every send writes an audit row, so delivery is traceable.
//
// REQUIRED ENV (set on the Pages production deployment_config):
//   NOTIFY_PROVIDER   "ses" (recommended) | "resend" | "postmark"
//   NOTIFY_FROM       e.g. "Mount Zara <no-reply@mountzara.com>"
//   NOTIFY_REPLY_TO   optional, e.g. "info@mountzara.com"
//   SITE_ORIGIN       optional, defaults to https://mountzara.com
//   -- for provider "ses" --
//   SES_REGION            e.g. "us-east-2"
//   SES_ACCESS_KEY_ID     IAM key with ses:SendEmail only
//   SES_SECRET_ACCESS_KEY
//   -- for provider "resend" / "postmark" (non-PHI only) --
//   NOTIFY_API_KEY        provider API key
//   NOTIFY_ALLOW_NON_BAA  must be "yes" to permit a non-BAA provider
// =====================================================================

import { logAudit } from "./audit.js";

const DEFAULT_ORIGIN = "https://mountzara.com";

/**
 * Clinical/PHI words that must never appear in an email we send. This is a
 * backstop, not the primary control — the primary control is that every
 * template below is written to contain no clinical content at all.
 */
const PHI_HINTS = [
    "diagnosis", "symptom", "endometriosis", "fibroid", "adenomyosis",
    "pregnan", "bleeding", "pain score", "biopsy", "pathology", "lab result",
    "medication", "prescription", "surgery date", "operative",
];

export function looksLikePHI(text) {
    const t = String(text || "").toLowerCase();
    return PHI_HINTS.some((w) => t.includes(w));
}

/**
 * Refuse to put clinical text in an email. Returns the text when clean;
 * throws when not, because a caller passing PHI is a bug that must surface
 * in development rather than leak in production.
 */
export function sanitizeForEmail(text, field) {
    if (looksLikePHI(text)) {
        throw new Error(
            `notify: refusing to send — ${field} contains clinical content. ` +
            `Email is not a secure channel; send a "sign in to read" notice instead.`
        );
    }
    return String(text || "");
}

function origin(env) {
    return String(env?.SITE_ORIGIN || DEFAULT_ORIGIN).replace(/\/+$/, "");
}

function esc(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
}

// ---------------------------------------------------------------------
// Templates. Every one of these is deliberately content-free: it tells the
// recipient that something is waiting and links them to the portal to read
// it behind authentication. Do not add clinical detail to any of them.
// ---------------------------------------------------------------------
export const TEMPLATES = {
    magic_link: ({ url, minutes = 15 }) => ({
        subject: "Your Mount Zara sign-in link",
        text:
            `Use this link to sign in to your Mount Zara patient portal:\n\n${url}\n\n` +
            `The link expires in ${minutes} minutes and can only be used once.\n\n` +
            `If you did not request it, you can ignore this email — nothing will happen.`,
        html:
            `<p>Use this link to sign in to your Mount Zara patient portal:</p>` +
            `<p><a href="${esc(url)}">Sign in to the portal</a></p>` +
            `<p>The link expires in ${minutes} minutes and can only be used once.</p>` +
            `<p style="color:#666">If you did not request it, you can ignore this email — nothing will happen.</p>`,
    }),

    new_message: ({ portalUrl }) => ({
        subject: "You have a new secure message from Mount Zara",
        text:
            `A new secure message is waiting for you in your Mount Zara patient portal.\n\n` +
            `Sign in to read it:\n${portalUrl}\n\n` +
            `For your privacy, the message itself is not included in this email.\n\n` +
            `This inbox is not monitored for emergencies. If this is an emergency, call 911.`,
        html:
            `<p>A new secure message is waiting for you in your Mount Zara patient portal.</p>` +
            `<p><a href="${esc(portalUrl)}">Sign in to read it</a></p>` +
            `<p style="color:#666">For your privacy, the message itself is not included in this email.</p>` +
            `<p style="color:#666">This inbox is not monitored for emergencies. If this is an emergency, call 911.</p>`,
    }),

    appointment_confirmed: ({ whenText, portalUrl }) => ({
        subject: `Your Mount Zara appointment is confirmed — ${whenText}`,
        text:
            `Your appointment is confirmed for ${whenText}.\n\n` +
            `You can review the details, complete anything outstanding, and join your ` +
            `visit from your portal:\n${portalUrl}\n\n` +
            `The join button becomes active shortly before your start time.`,
        html:
            `<p>Your appointment is confirmed for <strong>${esc(whenText)}</strong>.</p>` +
            `<p><a href="${esc(portalUrl)}">Open your portal</a> to review details and join your visit.</p>` +
            `<p style="color:#666">The join button becomes active shortly before your start time.</p>`,
    }),

    visit_ready: ({ whenText, launchUrl }) => ({
        subject: "Your Mount Zara visit is ready to join",
        text:
            `Your visit (${whenText}) is ready.\n\nJoin here:\n${launchUrl}\n\n` +
            `If the link does not open, sign in to your portal and use the Join button.`,
        html:
            `<p>Your visit (<strong>${esc(whenText)}</strong>) is ready.</p>` +
            `<p><a href="${esc(launchUrl)}">Join your visit</a></p>` +
            `<p style="color:#666">If the link does not open, sign in to your portal and use the Join button.</p>`,
    }),

    invoice_ready: ({ portalUrl }) => ({
        subject: "A new statement is available in your Mount Zara portal",
        text:
            `A new statement is available in your patient portal.\n\n` +
            `Sign in to view and pay:\n${portalUrl}\n\n` +
            `For your privacy, no billing detail is included in this email.`,
        html:
            `<p>A new statement is available in your patient portal.</p>` +
            `<p><a href="${esc(portalUrl)}">View and pay</a></p>` +
            `<p style="color:#666">For your privacy, no billing detail is included in this email.</p>`,
    }),

    intake_reminder: ({ portalUrl }) => ({
        subject: "Finish your Mount Zara intake before your visit",
        text:
            `Your intake is not finished yet. Completing it before your visit means ` +
            `more of your appointment is spent on you rather than paperwork.\n\n` +
            `Pick up where you left off:\n${portalUrl}`,
        html:
            `<p>Your intake is not finished yet. Completing it before your visit means more of ` +
            `your appointment is spent on you rather than paperwork.</p>` +
            `<p><a href="${esc(portalUrl)}">Pick up where you left off</a></p>`,
    }),

    // Sent when Dr. Mabini approves an after-visit summary. Carries no
    // clinical content — not the plan, not the medicines, nothing from the
    // visit — because email is not a secure channel and the summary is the
    // most clinically detailed thing the portal holds.
    visit_summary_ready: ({ portalUrl }) => ({
        subject: "Your visit summary is ready",
        text:
            `A summary of your recent visit is ready in your Mount Zara portal.\n\n` +
            `It covers what you and Dr. Mabini talked about, the plan, your medicines ` +
            `and what happens next. He has reviewed and approved it.\n\n` +
            `Read it here:\n${portalUrl}\n\n` +
            `For your privacy, the summary itself is not included in this email.`,
        html:
            `<p>A summary of your recent visit is ready in your Mount Zara portal.</p>` +
            `<p>It covers what you and Dr.&nbsp;Mabini talked about, the plan, your medicines ` +
            `and what happens next. He has reviewed and approved it.</p>` +
            `<p><a href="${esc(portalUrl)}">Read your visit summary</a></p>` +
            `<p style="color:#666">For your privacy, the summary itself is not included in this email.</p>`,
    }),

    // Sent to the PRACTICE, not a patient: the order board has something
    // that needs attention. Counts and a link only — no patient, no test,
    // no result. This lands in an ordinary inbox, and an alert that
    // discloses the finding it is alerting about is a breach with a good
    // excuse. The detail lives behind admin authentication.
    order_attention: ({ lines, boardUrl }) => ({
        subject: "Mount Zara — orders needing attention",
        text:
            `The order board has items that need attention:\n\n` +
            (lines || []).map((l) => `  • ${l}`).join("\n") +
            `\n\nOpen the board:\n${boardUrl}\n\n` +
            `No patient or clinical detail is included in this email by design.`,
        html:
            `<p>The order board has items that need attention:</p><ul>` +
            (lines || []).map((l) => `<li>${esc(l)}</li>`).join("") +
            `</ul><p><a href="${esc(boardUrl)}">Open the order board</a></p>` +
            `<p style="color:#666">No patient or clinical detail is included in this email by design.</p>`,
    }),

    // Sent when a triage row is released and booking opens — by Dr. Mabini,
    // or by the four-hour auto-release. The patient does not need to know
    // which, and telling them would be worse: "a computer decided" is not
    // reassuring and is not the point. What they need is that they can now
    // book. Carries NO clinical content — not the visit type, not the
    // urgency, nothing from the intake — because email is not a secure
    // channel and this is the same posture as new_message.
    triage_released: ({ portalUrl }) => ({
        subject: "You can now book your appointment with Mount Zara",
        text:
            `Your intake has been reviewed and your appointment times are ready.\n\n` +
            `The times you will see are the ones that fit the kind of visit you need, ` +
            `so there is enough time set aside for it.\n\n` +
            `Choose a time:\n${portalUrl}`,
        html:
            `<p>Your intake has been reviewed and your appointment times are ready.</p>` +
            `<p>The times you will see are the ones that fit the kind of visit you need, ` +
            `so there is enough time set aside for it.</p>` +
            `<p><a href="${esc(portalUrl)}">Choose a time</a></p>`,
    }),
};

// ---------------------------------------------------------------------
// Outbox. Guarantees no notification is ever silently lost.
// ---------------------------------------------------------------------
async function queue(env, row) {
    if (!env?.DB) {
        console.error("notify: DB unbound; notification DROPPED", row.template);
        return { queued: false };
    }
    try {
        await env.DB.prepare(
            `INSERT INTO notification_outbox
               (to_email, template, subject, body_text, body_html, patient_id,
                status, error, created_at, attempts)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
            row.to, row.template, row.subject, row.text, row.html,
            row.patient_id ?? null, row.status, row.error ?? null,
            new Date().toISOString(), row.attempts ?? 1
        ).run();
        return { queued: true };
    } catch (e) {
        // The table may not exist yet (migration pending). Say so loudly —
        // this is exactly the class of silence that caused the original bug.
        console.error("notify: could not queue notification", {
            template: row.template, error: String(e).slice(0, 200),
        });
        return { queued: false, error: String(e) };
    }
}

// ---------------------------------------------------------------------
// AWS SES v2 over the REST API, signed with SigV4 using Web Crypto.
// Workers cannot open SMTP connections, and the AWS SDK is far too heavy
// for an edge function, so the request is signed by hand. SES is the
// default provider because AWS signs a BAA (see the header note).
// ---------------------------------------------------------------------
const enc = new TextEncoder();

async function sha256Hex(data) {
    const buf = await crypto.subtle.digest("SHA-256", typeof data === "string" ? enc.encode(data) : data);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(key, data) {
    const k = await crypto.subtle.importKey(
        "raw", typeof key === "string" ? enc.encode(key) : key,
        { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
}

/** AWS SigV4 signing key: HMAC chain over date/region/service/aws4_request. */
async function signingKey(secret, dateStamp, region, service) {
    let k = await hmac(`AWS4${secret}`, dateStamp);
    k = await hmac(k, region);
    k = await hmac(k, service);
    return await hmac(k, "aws4_request");
}

async function sendViaSES(env, { to, subject, text, html }) {
    const region = env.SES_REGION;
    const akid = env.SES_ACCESS_KEY_ID;
    const secret = env.SES_SECRET_ACCESS_KEY;
    if (!region || !akid || !secret) {
        throw new Error("SES requires SES_REGION, SES_ACCESS_KEY_ID and SES_SECRET_ACCESS_KEY");
    }

    const host = `email.${region}.amazonaws.com`;
    const path = "/v2/email/outbound-emails";
    const payload = JSON.stringify({
        FromEmailAddress: env.NOTIFY_FROM,
        Destination: { ToAddresses: [to] },
        ...(env.NOTIFY_REPLY_TO ? { ReplyToAddresses: [env.NOTIFY_REPLY_TO] } : {}),
        Content: {
            Simple: {
                Subject: { Data: subject, Charset: "UTF-8" },
                Body: {
                    Text: { Data: text, Charset: "UTF-8" },
                    Html: { Data: html, Charset: "UTF-8" },
                },
            },
        },
    });

    // 20260812T153045Z / 20260812
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = await sha256Hex(payload);

    const canonicalHeaders =
        `content-type:application/json\n` +
        `host:${host}\n` +
        `x-amz-content-sha256:${payloadHash}\n` +
        `x-amz-date:${amzDate}\n`;
    const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
    const canonicalRequest =
        `POST\n${path}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

    const scope = `${dateStamp}/${region}/ses/aws4_request`;
    const stringToSign =
        `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${await sha256Hex(canonicalRequest)}`;

    const sigKey = await signingKey(secret, dateStamp, region, "ses");
    const sigBytes = await hmac(sigKey, stringToSign);
    const signature = [...sigBytes].map((b) => b.toString(16).padStart(2, "0")).join("");

    const res = await fetch(`https://${host}${path}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Amz-Date": amzDate,
            "X-Amz-Content-Sha256": payloadHash,
            Authorization:
                `AWS4-HMAC-SHA256 Credential=${akid}/${scope}, ` +
                `SignedHeaders=${signedHeaders}, Signature=${signature}`,
        },
        body: payload,
    });
    if (!res.ok) throw new Error(`ses ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return await res.json().catch(() => ({}));
}

// ---------------------------------------------------------------------
// Cloudflare Email Sending over the REST API.
//
// 2026-08-20 — AWS declined SES production access a second time on "no
// sending history" grounds, a catch-22 for a sandboxed account that is
// not allowed to build one. This stack is already Cloudflare end to end
// (Pages, Functions, D1, R2, DNS), and Cloudflare Email Sending has no
// sandbox and no approval gauntlet: onboard the domain, mint a token
// with Email Sending: Edit, send. Owner directive: "Fix this for
// cloudflare."
//
// WHY THE REST API AND NOT THE send_email BINDING: the binding is
// configured per-Worker in wrangler config, and this project's bindings
// live in the Pages deployment_config where wrangler.toml is dev-only
// (see CLAUDE.md's anti-patterns). The REST call needs nothing but a
// token in an env var, works identically in `wrangler dev` and
// production, and — decisively — returns per-recipient delivery status,
// which the binding does not.
//
// THAT RESPONSE IS THE BOUNCE PIPELINE. SES needed an SNS topic, an
// HTTPS subscription, a confirmation dance and a public webhook to tell
// us about a hard bounce minutes later (see ses/feedback.js and its
// scars). Cloudflare reports `permanent_bounces` IN THE SEND RESPONSE,
// so the suppression row is written synchronously, in the same request
// that learned of the bounce. The SNS path stays wired for the SES
// fallback but is not needed while this provider is active.
//
// Error codes worth knowing at 3am (numeric, from the REST API):
//   10105 not_entitled       — account has never enabled Email Sending
//   10203 sending_disabled   — domain not onboarded / disabled
//   10102 forbidden          — token lacks Email Sending: Edit
//   10004 throttled          — back off; the flush retry loop handles it
// ---------------------------------------------------------------------
async function sendViaCloudflare(env, { to, subject, text, html }) {
    const token = env.CF_EMAIL_TOKEN;
    const account = env.CF_EMAIL_ACCOUNT_ID;
    if (!token || !account) {
        throw new Error("cloudflare email requires CF_EMAIL_TOKEN and CF_EMAIL_ACCOUNT_ID");
    }

    // NOTIFY_FROM was configured in the SES era, where FromEmailAddress
    // accepts the RFC 5322 display form — "Mount Zara <no-reply@…>".
    // Cloudflare's from.address takes the BARE address only and 400s
    // (code 10202 email.invalid) on the display form. Found live
    // 2026-08-23: every direct test passed (explicit bare address) while
    // the deployed notify() path failed, because the two used different
    // sources for the sender. Parse both forms so the secret does not
    // have to change shape underneath the SES fallback.
    const rawFrom = String(env.NOTIFY_FROM || "");
    const m = rawFrom.match(/^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/);
    const fromAddress = (m ? m[2] : rawFrom).trim();
    const fromName = (m && m[1] ? m[1].trim() : "") || env.NOTIFY_FROM_NAME || "Mount Zara";

    const payload = {
        to,
        from: { address: fromAddress, name: fromName },
        ...(env.NOTIFY_REPLY_TO ? { reply_to: env.NOTIFY_REPLY_TO } : {}),
        subject,
        text,
        html,
    };

    const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${account}/email/sending/send`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
        }
    );

    const bodyText = await res.text();
    if (!res.ok) {
        throw new Error(`cloudflare-email ${res.status}: ${bodyText.slice(0, 300)}`);
    }

    let out = {};
    try { out = JSON.parse(bodyText); } catch { /* tolerated; success path below */ }
    const result = out.result || {};
    const bounced = (result.permanent_bounces || []).map((a) => String(a).toLowerCase());

    if (bounced.includes(String(to).toLowerCase())) {
        // The mailbox does not exist. Suppress NOW — same row the SES SNS
        // pipeline would eventually write, minus the pipeline — and report
        // the send as failed, because it was.
        try {
            const now = new Date().toISOString();
            await env.DB.prepare(`
                CREATE TABLE IF NOT EXISTS email_suppression (
                    email        TEXT PRIMARY KEY,
                    reason       TEXT NOT NULL,
                    detail       TEXT,
                    suppressed   INTEGER NOT NULL DEFAULT 1,
                    soft_bounces INTEGER NOT NULL DEFAULT 0,
                    first_seen   TEXT NOT NULL,
                    last_seen    TEXT NOT NULL,
                    cleared_by   TEXT,
                    cleared_at   TEXT
                )`).run();
            await env.DB.prepare(`
                INSERT INTO email_suppression (email, reason, detail, suppressed, first_seen, last_seen)
                VALUES (?, 'hard_bounce', 'cloudflare permanent_bounce at send', 1, ?, ?)
                ON CONFLICT(email) DO UPDATE SET
                    reason = 'hard_bounce', detail = excluded.detail,
                    suppressed = 1, last_seen = excluded.last_seen,
                    cleared_by = NULL, cleared_at = NULL
            `).bind(String(to).trim().toLowerCase(), now, now).run();
        } catch (e) {
            console.error("cloudflare email: bounce recorded in response but suppression write failed",
                String(e).slice(0, 160));
        }
        throw new Error("cloudflare-email: permanent bounce — recipient suppressed");
    }

    return result;
}

async function sendViaResend(env, { to, subject, text, html }) {
    const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${env.NOTIFY_API_KEY}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            from: env.NOTIFY_FROM,
            to: [to],
            subject,
            text,
            html,
            ...(env.NOTIFY_REPLY_TO ? { reply_to: env.NOTIFY_REPLY_TO } : {}),
        }),
    });
    if (!res.ok) throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return await res.json().catch(() => ({}));
}

async function sendViaPostmark(env, { to, subject, text, html }) {
    const res = await fetch("https://api.postmarkapp.com/email", {
        method: "POST",
        headers: {
            "X-Postmark-Server-Token": env.NOTIFY_API_KEY,
            "Content-Type": "application/json",
            Accept: "application/json",
        },
        body: JSON.stringify({
            From: env.NOTIFY_FROM,
            To: to,
            Subject: subject,
            TextBody: text,
            HtmlBody: html,
            ...(env.NOTIFY_REPLY_TO ? { ReplyTo: env.NOTIFY_REPLY_TO } : {}),
            MessageStream: "outbound",
        }),
    });
    if (!res.ok) throw new Error(`postmark ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return await res.json().catch(() => ({}));
}

export function notifyConfigured(env) {
    if (!env?.NOTIFY_PROVIDER || !env?.NOTIFY_FROM) return false;
    const p = String(env.NOTIFY_PROVIDER).toLowerCase();
    if (p === "ses") {
        return Boolean(env.SES_REGION && env.SES_ACCESS_KEY_ID && env.SES_SECRET_ACCESS_KEY);
    }
    if (p === "cloudflare") {
        return Boolean(env.CF_EMAIL_TOKEN && env.CF_EMAIL_ACCOUNT_ID);
    }
    return Boolean(env.NOTIFY_API_KEY);
}

/**
 * Providers that will NOT sign a BAA must not carry patient traffic.
 * Verified 2026-08-12: Resend and Postmark both decline; AWS SES is
 * HIPAA-eligible and AWS signs one. Refusing here is deliberate — the
 * cheap-and-easy provider is the one that quietly creates the exposure.
 *
 * CLOUDFLARE (checked 2026-08-20): the Email Service documentation says
 * NOTHING about HIPAA or a BAA — the product launched in 2025 and its
 * compliance posture is undocumented. Cloudflare does sign BAAs on
 * enterprise agreements, but whether Email Sending is in scope is a
 * question for Cloudflare, not a fact to assume. So "cloudflare" is
 * deliberately NOT in this set: while the practice is pre-launch and the
 * only recipients are the owner and testers, NOTIFY_ALLOW_NON_BAA=yes is
 * accurate (the traffic is provably not PHI — there are no patients).
 * BEFORE PORTAL_PUBLIC_LAUNCH FLIPS, either Cloudflare confirms a BAA
 * covering Email Service (then add it here, citing the agreement), or
 * the provider switches back to one that does. Do not resolve that
 * tension by quietly editing this set.
 */
const BAA_PROVIDERS = new Set(["ses"]);

function providerPermitted(env) {
    const p = String(env?.NOTIFY_PROVIDER || "").toLowerCase();
    if (BAA_PROVIDERS.has(p)) return true;
    return String(env?.NOTIFY_ALLOW_NON_BAA || "").toLowerCase() === "yes";
}

/**
 * Send one notification.
 *
 * @returns {Promise<{sent:boolean, queued?:boolean, reason?:string}>}
 * Never throws for delivery problems — a failed notification must not fail
 * the request that triggered it (a patient's message must still post even
 * if the notice cannot go out). It is queued instead, and audited.
 */

/**
 * Is this address suppressed?
 *
 * A hard bounce or a spam complaint means we must stop mailing that
 * address — continuing damages the sending reputation that every OTHER
 * patient's sign-in link depends on. Populated by
 * /api/v1/internal/ses/feedback from SES event notifications.
 *
 * Fails OPEN on purpose: if the table does not exist yet, or the query
 * throws, mail still goes out. A suppression list that is unreachable
 * must not become a silent outage for every patient at once — that is a
 * worse failure than the one it prevents.
 */
/**
 * Standard role aliases that never belong to a patient.
 *
 * From the SES best-practices doc AWS linked in their decline: "It is
 * highly unlikely that a standard alias (such as postmaster@, abuse@, or
 * noc@) will ever sign up for your email intentionally… These aliases can
 * be maliciously added to your list as a form of sabotage, in order to
 * damage your reputation."
 *
 * Our signup is open — anyone can create an account with any address and
 * trigger a sign-in email to it. Without this check, signing up as
 * abuse@<some-isp>.com would aim our mail directly at an email watchdog.
 */
const ROLE_ALIASES = new Set([
    "postmaster", "abuse", "noc", "hostmaster", "mailer-daemon",
    "spam", "security", "root", "usenet", "uucp",
]);

export function isRoleAddress(email) {
    const local = String(email || "").split("@")[0].trim().toLowerCase();
    return ROLE_ALIASES.has(local);
}

/**
 * Is this address structurally undeliverable?
 *
 * 2026-08-20 — AWS declined production access a second time, citing risk to
 * "your sender reputation and the deliverability of your emails" without
 * naming a defect. The outbox explains the concern. Of thirteen sends this
 * account has ever attempted, SIX were aimed at seed and test accounts:
 *
 *     demo@mountzara.test          x4
 *     e2e-probe@mountzara.test     x1
 *     flow-1787112333@mountzara.test  x1
 *
 * In the sandbox those were harmlessly refused as unverified identities. WITH
 * production access they would have been accepted and delivered nowhere:
 * .test is reserved by RFC 2606 and can never resolve, so every one becomes a
 * HARD BOUNCE. A young account whose first real traffic is half hard bounces
 * is precisely the outcome AWS's letter is written to prevent.
 *
 * The reserved names (RFC 2606 / RFC 6761) exist so that test fixtures cannot
 * reach a real mailbox. That guarantee only holds if we refuse to send to
 * them, so this is checked before the provider is ever called — and it is
 * recorded as `abandoned` rather than `failed`, because nothing went wrong.
 *
 * Seed and demo data is supposed to be inert. Any future fixture that invents
 * an address should keep using a reserved name; this makes that safe.
 */
const RESERVED_TLDS = new Set(["test", "invalid", "localhost", "example"]);
const RESERVED_DOMAINS = new Set(["example.com", "example.net", "example.org"]);

export function isUndeliverableAddress(email) {
    const domain = String(email || "").split("@")[1];
    if (!domain) return false;
    const d = domain.trim().toLowerCase().replace(/\.$/, "");
    if (RESERVED_DOMAINS.has(d)) return true;
    return RESERVED_TLDS.has(d.split(".").pop());
}

export async function isSuppressed(env, email) {
    if (!env?.DB || !email) return { suppressed: false };
    try {
        const r = await env.DB.prepare(
            `SELECT reason, detail, suppressed FROM email_suppression
              WHERE email = ? AND suppressed = 1 LIMIT 1`
        ).bind(String(email).trim().toLowerCase()).first();
        return r ? { suppressed: true, reason: r.reason, detail: r.detail } : { suppressed: false };
    } catch {
        return { suppressed: false };
    }
}

export async function notify(env, { to, template, data = {}, patient_id = null, request = null }) {
    const build = TEMPLATES[template];
    if (!build) throw new Error(`notify: unknown template "${template}"`);
    if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(to))) {
        return { sent: false, reason: "invalid recipient" };
    }

    // Never mail an address that hard-bounced or filed a spam complaint.
    // This is checked BEFORE the body is built, so a suppressed send costs
    // nothing and never reaches the provider.
    // Never mail a role alias — see ROLE_ALIASES above. Refused before the
    // suppression lookup because it needs no database.
    // A reserved-name address can never be delivered, so sending to one buys
    // a guaranteed hard bounce. Refused before the suppression lookup because
    // it needs no database — see isUndeliverableAddress above.
    if (isUndeliverableAddress(to)) {
        console.warn(`notify: "${template}" refused — reserved/undeliverable domain`);
        await queue(env, {
            to, template, subject: "(not sent)", text: "", html: "", patient_id,
            status: "abandoned",
            error: "recipient uses a reserved, undeliverable domain (RFC 2606/6761)",
        });
        return { sent: false, refused: true, reason: "undeliverable_domain" };
    }

    if (isRoleAddress(to)) {
        console.warn(`notify: "${template}" refused — role alias recipient`);
        return { sent: false, refused: true, reason: "role_alias_recipient" };
    }

    const sup = await isSuppressed(env, to);
    if (sup.suppressed) {
        console.warn(`notify: "${template}" suppressed (${sup.reason})`);
        await queue(env, {
            to, template, subject: "(suppressed)", text: "", html: "", patient_id,
            status: "abandoned",
            error: `recipient suppressed: ${sup.reason}${sup.detail ? ` (${sup.detail})` : ""}`,
        });
        return { sent: false, suppressed: true, reason: sup.reason };
    }

    const built = build({ ...data, portalUrl: data.portalUrl || `${origin(env)}/portal/` });
    sanitizeForEmail(built.subject, "subject");
    sanitizeForEmail(built.text, "body");

    // Footer on every message: who we are and where the privacy terms
    // live. The SES best-practices guidance recommends linking a Privacy
    // Policy and Terms of Use from each email, and for a medical practice
    // "who is emailing me and under what rules" is a fair question every
    // time. Appended AFTER sanitisation — it is a constant with no
    // clinical content by construction.
    const o = origin(env);
    built.text += `\n\n—\nMount Zara, LLC · Chicago, Illinois\nPrivacy: ${o}/privacy/ · Terms: ${o}/terms/`;
    built.html += `<hr style="border:none;border-top:1px solid #ddd;margin:18px 0 10px">` +
        `<p style="font-size:12px;color:#888">Mount Zara, LLC · Chicago, Illinois · ` +
        `<a href="${o}/privacy/" style="color:#888">Privacy</a> · ` +
        `<a href="${o}/terms/" style="color:#888">Terms</a></p>`;

    const base = {
        to, template, subject: built.subject, text: built.text,
        html: built.html, patient_id,
    };

    if (!notifyConfigured(env)) {
        await queue(env, { ...base, status: "unconfigured", error: "NOTIFY_PROVIDER/API_KEY/FROM not set" });
        console.warn(`notify: no provider configured — "${template}" queued, not delivered`);
        return { sent: false, queued: true, reason: "provider not configured" };
    }

    try {
        const provider = String(env.NOTIFY_PROVIDER).toLowerCase();
        if (!providerPermitted(env)) {
            throw new Error(
                `provider "${provider}" is not confirmed to sign a BAA; patient ` +
                `notifications require one. Use NOTIFY_PROVIDER=ses, or set ` +
                `NOTIFY_ALLOW_NON_BAA=yes only for traffic that is provably not ` +
                `PHI (e.g. pre-launch testing with no patients enrolled).`
            );
        }
        if (provider === "ses") await sendViaSES(env, base);
        else if (provider === "cloudflare") await sendViaCloudflare(env, base);
        else if (provider === "resend") await sendViaResend(env, base);
        else if (provider === "postmark") await sendViaPostmark(env, base);
        else throw new Error(`unsupported NOTIFY_PROVIDER "${provider}"`);

        await queue(env, { ...base, status: "sent" });
        try {
            await logAudit(env, {
                action: "notification_sent",
                patient_id,
                detail: JSON.stringify({ template, to: String(to).replace(/^(.{2}).*@/, "$1***@") }),
            });
        } catch { /* auditing must never break delivery */ }
        return { sent: true };
    } catch (e) {
        await queue(env, { ...base, status: "failed", error: String(e).slice(0, 500) });
        console.error("notify: delivery failed", { template, error: String(e).slice(0, 200) });
        return { sent: false, queued: true, reason: String(e).slice(0, 200) };
    }
}

/**
 * Send an ALREADY-BUILT body through the configured provider, without
 * touching a template and without writing to the outbox.
 *
 * This is what the outbox retry needs (see
 * api/v1/internal/notifications/flush.js). Rebuilding from the template
 * would be wrong for the exact case that matters most: a queued
 * magic_link row contains the token that was ISSUED, and regenerating the
 * body would either mint a different token or embed an expired one — the
 * patient would receive a link that does not work, which is worse than
 * the email they never got.
 *
 * Returns { ok } / { ok: false, error } rather than throwing, so the
 * caller can record the outcome per row instead of aborting the batch.
 */
export async function sendDirect(env, { to, subject, text, html }) {
    if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(to))) {
        return { ok: false, error: "invalid recipient" };
    }
    // 2026-08-20 — the SAME guards notify() applies, because this is the
    // outbox RETRY path and the outbox is where the dangerous rows live.
    // Six queued sends target @mountzara.test seed accounts; the sandbox
    // refused them as "not verified", which isPermanent() treats as
    // recoverable, so the first flush after a WORKING provider went live
    // would have replayed all six as guaranteed hard bounces — on the new
    // provider's very first day. The error strings here deliberately match
    // isPermanent() in notifications/flush.js so the rows are abandoned,
    // not retried forever.
    if (isUndeliverableAddress(to)) {
        return { ok: false, error: "recipient uses a reserved, undeliverable domain (RFC 2606/6761)" };
    }
    if (isRoleAddress(to)) {
        return { ok: false, error: "role alias recipient — blocked as undeliverable-by-policy" };
    }
    const sup = await isSuppressed(env, to);
    if (sup.suppressed) {
        return { ok: false, error: `recipient suppressed: ${sup.reason}` };
    }
    if (!notifyConfigured(env)) {
        return { ok: false, error: "NOTIFY_PROVIDER/API_KEY/FROM not set" };
    }
    const provider = String(env.NOTIFY_PROVIDER).toLowerCase();
    if (!providerPermitted(env)) {
        return { ok: false, error: `provider "${provider}" does not sign a BAA` };
    }
    try {
        const payload = { to, subject, text, html };
        if (provider === "ses") await sendViaSES(env, payload);
        else if (provider === "cloudflare") await sendViaCloudflare(env, payload);
        else if (provider === "resend") await sendViaResend(env, payload);
        else if (provider === "postmark") await sendViaPostmark(env, payload);
        else return { ok: false, error: `unsupported NOTIFY_PROVIDER "${provider}"` };
        return { ok: true };
    } catch (e) {
        return { ok: false, error: String(e).slice(0, 500) };
    }
}

/** Fire-and-forget helper for request handlers that must not block on email. */
export function notifyInBackground(ctx, env, args) {
    const p = notify(env, args).catch((e) =>
        console.error("notify: unexpected throw", String(e).slice(0, 200)));
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(p);
    return p;
}
