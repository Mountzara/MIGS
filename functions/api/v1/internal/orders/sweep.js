// =====================================================================
// POST /api/v1/internal/orders/sweep — the missed-result safety net
// =====================================================================
// A board only helps someone who opens it. This is the part that goes
// looking: every hour it finds orders that passed their expected result
// date with nothing back, and critical results nobody has acknowledged,
// and emails the practice.
//
// Two deliberate properties:
//
//   * IT ONLY SHOUTS ABOUT WHAT IS NEW OR DANGEROUS. Each overdue order
//     is flagged once (overdue_notified_at); after that it is reported in
//     the digest but does not re-trigger an email. A daily message that
//     repeats yesterday's numbers gets filtered — and then the one that
//     matters gets filtered with it.
//   * THE EMAIL CARRIES COUNTS, NOT CONTENT. No patient, no test, no
//     result. It lands in an ordinary inbox; the detail lives behind
//     admin authentication.
//
// Auth: X-Pipeline-Token, same as the other cron-driven internal
// endpoints. Fails closed when the token is unset.
// =====================================================================

import { adminRoute } from "../../../../_lib/admin_api.js";
import { newId } from "../../../../_lib/db.js";
import { sweepPlan, digestText } from "../../../../_lib/orders.js";
import { notify } from "../../../../_lib/notify.js";
import { logAudit } from "../../../../_lib/audit.js";

function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status, headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

// Two callers, same work (the pattern billing/era.js already uses):
//   * the hourly cron, with X-Pipeline-Token;
//   * an authenticated admin pressing "Run now", which matters because the
//     cron Worker is deployed separately — without this path the safety net
//     would sit dormant and look installed.
async function runSweep(ctx, actor) {
    const { env } = ctx;
    if (!env.DB) return json({ error: "db_not_bound" }, 500);

    const now = Date.now();
    const orders = (await env.DB.prepare(`
        SELECT id, patient_id, order_type, status, priority, result_due_at,
               resulted_at, reviewed_at, overdue_notified_at
          FROM clinical_orders
         WHERE status NOT IN ('reviewed','cancelled','draft')
         LIMIT 1000`).all())?.results || [];

    const byOrder = new Map();
    if (orders.length) {
        const ph = orders.map(() => "?").join(",");
        const rs = (await env.DB.prepare(`
            SELECT id, order_id, result_status, received_at, acknowledged_at, patient_communicated_at
              FROM order_results WHERE order_id IN (${ph})`).bind(...orders.map(o => o.id)).all())?.results || [];
        for (const r of rs) {
            if (!byOrder.has(r.order_id)) byOrder.set(r.order_id, []);
            byOrder.get(r.order_id).push(r);
        }
    }

    const plan = sweepPlan(orders, byOrder, now);

    // Stamp the newly overdue so the next run does not re-alert on them.
    for (const o of plan.newly_overdue) {
        await env.DB.prepare(`UPDATE clinical_orders SET overdue_notified_at = ?, updated_at = ? WHERE id = ?`)
            .bind(now, now, o.id).run();
        await env.DB.prepare(
            `INSERT INTO order_events (id, order_id, at, actor, event, detail) VALUES (?, ?, ?, ?, 'overdue_flagged', '{}')`
        ).bind(newId(), o.id, now, "sweep").run();
    }

    let emailed = false;
    const lines = digestText(plan.counts);
    if (plan.notify && lines.length > 0) {
        // ALERT_EMAIL is where operational alerts go. It is deliberately its
        // OWN setting rather than reusing ADMIN_EMAILS, which is a Cloudflare
        // Access allowlist — changing who gets paged must never quietly
        // change who can log in. Falls back to the first admin address so
        // the alert still goes somewhere if ALERT_EMAIL is unset.
        const to = String(env.ALERT_EMAIL || env.ADMIN_EMAILS || "").split(/[,\s]+/).filter(Boolean)[0];
        if (to) {
            try {
                await notify(env, {
                    to, template: "order_attention",
                    data: { lines, boardUrl: "https://mountzara.com/admin/orders/" },
                });
                emailed = true;
            } catch (e) {
                console.error("orders sweep: notify failed", String(e?.message || e));
            }
        }
    }

    try {
        await logAudit(env, {
            user_id: actor, user_role: actor === "sweep" ? "app" : "staff", action: "order_sweep",
            record_type: "clinical_order", record_id: "sweep", success: true,
            details: { ...plan.counts, emailed },
        }, ctx);
    } catch {}

    return json({
        ok: true, scanned: orders.length, emailed, ...plan.counts,
        // Ids only — this response goes to the cron log, not to a person.
        newly_overdue_ids: plan.newly_overdue.map(o => o.id),
    });
}

export async function onRequestPost(ctx) {
    const { request, env } = ctx;
    const token = request.headers.get("X-Pipeline-Token");
    if (token && env.PIPELINE_TOKEN && token === env.PIPELINE_TOKEN) {
        return runSweep(ctx, "sweep");
    }
    return adminRoute(ctx, async ({ admin }) => runSweep(ctx, (admin && admin.user) || "admin"));
}

export async function onRequest(ctx) {
    if (ctx.request.method === "POST") return onRequestPost(ctx);
    return json({ error: "method_not_allowed" }, 405);
}
