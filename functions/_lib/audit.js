// =====================================================================
// functions/_lib/audit.js — HIPAA audit log helper
// =====================================================================
// Per CLAUDE.md §11 Tier 7 and §4.4. Every PHI read/write, every auth
// event, every appointment/encounter/message/document operation writes
// a row to audit_log.
//
// Constraints:
//   * Append-only — no row is ever updated or deleted by application code.
//   * 6-year retention (Cloudflare D1 indefinite by default; we never
//     prune from app code).
//   * PHI is redacted at the call site. Don't pass names, DOBs, or
//     free-text descriptions through `details`. Pass record_ids only.
// =====================================================================

const ALLOWED_ACTIONS = new Set([
    // auth lifecycle
    "login_success", "login_fail",
    "logout",
    "session_create", "session_revoke",
    "magic_link_issue", "magic_link_redeem",
    "password_reset_request", "password_reset_complete",
    "role_check_fail",
    "totp_enroll", "totp_verify_success", "totp_verify_fail",
    // patient lifecycle
    "patient_create", "patient_update", "patient_close",
    // intake
    "intake_start", "intake_section_save", "intake_submit", "intake_review",
    // triage
    "triage_run", "triage_override", "triage_release",
    // scheduling
    "availability_set", "availability_update",
    "appointment_book", "appointment_cancel", "appointment_reschedule",
    "appointment_complete", "appointment_no_show",
    "doxy_join",
    // messaging
    "message_send", "message_read", "message_delete",
    // documents
    "document_upload", "document_download", "document_delete",
    // encounters / clinical
    "encounter_create", "encounter_update",
    "phi_read", "phi_write", "phi_delete",
    // billing
    "invoice_create", "invoice_send", "invoice_paid", "invoice_void",
    "claim_submit", "claim_era_post", "insurance_update",
    "claim_ai_preflight", "claim_appeal_draft",
    // app sync
    "app_sync_push", "app_sync_token_issue", "app_sync_token_revoke",
    // admin / data rights
    "admin_override",
    "data_export", "data_amendment_request", "data_restriction_request",
]);

/**
 * Write a row to audit_log. Never throws — failures log to console and
 * are swallowed so an audit-write failure cannot break the user-facing
 * request. The Pages Function tail captures any such miss.
 *
 * @param {object} env - Pages Function env with .DB bound
 * @param {object} entry
 * @param {string=} entry.user_id        - patient_id / clinician_id / null
 * @param {string=} entry.user_role      - 'patient' | 'clinician' | 'staff' | 'anonymous' | 'app'
 * @param {string} entry.action          - from ALLOWED_ACTIONS
 * @param {string=} entry.record_type
 * @param {string=} entry.record_id
 * @param {string=} entry.ip
 * @param {string=} entry.user_agent
 * @param {boolean} entry.success
 * @param {object=} entry.details        - serializable JSON, PHI-free
 */
export async function logAudit(env, entry, ctx) {
    if (!env || !env.DB) {
        console.warn("logAudit skipped — env.DB not bound", { action: entry?.action });
        return;
    }
    const action = String(entry?.action || "");
    if (!ALLOWED_ACTIONS.has(action)) {
        // We still write the row (don't lose audit data) but warn loud
        // so a new action that wasn't added to the allowlist is visible.
        console.warn("logAudit: action not in allowlist — adding to allowlist or check spelling", { action });
    }
    const row_id = (typeof crypto.randomUUID === "function") ? crypto.randomUUID() : `audit-${Date.now()}-${Math.random()}`;
    const ts = Date.now();
    let details_json = null;
    try {
        if (entry.details !== undefined && entry.details !== null) {
            details_json = JSON.stringify(entry.details);
        }
    } catch (e) {
        details_json = JSON.stringify({ _serialization_error: String(e) });
    }
    // Build the write promise once. When ctx is provided, hand it to
    // ctx.waitUntil() and return immediately — the audit row writes
    // after the response is sent, removing 20-50ms of D1 latency from
    // the response path. This was a key cause of intermittent Worker
    // 503s before 2026-05-20. When ctx is absent (legacy callers), the
    // promise still runs in the background; we don't await it.
    const writePromise = env.DB.prepare(`
        INSERT INTO audit_log
            (id, ts, user_id, user_role, action, record_type, record_id, ip, user_agent, success, details_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
        row_id,
        ts,
        entry.user_id || null,
        entry.user_role || "anonymous",
        action,
        entry.record_type || null,
        entry.record_id || null,
        entry.ip || null,
        entry.user_agent || null,
        entry.success ? 1 : 0,
        details_json
    ).run().catch((e) => {
        // Last-resort: write to console so the event is at least in the
        // wrangler tail / Cloudflare log even if D1 was down.
        console.error("logAudit DB.prepare/run threw — event lost from D1 but logged here", {
            module: "_lib/audit",
            error: e && e.message ? e.message : String(e),
            event: {
                id: row_id, ts,
                user_id: entry.user_id, user_role: entry.user_role,
                action, record_type: entry.record_type, record_id: entry.record_id,
                success: !!entry.success,
            },
        });
    });
    if (ctx && typeof ctx.waitUntil === "function") {
        ctx.waitUntil(writePromise);
    }
    // else: promise runs in the background unawaited
}

/**
 * Convenience: query the most recent audit_log rows for one record.
 * Used by /admin/cases/<patient_id> to show the activity timeline.
 *
 * @returns {Promise<object[]>}
 */
export async function listAuditForRecord(env, record_type, record_id, limit = 100) {
    if (!env.DB) return [];
    const res = await env.DB.prepare(`
        SELECT id, ts, user_id, user_role, action, ip, success, details_json
        FROM audit_log
        WHERE record_type = ? AND record_id = ?
        ORDER BY ts DESC
        LIMIT ?
    `).bind(record_type, record_id, limit).all();
    return res?.results || [];
}

/**
 * Convenience: query audit rows for a user (patient_id or clinician_id).
 */
export async function listAuditForUser(env, user_id, limit = 200) {
    if (!env.DB) return [];
    const res = await env.DB.prepare(`
        SELECT id, ts, user_role, action, record_type, record_id, ip, success
        FROM audit_log
        WHERE user_id = ?
        ORDER BY ts DESC
        LIMIT ?
    `).bind(user_id, limit).all();
    return res?.results || [];
}
