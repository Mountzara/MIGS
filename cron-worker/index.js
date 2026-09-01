// =====================================================================
// cron-worker/index.js — nightly D1 -> R2 snapshot
// =====================================================================
// Standalone Cloudflare Worker (NOT part of the Pages project) that
// runs nightly at 09:00 UTC to dump every D1 row to NDJSON, gzip it,
// and PUT to mountzara-backups/d1/<UTC-date>.ndjson.gz.
//
// Why NDJSON instead of SQL?
//   1. The Worker has direct env.DB access, so we don't need the D1
//      export API (which is a separate poll-based flow).
//   2. NDJSON is portable + restorable into ANY SQL store, not just D1.
//   3. We don't need the schema in the dump — the schema lives in
//      schema/0001*.sql et al., versioned in git.
//
// On restore: replay each row by table into a fresh D1 via a small
// restore script that walks the NDJSON, creates the tables from the
// versioned schema files, and INSERTs the rows. See docs/compliance/
// disaster-recovery-plan.md §3.1 for the operator procedure.
// =====================================================================

// Tables to back up. Update when schema migrations land new tables.
// Anything missing here is silently NOT backed up — risk of data loss
// if a new table is added but the operator forgets to register it. The
// runBackup() function logs each table's row count + any error so the
// operator can spot gaps in the daily output.
const TABLES = [
    // Core identity + auth
    "patients",
    "auth_sessions",
    "magic_link_tokens",
    "audit_log",

    // Intake / triage / scheduling
    "intake_responses",
    "intake_section_data",
    "appointment_triage",
    "clinician_availability",
    "appointments",

    // Clinical encounters + messages + documents
    "encounters",
    "encounter_ai_summaries",
    "message_threads",
    "messages",
    "message_attachments",
    "documents",

    // Member portal modules
    "symptom_definitions",
    "symptom_diary_entries",
    "cycle_log",
    "womens_health_profile",
    "education_materials",
    "patient_education_assignments",
    "patient_content_subscriptions",
    "patient_content_views",

    // Practice config
    "practice_settings",

    // Phase 17 telehealth safety (schema 0018 — added to backup 2026-06-10;
    // pre-existing gap: these were missing from this list since 2026-05-28)
    "visit_launch_attestations",
    "tech_check_results",
    "licensure_blocks",

    // Phase 18 R9 NPS (schema 0023)
    "nps_dispatches",
    "nps_responses",

    // Phase QF trend-brief review queue (schema 0016 — added to backup
    // 2026-07-02; pre-existing gap: pending briefs + their audit trail
    // were unbacked-up since the queue launched)
    "trend_brief_pending",
    "trend_brief_audit_events",

    // Billing pipeline (schema 0006/0025/0026 — added 2026-07-02)
    "billing_claims",
    "billing_claim_lines",
    "billing_claim_diagnoses",
    "billing_compliance_flags",
    "billing_upcoding_opportunities",
    "billing_documentation_suggestions",
    "billing_audit_log",
    "billing_payers",
    "patient_insurance",
    "billing_appeals",
    "billing_preflight_reviews",

    // KNOWN GAP (2026-06-10): tables from migrations 0006–0017 (triage is
    // covered above, but session_trace, preview_invites, member_feedback,
    // wizard_state, PROMs, billing, snapshots, deep-dive authoring) are NOT
    // yet enumerated — audit against `PRAGMA table_list` and backfill in a
    // follow-up. runBackup logs per-table errors so additions are safe.

    // BAA ledger (when migrated to a table — currently in docs/)
    // "baa_ledger",
];

