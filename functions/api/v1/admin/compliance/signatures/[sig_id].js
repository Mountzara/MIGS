// =====================================================================
// /api/v1/admin/compliance/signatures/[sig_id]
//   GET    → return the metadata row.
//   DELETE → retire the signature (sets retired_at). Idempotent — does
//            not delete the R2 object so prior document_signatures rows
//            that reference it still render.
//
// /api/v1/admin/compliance/signatures/[sig_id]/image  → handled here
// because the [sig_id] dynamic route catches the trailing segment.
// We dispatch by inspecting the path suffix.
// =====================================================================

import { adminRoute, jsonResponse, jsonError } from "../../../../../_lib/admin_api.js";
import { logAudit } from "../../../../../_lib/audit.js";
import {
    getSignatureMetadata, fetchSignaturePng, retireSignature,
} from "../../../../../_lib/signatures.js";

export async function onRequest(ctx) {
    return adminRoute(ctx, async ({ env, request, admin, ctx: c, params }) => {
        const sig_id = String(params?.sig_id || "");
        if (!sig_id) return jsonError("sig_id_required", 400);

        const url = new URL(request.url);
        // The [sig_id].js route handles paths like:
        //   /api/v1/admin/compliance/signatures/<sig_id>
        //   /api/v1/admin/compliance/signatures/<sig_id>/image
        // The /image suffix is detected from the request URL pathname.
        const isImageRequest = /\/image\/?$/.test(url.pathname);

        if (request.method === "GET" && isImageRequest) {
            try {
                const { png_bytes } = await fetchSignaturePng(env, sig_id);
                // Audit the image fetch — admin-only by definition, but
                // worth recording so the signature-access log is auditable.
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
        }

        if (request.method === "GET") {
            const row = await getSignatureMetadata(env, sig_id);
            if (!row) return jsonError("signature_not_found", 404);
            // Never return wrapped_dek / iv_data / iv_dek (key material).
            const { wrapped_dek, iv_data, iv_dek, ...safe } = row;
            return jsonResponse({ ok: true, signature: safe });
        }

        if (request.method === "DELETE") {
            const row = await getSignatureMetadata(env, sig_id);
            if (!row) return jsonError("signature_not_found", 404);
            if (row.retired_at) {
                return jsonResponse({ ok: true, already_retired: true, retired_at: row.retired_at });
            }
            const result = await retireSignature(env, sig_id);
            await logAudit(env, {
                user_id: admin.user, user_role: admin.role,
                action: "clinician_signature_retired",
                record_type: "clinician_signature",
                record_id: sig_id,
                ip: request.headers.get("CF-Connecting-IP") || "",
                user_agent: request.headers.get("User-Agent") || "",
                success: true,
                details: { display_name: row.display_name },
            }, c);
            return jsonResponse({ ok: true, ...result });
        }

        return jsonError("method_not_allowed", 405);
    });
}
