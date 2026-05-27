// =====================================================================
// functions/_lib/trend_briefs.js — Phase QF shared helpers
// =====================================================================
// Trend-brief peer-review queue helpers.  Used by every endpoint under
// /api/v1/admin/trend-briefs/*.
//
// Storage convention (R2 bucket = env.CONTENT = mountzara-content):
//   trend-briefs-pending/<id>/body.html       — rendered HTML body
//   trend-briefs-pending/<id>/sidecar.json    — the brief sidecar JSON
//   trend-briefs-pending/<id>/override.json   — override JSON (set on approve)
//
// Per CLAUDE.md §3.8 + §9.2: trend-brief content is NOT PHI (it cites
// published peer-reviewed literature) — BAA-not-gated per §12.2.  The
// queue is still admin-auth + MFA gated because it's an admin surface.
// =====================================================================

import { logAudit } from "./audit.js";
import { newId } from "./db.js";

/**
 * Compute the canonical row id from {brief_date, slug}.
 * Stable across re-submissions of the same brief.
 */
export function briefId(briefDate, slug) {
    return `${briefDate}__${slug}`;
}

export function bodyHtmlR2Key(id) {
    return `trend-briefs-pending/${id}/body.html`;
}

export function sidecarR2Key(id) {
    return `trend-briefs-pending/${id}/sidecar.json`;
}

export function overrideR2Key(id) {
    return `trend-briefs-pending/${id}/override.json`;
}

/**
 * Pipeline-token check, mirrors functions/api/posts/[[path]].js.
 * Returns true when the request carries X-Pipeline-Token matching
 * env.PIPELINE_TOKEN (constant-time compare).
 */
export function isPipelineRequest(request, env) {
    const token = request.headers.get("X-Pipeline-Token");
    if (!token || !env.PIPELINE_TOKEN) return false;
    if (token.length !== env.PIPELINE_TOKEN.length) return false;
    let mismatch = 0;
    for (let i = 0; i < token.length; i++) {
        mismatch |= token.charCodeAt(i) ^ env.PIPELINE_TOKEN.charCodeAt(i);
    }
    return mismatch === 0;
}

/**
 * Safely JSON.parse a string; returns the parsed value or a
 * { _parse_error, _raw } envelope.  Mirrors the convention in
 * feedback/index.js.
 */
export function safeParse(s) {
    if (s == null) return null;
    try { return JSON.parse(s); } catch {
        return { _parse_error: true, _raw: String(s).slice(0, 120) };
    }
}

/**
 * Build the row payload returned by GET /queue and GET /<slug>.
 * Strips R2 keys (callers reach the HTML via /preview), parses JSON
 * blobs, exposes whether each artifact exists.
 */
export function rowToWire(row) {
    if (!row) return null;
    return {
        id: row.id,
        slug: row.slug,
        brief_date: row.brief_date,
        claim_text: row.claim_text,
        influencer: row.influencer,
        topics_covered: safeParse(row.topics_covered) || [],
        pmids_cited: safeParse(row.pmids_cited) || [],
        kb_entries_retrieved: safeParse(row.kb_entries_retrieved) || [],
        gaps_surfaced: safeParse(row.gaps_surfaced) || [],

        audit_table: safeParse(row.audit_table_json) || [],
        audit_pass_count: row.audit_pass_count,
        audit_fail_count: row.audit_fail_count,

        status: row.status,
        status_reason: row.status_reason,

        override: safeParse(row.override_json),
        has_override: !!row.override_json,

        submitted_at: row.submitted_at,
        approved_at: row.approved_at,
        approved_by: row.approved_by,
        rejected_at: row.rejected_at,
        rejected_by: row.rejected_by,

        pulled_at: row.pulled_at,
        rerender_passed: row.rerender_passed,
        rerender_attempted_at: row.rerender_attempted_at,
        draft_post_id: row.draft_post_id,

        suggestions_text: row.suggestions_text,
        suggestions_set_at: row.suggestions_set_at,

        created_at: row.created_at,
        updated_at: row.updated_at,

        // Convenience URLs the SPA uses
        preview_url: `/api/v1/admin/trend-briefs/${encodeURIComponent(row.id)}/preview`,
        detail_url: `/api/v1/admin/trend-briefs/${encodeURIComponent(row.id)}`,
    };
}

/**
 * Insert a state-change row into trend_brief_audit_events.  Non-fatal
 * — logs and swallows on failure (mirrors feedback audit pattern).
 */
export async function appendAuditEvent(env, ctx, briefId, event) {
    try {
        await env.DB.prepare(`
            INSERT INTO trend_brief_audit_events
                (id, brief_id, ts, actor, actor_label, event_kind, detail_json)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(
            newId(),
            briefId,
            event.ts || Date.now(),
            event.actor || "system",
            event.actor_label || null,
            event.event_kind,
            event.detail ? JSON.stringify(event.detail).slice(0, 4000) : null,
        ).run();
    } catch (e) {
        console.warn("trend_brief_audit_events insert failed (non-fatal)", {
            module: "_lib/trend_briefs",
            briefId, event_kind: event.event_kind, error: String(e),
        });
    }
}

/**
 * Bind logAudit on a state change so admin actions are HIPAA-traceable
 * (even though briefs aren't PHI, we keep the audit trail for op-sec).
 * Uses ctx.waitUntil per §10.10 to keep the write off the response path.
 */
export function auditAdminAction(env, ctx, admin, action, briefId, details) {
    const entry = {
        user_id: admin.user,
        user_role: admin.role,
        action: "admin_override",
        record_type: "trend_brief_pending",
        record_id: briefId,
        success: true,
        details: { op: action, ...(details || {}) },
    };
    return logAudit(env, entry, ctx);
}

/**
 * The §3.8 verdict-gate row label, used by the producer endpoint to
 * confirm the submission is queue-eligible (only the verdict gate
 * failing means an override JSON unblocks it; any other failure is a
 * real bug that should hard-abort upstream, not queue here).
 */
export const VERDICT_GATE_LABEL =
    "verdict reviewed (no REVIEW REQUIRED label)";

/**
 * Inspect the audit-table list and return:
 *   { queue_eligible: bool, failing_labels: [string], reason: string }
 *
 * queue_eligible is true iff:
 *   - audit table is non-empty
 *   - every failing row is the verdict-gate row (label match)
 */
export function classifyAudit(auditTable) {
    if (!Array.isArray(auditTable) || auditTable.length === 0) {
        return {
            queue_eligible: false,
            failing_labels: [],
            reason: "audit_table_missing_or_empty",
        };
    }
    const failing = auditTable.filter((r) => !r?.ok);
    if (failing.length === 0) {
        return {
            queue_eligible: false,
            failing_labels: [],
            reason: "no_failures_should_publish_directly",
        };
    }
    const failingLabels = failing.map((r) => String(r.label || ""));
    const onlyVerdictGate = failingLabels.every(
        (lbl) => lbl === VERDICT_GATE_LABEL
    );
    return {
        queue_eligible: onlyVerdictGate,
        failing_labels: failingLabels,
        reason: onlyVerdictGate
            ? "only_verdict_gate_failing"
            : "non_verdict_gate_failures_present",
    };
}
