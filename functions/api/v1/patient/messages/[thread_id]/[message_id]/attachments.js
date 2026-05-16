// =====================================================================
// POST /api/v1/patient/messages/<thread_id>/<message_id>/attachments
// =====================================================================
// Multipart upload: `file` field carries one attachment binary. The
// patient must own the message (message.from_role='patient' AND
// message.patient_id=session.patient_id). The file is envelope-encrypted
// to mountzara-phi, recorded as a documents row (kind='message_attachment')
// and joined to the message via message_attachments.
//
// Caps + allowlist:
//   * Max file size: 25 MB
//   * Allowed MIME: same list as documents.js (images, PDF, text, DICOM,
//                    common Office formats)
//
// Sets messages.has_attachments = 1 on first attachment to a message.
//
// Response (201): { ok, attachment_id, document_id, size_bytes, filename }
// =====================================================================

import { previewAccess, preLaunchNotFound } from "../../../../../../_lib/preview_gate.js";
import { requireRole, nowMs } from "../../../../../../_lib/auth.js";
import { logAudit } from "../../../../../../_lib/audit.js";
import { newId } from "../../../../../../_lib/db.js";
import { putPhiObject } from "../../../../../../_lib/phi.js";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ALLOWED_MIME = new Set([
    "image/jpeg", "image/png", "image/heic", "image/heif",
    "image/tiff", "image/gif", "image/webp",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/plain", "text/csv",
    "application/dicom",
    "application/octet-stream",
]);

function err(status, code, message, extra = {}) {
    return new Response(JSON.stringify({ error: code, message, ...extra }), {
        status,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}
async function sha256Hex(bytes) {
    const buf = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function onRequestPost(ctx) {
    const { request, env, params } = ctx;
    const { allow } = await previewAccess(request, env);
    if (!allow) return preLaunchNotFound();

    let session;
    try { session = await requireRole(ctx, ["patient"]); }
    catch (resp) { return resp; }
    if (!session.patient_id || !env.DB) return err(500, "server_error", "DB not bound");

    const thread_id = String(params?.thread_id || "");
    const message_id = String(params?.message_id || "");
    if (!thread_id || !message_id) return err(400, "bad_params");

    // Verify the message exists, is in the right thread, and belongs to the patient.
    const msg = await env.DB.prepare(`
        SELECT m.id, m.thread_id, m.patient_id, m.from_role, m.from_user_id
        FROM messages m WHERE m.id = ? AND m.thread_id = ?
    `).bind(message_id, thread_id).first();
    if (!msg) return err(404, "message_not_found");
    if (msg.patient_id !== session.patient_id) return err(403, "not_owned");
    // Patients can only attach to messages they themselves authored.
    if (msg.from_role !== "patient" || msg.from_user_id !== session.patient_id) {
        return err(403, "not_message_author");
    }

    let form;
    try { form = await request.formData(); }
    catch { return err(400, "invalid_multipart_body"); }
    const file = form.get("file");
    if (!file || typeof file === "string") return err(400, "missing_file_field");

    const filename = (file.name || "attachment.bin").slice(0, 240);
    const mime = file.type || "application/octet-stream";
    if (!ALLOWED_MIME.has(mime)) return err(415, "unsupported_mime", "", { mime });
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length === 0) return err(400, "empty_file");
    if (bytes.length > MAX_FILE_BYTES) return err(413, "file_too_large", "", { max: MAX_FILE_BYTES });

    const document_id = newId();
    const attachment_id = newId();
    const r2_key = `message/${session.patient_id}/${message_id}/${attachment_id}.bin`;
    const aad = `message_attachment/${attachment_id}`;
    let put;
    try {
        put = await putPhiObject(env, r2_key, bytes, aad);
    } catch (e) {
        return err(500, "phi_encrypt_failed", String(e && e.message || e));
    }
    const sha = await sha256Hex(bytes);
    const t = nowMs();

    try {
        await env.DB.prepare(`
            INSERT INTO documents
                (id, patient_id, kind, r2_key, r2_bucket, filename, mime_type, size_bytes,
                 sha256, encrypted, envelope_dek_wrapped,
                 uploaded_by_role, uploaded_by_id, source_app, description, uploaded_at)
            VALUES (?, ?, 'message_attachment', ?, 'mountzara-phi', ?, ?, ?, ?, 1, ?, 'patient', ?, 'web', ?, ?)
        `).bind(
            document_id, session.patient_id, r2_key, filename, mime,
            bytes.length, sha, put.wrapped_dek, session.patient_id,
            `Message attachment for message ${message_id}`, t
        ).run();

        await env.DB.prepare(`
            INSERT INTO message_attachments
                (id, message_id, thread_id, patient_id, document_id,
                 filename, mime_type, size_bytes, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
            attachment_id, message_id, thread_id, session.patient_id,
            document_id, filename, mime, bytes.length, t
        ).run();

        await env.DB.prepare(`UPDATE messages SET has_attachments = 1 WHERE id = ?`).bind(message_id).run();
    } catch (e) {
        return err(500, "db_insert_failed", String(e && e.message || e));
    }

    await logAudit(env, {
        user_id: session.patient_id, user_role: "patient",
        action: "document_upload",
        record_type: "message_attachment",
        record_id: attachment_id,
        ip: request.headers.get("CF-Connecting-IP") || "",
        user_agent: request.headers.get("User-Agent") || "",
        success: true,
        details: { thread_id, message_id, mime, size_bytes: bytes.length, filename_len: filename.length },
    });

    return new Response(JSON.stringify({
        ok: true,
        attachment_id, document_id, filename, mime, size_bytes: bytes.length,
    }), {
        status: 201,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}
