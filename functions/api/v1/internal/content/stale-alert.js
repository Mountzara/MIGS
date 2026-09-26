// =====================================================================
// POST /api/v1/internal/content/stale-alert — the pipeline dead-man EMAIL
// =====================================================================
// The content pipeline has died silently twice: after W24 (2026-06-12,
// noticed three weeks later) and after W29 (2026-07-13, noticed SEVEN
// weeks later, with 15 trend briefs sitting pending in the review queue
// the whole time). The dead-man CHECK existed both times — cron writes a
// content_freshness_alert audit row daily — but a row in a table and a
// banner in an admin panel only inform someone who goes looking. This
// endpoint is the part that tells the owner.
//
// What it examines (counts and dates only — no clinical content, no PHI):
//   * the newest published post's age (weekly cadence ⇒ stale past 8 days)
//   * trend briefs sitting in 'pending' review (aging past 7 days means
//     the queue is waiting on a human and nobody knows)
//
// Two deliberate properties, same philosophy as the orders sweep:
//   * IT THROTTLES ITSELF. At most one email per 7 days (tracked via its
//     own audit_log rows) — a daily nag gets filtered, and then the one
//     that matters gets filtered with it. The email states plainly that
//     the condition persists until fixed and when the next reminder is.
//   * IT CARRIES FACTS, NOT CONTENT. Ages, counts, and admin links.
//
// Auth: X-Pipeline-Token (cron) or admin Basic/Access auth (manual test).
// Recipient: ALERT_EMAIL, falling back to the first ADMIN_EMAILS address
// (same convention as orders/sweep.js).
// =====================================================================

import { jsonResponse, jsonError, readAdminIdentity } from "../../../../_lib/admin_api.js";
import { isPipelineRequest } from "../../../../_lib/trend_briefs.js";
import { sendDirect } from "../../../../_lib/notify.js";

const POST_STALE_DAYS = 8;      // weekly cadence + grace
const QUEUE_STALE_DAYS = 7;     // a brief waiting a week is stuck, not "in review"
const EMAIL_THROTTLE_DAYS = 7;  // at most one alert email per week

function parseWhen(v) {
    if (v == null) return 0;
    if (typeof v === "number") return v > 1e12 ? v : v * 1000; // ms vs s epochs
    const t = Date.parse(String(v));
    return Number.isFinite(t) ? t : 0;
}

async function newestPublishedAt(env) {
    let newest = 0;
    for (const kind of ["blog", "evidence"]) {
        try {
            const obj = await env.CONTENT.get(`_index/${kind}.json`);
            if (!obj) continue;
            const idx = JSON.parse(await obj.text());
            for (const p of idx.posts || []) {
                if (p.status && p.status !== "published") continue;
                const t = parseWhen(p.published_at || p.created_at);
                if (t > newest) newest = t;
            }
        } catch { /* a missing/corrupt index reads as "no posts" — stale, which alerts */ }
    }
    return newest;
}

async function run(env) {
    const now = Date.now();
    const facts = { checked_at: new Date(now).toISOString() };

    const newest = await newestPublishedAt(env);
    facts.newest_post_age_days = newest ? Math.floor((now - newest) / 86400000) : null;
    const postsStale = facts.newest_post_age_days === null || facts.newest_post_age_days > POST_STALE_DAYS;

    let pendingCount = 0, oldestPendingDays = null;
    try {
        const row = await env.DB.prepare(
            `SELECT COUNT(*) AS c, MIN(submitted_at) AS oldest FROM trend_brief_pending WHERE status = 'pending'`
        ).first();
        pendingCount = Number(row?.c || 0);
        const oldest = parseWhen(row?.oldest);
        if (pendingCount > 0 && oldest) oldestPendingDays = Math.floor((now - oldest) / 86400000);
    } catch (e) {
        facts.queue_error = String(e?.message || e).slice(0, 120);
    }
    facts.pending_briefs = pendingCount;
    facts.oldest_pending_days = oldestPendingDays;
    const queueStale = pendingCount > 0 && oldestPendingDays !== null && oldestPendingDays > QUEUE_STALE_DAYS;

    if (!postsStale && !queueStale) {
        return jsonResponse({ ok: true, alert: false, ...facts });
    }

    // ---- throttle: at most one email per window, tracked in audit_log ----
    let lastEmailTs = 0;
    try {
        const row = await env.DB.prepare(
            `SELECT ts FROM audit_log WHERE action = 'content_stale_email' AND success = 1 ORDER BY ts DESC LIMIT 1`
        ).first();
        lastEmailTs = Number(row?.ts || 0);
    } catch { /* no row / fresh table — send */ }
    if (lastEmailTs && now - lastEmailTs < EMAIL_THROTTLE_DAYS * 86400000) {
        return jsonResponse({ ok: true, alert: true, emailed: false, throttled: true, ...facts });
    }

    // ALERT_EMAIL is where operational alerts go — deliberately its own
    // setting (ADMIN_EMAILS is an access allowlist; changing who gets paged
    // must never quietly change who can log in). Falls back so the alert
    // still goes somewhere if ALERT_EMAIL is unset.
    const to = String(env.ALERT_EMAIL || env.ADMIN_EMAILS || "").split(/[,\s]+/).filter(Boolean)[0];
    if (!to) return jsonResponse({ ok: false, alert: true, emailed: false, error: "no ALERT_EMAIL/ADMIN_EMAILS configured", ...facts }, 200);

    const lines = [];
    if (postsStale) {
        lines.push(facts.newest_post_age_days === null
            ? "No published posts could be read — the content index may be broken."
            : `The newest published post is ${facts.newest_post_age_days} days old (weekly cadence expects ≤ ${POST_STALE_DAYS}). The Mac research-digest pipeline has likely stopped submitting.`);
    }
    if (queueStale) {
        lines.push(`${pendingCount} trend brief(s) are waiting in the review queue — the oldest for ${oldestPendingDays} days. They publish only after your approval: https://mountzara.com/admin/`);
    }
    lines.push("", `This email repeats at most weekly while the condition persists.`);

    let emailed = false;
    try {
        await sendDirect(env, {
            to,
            subject: "mountzara.com: content pipeline needs attention",
            text: lines.join("\n"),
        });
        emailed = true;
    } catch (e) {
        facts.email_error = String(e?.message || e).slice(0, 160);
    }

    try {
        await env.DB.prepare(`
            INSERT INTO audit_log
                (id, ts, user_id, user_role, action, record_type, record_id,
                 ip, user_agent, success, details_json)
            VALUES (?, ?, NULL, 'app', 'content_stale_email', 'content_pipeline', 'stale_alert', '', 'stale-alert', ?, ?)
        `).bind(crypto.randomUUID(), now, emailed ? 1 : 0, JSON.stringify(facts)).run();
    } catch { /* the email already went; a failed audit write must not fail the run */ }

    return jsonResponse({ ok: emailed, alert: true, emailed, ...facts });
}

export async function onRequestPost(ctx) {
    const { request, env } = ctx;
    if (!env.DB) return jsonError("server_error: DB binding missing", 500);
    if (!env.CONTENT) return jsonError("server_error: CONTENT binding missing", 500);
    if (isPipelineRequest(request, env)) return run(env);
    const admin = await readAdminIdentity(request, env);
    if (!admin) return jsonError("authentication_required", 401);
    return run(env);
}
