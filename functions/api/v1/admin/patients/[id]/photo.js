// =====================================================================
// /api/v1/admin/patients/<id>/photo
// =====================================================================
// Phase 14 Round A — patient profile photo.
//
// POST   — upload image bytes (multipart OR base64-in-JSON), envelope-encrypt
//          to mountzara-phi, write r2_key + wrapped_dek onto patients row.
// GET    — admin-gated proxy that decrypts + serves the image bytes.
// DELETE — drop the R2 object + clear the patients columns.
//
// We accept either multipart/form-data (standard <input type=file>) OR
// application/json with { content_type, data_base64 } for clients that
// can't easily produce multipart (e.g. our admin SPA which fetches via JSON).
// =====================================================================

import { adminRoute, jsonResponse, jsonError } from "../../../../../_lib/admin_api.js";
import { putPhiObject, getPhiObject } from "../../../../../_lib/phi.js";
import { logAudit } from "../../../../../_lib/audit.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;   // 5 MB cap
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);


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
    throw new Error(`unsupported content-type ${ct}; expected multipart/form-data or application/json`);
}


// ---------------------------------------------------------------------
// POST — upload + replace
// ---------------------------------------------------------------------
export async function onRequestPost(ctx) {
    return adminRoute(ctx, async ({ env, request, admin }) => {
        const patientId = ctx.params.id;
        if (!UUID_RE.test(patientId)) return jsonError("invalid patient_id", 400);

        const row = await env.DB.prepare(
            "SELECT id, photo_r2_key FROM patients WHERE id = ?"
        ).bind(patientId).first();
        if (!row) return jsonError("patient not found", 404);

        let upload;
        try {
            upload = await ingestUpload(request);
        } catch (e) {
            return jsonError(e.message || String(e), 400);
        }

        // R2 key — versioned by upload time so we never overwrite the prior
        // object (R2 versioning is enabled on mountzara-phi but we also
        // want a deterministic-but-fresh key so previous wrapped DEKs can be
        // gc'd without ambiguity).
        const now = Date.now();
        const r2Key = `patient-photos/${patientId}/${now}-${crypto.randomUUID().slice(0, 8)}.bin`;
        const aad = `patient-photo/${patientId}`;

        let envelope;
        try {
            envelope = await putPhiObject(env, r2Key, upload.bytes, aad);
        } catch (e) {
            return jsonError(`PHI write failed: ${e.message || e}`, 500);
        }

        // Delete the prior photo if any.
        const oldKey = row.photo_r2_key;
        if (oldKey && oldKey !== r2Key) {
            try { await env.PHI.delete(oldKey); } catch {}
        }

        await env.DB.prepare(
            "UPDATE patients SET photo_r2_key=?, photo_wrapped_dek=?, photo_uploaded_at=?, updated_at=? WHERE id=?"
        ).bind(envelope.r2_key, envelope.wrapped_dek, now, now, patientId).run();

        // Persist the image content_type on the R2 object so GET can echo it.
        // putPhiObject overwrote httpMetadata; re-put with the right CT in
        // customMetadata so GET can pull it. (We don't put plaintext CT on
        // httpMetadata because the body is ciphertext.)
        try {
            const obj = await env.PHI.get(envelope.r2_key);
            if (obj) {
                const newMeta = { ...(obj.customMetadata || {}), "mz-image-content-type": upload.contentType };
                // Re-put: read body, write back with same body but updated metadata.
                const ciphertext = new Uint8Array(await obj.arrayBuffer());
                await env.PHI.put(envelope.r2_key, ciphertext, {
                    httpMetadata: { contentType: "application/octet-stream" },
                    customMetadata: newMeta,
                });
            }
        } catch {}

        await logAudit(env, {
            user_id: admin.user, user_role: admin.role,
            action: "patient_photo_upload",
            record_type: "patient", record_id: patientId,
            ip: request.headers.get("CF-Connecting-IP") || "",
            user_agent: request.headers.get("User-Agent") || "",
            success: true,
            details: { content_type: upload.contentType, size_bytes: upload.bytes.length },
        });

        return jsonResponse({
            ok: true,
            photo: {
                uploaded_at: now,
                content_type: upload.contentType,
                size_bytes: upload.bytes.length,
                url: `/api/v1/admin/patients/${patientId}/photo`,
            },
        }, { status: 201 });
    });
}


// ---------------------------------------------------------------------
// GET — decrypt + serve
// ---------------------------------------------------------------------
export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env, request, admin }) => {
        const patientId = ctx.params.id;
        if (!UUID_RE.test(patientId)) return jsonError("invalid patient_id", 400);

        const row = await env.DB.prepare(
            "SELECT photo_r2_key, photo_wrapped_dek FROM patients WHERE id = ?"
        ).bind(patientId).first();
        if (!row || !row.photo_r2_key) return jsonError("no photo on file", 404);

        // Pull the content_type out of the R2 customMetadata.
        const obj = await env.PHI.get(row.photo_r2_key);
        if (!obj) return jsonError("photo object missing in R2", 410);
        const contentType = obj.customMetadata?.["mz-image-content-type"] || "image/jpeg";

        // Decrypt via getPhiObject so AAD is verified.
        const aad = `patient-photo/${patientId}`;
        let plaintext;
        try {
            plaintext = await getPhiObject(env, row.photo_r2_key, row.photo_wrapped_dek, aad);
        } catch (e) {
            return jsonError(`photo decrypt failed: ${e.message || e}`, 500);
        }
        if (!plaintext) return jsonError("photo object missing", 410);

        await logAudit(env, {
            user_id: admin.user, user_role: admin.role,
            action: "patient_photo_read",
            record_type: "patient", record_id: patientId,
            success: true,
        });

        return new Response(plaintext, {
            status: 200,
            headers: {
                "content-type": contentType,
                "cache-control": "private, max-age=300, must-revalidate",
            },
        });
    });
}


// ---------------------------------------------------------------------
// DELETE — clear photo
// ---------------------------------------------------------------------
export async function onRequestDelete(ctx) {
    return adminRoute(ctx, async ({ env, request, admin }) => {
        const patientId = ctx.params.id;
        if (!UUID_RE.test(patientId)) return jsonError("invalid patient_id", 400);

        const row = await env.DB.prepare(
            "SELECT photo_r2_key FROM patients WHERE id = ?"
        ).bind(patientId).first();
        if (!row) return jsonError("patient not found", 404);

        if (row.photo_r2_key) {
            try { await env.PHI.delete(row.photo_r2_key); } catch {}
        }
        const now = Date.now();
        await env.DB.prepare(
            "UPDATE patients SET photo_r2_key=NULL, photo_wrapped_dek=NULL, photo_uploaded_at=NULL, updated_at=? WHERE id=?"
        ).bind(now, patientId).run();

        await logAudit(env, {
            user_id: admin.user, user_role: admin.role,
            action: "patient_photo_delete",
            record_type: "patient", record_id: patientId,
            success: true,
        });

        return jsonResponse({ ok: true, deleted: true });
    });
}
