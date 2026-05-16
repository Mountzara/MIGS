// =====================================================================
// /api/v1/patient/documents — list + upload
// =====================================================================
// GET   → list this patient's documents (metadata only).
// POST  → multipart upload: `file` field carries the binary, plus
//         optional `description` and `kind` (default 'patient_upload').
//
// Files are envelope-encrypted in the mountzara-phi R2 bucket via
// functions/_lib/phi.js. The wrapped DEK is stored on the documents
// row in D1; the actual ciphertext lives in R2 keyed by
// `patient/<patient_id>/<doc_id>.bin`. SHA-256 of the plaintext is
// recorded for integrity.
//
// Caps + allowlist (CLAUDE.md §4.2 / §11 Tier 7):
//   * Max file size: 50 MB
//   * Allowed MIME: image/* (JPEG, PNG, HEIC, TIFF, GIF), application/pdf,
//     application/msword, .docx (vnd.openxmlformats), text/plain, .dicom.
//   * Max documents per patient: 200 (soft limit; bump if needed).
// =====================================================================

import { previewAccess, preLaunchNotFound } from "../../../_lib/preview_gate.js";
import { requireRole, nowMs } from "../../../_lib/auth.js";
import { logAudit } from "../../../_lib/audit.js";
import { newId } from "../../../_lib/db.js";
import { putPhiObject } from "../../../_lib/phi.js";

const MAX_FILE_BYTES = 50 * 1024 * 1024;       // 50 MB
const MAX_DOCS_PER_PATIENT = 200;

const ALLOWED_MIME = new Set([
    "image/jpeg", "image/png", "image/heic", "image/heif",
    "image/tiff", "image/gif", "image/webp",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "application/dicom",
    "application/octet-stream", // fallback for DICOM tools that don't set MIME
]);

const ALLOWED_KIND = new Set([
    "patient_upload",
    "intake_attachment",
]);

