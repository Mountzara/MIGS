// =====================================================================
// /api/v1/admin/compliance/signatures
//   GET  → list active (and optionally retired) signatures.
//   POST → upload a new signature PNG.  multipart/form-data body with:
//            file:         the PNG file
//            display_name: "Chris Mabini, DO, FMIGS"
//            notes:        optional free text
// =====================================================================
//
// Phase 17 follow-on (audit R2/R3/R12/R14/R15). Admin-gated via
// _lib/admin_api.js::adminRoute. Audit-logged via logAudit() so the
// signature lifecycle is reviewable in /admin/audit/.
//
// Per CLAUDE.md §10.3 (Phase 7) — signature images are PHI-adjacent:
// envelope-encrypted in mountzara-phi via _lib/phi.js.  D1 carries
// metadata only.
// =====================================================================

import { adminRoute, jsonResponse, jsonError } from "../../../../../_lib/admin_api.js";
import { logAudit } from "../../../../../_lib/audit.js";
import {
    uploadSignature, listSignatures,
} from "../../../../../_lib/signatures.js";

const MAX_UPLOAD_BYTES = 1_500_000;

export async function onRequest(ctx) {
    return adminRoute(ctx, async ({ env, request, admin, ctx: c }) => {
        if (request.method === "GET") {
            const url = new URL(request.url);
            const include_retired = url.searchParams.get("include_retired") === "1";
            try {
                const rows = await listSignatures(env, { include_retired });
                return jsonResponse({ ok: true, signatures: rows });
            } catch (e) {
                return jsonError("list_failed", 500, { detail: String(e?.message || e) });
            }
        }

        if (request.method === "POST") {
            let form;
            try {
                form = await request.formData();
            } catch (e) {
                return jsonError("invalid_form", 400, { detail: String(e?.message || e) });
            }
            const file = form.get("file");
            const display_name = String(form.get("display_name") || "").trim();
            const notes = form.get("notes") ? String(form.get("notes")).slice(0, 1000) : null;

            if (!file || typeof file === "string") {
                return jsonError("file_required", 400);
            }
            if (!display_name) {
                return jsonError("display_name_required", 400);
            }
            // file is a Web File. Read into Uint8Array.
            const ab = await file.arrayBuffer();
            if (ab.byteLength === 0 || ab.byteLength > MAX_UPLOAD_BYTES) {
                return jsonError("file_size_out_of_range", 413,
                    { max: MAX_UPLOAD_BYTES, got: ab.byteLength });
            }
            const png_bytes = new Uint8Array(ab);

            let result;
            try {
                result = await uploadSignature(env, {
                    png_bytes,
                    display_name,
                    uploaded_by_user_id: admin.user,
                    notes,
                });
            } catch (e) {
                return jsonError("upload_failed", 400, { detail: String(e?.message || e) });
            }

            // Audit per §10.10 — non-blocking via ctx.waitUntil so the
            // upload response doesn't wait on the audit write.
            await logAudit(env, {
                user_id: admin.user,
                user_role: admin.role,
                action: "clinician_signature_uploaded",
                record_type: "clinician_signature",
                record_id: result.id,
                ip: request.headers.get("CF-Connecting-IP") || "",
                user_agent: request.headers.get("User-Agent") || "",
                success: true,
                details: {
                    display_name,
                    width: result.width, height: result.height,
                    bytes_size: result.bytes_size,
                    sha256_hex: result.sha256_hex,
                },
            }, c);

            return jsonResponse({ ok: true, signature: result }, { status: 201 });
        }

        return jsonError("method_not_allowed", 405);
    });
}
