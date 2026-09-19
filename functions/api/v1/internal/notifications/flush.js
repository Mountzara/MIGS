// =====================================================================
// POST /api/v1/internal/notifications/flush — actually retry the outbox
// =====================================================================
// notify.js writes every failed send to `notification_outbox` and its own
// comment says "a later run can retry". No later run existed. The outbox
// was write-only: six real notifications sat in it as of 2026-08-14 —
// three magic-link sign-in emails to the owner's own address and three
// patient message alerts — every one of them `attempts = 1`, none of them
// ever tried again.
//
// That is worse than not queueing at all, because it LOOKS handled. The
// row is there, the error is recorded, and nothing on any screen says a
// patient never got their sign-in link.
//
// WHAT ACTUALLY FAILED, AND WHY RETRY IS THE RIGHT ANSWER
// The recorded error on all six is:
//   "Email address is not verified. The following identities failed the
//    check in region US-EAST-2"
// which is SES refusing to send to an unverified recipient — the sandbox
// restriction. That is a TRANSIENT, ACCOUNT-LEVEL condition: the moment
// production access is granted, every one of those sends would succeed
// unchanged. Without a retry they stay dead forever and the patients they
// were for are simply never told.
//
// BACKOFF AND A CAP
// Retries are spaced by attempt count and capped, because a permanently
// bad address (a typo at signup) must not be retried until the end of
// time. After MAX_ATTEMPTS the row is marked `abandoned` rather than left
// as `failed`, so "we stopped trying" is distinguishable from "we have not
// tried yet" — the distinction the original outbox lacked.
//
// Auth: X-Pipeline-Token, same as the other internal cron endpoints.
// =====================================================================

import { TEMPLATES } from "../../../../_lib/notify.js";

export const MAX_ATTEMPTS = 8;

/**
 * Minutes to wait before the Nth retry. Roughly exponential, capped at a
 * day: a sandbox lift or a DNS fix is hours away, not seconds, so hammering
 * buys nothing and burns the send quota that has to last.
 */
export function backoffMinutes(attempts) {
    const table = [1, 5, 15, 60, 240, 720, 1440, 1440];
    return table[Math.min(Math.max(attempts, 1), table.length) - 1];
}

/** Is this row due for another attempt? */
export function isDue(row, now = Date.now()) {
    if (!row) return false;
    if (row.status === "sent" || row.status === "abandoned") return false;
    const attempts = Number(row.attempts || 0);
    if (attempts >= MAX_ATTEMPTS) return false;
    const last = Date.parse(row.created_at || "") || 0;
    if (!last) return true;                       // no timestamp: try it
    return now - last >= backoffMinutes(attempts) * 60000;
}

/**
 * Some failures will never succeed no matter how long we wait. Retrying a
 * malformed address forever is noise that hides the ones that would work.
 */
export function isPermanent(error) {
    const e = String(error || "").toLowerCase();
    // "undeliverable" and "reserved" cover the RFC 2606 guard in
    // _lib/notify.js — a .test address will bounce on every provider until
    // the end of time, so retrying it is not persistence, it is sabotage.
    return /invalid|malformed|does not exist|no such user|blocked|suppress|bounce|rejected as spam|undeliverable|reserved/.test(e)
        && !/not verified/.test(e);   // "not verified" IS the sandbox — recoverable
}

function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status, headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

