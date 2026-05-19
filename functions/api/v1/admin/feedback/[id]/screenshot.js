// =====================================================================
// GET /api/v1/admin/feedback/<id>/screenshot — decrypt + serve image
// =====================================================================
// Pulls the screenshot blob from mountzara-phi, decrypts it with the
// per-record wrapped DEK, returns the image with the content-type that
// was stamped onto R2 customMetadata at upload time. Admin-only.
// =====================================================================

import { adminRoute, jsonError } from "../../../../../_lib/admin_api.js";
import { getPhiObject } from "../../../../../_lib/phi.js";

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env, request, params }) => {
        if (!env.DB || !env.PHI) return jsonError("server_error: bindings missing", 500);
        const id = String(params?.id || "");
        if (!id) return jsonError("bad_id", 400);

        const row = await env.DB.prepare(
            "SELECT screenshot_r2_key, screenshot_wrapped_dek FROM member_feedback WHERE id = ?"
        ).bind(id).first();
        if (!row || !row.screenshot_r2_key) return jsonError("no_screenshot", 404);

        const obj = await env.PHI.get(row.screenshot_r2_key);
        if (!obj) return jsonError("phi_object_missing", 410);
        const mime = obj.customMetadata?.["mz-image-content-type"] || "image/png";

        // AAD must match what was used at putPhiObject time.
        // We don't store it explicitly; reconstruct from the R2 key prefix.
        // Pattern: feedback-screenshots/<now>-<rand>.bin, AAD was `feedback-screenshot/<now>`.
        const keyParts = row.screenshot_r2_key.split("/");
        const fileBase = keyParts[keyParts.length - 1].replace(/\.bin$/, "");
        const tsPart = fileBase.split("-")[0];
        const aad = `feedback-screenshot/${tsPart}`;

        let plaintext;
        try {
            plaintext = await getPhiObject(env, row.screenshot_r2_key, row.screenshot_wrapped_dek, aad);
        } catch (e) {
            console.error("feedback screenshot decrypt failed", { id, error: String(e) });
            return jsonError("phi_decrypt_failed", 500);
        }
        if (!plaintext) return jsonError("phi_object_missing", 410);

        return new Response(plaintext, {
            status: 200,
            headers: {
                "content-type": mime,
                "cache-control": "private, max-age=300, must-revalidate",
            },
        });
    });
}