// =====================================================================
// Phase 18 R8 — messaging response-window SLA breach sweep (every 15 min)
// =====================================================================
// Flags message_threads whose committed response window (sla_due_at, set
// by functions/_lib/messaging.js when a patient message starts the clock)
// has passed without a clinician reply. Each breach flips sla_breached=1
// exactly once and writes an audit_log row; /admin/messages/ renders the
// red "SLA BREACHED" badge from the flag.
// KNOWN GAP: no outbound email/SMS exists yet (mailer deferred since
// Phase 2), so clinician notification is the admin-queue badge + audit
// trail. Wire email here when a mailer lands.
async function runSlaSweep(env, meta) {
    const now = Date.now();
    const due = await env.DB.prepare(`
        SELECT id, patient_id, urgency, sla_due_at
        FROM message_threads
        WHERE sla_breached = 0
          AND sla_due_at IS NOT NULL
          AND sla_due_at < ?
          AND status != 'closed'
        LIMIT 200
    `).bind(now).all();
    const rows = due?.results || [];
    let flagged = 0;
    for (const t of rows) {
        try {
            await env.DB.prepare(`
                UPDATE message_threads
                SET sla_breached = 1, updated_at = ?
                WHERE id = ? AND sla_breached = 0
            `).bind(now, t.id).run();
            await env.DB.prepare(`
                INSERT INTO audit_log
                    (id, ts, user_id, user_role, action, record_type, record_id,
                     ip, user_agent, success, details_json)
                VALUES (?, ?, NULL, 'app', 'message_sla_breached', 'message', ?, '', 'mountzara-cron', 1, ?)
            `).bind(
                crypto.randomUUID(), now, t.id,
                JSON.stringify({
                    urgency: t.urgency,
                    sla_due_at: t.sla_due_at,
                    flagged_at: now,
                    overdue_ms: now - Number(t.sla_due_at),
                    source: meta?.source || "cron",
                })
            ).run();
            flagged += 1;
        } catch (e) {
            console.error("sla sweep row failed", { thread_id: t.id, error: String(e?.message || e) });
        }
    }
    console.log(`R8 SLA sweep: scanned=${rows.length} flagged=${flagged} at=${new Date(now).toISOString()}`);
    return { scanned: rows.length, flagged };
}

// =====================================================================
// Phase 18 R9 — NPS survey dispatcher (daily, 11:00 UTC ≈ 6:00am CT)
// =====================================================================
// Delegates to the Pages endpoint /api/v1/internal/nps/dispatch
// (X-Pipeline-Token) because secure-message delivery needs the
// envelope-encryption + messaging libs that only exist in the Pages
// runtime. This Worker just fires the trigger and logs the outcome.
// Requires the PIPELINE_TOKEN secret on THIS worker:
//   cd cron-worker && npx wrangler secret put PIPELINE_TOKEN
async function runNpsDispatch(env) {
    if (!env.PIPELINE_TOKEN) {
        console.error("R9 NPS dispatch: PIPELINE_TOKEN secret not set on mountzara-cron — skipping");
        return;
    }
    try {
        const r = await fetch("https://mountzara.com/api/v1/internal/nps/dispatch", {
            method: "POST",
            headers: { "X-Pipeline-Token": env.PIPELINE_TOKEN },
        });
        const body = await r.text();
        console.log(`R9 NPS dispatch: HTTP ${r.status} ${body.slice(0, 400)}`);
    } catch (e) {
        console.error("R9 NPS dispatch failed", { error: String(e?.message || e) });
    }
}

// =====================================================================
// Content-pipeline DEAD-MAN check (daily, piggybacks the 09:00 backup)
// =====================================================================
// 2026-07-02 — the weekly autogeneration (Mac → /api/posts) died silently
// after blog-2026-W24 (2026-06-12) and NOTHING on the server noticed for
// three weeks; trend briefs piled up pending; carousels stopped 05-19.
// This check reads the PUBLIC posts API daily and writes an audit_log row
// (action content_freshness_alert) whenever the newest published post is
// older than the weekly cadence allows (> 8 days). The admin nav banner
// reads the richer /api/posts/_admin/freshness endpoint; this row is the
// durable, queryable record that the pipeline was dead on a given day.
// KNOWN GAP: no mailer exists yet (same as the R8 SLA sweep) — alerting
// is the admin banner + audit trail until email lands.
async function runContentFreshnessCheck(env) {
    const now = Date.now();
    try {
        const r = await fetch("https://mountzara.com/api/posts/?status=published", {
            headers: { "User-Agent": "mountzara-cron/freshness" },
        });
        if (!r.ok) throw new Error(`posts API HTTP ${r.status}`);
        const data = await r.json();
        const posts = Array.isArray(data) ? data : (data.posts || []);
        const newest = posts
            .map((p) => Date.parse(p.published_at || p.created_at || 0) || 0)
            .sort((a, b) => b - a)[0] || 0;
        const ageDays = newest ? Math.floor((now - newest) / 86400000) : null;
        const stale = ageDays === null || ageDays > 8;
        console.log(`content freshness: newest published ${ageDays === null ? "NONE" : ageDays + "d ago"} — ${stale ? "STALE" : "ok"}`);
        if (!stale) return { ok: true, age_days: ageDays };
        await env.DB.prepare(`
            INSERT INTO audit_log
                (id, ts, user_id, user_role, action, record_type, record_id,
                 ip, user_agent, success, details_json)
            VALUES (?, ?, NULL, 'app', 'content_freshness_alert', 'content_pipeline', 'weekly_posts', '', 'mountzara-cron', 0, ?)
        `).bind(
            crypto.randomUUID(), now,
            JSON.stringify({ newest_published_age_days: ageDays, threshold_days: 8, checked_at: new Date(now).toISOString() }),
        ).run();
        return { ok: false, age_days: ageDays };
    } catch (e) {
        console.error("content freshness check failed", { error: String(e?.message || e) });
        return { ok: false, error: String(e?.message || e) };
    }
}


