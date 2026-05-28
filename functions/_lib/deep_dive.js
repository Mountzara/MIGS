// =====================================================================
// functions/_lib/deep_dive.js — Phase QG shared helpers
// =====================================================================
// Per-PMID deep-dive journal-club content authoring queue.  Surface-
// agnostic (works for trend briefs, CBG/MIGS Monday Mornings, future
// JC surfaces).
//
// Per CLAUDE.md §3.9 (NO-heuristic clinical content) + §12.1 (Cowork
// is the orchestrator): the website is the queue + UI, the actual
// authorship happens in a Cowork session, and the patch is then
// applied back to the surface's storage via apply_deep_dive_patch.py.
//
// Zero Anthropic API spend from any of these endpoints.
// =====================================================================

import { logAudit } from "./audit.js";
import { newId } from "./db.js";

export const SURFACE_TREND_BRIEF   = "trend_brief";
export const SURFACE_MONDAY_MORNING = "monday_morning";
export const VALID_SURFACE_KINDS = new Set([
    SURFACE_TREND_BRIEF, SURFACE_MONDAY_MORNING,
]);

export const VALID_STATUSES = new Set([
    "pending", "bundle_requested", "bundle_ready",
    "patch_uploaded", "authored",
]);

/**
 * Stable composite id from (surface_kind, surface_key, pmid).  Used as
 * the D1 primary key and the R2 key prefix.
 */
export function authoringId(surfaceKind, surfaceKey, pmid) {
    return `${surfaceKind}:${surfaceKey}:${pmid}`;
}

export function bundleR2Key(id)  { return `deep-dive-authoring/${id}/bundle.md`; }
export function patchR2Key(id)   { return `deep-dive-authoring/${id}/patch.json`; }
export function contentR2Key(id) { return `deep-dive-authoring/${id}/content.json`; }

export function safeParse(s) {
    if (s == null) return null;
    try { return JSON.parse(s); } catch { return null; }
}

/**
 * Wire-shape transformation.  Strips R2 keys (callers reach artifacts
 * via the /artifact endpoint instead) and parses content_json.
 */
export function rowToWire(row) {
    if (!row) return null;
    return {
        id: row.id,
        surface_kind: row.surface_kind,
        surface_key: row.surface_key,
        pmid: row.pmid,
        paper_title: row.paper_title,
        paper_journal: row.paper_journal,
        paper_year: row.paper_year,
        paper_design: row.paper_design,
        status: row.status,
        status_reason: row.status_reason,

        has_bundle: !!row.bundle_r2_key,
        has_patch:  !!row.patch_r2_key,
        has_content: !!row.content_json,
        content: safeParse(row.content_json),

        bundle_requested_at: row.bundle_requested_at,
        bundle_requested_by: row.bundle_requested_by,
        bundle_ready_at:     row.bundle_ready_at,
        patch_uploaded_at:   row.patch_uploaded_at,
        patch_uploaded_by:   row.patch_uploaded_by,
        authored_at:         row.authored_at,
        pulled_at:           row.pulled_at,

        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}

export async function appendAuditEvent(env, ctx, authoringId, event) {
    try {
        await env.DB.prepare(`
            INSERT INTO deep_dive_audit_events
                (id, authoring_id, ts, actor, actor_label, event_kind, detail_json)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(
            newId(),
            authoringId,
            event.ts || Date.now(),
            event.actor || "system",
            event.actor_label || null,
            event.event_kind,
            event.detail ? JSON.stringify(event.detail).slice(0, 4000) : null,
        ).run();
    } catch (e) {
        console.warn("deep_dive_audit_events insert failed (non-fatal)", {
            module: "_lib/deep_dive", authoringId, event_kind: event.event_kind, error: String(e),
        });
    }
}

export function auditAdminAction(env, ctx, admin, action, authoringId, details) {
    return logAudit(env, {
        user_id: admin.user,
        user_role: admin.role,
        action: "admin_override",
        record_type: "deep_dive_authoring",
        record_id: authoringId,
        success: true,
        details: { op: action, ...(details || {}) },
    }, ctx);
}

/**
 * Pipeline token check, mirrors trend_briefs.js + /api/posts producer.
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
 * Upsert a discovered PMID row.  Called by the producer (pipeline-side)
 * when a new brief lands in /pending-review.  If the row already
 * exists, refreshes the paper metadata but does NOT change status —
 * lets in-flight authoring continue.
 */
export async function upsertDiscoveredPmid(env, {
    surfaceKind, surfaceKey, pmid,
    paperTitle, paperJournal, paperYear, paperDesign,
}) {
    if (!VALID_SURFACE_KINDS.has(surfaceKind)) {
        throw new Error(`invalid surface_kind: ${surfaceKind}`);
    }
    const id = authoringId(surfaceKind, surfaceKey, pmid);
    const now = Date.now();
    const existing = await env.DB.prepare(
        "SELECT id FROM deep_dive_authoring WHERE id = ?"
    ).bind(id).first();
    if (existing) {
        await env.DB.prepare(`
            UPDATE deep_dive_authoring SET
                paper_title = COALESCE(?, paper_title),
                paper_journal = COALESCE(?, paper_journal),
                paper_year = COALESCE(?, paper_year),
                paper_design = COALESCE(?, paper_design),
                updated_at = ?
            WHERE id = ?
        `).bind(
            paperTitle || null, paperJournal || null,
            paperYear || null, paperDesign || null,
            now, id,
        ).run();
        return { id, action: "refreshed" };
    }
    await env.DB.prepare(`
        INSERT INTO deep_dive_authoring (
            id, surface_kind, surface_key, pmid,
            paper_title, paper_journal, paper_year, paper_design,
            status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).bind(
        id, surfaceKind, surfaceKey, pmid,
        paperTitle || null, paperJournal || null,
        paperYear || null, paperDesign || null,
        now, now,
    ).run();
    return { id, action: "inserted" };
}
