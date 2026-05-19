// =====================================================================
// /api/v1/admin/patients/<id>/notes/<note_id>
//   PATCH  — update a personal note (any subset of category/summary/body/is_pinned)
//   DELETE — drop the note + R2 object
// =====================================================================

import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../../../../_lib/admin_api.js";
import { putPhiObject } from "../../../../../../_lib/phi.js";
import { logAudit } from "../../../../../../_lib/audit.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_CATEGORIES = new Set([
    "personal", "family", "preference", "milestone", "logistics",
]);
const MAX_SUMMARY = 140;
const MAX_BODY = 6 * 1024;

function aadFor(patientId, noteId) {
    return `patient-personal-note/${patientId}/${noteId}`;
}


export async function onRequestPatch(ctx) {
    return adminRoute(ctx, async ({ env, request, admin }) => {
        const patientId = ctx.params.id;
        const noteId = ctx.params.note_id;
        if (!UUID_RE.test(patientId) || !UUID_RE.test(noteId)) {
            return jsonError("invalid patient_id or note_id", 400);
        }

        const row = await env.DB.prepare(
            "SELECT * FROM patient_personal_notes WHERE id = ? AND patient_id = ?"
        ).bind(noteId, patientId).first();
        if (!row) return jsonError("note not found", 404);

        const body = await readJsonBody(request);
        if (!body) return jsonError("invalid JSON body", 400);

        const updates = [];
        const binds = [];

        if (body.category !== undefined) {
            const c = String(body.category).toLowerCase();
            if (!VALID_CATEGORIES.has(c)) {
                return jsonError(`category must be one of: ${[...VALID_CATEGORIES].join(", ")}`, 400);
            }
            updates.push("category = ?"); binds.push(c);
        }
        if (body.summary !== undefined) {
            const s = body.summary === null ? null
                : String(body.summary).trim().slice(0, MAX_SUMMARY).replace(/[<>]/g, "");
            updates.push("summary = ?"); binds.push(s);
        }
        if (body.is_pinned !== undefined) {
            updates.push("is_pinned = ?"); binds.push(body.is_pinned ? 1 : 0);
        }

        // Body re-encrypt — mountzara-phi has the 7-year retention lock
        // (§11 Tier 2), so we cannot put-over the existing R2 key. Write
        // a NEW versioned key and update the row pointer. The old object
        // remains in R2 until the retention period expires + R2 lifecycle
        // policy reclaims it (intended HIPAA behaviour — historical PHI
        // is preserved through immutability).
        if (body.body !== undefined) {
            const bodyText = String(body.body || "").slice(0, MAX_BODY);
            const aad = aadFor(patientId, noteId);
            const versionedKey = `patient-personal-notes/${patientId}/${noteId}__${Date.now()}.bin`;
            const envelope = await putPhiObject(env, versionedKey, bodyText, aad);
            updates.push(
                "body_r2_key = ?",
                "body_wrapped_dek = ?", "body_iv_data = ?", "body_iv_dek = ?", "body_size_bytes = ?"
            );
            binds.push(
                envelope.r2_key,
                envelope.wrapped_dek, envelope.iv_data, envelope.iv_dek, envelope.size_bytes
            );
        }

        if (!updates.length) return jsonError("nothing to update", 400);

        const now = Date.now();
        updates.push("updated_at = ?", "updated_by = ?");
        binds.push(now, admin.user, noteId);

        await env.DB.prepare(
            `UPDATE patient_personal_notes SET ${updates.join(", ")} WHERE id = ?`
        ).bind(...binds).run();

        await logAudit(env, {
            user_id: admin.user, user_role: admin.role,
            action: "personal_note_update",
            record_type: "patient_personal_notes", record_id: noteId,
            success: true,
            details: { patient_id: patientId, fields: Object.keys(body) },
        });

        return jsonResponse({ ok: true, updated_at: now });
    });
}


export async function onRequestDelete(ctx) {
    return adminRoute(ctx, async ({ env, request, admin }) => {
        const patientId = ctx.params.id;
        const noteId = ctx.params.note_id;
        if (!UUID_RE.test(patientId) || !UUID_RE.test(noteId)) {
            return jsonError("invalid patient_id or note_id", 400);
        }

        const row = await env.DB.prepare(
            "SELECT body_r2_key FROM patient_personal_notes WHERE id = ? AND patient_id = ?"
        ).bind(noteId, patientId).first();
        if (!row) return jsonError("note not found", 404);

        if (row.body_r2_key) {
            try { await env.PHI.delete(row.body_r2_key); } catch {}
        }
        await env.DB.prepare(
            "DELETE FROM patient_personal_notes WHERE id = ?"
        ).bind(noteId).run();

        await logAudit(env, {
            user_id: admin.user, user_role: admin.role,
            action: "personal_note_delete",
            record_type: "patient_personal_notes", record_id: noteId,
            success: true,
            details: { patient_id: patientId },
        });

        return jsonResponse({ ok: true, deleted: noteId });
    });
}
