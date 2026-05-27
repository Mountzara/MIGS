// =====================================================================
// POST /api/v1/admin/trend-briefs/<id>/approve
// =====================================================================
// Admin approves a brief by supplying an override JSON conforming to
// the schema gold_brief_render.py consumes.  The override is persisted
// in D1 (override_json) AND mirrored to R2 at
// trend-briefs-pending/<id>/override.json so the Mac-side
// pull_approved_overrides.py can GET it without needing D1 access.
//
// The orchestrator's next run will pull the override, re-render the
// brief, the §3.8 gate will pass, and the brief will POST to /api/posts
// as kind=evidence status=draft.  From there it appears in the
// existing /admin/content/ queue for final publish-approval.
//
// Required override fields:
//   verdict        — one of:
//                    "supported" | "partially supported" |
//                    "equipoise" | "mechanism-plausible / not supported" |
//                    "refuted"
//   verdict_label  — human prose for the gauge label
//   rationale      — required free-text justification (audit trail)
//
// Optional override fields (all forwarded to render_brief_html):
//   bottom_line       (string, HTML allowed)
//   level_a_items     (string[])
//   pyramid_rows      (array of {tier, count})
//   do_migs_lens      (string, HTML allowed)
//   gap_paragraphs    (string[])
//   counseling        (string[])
//   extra_meta_cards  (array of cite-card objects)
//   extra_mech_cards  (array of cite-card objects)
//   deep_dive_content (object keyed by PMID)
// =====================================================================

import {
    adminRoute, jsonResponse, jsonError, readJsonBody,
} from "../../../../../_lib/admin_api.js";
import {
    overrideR2Key, appendAuditEvent, auditAdminAction,
} from "../../../../../_lib/trend_briefs.js";

const ALLOWED_VERDICTS = new Set([
    "supported",
    "partially supported",
    "equipoise",
    "mechanism-plausible / not supported",
    "refuted",
]);

const ALLOWED_OVERRIDE_KEYS = new Set([
    "verdict", "verdict_label", "rationale",
    "bottom_line", "level_a_items", "pyramid_rows",
    "do_migs_lens", "gap_paragraphs", "counseling",
    "extra_meta_cards", "extra_mech_cards", "deep_dive_content",
    // Allow free-text "reviewer_notes" so the admin can leave a note
    // alongside the override without it being rendered.
    "reviewer_notes",
]);

const MAX_OVERRIDE_BYTES = 800_000;  // ~800 KB; deep_dive_content with all 13 sections × N PMIDs

