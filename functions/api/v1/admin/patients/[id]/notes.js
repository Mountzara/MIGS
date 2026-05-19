// =====================================================================
// /api/v1/admin/patients/<id>/notes
//   GET  — list all personal notes for the patient (decrypted bodies)
//   POST — create a new personal note (body envelope-encrypted to mountzara-phi)
//
// Phase 14 Round A — clinician-side memory: personal/family/preference/
// milestone/logistics touchpoints. NOT visible to patient.
// =====================================================================

import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../../../_lib/admin_api.js";
import { putPhiObject, getPhiObject } from "../../../../../_lib/phi.js";
import { logAudit } from "../../../../../_lib/audit.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_CATEGORIES = new Set([
    "personal", "family", "preference", "milestone", "logistics",
]);
const MAX_SUMMARY = 140;
const MAX_BODY = 6 * 1024;

function aadFor(patientId, noteId) {
    return `patient-personal-note/${patientId}/${noteId}`;
}

async function decryptNotes(env, rows) {
    const out = [];
    for (const r of rows) {
        let body = "";
        try {
            const bytes = await getPhiObject(
                env, r.body_r2_key, r.body_wrapped_dek,
                aadFor(r.patient_id, r.id)
            );
            if (bytes) body = new TextDecoder().decode(bytes);
        } catch (e) {
            body = `[decrypt_failed: ${(e.message || e).slice(0, 80)}]`;
        }
        out.push({
            id: r.id,
            patient_id: r.patient_id,
            category: r.category,
            summary: r.summary || "",
            body,
            is_pinned: !!r.is_pinned,
            body_size_bytes: r.body_size_bytes,
            created_at: r.created_at,
            created_by: r.created_by,
            updated_at: r.updated_at,
            updated_by: r.updated_by,
        });
    }
    return out;
}


// ---------------------------------------------------------------------
// GET — list
// ---------------------------------------------------------------------
export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env, request, admin }) => {
        const patientId = ctx.params.id;
        if (!UUID_RE.test(patientId)) return jsonError("invalid patient_id", 400);
        const url = new URL(request.url);
        const category = (url.searchParams.get("category") || "").toLowerCase();

        let q = "SELECT * FROM patient_personal_notes WHERE patient_id = ?";
        const binds = [patientId];
        if (category && VALID_CATEGORIES.has(category)) {
            q += " AND category = ?";
            binds.push(category);
        }
        q += " ORDER BY is_pinned DESC, updated_at DESC";

        const { results } = await env.DB.prepare(q).bind(...binds).all();
        const notes = await decryptNotes(env, results || []);

        await logAudit(env, {
            user_id: admin.user, user_role: admin.role,
            action: "personal_notes_read",
            record_type: "patient", record_id: patientId,
            success: true,
            details: { count: notes.length, category: category || null },
        });

        return jsonResponse({ notes });
    });
}


// ---------------------------------------------------------------------
// POST — create
// Body: { category, summary, body, is_pinned? }
// ---------------------------------------------------------------------
export async function onRequestPost(ctx) {
    return adminRoute(ctx, async ({ env, request, admin }) => {
        const patientId = ctx.params.id;
        if (!UUID_RE.test(patientId)) return jsonError("invalid patient_id", 400);
        const patientRow = await env.DB.prepare(
            "SELECT id FROM patients WHERE id = ?"
        ).bind(patientId).first();
        if (!patientRow) return jsonError("patient not found", 404);

        const body = await readJsonBody(request);
        if (!body) return jsonError("invalid JSON body", 400);
        const category = String(body.category || "personal").toLowerCase();
        if (!VALID_CATEGORIES.has(category)) {
            return jsonError(`category must be one of: ${[...VALID_CATEGORIES].join(", ")}`, 400);
        }
        const summary = String(body.summary || "").trim().slice(0, MAX_SUMMARY).replace(/[<>]/g, "");
        const bodyText = String(body.body || "").slice(0, MAX_BODY);
        if (!summary && !bodyText) {
            return jsonError("at least one of summary/body is required", 400);
        }
        const isPinned = body.is_pinned ? 1 : 0;

        const noteId = crypto.randomUUID();
        const r2Key = `patient-personal-notes/${patientId}/${noteId}.bin`;
        const aad = aadFor(patientId, noteId);

        let envelope;
        try {
            envelope = await putPhiObject(env, r2Key, bodyText, aad);
        } catch (e) {
            return jsonError(`PHI write failed: ${e.message || e}`, 500);
        }

        const now = Date.now();
        await env.DB.prepare(`
            INSERT INTO patient_personal_notes
              (id, patient_id, category, summary, body_r2_key, body_wrapped_dek,
               body_iv_data, body_iv_dek, body_size_bytes, is_pinned,
               created_at, created_by, updated_at, updated_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
            noteId, patientId, category, summary,
            envelope.r2_key, envelope.wrapped_dek, envelope.iv_data, envelope.iv_dek,
            envelope.size_bytes, isPinned,
            now, admin.user, now, admin.user,
        ).run();

        await logAudit(env, {
            user_id: admin.user, user_role: admin.role,
            action: "personal_note_create",
            record_type: "patient_personal_notes", record_id: noteId,
            success: true,
            details: { patient_id: patientId, category, summary_present: !!summary },
        });

        return jsonResponse({
            ok: true,
            note: {
                id: noteId,
                patient_id: patientId,
                category, summary, body: bodyText,
                is_pinned: !!isPinned,
                body_size_bytes: envelope.size_bytes,
                created_at: now, created_by: admin.user,
                updated_at: now, updated_by: admin.user,
            },
        }, { status: 201 });
    });
}
