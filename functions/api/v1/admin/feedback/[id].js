// =====================================================================
// /api/v1/admin/feedback/<id> — single-row CRUD for feedback
// =====================================================================
// GET   — full row + audit timeline + screenshot URL (admin-only)
// PATCH — write AI recommendation (used by the Cowork-side processor)
//         OR update operator notes (operator may comment without resolving)
// =====================================================================

import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../../_lib/admin_api.js";
import { logAudit } from "../../../../_lib/audit.js";
import { newId } from "../../../../_lib/db.js";

const ALLOWED_AI_KEYS = new Set([
    "summary", "root_cause", "proposed_change", "files_to_edit",
    "severity", "effort", "rationale", "confidence", "ai_model",
    "tags", "blocked_by", "generated_at",
]);

function safeParse(s) {
    try { return JSON.parse(s); } catch { return { _parse_error: true, _raw: String(s).slice(0, 120) }; }
}

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env, request, params }) => {
        if (!env.DB) return jsonError("server_error: DB binding missing", 500);
        const id = String(params?.id || "");
        if (!id) return jsonError("bad_id", 400);

        const row = await env.DB.prepare(`
            SELECT id, patient_id, invite_label, session_id,
                   route, viewport_width, viewport_height, user_agent,
                   feedback_type, severity, comment_text, detail_json,
                   screenshot_r2_key, status, status_reason,
                   ai_recommendation_json, ai_generated_at,
                   approved_at, approved_by, implemented_at, implemented_in_commit,
                   created_at, updated_at
            FROM member_feedback WHERE id = ?
        `).bind(id).first();
        if (!row) return jsonError("not_found", 404);

        const eventsRes = await env.DB.prepare(`
            SELECT id, ts, actor, actor_label, event_kind, detail_json
            FROM feedback_audit_events
            WHERE feedback_id = ?
            ORDER BY ts ASC
        `).bind(id).all();
        const events = (eventsRes?.results || []).map((e) => ({
            ...e,
            detail: e.detail_json ? safeParse(e.detail_json) : null,
            detail_json: undefined,
        }));

        return jsonResponse({
            ok: true,
            feedback: {
                ...row,
                detail: row.detail_json ? safeParse(row.detail_json) : null,
                ai_recommendation: row.ai_recommendation_json ? safeParse(row.ai_recommendation_json) : null,
                has_screenshot: !!row.screenshot_r2_key,
                screenshot_url: row.screenshot_r2_key ? `/api/v1/admin/feedback/${id}/screenshot` : null,
                detail_json: undefined,
                ai_recommendation_json: undefined,
                screenshot_r2_key: undefined,
            },
            events,
        });
    });
}

export async function onRequestPatch(ctx) {
    return adminRoute(ctx, async ({ env, request, params, admin }) => {
        if (!env.DB) return jsonError("server_error: DB binding missing", 500);
        const id = String(params?.id || "");
        if (!id) return jsonError("bad_id", 400);

        const body = await readJsonBody(request);
        const row = await env.DB.prepare("SELECT id, status FROM member_feedback WHERE id = ?").bind(id).first();
        if (!row) return jsonError("not_found", 404);

        const now = Date.now();
        const updates = [];
        const args = [];

        // AI recommendation write — comes from the Cowork-side processor.
        if (body.ai_recommendation && typeof body.ai_recommendation === "object") {
            const rec = {};
            for (const k of Object.keys(body.ai_recommendation)) {
                if (ALLOWED_AI_KEYS.has(k)) rec[k] = body.ai_recommendation[k];
            }
            rec.generated_at = now;
            updates.push("ai_recommendation_json = ?");
            args.push(JSON.stringify(rec));
            updates.push("ai_generated_at = ?");
            args.push(now);
            // Auto-bump status: new -> ai_analyzed if not already advanced.
            if (row.status === "new") {
                updates.push("status = ?");
                args.push("ai_analyzed");
            }
        }

        if (typeof body.status_reason === "string" && body.status_reason.trim()) {
            updates.push("status_reason = ?");
            args.push(body.status_reason.trim().slice(0, 1000));
        }

        if (updates.length === 0) return jsonError("nothing_to_update", 400);

        updates.push("updated_at = ?");
        args.push(now);
        args.push(id);

        try {
            await env.DB.prepare(`UPDATE member_feedback SET ${updates.join(", ")} WHERE id = ?`).bind(...args).run();
        } catch (e) {
            console.error("feedback PATCH threw", { error: String(e), id });
            return jsonError("server_error: db update failed", 500);
        }

        // Audit-event row.
        try {
            await env.DB.prepare(`
                INSERT INTO feedback_audit_events (id, feedback_id, ts, actor, actor_label, event_kind, detail_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).bind(
                newId(), id, now,
                body.ai_recommendation ? "cowork_ai" : "admin",
                body.ai_recommendation ? (body.ai_recommendation.ai_model || "claude") : admin.user,
                body.ai_recommendation ? "ai_analyzed" : "operator_note",
                JSON.stringify({
                    has_ai_rec: !!body.ai_recommendation,
                    rec_summary_preview: body.ai_recommendation?.summary?.slice(0, 120),
                    note_preview: typeof body.status_reason === "string" ? body.status_reason.slice(0, 120) : undefined,
                })
            ).run();
        } catch (e) {
            console.warn("feedback_audit_events insert failed (non-fatal)", { error: String(e) });
        }

        await logAudit(env, {
            user_id: admin.user,
            user_role: admin.role,
            action: "admin_override",
            record_type: "member_feedback",
            record_id: id,
            success: true,
            details: { op: body.ai_recommendation ? "ai_rec_written" : "operator_note" },
        });

        return jsonResponse({ ok: true });
    });
}
