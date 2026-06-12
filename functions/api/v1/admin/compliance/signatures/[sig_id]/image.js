// =====================================================================
// /api/v1/admin/compliance/signatures/[sig_id]/image  → GET signature PNG
// =====================================================================
// 2026-06-12: this MUST be its own file. In Cloudflare Pages Functions a
// single-bracket [sig_id].js matches exactly ONE path segment, so the two-
// segment ".../<sig_id>/image" never routed to the sibling [sig_id].js (its
// in-handler `/\/image$/` check was dead code) — every signature thumbnail
// 404'd in the compliance dashboard. A nested [sig_id]/image.js is the correct
// Pages route for the trailing /image segment.
// =====================================================================

import { adminRoute, jsonError } from "../../../../../../_lib/admin_api.js";
import { logAudit } from "../../../../../../_lib/audit.js";
import { fetchSignaturePng } from "../../../../../../_lib/signatures.js";

export async function onRequest(ctx) {
    return adminRoute(ctx, async ({ env, request, admin, ctx: c, params }) => {
        const sig_id = String(params?.sig_id || "");
        if (!sig_id) return jsonError("sig_id_required", 400);
        if (request.method !== "GET") return jsonError("method_not_allowed", 405);

        try {
            const { png_bytes } = await fetchSignaturePng(env, sig_id);
            await logAudit(env, {
                user_id: admin.user, user_role: admin.role,
                action: "clinician_signature_image_fetched",
                record_type: "clinician_signature",
                record_id: sig_id,
                ip: request.headers.get("CF-Connecting-IP") || "",
                user_agent: request.headers.get("User-Agent") || "",
                success: true,
            }, c);
            return new Response(png_bytes, {
                status: 200,
                headers: {
                    "content-type": "image/png",
                    "cache-control": "private, no-store",
                    "x-mountzara-signature-id": sig_id,
                },
            });
        } catch (e) {
            return jsonError("image_fetch_failed", 404, { detail: String(e?.message || e) });
        }
    });
}
