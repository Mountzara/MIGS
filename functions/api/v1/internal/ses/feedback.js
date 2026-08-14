// =====================================================================
// POST /api/v1/internal/ses/feedback — SES bounce & complaint handling
// =====================================================================
// AWS asks, when reviewing a production-access request, how bounces and
// complaints are managed. The honest answer on 2026-08-14 was "they are
// not" — the outbox recorded SEND-time errors only, and an asynchronous
// bounce or a spam complaint arriving minutes later was invisible.
//
// That is not merely a review problem. A practice that keeps mailing an
// address that hard-bounced, or that keeps mailing someone who marked it
// as spam, damages its own sending reputation until nothing arrives for
// anyone — including the sign-in links patients need.
//
// WHAT THIS DOES
// Receives SES event notifications over SNS and maintains a SUPPRESSION
// LIST. Before any send, notify.js checks it.
//
//   Hard bounce   → suppress permanently. The mailbox does not exist.
//   Soft bounce   → recorded, not suppressed. A full mailbox recovers.
//   Complaint     → suppress permanently. Someone pressed "this is spam";
//                   continuing to mail them is both rude and reputationally
//                   expensive, and no transactional exemption changes that.
//   Delivery      → clears any soft-bounce record; the address works.
//
// SUPPRESSION IS PER-ADDRESS AND REVERSIBLE BY A HUMAN. A patient who
// mistyped their address at signup, bounced, and then corrected it must
// not be permanently unreachable, so /api/v1/admin/notifications/health
// surfaces the list and an admin can clear an entry.
//
// SECURITY
// SNS posts here unauthenticated by design — the endpoint is public and
// the message must therefore be verified, not trusted. Two checks:
//   1. the SNS TopicArn must match SES_SNS_TOPIC_ARN, so another topic
//      cannot inject suppressions;
//   2. subscription confirmation is only auto-confirmed for that same ARN.
// Without SES_SNS_TOPIC_ARN set, the endpoint refuses everything rather
// than accepting anonymous input — an unauthenticated write path that
// silences a patient's email is not something to leave open by default.
//
// PHI: an email address is an identifier but not clinical content, and
// nothing here records why a message was sent.
// =====================================================================

function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status, headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

/** Classify an SES notification into what we should do about it. */
export function classify(msg) {
    const type = String(msg?.eventType || msg?.notificationType || "").toLowerCase();

    if (type === "bounce") {
        const b = msg.bounce || {};
        const hard = String(b.bounceType || "").toLowerCase() === "permanent";
        return {
            action: hard ? "suppress" : "record",
            reason: hard ? "hard_bounce" : "soft_bounce",
            detail: `${b.bounceType || "?"}/${b.bounceSubType || "?"}`,
            recipients: (b.bouncedRecipients || []).map((r) => r.emailAddress).filter(Boolean),
        };
    }
    if (type === "complaint") {
        const c = msg.complaint || {};
        return {
            action: "suppress",
            reason: "complaint",
            // Deliberately NOT recording complaintFeedbackType beyond the
            // label: what someone objected to is not our business to file.
            detail: c.complaintFeedbackType || "unspecified",
            recipients: (c.complainedRecipients || []).map((r) => r.emailAddress).filter(Boolean),
        };
    }
    if (type === "delivery") {
        return {
            action: "clear_soft",
            reason: "delivered",
            detail: "",
            recipients: (msg.delivery?.recipients || []).filter(Boolean),
        };
    }
    return { action: "ignore", reason: type || "unknown", detail: "", recipients: [] };
}

async function ensureTable(env) {
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
        )
    `).run();
}

export async function onRequestPost(ctx) {
    const { request, env } = ctx;
    if (!env.DB) return json({ error: "db_not_bound" }, 500);

    const expectedArn = env.SES_SNS_TOPIC_ARN || "";
    if (!expectedArn) {
        // Fail closed. An open, unauthenticated endpoint that can silence a
        // patient's email is worse than no endpoint.
        return json({ error: "not_configured",
                      message: "SES_SNS_TOPIC_ARN is not set; refusing anonymous input." }, 503);
    }

    let envelope;
    try { envelope = await request.json(); }
    catch { return json({ error: "invalid_json" }, 400); }

    if (String(envelope?.TopicArn || "") !== expectedArn) {
        return json({ error: "wrong_topic" }, 403);
    }

    // SNS confirms a subscription by POSTing a URL to visit once.
    if (envelope.Type === "SubscriptionConfirmation") {
        try {
            await fetch(String(envelope.SubscribeURL), { method: "GET" });
            return json({ ok: true, confirmed: true });
        } catch (e) {
            return json({ ok: false, error: `confirmation fetch failed: ${String(e).slice(0, 160)}` }, 502);
        }
    }
    if (envelope.Type !== "Notification") {
        return json({ ok: true, ignored: envelope.Type || "unknown" });
    }

    let msg;
    try { msg = JSON.parse(envelope.Message); }
    catch { return json({ error: "invalid_sns_message" }, 400); }

    await ensureTable(env);
    const c = classify(msg);
    const now = new Date().toISOString();
    let applied = 0;

    for (const raw of c.recipients) {
        const email = String(raw || "").trim().toLowerCase();
        if (!email) continue;
        try {
            if (c.action === "suppress") {
                await env.DB.prepare(`
                    INSERT INTO email_suppression (email, reason, detail, suppressed, first_seen, last_seen)
                    VALUES (?, ?, ?, 1, ?, ?)
                    ON CONFLICT(email) DO UPDATE SET
                        reason = excluded.reason, detail = excluded.detail,
                        suppressed = 1, last_seen = excluded.last_seen,
                        cleared_by = NULL, cleared_at = NULL
                `).bind(email, c.reason, c.detail, now, now).run();
                applied++;
            } else if (c.action === "record") {
                // A soft bounce is not a suppression. A mailbox that is full
                // today works tomorrow, and suppressing on the first one
                // would lock patients out over a transient condition.
                await env.DB.prepare(`
                    INSERT INTO email_suppression (email, reason, detail, suppressed, soft_bounces, first_seen, last_seen)
                    VALUES (?, ?, ?, 0, 1, ?, ?)
                    ON CONFLICT(email) DO UPDATE SET
                        soft_bounces = email_suppression.soft_bounces + 1,
                        detail = excluded.detail, last_seen = excluded.last_seen,
                        -- Repeated soft bounces eventually behave like a hard
                        -- one; five is generous and still protects reputation.
                        suppressed = CASE WHEN email_suppression.soft_bounces + 1 >= 5 THEN 1 ELSE email_suppression.suppressed END
                `).bind(email, c.reason, c.detail, now, now).run();
                applied++;
            } else if (c.action === "clear_soft") {
                await env.DB.prepare(`
                    UPDATE email_suppression SET soft_bounces = 0, last_seen = ?
                     WHERE email = ? AND suppressed = 0
                `).bind(now, email).run();
                applied++;
            }
        } catch (e) {
            console.error("ses feedback: row failed", email.replace(/^(.{2}).*@/, "$1***@"), String(e).slice(0, 160));
        }
    }

    return json({ ok: true, action: c.action, reason: c.reason, recipients: c.recipients.length, applied });
}

export async function onRequest(ctx) {
    if (ctx.request.method === "POST") return onRequestPost(ctx);
    return json({ error: "method_not_allowed" }, 405);
}
