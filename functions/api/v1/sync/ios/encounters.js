// =====================================================================
// POST /api/v1/sync/ios/encounters — MountZaraAI-iOS -> website
// =====================================================================
// Per CLAUDE.md §11 Tier 5. The iOS app posts mobile encounter capture
// (a clinician documenting a quick visit in clinic on iPhone/iPad).
// Body is similar to transcription/notes but smaller / faster.
//
// Body:
//   {
//     patient_id, app_session_id, visit_date,
//     visit_type_actual, chief_complaint, note_body,
//     icd10_codes?, cpt_codes?, photos_base64?,
//   }
//
// Idempotent on (patient, app_session_id).
// =====================================================================

import { syncRoute, syncJson, syncError } from "../../../../_lib/sync_auth.js";
import { logAudit } from "../../../../_lib/audit.js";
import { newId } from "../../../../_lib/db.js";
import { putPhiObject } from "../../../../_lib/phi.js";

const APP = "ios";
const MAX_NOTE_BYTES = 100 * 1024;
const MAX_PHOTO_BYTES = 6 * 1024 * 1024;
const MAX_PHOTOS = 10;

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
        const visit_type_actual = body.visit_type_actual ? String(body.visit_type_actual).slice(0, 64) : null;
        const chief_complaint = body.chief_complaint ? String(body.chief_complaint).slice(0, 500) : null;
        const note_body = typeof body.note_body === "string" ? body.note_body : "";

        if (!patient_id) return syncError("missing_patient_id", 400);
        if (!session_id) return syncError("missing_app_session_id", 400);
        if (!isDate(visit_date)) return syncError("invalid_visit_date", 400);
        if (!note_body.trim()) return syncError("empty_note_body", 400);
        const noteBytes = new TextEncoder().encode(note_body).length;
        if (noteBytes > MAX_NOTE_BYTES) return syncError("note_body_too_large", 413, { max: MAX_NOTE_BYTES });

        const p = await env.DB.prepare(`SELECT id FROM patients WHERE id = ?`).bind(patient_id).first();
        if (!p) return syncError("patient_not_found", 404);

        const existing = await env.DB.prepare(`
            SELECT id FROM encounters
            WHERE patient_id = ? AND transcription_session_id = ?
        `).bind(patient_id, session_id).first();
        if (existing) return syncError("duplicate_session", 409, { existing_encounter_id: existing.id });

        const now = Date.now();
        const encounter_id = newId();
        const noteKey = `encounter/${patient_id}/${encounter_id}/note.bin`;
        try {
            await putPhiObject(env, noteKey, note_body, `encounter/${encounter_id}/note`);
        } catch (e) { return syncError("phi_encrypt_note_failed", 500); }

        const CLINICIAN_ID = "mabini-christopher-z";
        await env.DB.prepare(`
            INSERT INTO encounters
                (id, patient_id, clinician_id, visit_date, visit_type_actual,
                 chief_complaint, note_r2_key, note_source, transcription_session_id,
                 cpt_codes_json, icd10_codes_json,
                 created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'imported', ?, ?, ?, ?, ?)
        `).bind(
            encounter_id, patient_id, CLINICIAN_ID, visit_date,
            visit_type_actual, chief_complaint,
            noteKey, session_id,
            safeStringArr(body.cpt_codes),
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
            const key = `encounter/${patient_id}/${encounter_id}/ios_photo_${photoIdx}.bin`;
            let pput;
            try {
                pput = await putPhiObject(env, key, photo, `encounter/${encounter_id}/ios_photo_${photoIdx}`);
            } catch { continue; }
            const sha = await sha256Hex(photo);
            const docId = newId();
            await env.DB.prepare(`
                INSERT INTO documents
                    (id, patient_id, kind, r2_key, r2_bucket, filename, mime_type, size_bytes,
                     sha256, encrypted, envelope_dek_wrapped,
                     uploaded_by_role, uploaded_by_id, source_app, description, uploaded_at)
                VALUES (?, ?, 'imaging', ?, 'mountzara-phi', ?, ?, ?, ?, 1, ?, 'app', 'mountzara_ios', 'ios', ?, ?)
            `).bind(
                docId, patient_id, key, `ios-photo-${photoIdx}.jpg`,
                "image/jpeg", photo.length, sha, pput.wrapped_dek,
                `Captured from iOS app session ${session_id}`, now
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
                app: APP, op: "ios_sync",
                patient_id, app_session_id: session_id,
                visit_type_actual, note_bytes: noteBytes, photo_count: document_ids.length,
                visit_date,
            },
        });

        // Phase 9.5 — record encounter event so the case-view "what's new"
        // panel surfaces a freshly-captured iOS encounter. Best-effort.
        try {
            const { recordEncounterEvent } = await import("../../../../_lib/encounters.js");
            await recordEncounterEvent(env, {
                patient_id,
                event_type: "ios_encounter_synced",
                event_summary: `New mobile encounter captured (${visit_date}${visit_type_actual ? `, ${visit_type_actual}` : ""})`,
                severity: "info",
                ref_kind: "encounter",
                ref_id: encounter_id,
                details: { visit_date, visit_type_actual, photo_count: document_ids.length, app_session_id: session_id }
            });
        } catch {}

        return syncJson({ ok: true, encounter_id, document_ids }, { status: 201 });
    });
}
