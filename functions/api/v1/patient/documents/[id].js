// =====================================================================
// /api/v1/patient/documents/<id> — download + delete
// =====================================================================
// GET    → returns the decrypted blob with the original filename + MIME.
//          Verifies the document belongs to the calling patient (404
//          otherwise — never reveal another patient's id space).
// DELETE → soft delete: the R2 object is removed and the documents row
//          is deleted. An audit_log row records the deletion BEFORE the
//          actual delete so we always have a trail even if the delete
//          throws halfway through.
// =====================================================================

import { previewAccess, preLaunchNotFound } from "../../../../_lib/preview_gate.js";
import { requireRole } from "../../../../_lib/auth.js";
import { logAudit } from "../../../../_lib/audit.js";
import { getPhiObject } from "../../../../_lib/phi.js";

function err(status, code, message) {
    return new Response(JSON.stringify({ error: code, message }), {
        status,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

async function loadOwnedDoc(env, patient_id, doc_id) {
    return env.DB.prepare(`
        SELECT id, kind, r2_key, filename, mime_type, size_bytes,
               envelope_dek_wrapped, encrypted, sha256, description, uploaded_at
        FROM documents WHERE id = ? AND patient_id = ?
    `).bind(doc_id, patient_id).first();
}

// ---------------------------------------------------------------------
// GET — stream the decrypted file
// ---------------------------------------------------------------------
export async function onRequestGet(ctx) {
    const { request, env, params } = ctx;
    const { allow } = await previewAccess(request, env);
    if (!allow) return preLaunchNotFound();

    let session;
    try { session = await requireRole(ctx, ["patient"]); }
    catch (resp) { return resp; }
    if (!session.patient_id || !env.DB || !env.PHI || !env.PHI_MASTER_KEY) {
        return err(500, "server_error", "PHI storage not configured");
    }

    const doc_id = String(params?.id || "");
    if (!doc_id) return err(400, "bad_params", "id required");

    const doc = await loadOwnedDoc(env, session.patient_id, doc_id);
    if (!doc) return err(404, "not_found", "no such document");
    if (!doc.encrypted || !doc.envelope_dek_wrapped) {
        return err(500, "missing_dek", "document is missing its wrapped DEK");
    }

    let plaintext;
    try {
        plaintext = await getPhiObject(
            env, doc.r2_key, doc.envelope_dek_wrapped,
            `documents:${session.patient_id}:${doc_id}`
        );
    } catch (e) {
        console.error("documents GET decrypt threw", { error: String(e), doc_id });
        return err(500, "decrypt_failed", "could not retrieve file");
    }
    if (!plaintext) return err(404, "object_missing", "R2 object not found");

    await logAudit(env, {
        user_id: session.patient_id,
        user_role: "patient",
        action: "document_download",
        record_type: "document",
        record_id: doc_id,
        ip: request.headers.get("CF-Connecting-IP") || "",
        user_agent: request.headers.get("User-Agent") || "",
        success: true,
        details: { size_bytes: doc.size_bytes },
    });

    // Quote the filename safely for Content-Disposition.
    const safeName = String(doc.filename || "download.bin").replace(/[\r\n"\\]/g, "_");
    return new Response(plaintext, {
        status: 200,
        headers: {
            "content-type": doc.mime_type || "application/octet-stream",
            "content-length": String(plaintext.byteLength),
            "content-disposition": `attachment; filename="${safeName}"`,
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
        },
    });
}

// ---------------------------------------------------------------------
// DELETE — remove R2 object + D1 row
// ---------------------------------------------------------------------
export async function onRequestDelete(ctx) {
    const { request, env, params } = ctx;
    const { allow } = await previewAccess(request, env);
    if (!allow) return preLaunchNotFound();

    let session;
    try { session = await requireRole(ctx, ["patient"]); }
    catch (resp) { return resp; }
    if (!session.patient_id || !env.DB || !env.PHI) {
        return err(500, "server_error", "PHI storage not configured");
    }

    const doc_id = String(params?.id || "");
    if (!doc_id) return err(400, "bad_params", "id required");

    const doc = await loadOwnedDoc(env, session.patient_id, doc_id);
    if (!doc) return err(404, "not_found", "no such document");

    // Audit FIRST so we have a record even if the delete partially fails.
    await logAudit(env, {
        user_id: session.patient_id,
        user_role: "patient",
        action: "document_delete",
        record_type: "document",
        record_id: doc_id,
        ip: request.headers.get("CF-Connecting-IP") || "",
        user_agent: request.headers.get("User-Agent") || "",
        success: true,
        details: { kind: doc.kind, size_bytes: doc.size_bytes },
    });

    let r2_ok = true;
    try { await env.PHI.delete(doc.r2_key); } catch (e) {
        console.warn("documents DELETE R2.delete warn", { error: String(e), key: doc.r2_key });
        r2_ok = false;
    }
    try {
        await env.DB.prepare(
            "DELETE FROM documents WHERE id = ? AND patient_id = ?"
        ).bind(doc_id, session.patient_id).run();
    } catch (e) {
        console.error("documents DELETE DB.delete threw", { error: String(e), doc_id });
        return err(500, "db_delete_failed", "could not delete record");
    }

    return new Response(JSON.stringify({ ok: true, id: doc_id, r2_ok }), {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}