// =====================================================================
// Content-pipeline stale-alert EMAIL (daily, piggybacks the 09:00 backup)
// =====================================================================
// 2026-09-01 — closes the "KNOWN GAP: no mailer exists yet" above. The
// freshness check writes its audit row; this delegates the actual
// alerting (posts stale > 8d, trend briefs pending > 7d, one email per
// week max) to the Pages endpoint, because email delivery lives in the
// Pages runtime. The endpoint throttles itself, so firing daily is safe.
// The W29 stall sat unnoticed for SEVEN WEEKS with 15 briefs pending in
// review — the audit row existed the whole time; nothing told a human.
async function runContentStaleAlert(env) {
    if (!env.PIPELINE_TOKEN) {
        console.error("content stale-alert: PIPELINE_TOKEN secret not set on mountzara-cron — skipping");
        return;
    }
    try {
        const r = await fetch("https://mountzara.com/api/v1/internal/content/stale-alert", {
            method: "POST",
            headers: { "X-Pipeline-Token": env.PIPELINE_TOKEN },
        });
        const j = await r.json().catch(() => ({}));
        console.log(`content stale-alert: HTTP ${r.status} alert=${j.alert ?? "?"} emailed=${j.emailed ?? "?"} ` +
                    `throttled=${j.throttled ?? false} newest_age=${j.newest_post_age_days ?? "?"}d pending=${j.pending_briefs ?? "?"}`);
    } catch (e) {
        console.error("content stale-alert failed", { error: String(e?.message || e) });
    }
}

// =====================================================================
// Triage auto-release (hourly)
// =====================================================================
// admin/triage/index.html promises, in the panel he works from: "Rows
// auto-release to the patient four hours after AI categorization if not
// reviewed." Nothing did that. AUTO_RELEASE_THRESHOLD_HOURS existed only
// to paint a row `is_overdue` — a badge, not a behaviour — so a patient
// who submitted an intake on a Friday evening waited until he next opened
// the panel, with no slots offered and nothing on screen explaining why.
//
// Delegates to the Pages endpoint because the release path needs the
// audit and notification libs that only exist in the Pages runtime. This
// Worker fires the trigger and logs the outcome. Requires PIPELINE_TOKEN:
//   cd cron-worker && npx wrangler secret put PIPELINE_TOKEN
//
// Hourly, not every 15 minutes: the promise is "four hours", and a row
// released at 4h00 versus 4h59 is indistinguishable to the patient, while
// four times the requests buys nothing.
async function runTriageAutoRelease(env) {
    if (!env.PIPELINE_TOKEN) {
        console.error("triage auto-release: PIPELINE_TOKEN secret not set on mountzara-cron — skipping");
        return;
    }
    try {
        const r = await fetch("https://mountzara.com/api/v1/internal/triage/auto-release", {
            method: "POST",
            headers: { "X-Pipeline-Token": env.PIPELINE_TOKEN, "content-type": "application/json" },
        });
        const j = await r.json().catch(() => ({}));
        console.log(`triage auto-release: scanned=${j.scanned ?? "?"} released=${j.released ?? "?"} ` +
                    `held=${j.held ?? "?"} urgent_awaiting_review=${j.urgent_awaiting_review ?? "?"}`);
        // Urgent rows past four hours are a real backlog, not an exception
        // the job absorbs. Say so loudly enough to find in the logs.
        if (j.urgent_awaiting_review > 0) {
            console.error(`triage auto-release: ${j.urgent_awaiting_review} URGENT triage row(s) past ${j.threshold_hours}h and still unreviewed — these are never auto-released`);
        }
    } catch (e) {
        console.error("triage auto-release failed", String(e?.message || e));
    }
}


