// =====================================================================
// POST /api/v1/patient/feedback — submit beta-tester feedback
// =====================================================================
// Accepts feedback from anyone who passed previewAccess() — so it works
// for an authenticated patient (mz_session), for a preview-cookie holder
// who hasn't signed up yet, and for an admin browsing the portal under
// Basic Auth.
//
// Body (JSON):
//   {
//     route:        "/portal/intake/section/4",
//     viewport_width: 414,
//     viewport_height: 896,
//     feedback_type: "bug" | "confusing" | "suggestion" | "praise" | "other",
//     severity:     "blocker" | "annoying" | "nice_to_have" | null,
//     comment_text: "the date-picker doesn't open on iPhone Safari",
//     detail:       { last_action, recent_traces, scroll_pct, ... }   // optional
//     screenshot_base64: "<base64 png/jpeg>"                          // optional
//     screenshot_mime:   "image/png"                                  // optional
//   }
//
// Response: 201 with { ok: true, feedback_id, message }
//
// PHI posture: comment_text is patient-volunteered free text — kept
// verbatim. Screenshot (if present) is envelope-encrypted to mountzara-phi
// using a per-record DEK wrapped by PHI_MASTER_KEY, same pattern as the
// patient-photo endpoint. The screenshot is NEVER served to anyone other
// than admin Basic Auth; patient cannot fetch their own back.
// =====================================================================

import { previewAccess, preLaunchNotFound } from "../../../_lib/preview_gate.js";
import { requireRoleOptional, nowMs } from "../../../_lib/auth.js";
import { logAudit } from "../../../_lib/audit.js";
import { recordTrace, readInviteLabel } from "../../../_lib/session_trace.js";
import { newId } from "../../../_lib/db.js";
import { putPhiObject } from "../../../_lib/phi.js";

const MAX_COMMENT_BYTES   = 4 * 1024;
const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;
const ALLOWED_SCREENSHOT_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const ALLOWED_TYPES = new Set(["bug", "confusing", "suggestion", "praise", "other"]);
const ALLOWED_SEVERITY = new Set(["blocker", "annoying", "nice_to_have", null]);

