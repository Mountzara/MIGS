// =====================================================================
// POST /api/v1/admin/trend-briefs/pending-review
// =====================================================================
// PRODUCER-facing endpoint: Mac orchestrator (publish_to_admin.py)
// submits trend briefs that passed every §3.8 row EXCEPT the
// verdict-gate row.  This endpoint inserts a row into
// trend_brief_pending + uploads the rendered body_html + sidecar
// JSON to R2 mountzara-content under trend-briefs-pending/<id>/.
//
// Auth: X-Pipeline-Token (matches env.PIPELINE_TOKEN), same path the
// existing /api/posts producer uses.  Admin Basic Auth also accepted
// so this endpoint can be tested from the browser.
//
// Idempotent: if a row with the same id already exists, the endpoint
// PUTs (replaces the body_html + sidecar + audit_table, resets status
// back to 'pending' if the brief was previously approved/rejected and
// the producer is re-submitting — typically because the Mac side
// re-rendered after a renderer change upstream).
// =====================================================================

import { jsonResponse, jsonError, readAdminIdentity } from "../../../../_lib/admin_api.js";
import {
    briefId, bodyHtmlR2Key, sidecarR2Key, isPipelineRequest,
    appendAuditEvent, classifyAudit, VERDICT_GATE_LABEL,
} from "../../../../_lib/trend_briefs.js";

const MAX_BODY_HTML_BYTES   = 1_500_000;   // 1.5 MB — gold-rendered briefs run ~150-250 KB; cap leaves headroom
const MAX_SIDECAR_BYTES     =   500_000;   // 0.5 MB
const MAX_AUDIT_ROWS        =       100;   // safety cap (§3.8 has 32 today)

