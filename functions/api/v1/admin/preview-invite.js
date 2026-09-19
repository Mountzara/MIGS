// =====================================================================
// /api/v1/admin/preview-invite — mint signed invitations for test users
// =====================================================================
// Per CLAUDE.md §11.5.2 + Phase QA. The operator can invite external
// recipients (Ally O'Flinn first; other test members later) to walk
// through the complete signup → intake → scheduling flow before
// PORTAL_PUBLIC_LAUNCH flips globally.
//
// Endpoints:
//   POST  /api/v1/admin/preview-invite           — mint a fresh invite
//   GET   /api/v1/admin/preview-invite           — list recent invites
//   DELETE /api/v1/admin/preview-invite/<id>     — revoke (see invitations.js)
//
// POST body (JSON):
//   { email,                  required
//     label?: "ally",         short tag used by session_trace filters
//     full_name?: "Ally O'Flinn",
//     ttl_days?: 14,          grant-token TTL (default 14)
//     cookie_days?: 90,       access-cookie TTL (default 90)
//     notes?: "first external test"
//   }
//
// Response: 201 with { invite_id, grant_url, expires_at, cookie_exp,
//                      jti, label, message }
//
// The admin reads grant_url from the response, then emails it to the
// recipient out-of-band. (When SendGrid/Mailgun BAA lands, this endpoint
// gets a `send: true` flag to dispatch automatically.)
// =====================================================================

import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../_lib/admin_api.js";
import {
    mintGrantToken,
    hashGrantToken,
} from "../../../_lib/preview_invite.js";
import { newId } from "../../../_lib/db.js";
import { logAudit } from "../../../_lib/audit.js";
import { recordTrace } from "../../../_lib/session_trace.js";

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(s) {
    return String(s || "").trim().toLowerCase();
}

function normalizeLabel(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9_\-]/g, "").slice(0, 32) || null;
}

export async function onRequestPost(ctx) {
    return adminRoute(ctx, async ({ env, request, admin }) => {
        if (!env.DB) return jsonError("server_error: DB binding missing", 500);
        if (!env.PREVIEW_INVITE_KEY || env.PREVIEW_INVITE_KEY.length < 32) {
            return jsonError("server_error: PREVIEW_INVITE_KEY missing or too short — set a Pages secret first", 500);
        }

        const body = await readJsonBody(request);
        const email = normalizeEmail(body.email);
        if (!EMAIL_RX.test(email)) return jsonError("invalid_email", 400);

        const label = normalizeLabel(body.label) || email.split("@")[0].slice(0, 16);
        const full_name = (body.full_name || "").trim().slice(0, 120) || null;
        const ttl_days = Math.max(1, Math.min(parseInt(body.ttl_days, 10) || 14, 30));
        const cookie_days = Math.max(1, Math.min(parseInt(body.cookie_days, 10) || 90, 180));
        const notes = (body.notes || "").trim().slice(0, 480) || null;
        const ttl_ms = ttl_days * 24 * 60 * 60 * 1000;

        // Mint the one-time grant token (HMAC-signed, exp embedded).
        const email_prefix = email.slice(0, 4) + "***";
        const grant = await mintGrantToken(env, { label, email_prefix, ttl_ms });
        const token_hash = await hashGrantToken(grant.token);
        const cookie_exp = Date.now() + cookie_days * 24 * 60 * 60 * 1000;

        const invite_id = newId();
        const now = Date.now();

        try {
            await env.DB.prepare(`
                INSERT INTO preview_invites
                    (id, email, label, full_name, token_hash, expires_at,
                     cookie_jti, cookie_exp,
                     issued_by, notes, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
                invite_id,
                email,
                label,
                full_name,
                token_hash,
                grant.exp_ms,
                grant.jti,
                cookie_exp,
                admin.user,
                notes,
                now,
                now
            ).run();
        } catch (e) {
            console.error("preview-invite INSERT threw", { error: String(e), module: "api/v1/admin/preview-invite" });
            return jsonError("server_error: could not record invitation", 500);
        }

        // Build the click-once invitation URL.
        const url = new URL(request.url);
        const grant_url = `${url.protocol}//${url.host}/portal/preview-grant/?t=${encodeURIComponent(grant.token)}`;
        // The SAME signed grant also unlocks the by-request CV, because
        // functions/cv/_middleware.js honors the mz_preview_access cookie.
        // Hand the admin a CV-specific link too, so a colleague who asked
        // for the CV (not the portal preview) lands straight on it.
        const cv_grant_url = `${url.protocol}//${url.host}/cv/grant?t=${encodeURIComponent(grant.token)}`;

        await logAudit(env, {
            user_id: admin.user,
            user_role: admin.role,
            action: "admin_override",
            record_type: "preview_invite",
            record_id: invite_id,
            ip: request.headers.get("CF-Connecting-IP") || "",
            user_agent: request.headers.get("User-Agent") || "",
            success: true,
            details: {
                op: "preview_invite_issued",
                label, email_prefix,
                ttl_days, cookie_days,
            },
        });

        await recordTrace(env, {
            request,
            action: "admin_preview_invite_issued",
            outcome: "ok",
            invite_label: "admin_preview",
            detail: { label, email_prefix, ttl_days, cookie_days },
        });

        console.log("preview_invite issued (DEV / pre-launch)", {
            invite_id, label, email_prefix,
            grant_url,
            cv_grant_url,
            expires_at: new Date(grant.exp_ms).toISOString(),
        });

        return jsonResponse({
            ok: true,
            invite_id,
            label,
            email_prefix,
            jti: grant.jti,
            expires_at: grant.exp_ms,
            expires_at_iso: new Date(grant.exp_ms).toISOString(),
            cookie_exp,
            cookie_exp_iso: new Date(cookie_exp).toISOString(),
            grant_url,
            cv_grant_url,
            message: "Send the grant_url to the recipient out-of-band. The URL is single-use and expires at expires_at_iso.",
        }, { status: 201 });
    });
}

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env }) => {
        if (!env.DB) return jsonError("server_error: DB binding missing", 500);
        const res = await env.DB.prepare(`
            SELECT id, email, label, full_name, expires_at, cookie_jti, cookie_exp,
                   grant_used_at, patient_id, revoked_at, revoke_reason,
                   issued_by, notes, created_at, updated_at
            FROM preview_invites
            ORDER BY created_at DESC
            LIMIT 100
        `).all();
        const now = Date.now();
        const rows = (res?.results || []).map((r) => ({
            ...r,
            email_prefix: typeof r.email === "string" ? r.email.slice(0, 4) + "***" : null,
            email: undefined,                                                // never re-emit raw email
            status: r.revoked_at ? "revoked"
                : r.grant_used_at ? "redeemed"
                : (r.expires_at < now ? "expired" : "pending"),
        }));
        return jsonResponse({ ok: true, invites: rows, count: rows.length });
    });
}
