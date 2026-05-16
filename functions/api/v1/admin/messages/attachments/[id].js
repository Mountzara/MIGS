// =====================================================================
// GET /api/v1/admin/messages/attachments/<id> — clinician download
// =====================================================================

import { adminRoute, jsonError } from "../../../../../_lib/admin_api.js";
import { logAudit } from "../../../../../_lib/audit.js";
import { getPhiObject } from "../../../../../_lib/phi.js";

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env, request, admin }) => {
        const id = String(ctx.params?.id || "");
        if (!id) return jsonError("bad_params", 400);
        const row = await env.DB.prepare(`
            SELECT ma.id, ma.patient_id, ma.thread_id, ma.message_id, ma.filename, ma.mime_type,
                   d.r2_key, d.envelope_dek_wrapped
            FROM message_attachments ma
            JOIN documents d ON d.id = ma.document_id
            WHERE ma.id = ?
        `).bind(id).first();
        if (!row) return jsonError("attachment_not_found", 404);
        let bytes;
        try { bytes = await getPhiObject(env, row.r2_key, row.envelope_dek_wrapped, `message_attachment/${row.id}`); }
        catch (e) { return jsonError("decrypt_failed", 500, { detail: String(e && e.message || e) }); }
        if (!bytes) return jsonError("object_missing", 404);
        await logAudit(env, {
            user_id: admin.user, user_role: admin.role,
            action: "document_download",
            record_type: "message_attachment",
            record_id: id,
            ip: request.headers.get("CF-Connecting-IP") || "",
            user_agent: request.headers.get("User-Agent") || "",
            success: true,
            details: { thread_id: row.thread_id, message_id: row.message_id, size_bytes: bytes.length, patient_id: row.patient_id },
        });
        return new Response(bytes, {
            status: 200,
            headers: {
                "content-type": row.mime_type || "application/octet-stream",
                "content-disposition": `attachment; filename="${row.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
                "cache-control": "private, no-store",
                "x-content-type-options": "nosniff",
            },
        });
    });
}
