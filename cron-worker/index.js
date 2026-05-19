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

    // BAA ledger (when migrated to a table — currently in docs/)
    // "baa_ledger",
];

export default {
    /**
     * Cron handler — invoked by Cloudflare on the [triggers] crons schedule.
     */
    async scheduled(event, env, ctx) {
        ctx.waitUntil(runBackup(env, { source: "cron", scheduledTime: event.scheduledTime }));
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