// =====================================================================
// Order / result sweep (hourly, with triage auto-release)
// =====================================================================
// The missed-result safety net. Delegates to the Pages endpoint, which
// holds the logic and the DB binding; this just wakes it up and makes
// the outcome findable in the logs. An unacknowledged critical result is
// the most dangerous state the system can be in, so it is logged as an
// error rather than an info line.
async function runOrderSweep(env) {
    if (!env.PIPELINE_TOKEN) {
        console.error("order sweep: PIPELINE_TOKEN secret not set on mountzara-cron — skipping");
        return;
    }
    try {
        const r = await fetch("https://mountzara.com/api/v1/internal/orders/sweep", {
            method: "POST",
            headers: { "X-Pipeline-Token": env.PIPELINE_TOKEN, "content-type": "application/json" },
        });
        const j = await r.json().catch(() => ({}));
        console.log(`order sweep: scanned=${j.scanned ?? "?"} newly_overdue=${j.newly_overdue ?? "?"} ` +
                    `still_overdue=${j.still_overdue ?? "?"} critical_unacked=${j.critical_unacknowledged ?? "?"} ` +
                    `awaiting_patient_comm=${j.awaiting_patient_communication ?? "?"} emailed=${j.emailed ?? "?"}`);
        if (j.critical_unacknowledged > 0) {
            console.error(`order sweep: ${j.critical_unacknowledged} CRITICAL result(s) unacknowledged`);
        }
    } catch (e) {
        console.error("order sweep failed", String(e?.message || e));
    }
}

// =====================================================================
// Notification outbox flush (every 15 minutes, with the SLA sweep)
// =====================================================================
// notify.js queues every failed send and its own comment said "a later run
// can retry". No later run existed — the outbox was write-only. Six real
// notifications sat in it, three of them magic-link SIGN-IN emails, every
// one at attempts=1, none ever tried again.
//
// The recorded failure is the SES sandbox refusing unverified recipients,
// which is transient at the account level: the moment production access is
// granted these all succeed unchanged. Without a retry they stay dead and
// the patients they were for are simply never told.
async function runNotificationFlush(env) {
    if (!env.PIPELINE_TOKEN) {
        console.error("notification flush: PIPELINE_TOKEN not set on mountzara-cron — skipping");
        return;
    }
    try {
        const r = await fetch("https://mountzara.com/api/v1/internal/notifications/flush", {
            method: "POST",
            headers: { "X-Pipeline-Token": env.PIPELINE_TOKEN, "content-type": "application/json" },
        });
        const j = await r.json().catch(() => ({}));
        console.log(`notification flush: pending=${j.pending ?? "?"} sent=${j.sent ?? "?"} ` +
                    `still_failing=${j.still_failing ?? "?"} abandoned=${j.abandoned ?? "?"}`);
        if (j.still_failing > 0) {
            console.error(`notification flush: ${j.still_failing} notification(s) STILL undelivered — ` +
                          `check /api/v1/admin/notifications/health for the cause`);
        }
    } catch (e) {
        console.error("notification flush failed", String(e?.message || e));
    }
}

