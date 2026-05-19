// =====================================================================
// /api/v1/patient/photo  — patient self-upload + self-fetch + self-delete
// =====================================================================
// Phase 14 Round D. Mirrors /api/v1/admin/patients/[id]/photo with the
// session-auth scope: the patient may only act on their own row.
//
//   POST   — upload image (multipart OR base64-in-JSON), 5 MB cap,
//            jpeg/png/webp/heic, envelope-encrypted to mountzara-phi.
//   GET    — fetch + decrypt the patient's own photo.
//   DELETE — clear photo.
// =====================================================================

import { previewAccess, preLaunchNotFound } from "../../../_lib/preview_gate.js";
import { requireRole, nowMs } from "../../../_lib/auth.js";
import { logAudit } from "../../../_lib/audit.js";
import { putPhiObject, getPhiObject } from "../../../_lib/phi.js";

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

function err(status, code, message) {
    return new Response(JSON.stringify({ error: code, message }), {
        status,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}


async function ingestUpload(request) {
    const ct = (request.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("application/json")) {
        let body;
        try { body = await request.json(); } catch { throw new Error("invalid_json_body"); }
        const contentType = String(body.content_type || "").toLowerCase();
        if (!ALLOWED_TYPES.has(contentType)) {
            throw new Error(`content_type ${contentType} not allowed (jpeg/png/webp/heic only)`);
        }
        const dataB64 = String(body.data_base64 || "");
        if (!dataB64) throw new Error("data_base64 is required");
        const bin = Uint8Array.from(atob(dataB64), (c) => c.charCodeAt(0));
        if (bin.length > MAX_PHOTO_BYTES) throw new Error(`photo > ${MAX_PHOTO_BYTES} bytes`);
        return { contentType, bytes: bin };
    }
    if (ct.startsWith("multipart/form-data")) {
        const form = await request.formData();
        const file = form.get("photo") || form.get("file");
        if (!(file instanceof File)) throw new Error("multipart body missing 'photo' file part");
        const contentType = (file.type || "").toLowerCase();
        if (!ALLOWED_TYPES.has(contentType)) {
            throw new Error(`content_type ${contentType} not allowed`);
        }
        const buf = await file.arrayBuffer();
        if (buf.byteLength > MAX_PHOTO_BYTES) throw new Error(`photo > ${MAX_PHOTO_BYTES} bytes`);
        return { contentType, bytes: new Uint8Array(buf) };
    }
    throw new Error(`unsupported content-type ${ct}`);
}


// ---------------------------------------------------------------------
// POST  — upload + replace
// ---------------------------------------------------------------------
export async function onRequestPost(ctx) {
    const { request, env } = ctx;
    const { allow } = await previewAccess(request, env);
    if (!allow) return preLaunchNotFound();

    let session;
    try { session = await requireRole(ctx, ["patient"]); }
    catch (resp) { return resp; }
    if (!session.patient_id || !env.DB || !env.PHI) {
        return err(500, "server_error", "DB or PHI binding missing");
    }

    const row = await env.DB.prepare(
        "SELECT photo_r2_key FROM patients WHERE id = ?"
    ).bind(session.patient_id).first();
    if (!row) return err(404, "not_found", "patient row missing");

    let upload;
    try { upload = await ingestUpload(request); }
    catch (e) { return err(400, "bad_upload", e.message || String(e)); }

    const now = nowMs();
    // Versioned key — mountzara-phi has retention lock; never overwrite.
    const r2Key = `patient-photos/${session.patient_id}/${now}-${crypto.randomUUID().slice(0, 8)}.bin`;
    const aad = `patient-photo/${session.patient_id}`;

    let envelope;
    try { envelope = await putPhiObject(env, r2Key, upload.bytes, aad); }
    catch (e) { return err(500, "phi_write_failed", e.message || String(e)); }

    // Delete prior photo (if any) — only succeeds if not yet sealed by retention,
    // otherwise R2 silently leaves the object until the lifecycle policy reclaims it.
    const oldKey = row.photo_r2_key;
    if (oldKey && oldKey !== r2Key) {
        try { await env.PHI.delete(oldKey); } catch {}
    }

    await env.DB.prepare(
        "UPDATE patients SET photo_r2_key=?, photo_wrapped_dek=?, photo_uploaded_at=?, updated_at=? WHERE id=?"
    ).bind(envelope.r2_key, envelope.wrapped_dek, now, now, session.patient_id).run();

    // Stamp the image content-type onto R2 customMetadata so GET can echo it.
    try {
        const obj = await env.PHI.get(envelope.r2_key);
        if (obj) {
            const newMeta = { ...(obj.customMetadata || {}), "mz-image-content-type": upload.contentType };
            const ciphertext = new Uint8Array(await obj.arrayBuffer());
            await env.PHI.put(envelope.r2_key, ciphertext, {
                httpMetadata: { contentType: "application/octet-stream" },
                customMetadata: newMeta,
            });
        }
    } catch {}

    await logAudit(env, {
        user_id: session.patient_id, user_role: "patient",
        action: "patient_photo_upload",
        record_type: "patient", record_id: session.patient_id,
        ip: request.headers.get("CF-Connecting-IP") || "",
        user_agent: request.headers.get("User-Agent") || "",
        success: true,
        details: { content_type: upload.contentType, size_bytes: upload.bytes.length },
    });

    return new Response(JSON.stringify({
        ok: true,
        photo: {
            uploaded_at: now,
            content_type: upload.contentType,
            size_bytes: upload.bytes.length,
            url: "/api/v1/patient/photo",
        },
    }), {
        status: 201,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}


// ---------------------------------------------------------------------
// GET  — decrypt + serve patient's own photo
// ---------------------------------------------------------------------
export async function onRequestGet(ctx) {
    const { request, env } = ctx;
    const { allow } = await previewAccess(request, env);
    if (!allow) return preLaunchNotFound();

    let session;
    try { session = await requireRole(ctx, ["patient"]); }
    catch (resp) { return resp; }
    if (!session.patient_id || !env.DB || !env.PHI) {
        return err(500, "server_error", "DB or PHI binding missing");
    }

    const row = await env.DB.prepare(
        "SELECT photo_r2_key, photo_wrapped_dek FROM patients WHERE id = ?"
    ).bind(session.patient_id).first();
    if (!row || !row.photo_r2_key) return err(404, "no_photo", "no photo on file");

    const obj = await env.PHI.get(row.photo_r2_key);
    if (!obj) return err(410, "phi_object_missing", "photo object missing from R2");
    const contentType = obj.customMetadata?.["mz-image-content-type"] || "image/jpeg";

    const aad = `patient-photo/${session.patient_id}`;
    let plaintext;
    try { plaintext = await getPhiObject(env, row.photo_r2_key, row.photo_wrapped_dek, aad); }
    catch (e) { return err(500, "phi_decrypt_failed", e.message || String(e)); }
    if (!plaintext) return err(410, "phi_object_missing", "photo object missing");

    return new Response(plaintext, {
        status: 200,
        headers: {
            "content-type": contentType,
            "cache-control": "private, max-age=300, must-revalidate",
        },
    });
}


// ---------------------------------------------------------------------
// DELETE  — clear photo
// ---------------------------------------------------------------------
export async function onRequestDelete(ctx) {
    const { request, env } = ctx;
    const { allow } = await previewAccess(request, env);
    if (!allow) return preLaunchNotFound();

    let session;
    try { session = await requireRole(ctx, ["patient"]); }
    catch (resp) { return resp; }
    if (!session.patient_id || !env.DB) {
        return err(500, "server_error", "DB binding missing");
    }

    const row = await env.DB.prepare(
        "SELECT photo_r2_key FROM patients WHERE id = ?"
    ).bind(session.patient_id).first();
    if (!row) return err(404, "not_found", "patient row missing");

    if (row.photo_r2_key) {
        try { await env.PHI.delete(row.photo_r2_key); } catch {}
    }
    const now = nowMs();
    await env.DB.prepare(
        "UPDATE patients SET photo_r2_key=NULL, photo_wrapped_dek=NULL, photo_uploaded_at=NULL, updated_at=? WHERE id=?"
    ).bind(now, session.patient_id).run();

    await logAudit(env, {
        user_id: session.patient_id, user_role: "patient",
        action: "patient_photo_delete",
        record_type: "patient", record_id: session.patient_id,
        success: true,
    });

    return new Response(JSON.stringify({ ok: true, deleted: true }), {
        status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}