function err(status, code, message) {
    return new Response(JSON.stringify({ error: code, message }), {
        status,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

function safeStr(s, max) {
    if (typeof s !== "string") return null;
    const v = s.trim();
    if (!v) return null;
    if (max && new TextEncoder().encode(v).length > max) {
        return new TextDecoder().decode(new TextEncoder().encode(v).slice(0, max));
    }
    return v;
}

export async function onRequestPost(ctx) {
    const { request, env } = ctx;
    const _t0 = Date.now();
    const access = await previewAccess(request, env);
    if (!access.allow) {
        await recordTrace(env, {
            request, action: "feedback_gate_closed",
            outcome: "blocked", http_status: 404, duration_ms: Date.now() - _t0,
        });
        return preLaunchNotFound();
    }

    if (!env.DB) return err(500, "server_error", "DB binding missing");

    // Soft-resolve patient_id if mz_session is present; otherwise OK.
    let patient_id = null;
    let session_token = null;
    try {
        const session = await requireRoleOptional(ctx, ["patient"]);
        if (session && session.patient_id) {
            patient_id = session.patient_id;
            session_token = session.token;
        }
    } catch { /* optional — anonymous-with-preview-cookie OK */ }

    let body;
    try { body = await request.json(); }
    catch { return err(400, "bad_json", "expected JSON body"); }

    const feedback_type = String(body?.feedback_type || "").toLowerCase().trim();
    if (!ALLOWED_TYPES.has(feedback_type)) {
        return err(400, "bad_type", `feedback_type must be one of: ${Array.from(ALLOWED_TYPES).join(", ")}`);
    }
    const severity = body?.severity === null || body?.severity === undefined
        ? null
        : String(body.severity).toLowerCase().trim();
    if (!ALLOWED_SEVERITY.has(severity)) {
        return err(400, "bad_severity", `severity must be one of: blocker, annoying, nice_to_have, or null`);
    }
    const comment_text = safeStr(body?.comment_text, MAX_COMMENT_BYTES);
    if (!comment_text || comment_text.length < 4) {
        return err(400, "bad_comment", "comment_text required (≥ 4 characters)");
    }
    const route = safeStr(body?.route, 240) || new URL(request.url).pathname;
    const vw = parseInt(body?.viewport_width, 10);
    const vh = parseInt(body?.viewport_height, 10);
    const ua = (request.headers.get("User-Agent") || "").slice(0, 240);
    const invite_label = readInviteLabel(request);

    // Optional screenshot.
    let screenshot_r2_key = null;
    let screenshot_wrapped_dek = null;
    if (body?.screenshot_base64) {
        if (!env.PHI) {
            console.warn("feedback: screenshot supplied but PHI binding missing — dropping screenshot");
        } else {
            const mime = String(body.screenshot_mime || "image/png").toLowerCase();
            if (!ALLOWED_SCREENSHOT_TYPES.has(mime)) {
                return err(400, "bad_screenshot_mime", `screenshot_mime must be png/jpeg/webp`);
            }
            let bin;
            try {
                bin = Uint8Array.from(atob(body.screenshot_base64), (c) => c.charCodeAt(0));
            } catch {
                return err(400, "bad_screenshot_b64", "screenshot_base64 not valid base64");
            }
            if (bin.length > MAX_SCREENSHOT_BYTES) {
                return err(413, "screenshot_too_large", `screenshot > ${MAX_SCREENSHOT_BYTES} bytes`);
            }
            const now = nowMs();
            const r2Key = `feedback-screenshots/${now}-${crypto.randomUUID().slice(0, 8)}.bin`;
            const aad = `feedback-screenshot/${now}`;
            try {
                const envelope = await putPhiObject(env, r2Key, bin, aad);
                screenshot_r2_key = envelope.r2_key;
                screenshot_wrapped_dek = envelope.wrapped_dek;
                // Stamp mime onto R2 customMetadata so admin GET can echo it.
                try {
                    const obj = await env.PHI.get(envelope.r2_key);
                    if (obj) {
                        const ciphertext = new Uint8Array(await obj.arrayBuffer());
                        await env.PHI.put(envelope.r2_key, ciphertext, {
                            httpMetadata: { contentType: "application/octet-stream" },
                            customMetadata: { ...(obj.customMetadata || {}), "mz-image-content-type": mime },
                        });
                    }
                } catch { /* non-fatal */ }
            } catch (e) {
                console.error("feedback: screenshot PHI write failed", { error: String(e) });
                // Non-fatal — keep the feedback without the screenshot.
            }
        }
    }

    // detail_json: keep only PHI-free fields the client volunteered.
    let detail_json = null;
    if (body?.detail && typeof body.detail === "object") {
        try {
            const safe = {
                last_action: typeof body.detail.last_action === "string" ? body.detail.last_action.slice(0, 80) : undefined,
                recent_traces: Array.isArray(body.detail.recent_traces) ? body.detail.recent_traces.slice(0, 8).map((t) => ({
                    action: typeof t?.action === "string" ? t.action.slice(0, 80) : undefined,
                    route: typeof t?.route === "string" ? t.route.slice(0, 240) : undefined,
                    outcome: typeof t?.outcome === "string" ? t.outcome.slice(0, 40) : undefined,
                    ts: typeof t?.ts === "number" ? t.ts : undefined,
                })) : undefined,
                scroll_pct: typeof body.detail.scroll_pct === "number" ? Math.round(body.detail.scroll_pct) : undefined,
                referrer: typeof body.detail.referrer === "string" ? body.detail.referrer.slice(0, 240) : undefined,
                page_load_ms: typeof body.detail.page_load_ms === "number" ? body.detail.page_load_ms : undefined,
            };
            detail_json = JSON.stringify(safe);
            if (detail_json.length > 4096) detail_json = detail_json.slice(0, 4096);
        } catch { /* drop on serialization issue */ }
    }

    const feedback_id = newId();
    const now = nowMs();

    try {
        await env.DB.prepare(`
            INSERT INTO member_feedback (
                id, patient_id, invite_label, session_id,
                route, viewport_width, viewport_height, user_agent,
                feedback_type, severity, comment_text, detail_json,
                screenshot_r2_key, screenshot_wrapped_dek,
                status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)
        `).bind(
            feedback_id, patient_id, invite_label, null,
            route, isNaN(vw) ? null : vw, isNaN(vh) ? null : vh, ua,
            feedback_type, severity, comment_text, detail_json,
            screenshot_r2_key, screenshot_wrapped_dek,
            now, now
        ).run();
    } catch (e) {
        console.error("feedback insert threw", { error: String(e) });
        return err(500, "server_error", "could not record feedback");
    }

    // Append-only audit-event row for the operator timeline.
    try {
        await env.DB.prepare(`
            INSERT INTO feedback_audit_events (id, feedback_id, ts, actor, actor_label, event_kind, detail_json)
            VALUES (?, ?, ?, 'patient', ?, 'submitted', ?)
        `).bind(
            newId(), feedback_id, now, invite_label,
            JSON.stringify({ type: feedback_type, severity, has_screenshot: !!screenshot_r2_key, comment_len: comment_text.length, route })
        ).run();
    } catch (e) {
        console.warn("feedback audit-event insert failed (non-fatal)", { error: String(e) });
    }

    await logAudit(env, {
        user_id: patient_id || null,
        user_role: patient_id ? "patient" : "anonymous",
        action: "data_amendment_request",                       // closest existing allowlist entry
        record_type: "member_feedback",
        record_id: feedback_id,
        ip: request.headers.get("CF-Connecting-IP") || "",
        user_agent: ua,
        success: true,
        details: { feedback_type, severity, route, invite_label, has_screenshot: !!screenshot_r2_key },
    });

    await recordTrace(env, {
        request,
        patient_id,
        session_token,
        action: "feedback_submit",
        outcome: "ok", http_status: 201,
        duration_ms: Date.now() - _t0,
        detail: {
            feedback_id, feedback_type, severity, route_target: route,
            comment_len: comment_text.length,
            has_screenshot: !!screenshot_r2_key,
        },
    });

    return new Response(JSON.stringify({
        ok: true,
        feedback_id,
        message: "Thanks — we received your feedback. We review every submission.",
    }), {
        status: 201,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}
