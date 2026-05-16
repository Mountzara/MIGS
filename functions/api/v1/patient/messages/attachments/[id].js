// =====================================================================
// GET /api/v1/patient/messages/attachments/<id> — download an attachment
// =====================================================================
// Returns the raw bytes (decrypted in-worker from mountzara-phi) for
// a message attachment. Ownership check: the attachment must belong
// to a thread owned by the requesting patient.
// =====================================================================

import { previewAccess, preLaunchNotFound } from "../../../../../_lib/preview_gate.js";
import { requireRole } from "../../../../../_lib/auth.js";
import { logAudit } from "../../../../../_lib/audit.js";
import { getPhiObject } from "../../../../../_lib/phi.js";

function err(status, code, message) {
    return new Response(JSON.stringify({ error: code, message }), {
        status,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

export async function onRequestGet(ctx) {
    const { request, env, params } = ctx;
    const { allow } = await previewAccess(request, env);
    if (!allow) return preLaunchNotFound();

    let session;
    try { session = await requireRole(ctx, ["patient"]); }
    catch (resp) { return resp; }
    if (!session.patient_id || !env.DB) return err(500, "server_error", "DB not bound");

    const id = String(params?.id || "");
    if (!id) return err(400, "bad_params");

    const row = await env.DB.prepare(`
        SELECT ma.id, ma.patient_id, ma.thread_id, ma.message_id, ma.filename, ma.mime_type,
               d.r2_key, d.envelope_dek_wrapped
        FROM message_attachments ma
        JOIN documents d ON d.id = ma.document_id
        WHERE ma.id = ?
    `).bind(id).first();
    if (!row) return err(404, "attachment_not_found");
    if (row.patient_id !== session.patient_id) return err(403, "not_owned");

    let bytes;
    try {
        bytes = await getPhiObject(env, row.r2_key, row.envelope_dek_wrapped, `message_attachment/${row.id}`);
    } catch (e) {
        return err(500, "decrypt_failed", String(e && e.message || e));
    }
    if (!bytes) return err(404, "object_missing");

    await logAudit(env, {
        user_id: session.patient_id, user_role: "patient",
        action: "document_download",
        record_type: "message_attachment",
        record_id: id,
        ip: request.headers.get("CF-Connecting-IP") || "",
        user_agent: request.headers.get("User-Agent") || "",
        success: true,
        details: { thread_id: row.thread_id, message_id: row.message_id, size_bytes: bytes.length },
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
}
