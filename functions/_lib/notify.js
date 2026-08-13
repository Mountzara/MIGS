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
//   * Provider-agnostic. Resend and Postmark are supported over plain
//     HTTPS (no SDK — Workers have fetch). Cloudflare removed free
//     MailChannels for Workers in 2024, so a provider key is required to
//     actually deliver; see "NOT CONFIGURED" below for what happens until
//     then.
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
//   NOTIFY_PROVIDER   "resend" | "postmark"   (absent => queue only)
//   NOTIFY_API_KEY    provider API key
//   NOTIFY_FROM       e.g. "Mount Zara <no-reply@mountzara.com>"
//   NOTIFY_REPLY_TO   optional, e.g. "info@mountzara.com"
//   SITE_ORIGIN       optional, defaults to https://mountzara.com
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
    return Boolean(env?.NOTIFY_PROVIDER && env?.NOTIFY_API_KEY && env?.NOTIFY_FROM);
}

/**
 * Send one notification.
 *
 * @returns {Promise<{sent:boolean, queued?:boolean, reason?:string}>}
 * Never throws for delivery problems — a failed notification must not fail
 * the request that triggered it (a patient's message must still post even
 * if the notice cannot go out). It is queued instead, and audited.
 */
export async function notify(env, { to, template, data = {}, patient_id = null, request = null }) {
    const build = TEMPLATES[template];
    if (!build) throw new Error(`notify: unknown template "${template}"`);
    if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(to))) {
        return { sent: false, reason: "invalid recipient" };
    }

    const built = build({ ...data, portalUrl: data.portalUrl || `${origin(env)}/portal/` });
    sanitizeForEmail(built.subject, "subject");
    sanitizeForEmail(built.text, "body");

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
        if (provider === "resend") await sendViaResend(env, base);
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

/** Fire-and-forget helper for request handlers that must not block on email. */
export function notifyInBackground(ctx, env, args) {
    const p = notify(env, args).catch((e) =>
        console.error("notify: unexpected throw", String(e).slice(0, 200)));
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(p);
    return p;
}