export async function onRequestPost(ctx) {
    const { env, request } = ctx;

    // ---- Auth: pipeline token OR admin Basic Auth ------------------
    const isPipeline = isPipelineRequest(request, env);
    let admin = null;
    if (!isPipeline) {
        admin = await readAdminIdentity(request, env);
        if (!admin) {
            return jsonError(
                "authentication_required (X-Pipeline-Token or admin Basic Auth)",
                401,
            );
        }
    }
    const actorLabel = isPipeline
        ? "pipeline:trend_tracker"
        : (admin?.user || "admin");

    if (!env.DB)      return jsonError("server_error: DB binding missing", 500);
    if (!env.CONTENT) return jsonError("server_error: CONTENT R2 bucket binding missing", 500);

    // ---- Body parse ------------------------------------------------
    let payload;
    try { payload = await request.json(); }
    catch { return jsonError("invalid_json_body", 400); }

    const slug         = String(payload.slug || "").trim();
    const briefDate    = String(payload.brief_date || "").trim();
    const claim        = String(payload.claim_text || payload.claim || "").trim();
    const bodyHtml     = String(payload.body_html || "");
    const sidecar      = payload.sidecar || {};      // expects parsed object
    const auditTable   = Array.isArray(payload.audit_table) ? payload.audit_table : null;
    const influencer   = payload.influencer ? String(payload.influencer).slice(0, 200) : null;
    const topics       = Array.isArray(payload.topics_covered) ? payload.topics_covered : [];
    const pmids        = Array.isArray(payload.pmids_cited) ? payload.pmids_cited : [];
    const kbEntries    = Array.isArray(payload.kb_entries_retrieved) ? payload.kb_entries_retrieved : [];
    const gaps         = Array.isArray(payload.gaps_surfaced) ? payload.gaps_surfaced : [];

    if (!slug)        return jsonError("slug_required", 400);
    if (!briefDate)   return jsonError("brief_date_required (YYYY-MM-DD)", 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(briefDate)) return jsonError("brief_date_must_be_YYYY-MM-DD", 400);
    if (!claim)       return jsonError("claim_text_required", 400);
    if (!bodyHtml)    return jsonError("body_html_required", 400);
    if (!auditTable)  return jsonError("audit_table_required (array of {label, ok, observed, threshold})", 400);

    if (bodyHtml.length > MAX_BODY_HTML_BYTES) {
        return jsonError(`body_html_too_large (>${MAX_BODY_HTML_BYTES} bytes)`, 413);
    }
    const sidecarText = JSON.stringify(sidecar);
    if (sidecarText.length > MAX_SIDECAR_BYTES) {
        return jsonError(`sidecar_too_large (>${MAX_SIDECAR_BYTES} bytes)`, 413);
    }
    if (auditTable.length > MAX_AUDIT_ROWS) {
        return jsonError(`audit_table_too_large (>${MAX_AUDIT_ROWS} rows)`, 413);
    }

    // ---- Queue-eligibility check (defense in depth) ----------------
    // The producer is expected to only submit briefs that pass every
    // §3.8 row except the verdict gate.  We re-check here so a
    // malformed/buggy producer can't backdoor a real failing brief
    // into the queue.
    const classification = classifyAudit(auditTable);
    if (!classification.queue_eligible) {
        return jsonError(
            `not_queue_eligible: ${classification.reason}`,
            422,
            {
                expected_failing_labels: [VERDICT_GATE_LABEL],
                actual_failing_labels: classification.failing_labels,
                hint: "Only briefs where the §3.8 verdict-gate row is the ONLY failing check may enter the peer-review queue. Other failures are real bugs and must be fixed upstream before publish.",
            },
        );
    }

    const passCount = auditTable.filter((r) => r?.ok).length;
    const failCount = auditTable.length - passCount;

    // ---- Compute the row + R2 keys ---------------------------------
    const id = briefId(briefDate, slug);
    const bodyKey    = bodyHtmlR2Key(id);
    const sidecarKey = sidecarR2Key(id);

    // ---- R2 writes -------------------------------------------------
    try {
        await env.CONTENT.put(bodyKey, bodyHtml, {
            httpMetadata: { contentType: "text/html; charset=utf-8" },
            customMetadata: {
                "mz-trend-brief-id": id,
                "mz-slug": slug,
                "mz-brief-date": briefDate,
                "mz-submitted-at": String(Date.now()),
            },
        });
        await env.CONTENT.put(sidecarKey, sidecarText, {
            httpMetadata: { contentType: "application/json; charset=utf-8" },
            customMetadata: {
                "mz-trend-brief-id": id,
            },
        });
    } catch (e) {
        console.error("R2 write failed", { module: "pending-review", id, error: String(e) });
        return jsonError("r2_write_failed: " + String(e), 502);
    }

    // ---- D1 upsert -------------------------------------------------
    const now = Date.now();
    const existing = await env.DB.prepare(
        "SELECT id, status, suggestions_text FROM trend_brief_pending WHERE id = ?"
    ).bind(id).first();

    try {
        if (existing) {
            // Re-submission: refresh the body + audit + sidecar, reset
            // status to pending (a re-submission means the producer
            // re-rendered, so any prior approval is now stale and the
            // brief should be re-reviewed). suggestions_text is
            // preserved so prior free-text isn't lost.
            await env.DB.prepare(`
                UPDATE trend_brief_pending SET
                    claim_text = ?, influencer = ?,
                    topics_covered = ?, pmids_cited = ?,
                    kb_entries_retrieved = ?, gaps_surfaced = ?,
                    body_html_r2_key = ?, sidecar_r2_key = ?,
                    audit_table_json = ?, audit_pass_count = ?, audit_fail_count = ?,
                    status = 'pending', status_reason = NULL,
                    override_json = NULL, override_r2_key = NULL,
                    approved_at = NULL, approved_by = NULL,
                    rejected_at = NULL, rejected_by = NULL,
                    pulled_at = NULL, rerender_passed = NULL,
                    rerender_attempted_at = NULL, draft_post_id = NULL,
                    updated_at = ?
                WHERE id = ?
            `).bind(
                claim, influencer,
                JSON.stringify(topics), JSON.stringify(pmids),
                JSON.stringify(kbEntries), JSON.stringify(gaps),
                bodyKey, sidecarKey,
                JSON.stringify(auditTable), passCount, failCount,
                now,
                id,
            ).run();
        } else {
            await env.DB.prepare(`
                INSERT INTO trend_brief_pending (
                    id, slug, brief_date, claim_text, influencer,
                    topics_covered, pmids_cited, kb_entries_retrieved, gaps_surfaced,
                    body_html_r2_key, sidecar_r2_key,
                    audit_table_json, audit_pass_count, audit_fail_count,
                    status, submitted_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
            `).bind(
                id, slug, briefDate, claim, influencer,
                JSON.stringify(topics), JSON.stringify(pmids),
                JSON.stringify(kbEntries), JSON.stringify(gaps),
                bodyKey, sidecarKey,
                JSON.stringify(auditTable), passCount, failCount,
                now, now, now,
            ).run();
        }
    } catch (e) {
        console.error("D1 upsert failed", { module: "pending-review", id, error: String(e) });
        return jsonError("d1_upsert_failed: " + String(e), 500);
    }

    // ---- Audit event (off the response path per §10.10) ------------
    ctx.waitUntil(appendAuditEvent(env, ctx, id, {
        ts: now,
        actor: isPipeline ? "pipeline" : "admin",
        actor_label: actorLabel,
        event_kind: existing ? "resubmitted" : "submitted",
        detail: {
            slug, brief_date: briefDate, pmids_cited: pmids.length,
            kb_entries_retrieved: kbEntries.length,
            audit_pass: passCount, audit_fail: failCount,
        },
    }));

    return jsonResponse({
        ok: true,
        id,
        slug,
        brief_date: briefDate,
        status: "pending",
        action: existing ? "resubmitted" : "submitted",
        body_html_r2_key: bodyKey,
        sidecar_r2_key: sidecarKey,
        audit_pass_count: passCount,
        audit_fail_count: failCount,
        review_url: `/admin/trend-briefs/${encodeURIComponent(id)}`,
    });
}