export async function onRequestPost(ctx) {
    return adminRoute(ctx, async ({ env, request, params, admin }) => {
        if (!env.DB)      return jsonError("server_error: DB binding missing", 500);
        if (!env.CONTENT) return jsonError("server_error: CONTENT R2 bucket binding missing", 500);

        const id = decodeURIComponent(String(params?.id || ""));
        if (!id) return jsonError("bad_id", 400);

        const row = await env.DB.prepare(
            "SELECT id, status FROM trend_brief_pending WHERE id = ?"
        ).bind(id).first();
        if (!row) return jsonError("not_found", 404);
        if (row.status === "rejected") {
            return jsonError("cannot_approve_rejected_brief", 409);
        }

        const body = await readJsonBody(request);
        const overrideIn = body.override;
        if (!overrideIn || typeof overrideIn !== "object") {
            return jsonError(
                "override_required (object with verdict, verdict_label, rationale)",
                400,
            );
        }

        // ---- Whitelist + validate -------------------------------
        const override = {};
        for (const k of Object.keys(overrideIn)) {
            if (ALLOWED_OVERRIDE_KEYS.has(k)) override[k] = overrideIn[k];
        }

        const verdict       = String(override.verdict       || "").trim();
        const verdictLabel  = String(override.verdict_label || "").trim();
        const rationale     = String(override.rationale     || "").trim();

        if (!verdict)       return jsonError("override.verdict required",       400);
        if (!verdictLabel)  return jsonError("override.verdict_label required", 400);
        if (!rationale)     return jsonError("override.rationale required",     400);
        if (!ALLOWED_VERDICTS.has(verdict)) {
            return jsonError(
                `override.verdict must be one of: ${Array.from(ALLOWED_VERDICTS).join(" | ")}`,
                400,
                { received: verdict },
            );
        }

        // Length caps on free-text fields (defensive)
        override.verdict_label = verdictLabel.slice(0, 400);
        override.rationale     = rationale.slice(0, 4000);

        // Type-check array fields
        for (const k of ["level_a_items", "pyramid_rows", "gap_paragraphs",
                          "counseling", "extra_meta_cards", "extra_mech_cards"]) {
            if (override[k] != null && !Array.isArray(override[k])) {
                return jsonError(`override.${k} must be an array`, 400);
            }
        }
        if (override.deep_dive_content != null && typeof override.deep_dive_content !== "object") {
            return jsonError("override.deep_dive_content must be an object keyed by PMID", 400);
        }

        // ---- Stamp + serialize ----------------------------------
        const now = Date.now();
        override._approved_at = now;
        override._approved_by = admin.user;
        override._brief_id    = id;

        const overrideText = JSON.stringify(override, null, 2);
        if (overrideText.length > MAX_OVERRIDE_BYTES) {
            return jsonError(`override_too_large (>${MAX_OVERRIDE_BYTES} bytes)`, 413);
        }

        // ---- R2 mirror ------------------------------------------
        const r2Key = overrideR2Key(id);
        try {
            await env.CONTENT.put(r2Key, overrideText, {
                httpMetadata: { contentType: "application/json; charset=utf-8" },
                customMetadata: {
                    "mz-trend-brief-id": id,
                    "mz-approved-by": admin.user,
                    "mz-approved-at": String(now),
                    "mz-verdict": verdict,
                },
            });
        } catch (e) {
            console.error("override R2 write failed", { id, error: String(e) });
            return jsonError("r2_write_failed: " + String(e), 502);
        }

        // ---- D1 update ------------------------------------------
        try {
            await env.DB.prepare(`
                UPDATE trend_brief_pending SET
                    status = 'approved',
                    override_json = ?, override_r2_key = ?,
                    approved_at = ?, approved_by = ?,
                    rejected_at = NULL, rejected_by = NULL, status_reason = NULL,
                    updated_at = ?
                WHERE id = ?
            `).bind(overrideText, r2Key, now, admin.user, now, id).run();
        } catch (e) {
            console.error("approve D1 update failed", { id, error: String(e) });
            return jsonError("d1_update_failed: " + String(e), 500);
        }

        // ---- Audit (off the response path per §10.10) ------------
        ctx.waitUntil(appendAuditEvent(env, ctx, id, {
            ts: now, actor: "admin", actor_label: admin.user,
            event_kind: "approved",
            detail: {
                verdict,
                verdict_label_preview: verdictLabel.slice(0, 120),
                has_extra_meta_cards: Array.isArray(override.extra_meta_cards) && override.extra_meta_cards.length > 0,
                has_extra_mech_cards: Array.isArray(override.extra_mech_cards) && override.extra_mech_cards.length > 0,
                has_deep_dive_content: override.deep_dive_content && Object.keys(override.deep_dive_content).length > 0,
            },
        }));
        ctx.waitUntil(auditAdminAction(env, ctx, admin, "trend_brief_approved", id, {
            verdict, override_bytes: overrideText.length,
        }));

        return jsonResponse({
            ok: true,
            id,
            status: "approved",
            approved_at: now,
            approved_by: admin.user,
            override_r2_key: r2Key,
            verdict,
            next_step: "Mac orchestrator will pull this override on its next run, re-render the brief, and queue it as a draft at /admin/content/.",
        });
    });
}
