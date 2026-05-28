// =====================================================================
// POST /api/v1/admin/deep-dive/<id>/patch
// =====================================================================
// Admin uploads the JSON patch emitted by their Cowork session (or
// the Mac orchestrator pushes it after apply_deep_dive_patch.py
// successfully merges it into the surface storage).  Persists the
// content in D1 + R2 and flips status to 'patch_uploaded' OR
// 'authored' depending on which actor calls it.
//
// Body:
//   {
//     content: {
//       tldr: string,
//       clinical_question: html,
//       pico: { population, intervention, comparator, outcome, design, sample },
//       methodology: string,
//       key_findings: { effects: [...], interpretation: string },
//       rob: { domains: [...], limitations: string },
//       strengths: [string],
//       external_validity: string,
//       kb_placement: html,
//       equity: string,
//       monday_clinic: string,
//       discussion_prompts: [ { q, a }, ... ]
//     },
//     mark_authored?: bool   // Mac side sets true after apply_*_patch succeeds
//   }
// =====================================================================

import {
    adminRoute, jsonResponse, jsonError, readJsonBody,
    readAdminIdentity,
} from "../../../../../_lib/admin_api.js";
import {
    isPipelineRequest, contentR2Key, patchR2Key,
    appendAuditEvent, auditAdminAction,
} from "../../../../../_lib/deep_dive.js";

const MAX_CONTENT_BYTES = 200_000;  // 200 KB per PMID's 13-section content

// Loose whitelist of 13-section keys per §3.9.  Unknown keys are
// preserved (forward-compat) but the section enumeration is logged.
const SECTION_KEYS = new Set([
    "tldr", "clinical_question", "pico", "methodology",
    "key_findings", "rob", "strengths", "external_validity",
    "kb_placement", "equity", "monday_clinic", "discussion_prompts",
    "references",
]);

async function handle(ctx, isPipeline, admin) {
    const { env, request, params } = ctx;
    if (!env.DB)      return jsonError("server_error: DB binding missing", 500);
    if (!env.CONTENT) return jsonError("server_error: CONTENT R2 bucket binding missing", 500);

    const id = decodeURIComponent(String(params?.id || ""));
    if (!id) return jsonError("bad_id", 400);

    const row = await env.DB.prepare(
        "SELECT id, status FROM deep_dive_authoring WHERE id = ?"
    ).bind(id).first();
    if (!row) return jsonError("not_found", 404);

    const body = await readJsonBody(request);
    const content = body.content;
    if (!content || typeof content !== "object" || Array.isArray(content)) {
        return jsonError("content (object) required — the §3.9 13-section patch", 400);
    }
    const markAuthored = body.mark_authored === true;

    const contentText = JSON.stringify(content);
    if (contentText.length > MAX_CONTENT_BYTES) {
        return jsonError(`content too large (>${MAX_CONTENT_BYTES} bytes)`, 413);
    }
    const sectionsPresent = Object.keys(content).filter((k) => SECTION_KEYS.has(k));

    // Mirror to R2 for archival / external consumers
    const r2Key = contentR2Key(id);
    try {
        await env.CONTENT.put(r2Key, contentText, {
            httpMetadata: { contentType: "application/json; charset=utf-8" },
            customMetadata: {
                "mz-authoring-id": id,
                "mz-uploaded-by": admin?.user || "mac_puller",
                "mz-uploaded-at": String(Date.now()),
                "mz-mark-authored": String(!!markAuthored),
            },
        });
    } catch (e) {
        console.error("patch R2 write failed", { id, error: String(e) });
        return jsonError("r2_write_failed: " + String(e), 502);
    }

    const now = Date.now();
    const newStatus = markAuthored ? "authored" : "patch_uploaded";
    try {
        await env.DB.prepare(`
            UPDATE deep_dive_authoring SET
                status = ?,
                content_json = ?,
                patch_r2_key = ?,
                patch_uploaded_at = COALESCE(?, patch_uploaded_at),
                patch_uploaded_by = COALESCE(?, patch_uploaded_by),
                authored_at = ?,
                updated_at = ?
            WHERE id = ?
        `).bind(
            newStatus,
            contentText,
            r2Key,
            isPipeline ? null : now,
            isPipeline ? null : (admin?.user || null),
            markAuthored ? now : null,
            now,
            id,
        ).run();
    } catch (e) {
        console.error("patch D1 update failed", { id, error: String(e) });
        return jsonError("d1_update_failed: " + String(e), 500);
    }

    ctx.waitUntil(appendAuditEvent(env, ctx, id, {
        ts: now,
        actor: isPipeline ? "mac_puller" : "admin",
        actor_label: isPipeline ? "pipeline" : (admin?.user || "admin"),
        event_kind: markAuthored ? "authored" : "patch_uploaded",
        detail: {
            sections_present: sectionsPresent,
            section_count: sectionsPresent.length,
            content_bytes: contentText.length,
        },
    }));
    if (admin) {
        ctx.waitUntil(auditAdminAction(env, ctx, admin, "deep_dive_patch_uploaded", id, {
            mark_authored: markAuthored, section_count: sectionsPresent.length,
        }));
    }

    return jsonResponse({
        ok: true,
        id,
        status: newStatus,
        sections_present: sectionsPresent,
        content_r2_key: r2Key,
        next_step: markAuthored
            ? "Authored. Surface renderer will pick up this content on next re-render."
            : "Patch uploaded. Mac orchestrator will apply via apply_deep_dive_patch.py on next pull, then re-POST with mark_authored=true.",
    });
}

export async function onRequestPost(ctx) {
    const { env, request } = ctx;
    const isPipeline = isPipelineRequest(request, env);
    if (isPipeline) return handle(ctx, true, null);
    return adminRoute(ctx, async ({ admin }) => handle(ctx, false, admin));
}