export async function onRequestPost(ctx) {
    const { request, env } = ctx;
    if (!env.PIPELINE_TOKEN || request.headers.get("X-Pipeline-Token") !== env.PIPELINE_TOKEN) {
        return json({ error: "unauthorized" }, 401);
    }
    if (!env.DB) return json({ error: "db_not_bound" }, 500);

    const url = new URL(request.url);
    const dryRun = url.searchParams.get("dry_run") === "1";
    const now = Date.now();

    const res = await env.DB.prepare(`
        SELECT id, to_email, template, subject, body_text, body_html,
               patient_id, status, error, attempts, created_at
          FROM notification_outbox
         WHERE status NOT IN ('sent', 'abandoned')
         ORDER BY created_at ASC
         LIMIT 100
    `).all();
    const rows = res?.results || [];

    let sent = 0, stillFailing = 0, abandoned = 0, skipped = 0;
    const detail = [];

    for (const row of rows) {
        // A magic link is a TIME-LIMITED credential. Re-sending the stored
        // body is exactly right while the token is alive (see the note at
        // the send site below) and exactly wrong after it expires: the
        // recipient gets a sign-in link that fails, which reads as "the
        // portal is broken" — worse than the email never arriving. Found
        // live 2026-08-23: five magic_link rows from the SES-sandbox era,
        // eight to ten DAYS old, were still classified retryable and would
        // have delivered dead links the moment the provider switch made
        // sending work. One hour is generous — the issued token lives 15
        // minutes; a patient who still wants in has long since re-requested.
        const ageMs = now - Date.parse(row.created_at || 0);
        if (row.template === "magic_link" && ageMs > 60 * 60 * 1000) {
            if (!dryRun) {
                await env.DB.prepare(
                    `UPDATE notification_outbox
                        SET status = 'abandoned',
                            error = 'magic link expired before delivery was possible; patient must re-request'
                      WHERE id = ?`
                ).bind(row.id).run().catch(() => {});
            }
            abandoned++;
            detail.push({ id: row.id, to: row.to_email, outcome: "abandoned",
                          why: "expired magic link — resending would deliver a dead sign-in link" });
            continue;
        }
        if (Number(row.attempts || 0) >= MAX_ATTEMPTS || isPermanent(row.error)) {
            if (!dryRun) {
                await env.DB.prepare(
                    `UPDATE notification_outbox SET status = 'abandoned' WHERE id = ?`
                ).bind(row.id).run().catch(() => {});
            }
            abandoned++;
            detail.push({ id: row.id, to: row.to_email, outcome: "abandoned",
                          why: isPermanent(row.error) ? "permanent failure" : "attempt cap reached" });
            continue;
        }
        if (!isDue(row, now)) { skipped++; continue; }
        if (dryRun) { detail.push({ id: row.id, to: row.to_email, outcome: "would_retry" }); continue; }

        // Re-send the STORED body rather than rebuilding it from the
        // template. A magic-link token in a queued row is the token that
        // was issued; regenerating the body would either invent a new one
        // or embed an expired one, and the patient would get a link that
        // does not work.
        try {
            const { sendDirect } = await import("../../../../_lib/notify.js");
            const out = await sendDirect(env, {
                to: row.to_email,
                subject: row.subject,
                text: row.body_text,
                html: row.body_html,
            });
            if (out?.ok) {
                await env.DB.prepare(
                    `UPDATE notification_outbox
                        SET status = 'sent', sent_at = ?, attempts = attempts + 1, error = NULL
                      WHERE id = ?`
                ).bind(new Date(now).toISOString(), row.id).run();
                sent++;
                detail.push({ id: row.id, to: row.to_email, outcome: "sent" });
            } else {
                await env.DB.prepare(
                    `UPDATE notification_outbox
                        SET attempts = attempts + 1, error = ?, created_at = ?
                      WHERE id = ?`
                ).bind(String(out?.error || "unknown").slice(0, 500),
                       new Date(now).toISOString(), row.id).run();
                stillFailing++;
                detail.push({ id: row.id, to: row.to_email, outcome: "still_failing",
                              error: String(out?.error || "").slice(0, 160) });
            }
        } catch (e) {
            await env.DB.prepare(
                `UPDATE notification_outbox SET attempts = attempts + 1, error = ?, created_at = ? WHERE id = ?`
            ).bind(String(e).slice(0, 500), new Date(now).toISOString(), row.id).run().catch(() => {});
            stillFailing++;
            detail.push({ id: row.id, to: row.to_email, outcome: "threw", error: String(e).slice(0, 160) });
        }
    }

    return json({
        ok: true, dry_run: dryRun,
        pending: rows.length,
        sent, still_failing: stillFailing, abandoned, not_due_yet: skipped,
        detail: detail.slice(0, 50),
        ran_at: new Date(now).toISOString(),
        templates_known: Object.keys(TEMPLATES).length,
    });
}

export async function onRequest(ctx) {
    if (ctx.request.method === "POST") return onRequestPost(ctx);
    return json({ error: "method_not_allowed" }, 405);
}
