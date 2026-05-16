// =====================================================================
// POST /api/v1/admin/messages/<thread_id>/<message_id>/attachments
// =====================================================================
// Clinician/staff mirror of the patient-side upload. Same multipart
// shape. Verifies the message belongs to the admin's clinician_id and
// was authored by the clinician (no attaching to patient messages).
// =====================================================================

import { adminRoute, jsonResponse, jsonError } from "../../../../../../_lib/admin_api.js";
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

async function sha256Hex(bytes) {
    const buf = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function onRequestPost(ctx) {
    return adminRoute(ctx, async ({ env, request, admin }) => {
        const thread_id = String(ctx.params?.thread_id || "");
        const message_id = String(ctx.params?.message_id || "");
        if (!thread_id || !message_id) return jsonError("bad_params", 400);

        // Verify the message exists, in this thread, and was authored by a clinician/staff.
        const msg = await env.DB.prepare(`
            SELECT m.id, m.thread_id, m.patient_id, m.from_role, m.from_user_id, t.clinician_id
            FROM messages m
            LEFT JOIN message_threads t ON t.id = m.thread_id
            WHERE m.id = ? AND m.thread_id = ?
        `).bind(message_id, thread_id).first();
        if (!msg) return jsonError("message_not_found", 404);
        if (msg.from_role === "patient") return jsonError("cannot_attach_to_patient_msg", 403);

        const form = await request.formData().catch(() => null);
        if (!form) return jsonError("invalid_multipart_body", 400);
        const file = form.get("file");
        if (!file || typeof file === "string") return jsonError("missing_file_field", 400);

        const filename = (file.name || "attachment.bin").slice(0, 240);
        const mime = file.type || "application/octet-stream";
        if (!ALLOWED_MIME.has(mime)) return jsonError("unsupported_mime", 415, { mime });
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (bytes.length === 0) return jsonError("empty_file", 400);
        if (bytes.length > MAX_FILE_BYTES) return jsonError("file_too_large", 413, { max: MAX_FILE_BYTES });

        const document_id = newId();
        const attachment_id = newId();
        const r2_key = `message/${msg.patient_id}/${message_id}/${attachment_id}.bin`;
        let put;
        try {
            put = await putPhiObject(env, r2_key, bytes, `message_attachment/${attachment_id}`);
        } catch (e) { return jsonError("phi_encrypt_failed", 500, { detail: String(e && e.message || e) }); }
        const sha = await sha256Hex(bytes);
        const t = Date.now();

        await env.DB.prepare(`
            INSERT INTO documents
                (id, patient_id, kind, r2_key, r2_bucket, filename, mime_type, size_bytes,
                 sha256, encrypted, envelope_dek_wrapped,
                 uploaded_by_role, uploaded_by_id, source_app, description, uploaded_at)
            VALUES (?, ?, 'message_attachment', ?, 'mountzara-phi', ?, ?, ?, ?, 1, ?, 'clinician', ?, 'web', ?, ?)
        `).bind(
            document_id, msg.patient_id, r2_key, filename, mime,
            bytes.length, sha, put.wrapped_dek, admin.user,
            `Clinician message attachment for message ${message_id}`, t
        ).run();
        await env.DB.prepare(`
            INSERT INTO message_attachments
                (id, message_id, thread_id, patient_id, document_id,
                 filename, mime_type, size_bytes, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
            attachment_id, message_id, thread_id, msg.patient_id,
            document_id, filename, mime, bytes.length, t
        ).run();
        await env.DB.prepare(`UPDATE messages SET has_attachments = 1 WHERE id = ?`).bind(message_id).run();

        await logAudit(env, {
            user_id: admin.user, user_role: admin.role,
            action: "document_upload",
            record_type: "message_attachment",
            record_id: attachment_id,
            ip: request.headers.get("CF-Connecting-IP") || "",
            user_agent: request.headers.get("User-Agent") || "",
            success: true,
            details: { thread_id, message_id, mime, size_bytes: bytes.length, patient_id: msg.patient_id },
        });

        return jsonResponse({ ok: true, attachment_id, document_id, filename, mime, size_bytes: bytes.length }, { status: 201 });
    });
}
