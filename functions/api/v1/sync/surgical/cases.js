// =====================================================================
// POST /api/v1/sync/surgical/cases — MountZaraSurgicalWorkflow -> website
// =====================================================================
// Per CLAUDE.md §11 Tier 5. Called at end-of-case by the Surgical
// Workflow app. Writes an encounter (note_source='surgical_workflow_app')
// + op-note draft into encounters + each attached photo into documents.
//
// Body:
//   {
//     patient_id:         required
//     app_session_id:     required — case_id from the app
//     visit_date:         required (the OR date)
//     procedure_name:     required — e.g. "Diagnostic laparoscopy with excision of stage III endometriosis"
//     procedure_codes:    optional CPT codes array
//     icd10_codes:        optional
//     op_note_body:       required — op note text (encrypted into mountzara-phi)
//     photos_base64:      optional array of base64 png/jpg
//     ai_model / ai_prompt_version
//   }
//
// Response (201): { ok, encounter_id, document_ids: [...] }
// =====================================================================

import { syncRoute, syncJson, syncError } from "../../../../_lib/sync_auth.js";
import { logAudit } from "../../../../_lib/audit.js";
import { newId } from "../../../../_lib/db.js";
import { putPhiObject } from "../../../../_lib/phi.js";

const APP = "surgical_workflow";
const MAX_NOTE_BYTES = 200 * 1024;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;     // 8 MB per photo
const MAX_PHOTOS = 30;

function isDate(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function decodeBase64(s) {
    if (typeof s !== "string" || s.length === 0) return null;
    try {
        const bin = atob(s);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    } catch { return null; }
}
async function sha256Hex(bytes) {
    const buf = await crypto.subtle.digest("SHA-256", bytes instanceof Uint8Array ? bytes : new TextEncoder().encode(bytes));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}
function safeStringArr(arr) {
    if (!Array.isArray(arr)) return null;
    const out = arr.filter(x => typeof x === "string" && x.length > 0 && x.length < 64).slice(0, 64);
    return out.length > 0 ? JSON.stringify(out) : null;
}

export async function onRequestPost(ctx) {
    return syncRoute(ctx, APP, async ({ env, request }) => {
        let body;
        try { body = await request.json(); } catch { return syncError("invalid_json_body", 400); }

        const patient_id = String(body.patient_id || "");
        const session_id = String(body.app_session_id || "");
        const visit_date = String(body.visit_date || "");
        const procedure_name = body.procedure_name ? String(body.procedure_name).slice(0, 300) : null;
        const op_note_body = typeof body.op_note_body === "string" ? body.op_note_body : "";

        if (!patient_id) return syncError("missing_patient_id", 400);
        if (!session_id) return syncError("missing_app_session_id", 400);
        if (!isDate(visit_date)) return syncError("invalid_visit_date", 400);
        if (!procedure_name) return syncError("missing_procedure_name", 400);
        if (!op_note_body.trim()) return syncError("empty_op_note_body", 400);
        const noteBytes = new TextEncoder().encode(op_note_body).length;
        if (noteBytes > MAX_NOTE_BYTES) return syncError("op_note_too_large", 413);

        const p = await env.DB.prepare(`SELECT id FROM patients WHERE id = ?`).bind(patient_id).first();
        if (!p) return syncError("patient_not_found", 404);

        // Idempotency — one encounter per (patient, transcription_session_id-equivalent).
        const existing = await env.DB.prepare(`
            SELECT id FROM encounters
            WHERE patient_id = ? AND transcription_session_id = ?
        `).bind(patient_id, session_id).first();
        if (existing) return syncError("duplicate_session", 409, { existing_encounter_id: existing.id });

        const now = Date.now();
        const encounter_id = newId();
        const opNoteKey = `encounter/${patient_id}/${encounter_id}/op_note.bin`;
        let put;
        try {
            put = await putPhiObject(env, opNoteKey, op_note_body, `encounter/${encounter_id}/op_note`);
        } catch (e) { return syncError("phi_encrypt_op_note_failed", 500); }

        const CLINICIAN_ID = "mabini-christopher-z";
        await env.DB.prepare(`
            INSERT INTO encounters
                (id, patient_id, clinician_id, visit_date, visit_type_actual,
                 chief_complaint, note_r2_key, note_source, transcription_session_id,
                 cpt_codes_json, icd10_codes_json,
                 created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'surgical_workflow_app', ?, ?, ?, ?, ?)
        `).bind(
            encounter_id, patient_id, CLINICIAN_ID, visit_date,
            "surgical_procedure",
            procedure_name,
            opNoteKey, session_id,
            safeStringArr(body.procedure_codes),
            safeStringArr(body.icd10_codes),
            now, now
        ).run();

        // Photos as documents.
        const document_ids = [];
        const photos = Array.isArray(body.photos_base64) ? body.photos_base64.slice(0, MAX_PHOTOS) : [];
        let photoIdx = 0;
        for (const p64 of photos) {
            const photo = decodeBase64(p64);
            if (!photo) continue;
            if (photo.length > MAX_PHOTO_BYTES) continue;
            photoIdx++;
            const key = `encounter/${patient_id}/${encounter_id}/photo_${photoIdx}.bin`;
            let pput;
            try {
                pput = await putPhiObject(env, key, photo, `encounter/${encounter_id}/photo_${photoIdx}`);
            } catch (e) { continue; }
            const sha = await sha256Hex(photo);
            const docId = newId();
            await env.DB.prepare(`
                INSERT INTO documents
                    (id, patient_id, kind, r2_key, r2_bucket, filename, mime_type, size_bytes,
                     sha256, encrypted, envelope_dek_wrapped,
                     uploaded_by_role, uploaded_by_id, source_app, description, uploaded_at)
                VALUES (?, ?, 'surgical_workflow_doc', ?, 'mountzara-phi', ?, ?, ?, ?, 1, ?, 'app', 'surgical_workflow_pipeline', 'surgical_workflow', ?, ?)
            `).bind(
                docId, patient_id, key, `surgical-photo-${photoIdx}.jpg`,
                "image/jpeg", photo.length, sha, pput.wrapped_dek,
                `Intraop photo ${photoIdx} from session ${session_id}`, now
            ).run();
            document_ids.push(docId);
        }

        await logAudit(env, {
            user_id: null, user_role: "app",
            action: "phi_write",
            record_type: "encounter",
            record_id: encounter_id,
            ip: request.headers.get("CF-Connecting-IP") || "",
            user_agent: request.headers.get("User-Agent") || "",
            success: true,
            details: {
                app: APP, op: "surgical_sync",
                patient_id, app_session_id: session_id, procedure_name,
                op_note_bytes: noteBytes, photo_count: document_ids.length, visit_date,
            },
        });

        // Phase 9.5 — record encounter event so the case-view "what's new"
        // panel surfaces a freshly synced surgical case. Best-effort.
        try {
            const { recordEncounterEvent } = await import("../../../../_lib/encounters.js");
            await recordEncounterEvent(env, {
                patient_id,
                event_type: "surgical_case_synced",
                event_summary: `New surgical case synced: ${procedure_name.slice(0, 120)} (${visit_date})`,
                severity: "info",
                ref_kind: "encounter",
                ref_id: encounter_id,
                details: { procedure_name, visit_date, photo_count: document_ids.length, app_session_id: session_id }
            });
        } catch {}

        return syncJson({ ok: true, encounter_id, document_ids }, { status: 201 });
    });
}
