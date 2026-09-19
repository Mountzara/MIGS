// =====================================================================
// GET /api/v1/admin/documents/<id> — open a patient document from admin
// =====================================================================
// A patient uploads an outside operative report exactly as the portal
// asks her to. The admin case view then listed the FILENAME with no way
// to open it: there was no admin download route for `documents` rows at
// all. The one admin download that existed covered message attachments
// only. So the practice's answer to "please upload your records before
// the visit" was a list of names he could read and files he could not.
//
// AAD — THE PART THAT WOULD HAVE 500'D IF DONE THE OBVIOUS WAY.
// Five sealing conventions are in play across writers (see schema/0037):
// patient uploads use `documents:<patient_id>:<doc_id>`, message
// attachments use `message_attachment/<attachment_id>`, encounter photos
// and clinical-AI reports use their own. Hardcoding the patient-upload
// convention here would decrypt uploads and 500 on everything else —
// which is precisely the bug the patient-side endpoint already had and
// fixed. The resolution order is shared with it:
//   1. documents.phi_aad (recorded at write time since 0037),
//   2. the message_attachments join for pre-0037 attachment rows,
//   3. the historical patient-upload default.
//
// Access: adminRoute (Basic auth + PBKDF2). The clinician reading a
// document a patient uploaded TO the practice is the ordinary treatment
// use; it is audited like every other PHI read.
// =====================================================================

import { adminRoute, jsonError } from "../../../../_lib/admin_api.js";
import { logAudit } from "../../../../_lib/audit.js";
import { getPhiObject } from "../../../../_lib/phi.js";

/** Same resolution order as the patient endpoint. Kept in lock-step. */
async function aadForDocument(env, doc) {
    if (doc.phi_aad) return doc.phi_aad;
    if (doc.kind === "message_attachment") {
        const att = await env.DB.prepare(
            "SELECT id FROM message_attachments WHERE document_id = ? LIMIT 1"
        ).bind(doc.id).first().catch(() => null);
        if (att?.id) return `message_attachment/${att.id}`;
    }
    return `documents:${doc.patient_id}:${doc.id}`;
}

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env, request, admin, params }) => {
        if (!env.DB || !env.PHI || !env.PHI_MASTER_KEY) {
            return jsonError("phi_storage_not_configured", 500);
        }
        const id = String(params?.id || "");
        if (!id) return jsonError("id_required", 400);

        const doc = await env.DB.prepare(`
            SELECT id, patient_id, kind, r2_key, filename, mime_type, size_bytes,
                   envelope_dek_wrapped, encrypted, phi_aad, uploaded_by_role, uploaded_at
            FROM documents WHERE id = ?
        `).bind(id).first();
        if (!doc) return jsonError("document_not_found", 404);
        if (!doc.encrypted || !doc.envelope_dek_wrapped) {
            return jsonError("document_missing_dek", 500,
                { message: "This document has no stored encryption key and cannot be opened." });
        }

        let plaintext;
        try {
            plaintext = await getPhiObject(
                env, doc.r2_key, doc.envelope_dek_wrapped, await aadForDocument(env, doc));
        } catch (e) {
            console.error("admin document download decrypt failed",
                { doc_id: id, kind: doc.kind, error: String(e).slice(0, 200) });
            return jsonError("decrypt_failed", 500,
                { message: "The file could not be decrypted. If it predates schema 0037 and is not a patient upload, its sealing convention may need backfilling." });
        }
        if (!plaintext) return jsonError("object_missing", 404,
            { message: "The encrypted object is missing from storage." });

        await logAudit(env, {
            user_id: admin.user, user_role: admin.role,
            action: "document_download",
            record_type: "document",
            record_id: id,
            ip: request.headers.get("CF-Connecting-IP") || "",
            user_agent: request.headers.get("User-Agent") || "",
            success: true,
            details: { patient_id: doc.patient_id, kind: doc.kind, size_bytes: doc.size_bytes },
        });

        const safeName = String(doc.filename || "download.bin").replace(/[^a-zA-Z0-9._-]/g, "_");
        return new Response(plaintext, {
            status: 200,
            headers: {
                "content-type": doc.mime_type || "application/octet-stream",
                "content-length": String(plaintext.byteLength),
                "content-disposition": `attachment; filename="${safeName}"`,
                "cache-control": "private, no-store",
                "x-content-type-options": "nosniff",
            },
        });
    });
}