function err(status, code, message) {
    return new Response(JSON.stringify({ error: code, message }), {
        status,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

async function sha256Hex(bytes) {
    const buf = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(buf))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
}

// ---------------------------------------------------------------------
// GET — list this patient's documents (metadata)
// ---------------------------------------------------------------------
export async function onRequestGet(ctx) {
    const { request, env } = ctx;
    const { allow } = await previewAccess(request, env);
    if (!allow) return preLaunchNotFound();

    let session;
    try { session = await requireRole(ctx, ["patient"]); }
    catch (resp) { return resp; }
    if (!session.patient_id || !env.DB) return err(500, "server_error", "DB not bound");

    const res = await env.DB.prepare(`
        SELECT id, kind, filename, mime_type, size_bytes, description,
               uploaded_by_role, uploaded_at
        FROM documents
        WHERE patient_id = ?
        ORDER BY uploaded_at DESC
        LIMIT 200
    `).bind(session.patient_id).all();

    await logAudit(env, {
        user_id: session.patient_id,
        user_role: "patient",
        action: "phi_read",
        record_type: "document",
        record_id: null,
        ip: request.headers.get("CF-Connecting-IP") || "",
        user_agent: request.headers.get("User-Agent") || "",
        success: true,
        details: { source: "/api/v1/patient/documents", count: (res?.results || []).length },
    });

    return new Response(JSON.stringify({ documents: res?.results || [] }), {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

// ---------------------------------------------------------------------
// POST — multipart upload
// ---------------------------------------------------------------------
export async function onRequestPost(ctx) {
    const { request, env } = ctx;
    const { allow } = await previewAccess(request, env);
    if (!allow) return preLaunchNotFound();

    let session;
    try { session = await requireRole(ctx, ["patient"]); }
    catch (resp) { return resp; }
    if (!session.patient_id || !env.DB || !env.PHI || !env.PHI_MASTER_KEY) {
        return err(500, "server_error", "PHI storage not configured");
    }

    const ip = request.headers.get("CF-Connecting-IP") || "";
    const ua = request.headers.get("User-Agent") || "";

    // Per-patient count cap.
    const countRow = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM documents WHERE patient_id = ?"
    ).bind(session.patient_id).first();
    if ((countRow?.n || 0) >= MAX_DOCS_PER_PATIENT) {
        return err(409, "quota_exceeded", `max ${MAX_DOCS_PER_PATIENT} documents per patient`);
    }

    let form;
    try {
        form = await request.formData();
    } catch (e) {
        return err(400, "bad_multipart", "expected multipart/form-data with a `file` field");
    }
    const file = form.get("file");
    if (!file || typeof file === "string") {
        return err(400, "no_file", "expected a `file` field carrying the binary body");
    }

    // Validate
    const filename = (file.name || "upload.bin").slice(0, 200);
    const mime = (file.type || "application/octet-stream").toLowerCase();
    if (!ALLOWED_MIME.has(mime)) {
        return err(415, "mime_not_allowed",
            `MIME type ${mime} not in allowlist. Accepted: PDF, common images, DOC/DOCX, plain text, DICOM.`);
    }
    const sizeBytes = file.size || 0;
    if (sizeBytes <= 0) return err(400, "empty_file", "file is empty");
    if (sizeBytes > MAX_FILE_BYTES) {
        return err(413, "file_too_large", `max ${MAX_FILE_BYTES} bytes; got ${sizeBytes}`);
    }

    const kindRaw = String(form.get("kind") || "patient_upload");
    const kind = ALLOWED_KIND.has(kindRaw) ? kindRaw : "patient_upload";
    const description = String(form.get("description") || "").trim().slice(0, 500) || null;

    // Read body
    let plaintext;
    try {
        plaintext = new Uint8Array(await file.arrayBuffer());
    } catch (e) {
        console.error("documents POST read body threw", { error: String(e) });
        return err(500, "read_failed", "could not read upload body");
    }
    if (plaintext.byteLength !== sizeBytes) {
        return err(400, "size_mismatch", "file body size did not match declared size");
    }

    const doc_id = newId();
    const r2_key = `patient/${session.patient_id}/${doc_id}.bin`;
    const aad = `documents:${session.patient_id}:${doc_id}`;

    let sha256, putRes;
    try {
        sha256 = await sha256Hex(plaintext);
        putRes = await putPhiObject(env, r2_key, plaintext, aad);
    } catch (e) {
        console.error("documents POST putPhiObject threw", { error: String(e) });
        return err(500, "encryption_failed", "could not store file");
    }

    const now = nowMs();
    try {
        await env.DB.prepare(`
            INSERT INTO documents
                (id, patient_id, kind, r2_key, r2_bucket, filename, mime_type, size_bytes,
                 sha256, encrypted, envelope_dek_wrapped, uploaded_by_role, uploaded_by_id,
                 source_app, description, uploaded_at)
            VALUES (?, ?, ?, ?, 'mountzara-phi', ?, ?, ?, ?, 1, ?, 'patient', ?, 'web', ?, ?)
        `).bind(
            doc_id, session.patient_id, kind, r2_key,
            filename, mime, sizeBytes, sha256, putRes.wrapped_dek,
            session.patient_id, description, now
        ).run();
    } catch (e) {
        console.error("documents POST DB.insert threw — orphaned R2 object", { error: String(e), r2_key });
        // Try to clean up the orphan.
        try { await env.PHI.delete(r2_key); } catch (_) {}
        return err(500, "db_insert_failed", "could not record file metadata");
    }

    await logAudit(env, {
        user_id: session.patient_id,
        user_role: "patient",
        action: "document_upload",
        record_type: "document",
        record_id: doc_id,
        ip, user_agent: ua,
        success: true,
        details: { kind, mime, size_bytes: sizeBytes },
    });

    return new Response(JSON.stringify({
        ok: true,
        id: doc_id,
        kind,
        filename,
        mime_type: mime,
        size_bytes: sizeBytes,
        uploaded_at: now,
    }), {
        status: 201,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}