export default {
    /**
     * Cron handler — invoked by Cloudflare on the [triggers] crons schedule.
     * Routed by which cron expression fired (event.cron).
     */
    async scheduled(event, env, ctx) {
        if (event.cron === "*/15 * * * *") {
            ctx.waitUntil(runSlaSweep(env, { source: "cron", scheduledTime: event.scheduledTime }));
            ctx.waitUntil(runNotificationFlush(env));
            return;
        }
        if (event.cron === "0 11 * * *") {
            ctx.waitUntil(runNpsDispatch(env));
            return;
        }
        if (event.cron === "0 * * * *") {
            ctx.waitUntil(runTriageAutoRelease(env));
            ctx.waitUntil(runOrderSweep(env));
            return;
        }
        ctx.waitUntil(runBackup(env, { source: "cron", scheduledTime: event.scheduledTime }));
        ctx.waitUntil(runContentFreshnessCheck(env));
        ctx.waitUntil(runContentStaleAlert(env));
    },

    /**
     * HTTP fetch handler — for manual triggering during a drill, or for
     * verifying the Worker is reachable. Requires Bearer auth against
     * env.MANUAL_BACKUP_TOKEN. Useful for the quarterly DR drill.
     */
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        if (url.pathname === "/health") {
            return new Response(JSON.stringify({
                ok: true,
                worker: "mountzara-cron",
                env_has_db: !!env.DB,
                env_has_backups: !!env.BACKUPS,
                env_has_manual_token: !!env.MANUAL_BACKUP_TOKEN,
                time: new Date().toISOString(),
            }), { headers: { "content-type": "application/json" } });
        }
        if (url.pathname !== "/backup") {
            return new Response("not_found", { status: 404 });
        }
        if (!env.MANUAL_BACKUP_TOKEN) {
            return new Response(JSON.stringify({ error: "manual_trigger_disabled" }), {
                status: 503, headers: { "content-type": "application/json" },
            });
        }
        const auth = request.headers.get("Authorization") || "";
        const expected = `Bearer ${env.MANUAL_BACKUP_TOKEN}`;
        if (!constantTimeEq(auth, expected)) {
            return new Response(JSON.stringify({ error: "unauthorized" }), {
                status: 401, headers: { "content-type": "application/json" },
            });
        }
        const summary = await runBackup(env, { source: "manual_http" });
        return new Response(JSON.stringify(summary), {
            status: 200, headers: { "content-type": "application/json" },
        });
    },
};

function constantTimeEq(a, b) {
    if (typeof a !== "string" || typeof b !== "string") return false;
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

async function runBackup(env, meta) {
    const start = Date.now();
    const dateUtc = new Date().toISOString().slice(0, 10);   // YYYY-MM-DD
    const lines = [];
    let totalRows = 0;
    const tableSummaries = [];

    // Header line for restore tooling.
    lines.push(JSON.stringify({
        type: "header",
        worker: "mountzara-cron",
        version: 1,
        backup_at: new Date().toISOString(),
        date_utc: dateUtc,
        source: meta && meta.source,
    }));

    for (const table of TABLES) {
        try {
            const r = await env.DB.prepare(`SELECT * FROM ${table}`).all();
            const rows = r && r.results ? r.results : [];
            lines.push(JSON.stringify({ type: "table_meta", table, count: rows.length }));
            for (const row of rows) {
                lines.push(JSON.stringify({ type: "row", table, data: row }));
            }
            totalRows += rows.length;
            tableSummaries.push({ table, count: rows.length });
        } catch (e) {
            const errMsg = e && e.message ? e.message : String(e);
            lines.push(JSON.stringify({ type: "table_error", table, error: errMsg }));
            tableSummaries.push({ table, error: errMsg });
            console.error("backup table failed", { table, error: errMsg });
        }
    }

    lines.push(JSON.stringify({
        type: "footer",
        total_rows: totalRows,
        tables_backed_up: tableSummaries.length,
        elapsed_ms: Date.now() - start,
        completed_at: new Date().toISOString(),
    }));

    const ndjson = lines.join("\n") + "\n";
    const ndjsonBytes = new TextEncoder().encode(ndjson);

    // Gzip via the platform's CompressionStream.
    const cs = new CompressionStream("gzip");
    const writer = cs.writable.getWriter();
    await writer.write(ndjsonBytes);
    await writer.close();
    const compressed = await new Response(cs.readable).arrayBuffer();

    const key = `d1/${dateUtc}.ndjson.gz`;
    await env.BACKUPS.put(key, compressed, {
        httpMetadata: { contentType: "application/gzip" },
        customMetadata: {
            "mz-backup-version": "1",
            "mz-backup-source": (meta && meta.source) || "cron",
            "mz-backup-at": new Date().toISOString(),
            "mz-total-rows": String(totalRows),
            "mz-uncompressed-bytes": String(ndjsonBytes.length),
        },
    });

    const summary = {
        ok: true,
        key,
        total_rows: totalRows,
        tables: tableSummaries,
        uncompressed_bytes: ndjsonBytes.length,
        compressed_bytes: compressed.byteLength,
        elapsed_ms: Date.now() - start,
        source: (meta && meta.source) || "cron",
        scheduled_at: meta && meta.scheduledTime ? new Date(meta.scheduledTime).toISOString() : null,
    };
    console.log("backup complete", summary);
    return summary;
}
