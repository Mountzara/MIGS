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
               envelope_dek_wrapped, encrypted, sha256, description,
               uploaded_by_role, phi_aad, uploaded_at
        FROM documents WHERE id = ? AND patient_id = ?
    `).bind(doc_id, patient_id).first();
}

/**
 * The AAD this object was actually sealed with.
 *
 * AES-GCM AAD is not advisory: a mismatch fails decryption outright. This
 * endpoint used to hard-code `documents:<patient>:<doc>` for every row,
 * but message attachments are sealed as `message_attachment/<attachment_id>`
 * — and the document list returns them, so a member tapping a file they
 * had sent in a message got 500 "could not retrieve file" every time.
 *
 * Preference order:
 *   1. documents.phi_aad — what the writer recorded (schema 0037). Any
 *      future convention lands here automatically.
 *   2. the message_attachments join — covers rows written before 0037 in
 *      an environment where the backfill has not run.
 *   3. the historical default, correct for patient uploads.
 */
async function aadForDocument(env, doc, patient_id) {
    if (doc.phi_aad) return doc.phi_aad;
    if (doc.kind === "message_attachment") {
        const att = await env.DB.prepare(
            "SELECT id FROM message_attachments WHERE document_id = ? LIMIT 1"
        ).bind(doc.id).first().catch(() => null);
        if (att?.id) return `message_attachment/${att.id}`;
    }
    return `documents:${patient_id}:${doc.id}`;
}

// ---------------------------------------------------------------------
// WHAT A PATIENT MAY DELETE
// ---------------------------------------------------------------------
// `documents` is not a patient upload folder. It is the single store for
// every file in the record: the patient's own uploads, yes, but also
// clinician-sent attachments, encounter notes, operative notes, imaging
// the practice added, AAGL reports and AI analyses.
//
// DELETE took none of that into account. Its only check was ownership —
// `patient_id = ?` — which is true of every one of those rows, because
// they are all ABOUT this patient. So a patient could delete the operative
// note from their own surgery. The R2 object was erased and the D1 row
// dropped: not a soft delete, not recoverable, and for a record subject to
// six-year retention.
//
// The rule is BOTH: the patient must have authored it, AND it must be a
// kind that is still theirs to withdraw.
//
// Authorship alone is not enough, and `message_attachment` is why. The
// patient did upload it — but they uploaded it INTO a message thread, and
// it was received. A clinician has read it and may have acted on it. That
// makes it correspondence, not a file sitting in a folder, and letting the
// sender delete it retroactively would edit a conversation that has
// already happened. Same reasoning a sent email cannot be unsent from the
// recipient's mailbox.
const PATIENT_DELETABLE_KINDS = new Set(["patient_upload", "intake_attachment"]);

function patientMayDelete(doc) {
    if (!doc) return { ok: false, code: "not_found" };
    if (String(doc.uploaded_by_role || "") !== "patient") {
        return { ok: false, code: "not_your_upload",
                 message: "This file is part of your medical record and was added by the practice, so it cannot be deleted here. Message us if you think it is wrong." };
    }
    if (String(doc.kind || "") === "message_attachment") {
        return { ok: false, code: "sent_in_a_message",
                 message: "You sent this in a message, so it is part of that conversation and cannot be removed here. Message us if you sent it by mistake." };
    }
    if (!PATIENT_DELETABLE_KINDS.has(String(doc.kind || ""))) {
        return { ok: false, code: "not_deletable_kind",
                 message: "This file is part of your medical record and cannot be deleted here. Message us if you think it is wrong." };
    }
    return { ok: true };
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
            await aadForDocument(env, doc, session.patient_id)
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

    const allowed = patientMayDelete(doc);
    if (!allowed.ok) {
        // A refused deletion is worth recording: it is a patient trying to
        // remove something from their own record, which is exactly the
        // event an audit trail exists to show.
        await logAudit(env, {
            user_id: session.patient_id, user_role: "patient",
            action: "document_delete", record_type: "document", record_id: doc_id,
            ip: request.headers.get("CF-Connecting-IP") || "",
            user_agent: request.headers.get("User-Agent") || "",
            success: false,
            details: { kind: doc.kind, uploaded_by_role: doc.uploaded_by_role, refused: allowed.code },
        });
        return err(403, allowed.code, allowed.message);
    }

    // A file the patient uploaded can still have been ATTACHED to a
    // message. Deleting the document row would leave the attachment row
    // pointing at nothing — the thread keeps showing the filename, and the
    // download 404s with no explanation. There is no FK cascade on
    // message_attachments (D1 has no ON DELETE CASCADE here), so the
    // attachment rows are cleared explicitly, in the same request, before
    // the object goes.
    let attachments_cleared = 0;
    try {
        const att = await env.DB.prepare(
            "SELECT COUNT(*) AS n FROM message_attachments WHERE document_id = ? AND patient_id = ?"
        ).bind(doc_id, session.patient_id).first();
        attachments_cleared = att?.n || 0;
    } catch (e) {
        console.error("documents DELETE attachment count failed", String(e).slice(0, 200));
    }

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
        details: { kind: doc.kind, size_bytes: doc.size_bytes, attachments_cleared },
    });

    let r2_ok = true;
    try { await env.PHI.delete(doc.r2_key); } catch (e) {
        console.warn("documents DELETE R2.delete warn", { error: String(e), key: doc.r2_key });
        r2_ok = false;
    }
    try {
        await env.DB.batch([
            env.DB.prepare(
                "DELETE FROM message_attachments WHERE document_id = ? AND patient_id = ?"
            ).bind(doc_id, session.patient_id),
            env.DB.prepare(
                "DELETE FROM documents WHERE id = ? AND patient_id = ?"
            ).bind(doc_id, session.patient_id),
        ]);
    } catch (e) {
        console.error("documents DELETE DB.delete threw", { error: String(e), doc_id });
        return err(500, "db_delete_failed", "could not delete record");
    }

    return new Response(JSON.stringify({ ok: true, id: doc_id, r2_ok, attachments_cleared }), {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}
