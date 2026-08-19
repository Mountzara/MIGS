// =====================================================================
// POST /api/v1/sync/transcription/notes — Transcription app -> website
// =====================================================================
// Per CLAUDE.md §11 Tier 5. The MountZaraMedicalTranscription app calls
// this endpoint on every saved note. The note body (full SOAP) is
// envelope-encrypted into mountzara-phi; we insert one row into
// `encounters` linking the note's R2 key + transcription session id,
// and optionally one row into `encounter_ai_summaries` if the app
// pre-generated a patient-facing recap.
//
// Body (JSON):
//   {
//     patient_id:               required — resolved via /api/v1/sync/patients/lookup
//     transcription_session_id: required — the Transcription app's session UUID
//     appointment_id:           optional — back-link to a scheduled appointment
//     visit_date:               required — YYYY-MM-DD (visit_date column)
//     visit_type_actual:        optional — clinician-documented type post-visit
//     chief_complaint:          optional — short summary
//     note_body:                required — full SOAP body (markdown or plain text)
//     note_pdf_base64:          optional — signed-PDF if app rendered it
//     omt_codes:                optional array
//     cpt_codes:                optional array
//     icd10_codes:              optional array
//     patient_visible_summary:  optional — short plain-language summary the patient sees
//     clinician_full_summary:   optional — fuller clinician-side summary
//     ai_model:                 optional — eg "claude-opus-4-6"
//     ai_prompt_version:        optional — id of the prompt used to generate summaries
//   }
//
// Response (201): { ok: true, encounter_id, ai_summary_id? }
// Response (409): { error: "duplicate_session" } if transcription_session_id
//                 already has an encounter row for this patient.
// Auth: Bearer TRANSCRIPTION_SYNC_TOKEN.
// =====================================================================

import { syncRoute, syncJson, syncError } from "../../../../_lib/sync_auth.js";
import { logAudit } from "../../../../_lib/audit.js";
import { newId } from "../../../../_lib/db.js";
import { putPhiObject } from "../../../../_lib/phi.js";

const APP = "transcription";
async function sha256Hex(bytes) {
    const buf = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const MAX_NOTE_BYTES = 200 * 1024;       // 200 KB plaintext upper bound
const MAX_SUMMARY_BYTES = 16 * 1024;
const MAX_PDF_BYTES = 5 * 1024 * 1024;   // 5 MB PDF cap

function isDate(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function safeJsonArr(arr) {
    if (!Array.isArray(arr)) return null;
    const out = arr.filter(x => typeof x === "string" && x.length > 0 && x.length < 64).slice(0, 64);
    return out.length > 0 ? JSON.stringify(out) : null;
}
function decodeBase64(s) {
    if (typeof s !== "string" || s.length === 0) return null;
    try {
        const bin = atob(s);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    } catch { return null; }
}

export async function onRequestPost(ctx) {
    return syncRoute(ctx, APP, async ({ env, request }) => {
        let body;
        try { body = await request.json(); } catch { return syncError("invalid_json_body", 400); }

        const patient_id = String(body.patient_id || "");
        const session_id = String(body.transcription_session_id || "");
        const visit_date = String(body.visit_date || "");
        const appointment_id = body.appointment_id ? String(body.appointment_id) : null;
        const visit_type_actual = body.visit_type_actual ? String(body.visit_type_actual).slice(0, 64) : null;
        const chief_complaint = body.chief_complaint ? String(body.chief_complaint).slice(0, 500) : null;
        const note_body = typeof body.note_body === "string" ? body.note_body : "";
        const ai_model = body.ai_model ? String(body.ai_model).slice(0, 64) : null;
        const ai_prompt_version = body.ai_prompt_version ? String(body.ai_prompt_version).slice(0, 64) : null;
        const patient_visible_summary = typeof body.patient_visible_summary === "string" ? body.patient_visible_summary : null;
        const clinician_full_summary = typeof body.clinician_full_summary === "string" ? body.clinician_full_summary : null;
        const plan_summary = body.plan_summary ? String(body.plan_summary).slice(0, 200) : null;
        const next_step_summary = body.next_step_summary ? String(body.next_step_summary).slice(0, 280) : null;
        const medications_list = Array.isArray(body.medications_list) ? body.medications_list.filter(x => typeof x === "string").slice(0, 30) : null;

        if (!patient_id) return syncError("missing_patient_id", 400);
        if (!session_id) return syncError("missing_transcription_session_id", 400);
        if (!isDate(visit_date)) return syncError("invalid_visit_date", 400, { format: "YYYY-MM-DD" });
        if (!note_body || note_body.trim().length === 0) return syncError("empty_note_body", 400);
        const noteBytes = new TextEncoder().encode(note_body).length;
        if (noteBytes > MAX_NOTE_BYTES) return syncError("note_body_too_large", 413, { max: MAX_NOTE_BYTES });
        if (patient_visible_summary && new TextEncoder().encode(patient_visible_summary).length > MAX_SUMMARY_BYTES) {
            return syncError("patient_visible_summary_too_large", 413);
        }
        if (clinician_full_summary && new TextEncoder().encode(clinician_full_summary).length > MAX_SUMMARY_BYTES) {
            return syncError("clinician_full_summary_too_large", 413);
        }

        // Confirm patient exists.
        const patient = await env.DB.prepare(`SELECT id FROM patients WHERE id = ?`).bind(patient_id).first();
        if (!patient) return syncError("patient_not_found", 404);

        // Idempotency — one encounter per (patient, transcription_session_id).
        //
        // A repeat push is TWO different situations and they must not share
        // an answer. The app is offline-tolerant: it queues a push, the write
        // succeeds, the response is lost to a dropped connection, and the
        // retry arrives. Answering that with 409 tells a correct client its
        // note failed when the note is already safely stored — so it retries
        // forever, or marks a saved visit unsynced. Comparing the note's
        // digest separates the retry from a genuine conflict.
        const noteSha = await sha256Hex(new TextEncoder().encode(note_body));
        const existing = await env.DB.prepare(`
            SELECT id, note_sha256 FROM encounters
            WHERE patient_id = ? AND transcription_session_id = ?
        `).bind(patient_id, session_id).first();
        if (existing) {
            if (!existing.note_sha256 || existing.note_sha256 === noteSha) {
                // Same content (or pre-dates hashing): the earlier push won.
                // This IS success — say so, and hand back the id the client
                // was waiting for.
                const priorSummary = await env.DB.prepare(
                    `SELECT id FROM encounter_ai_summaries WHERE encounter_id = ? LIMIT 1`
                ).bind(existing.id).first().catch(() => null);
                return syncJson({
                    ok: true, duplicate: true, encounter_id: existing.id,
                    ai_summary_id: priorSummary ? priorSummary.id : null,
                    note: "This session was already synced with identical content — nothing was written twice.",
                });
            }
            // Different note under the same session id: a real conflict, and
            // the second note must never be silently dropped.
            return syncError("duplicate_session_different_content", 409, {
                existing_encounter_id: existing.id,
                message: "A different note is already stored for this transcription_session_id. Push the revision with a new session id, or correct the existing encounter.",
            });
        }

        const encounter_id = newId();
        const noteR2Key = `encounter/${patient_id}/${encounter_id}/note.bin`;
        const aad = `encounter/${encounter_id}/note`;
        let notePut;
        try {
            notePut = await putPhiObject(env, noteR2Key, note_body, aad);
        } catch (e) {
            return syncError("phi_encrypt_failed", 500, { detail: String(e && e.message || e) });
        }

        // Optional signed-PDF.
        let pdfR2Key = null;
        let pdfWrappedDek = null;
        const pdfAad = `encounter/${encounter_id}/note_pdf`;
        if (body.note_pdf_base64) {
            const pdfBytes = decodeBase64(body.note_pdf_base64);
            if (!pdfBytes) return syncError("invalid_note_pdf_base64", 400);
            if (pdfBytes.length > MAX_PDF_BYTES) return syncError("note_pdf_too_large", 413, { max: MAX_PDF_BYTES });
            pdfR2Key = `encounter/${patient_id}/${encounter_id}/note.pdf.bin`;
            try {
                // The return value used to be discarded entirely — no
                // assignment at all — so the signed PDF was encrypted and
                // its key immediately lost. See schema/0038.
                const pdfPut = await putPhiObject(env, pdfR2Key, pdfBytes, pdfAad);
                pdfWrappedDek = pdfPut.wrapped_dek;
            } catch (e) {
                return syncError("phi_encrypt_pdf_failed", 500, { detail: String(e && e.message || e) });
            }
        }

        const now = Date.now();
        const CLINICIAN_ID = "mabini-christopher-z";
        await env.DB.prepare(`
            INSERT INTO encounters
                (id, patient_id, clinician_id, appointment_id, visit_date,
                 visit_type_actual, chief_complaint,
                 note_r2_key, note_pdf_r2_key, note_source, transcription_session_id,
                 note_wrapped_dek, note_pdf_wrapped_dek, note_aad, note_pdf_aad, note_sha256,
                 omt_codes_json, cpt_codes_json, icd10_codes_json,
                 created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'transcription_app', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
            encounter_id, patient_id, CLINICIAN_ID, appointment_id, visit_date,
            visit_type_actual, chief_complaint,
            noteR2Key, pdfR2Key, session_id,
            // The wrapped DEK is the ONLY copy of the key to this note —
            // R2 carries the IVs and AAD but deliberately not key material.
            // It used to be computed and dropped, which made every synced
            // note permanently unreadable. See schema/0038.
            notePut.wrapped_dek, pdfWrappedDek, aad, pdfR2Key ? pdfAad : null, noteSha,
            safeJsonArr(body.omt_codes),
            safeJsonArr(body.cpt_codes),
            safeJsonArr(body.icd10_codes),
            now, now
        ).run();

        // Optional AI summary row.
        let ai_summary_id = null;
        if (patient_visible_summary || clinician_full_summary) {
            ai_summary_id = newId();
            let pvKey = null, pvDek = null, cfKey = null, cfDek = null;
            if (patient_visible_summary) {
                pvKey = `encounter/${patient_id}/${encounter_id}/summary_patient.bin`;
                try {
                    const put = await putPhiObject(env, pvKey, patient_visible_summary,
                        `encounter/${encounter_id}/summary_patient`);
                    pvDek = put.wrapped_dek;
                } catch (e) { return syncError("phi_encrypt_pvSummary_failed", 500); }
            }
            if (clinician_full_summary) {
                cfKey = `encounter/${patient_id}/${encounter_id}/summary_clinician.bin`;
                try {
                    const put = await putPhiObject(env, cfKey, clinician_full_summary,
                        `encounter/${encounter_id}/summary_clinician`);
                    cfDek = put.wrapped_dek;
                } catch (e) { return syncError("phi_encrypt_cfSummary_failed", 500); }
            }
            await env.DB.prepare(`
                INSERT INTO encounter_ai_summaries
                    (id, encounter_id, patient_id, clinician_id, source,
                     transcription_session_id, ai_model, ai_prompt_version,
                     patient_visible_r2_key, clinician_full_r2_key,
                     patient_visible_wrapped_dek, clinician_full_wrapped_dek,
                     plan_summary, medications_list_json, next_step_summary,
                     status, created_at, updated_at)
                VALUES (?, ?, ?, ?, 'transcription_app', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_clinician_review', ?, ?)
            `).bind(
                ai_summary_id, encounter_id, patient_id, CLINICIAN_ID,
                session_id, ai_model, ai_prompt_version,
                pvKey, cfKey, pvDek, cfDek,
                plan_summary,
                medications_list ? JSON.stringify(medications_list) : null,
                next_step_summary,
                now, now
            ).run();
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
                app: APP,
                op: "transcription_sync",
                patient_id,
                transcription_session_id: session_id,
                note_bytes: noteBytes,
                has_pdf: !!pdfR2Key,
                has_ai_summary: !!ai_summary_id,
                visit_date,
            },
        });

        // Phase 9.5 — record encounter event so the case-view "what's new"
        // panel surfaces a fresh transcription note. Best-effort.
        try {
            const { recordEncounterEvent } = await import("../../../../_lib/encounters.js");
            await recordEncounterEvent(env, {
                patient_id,
                event_type: "transcription_note_synced",
                event_summary: `New transcription note from visit on ${visit_date}${visit_type_actual ? ` (${visit_type_actual})` : ""}`,
                severity: "info",
                ref_kind: "encounter",
                ref_id: encounter_id,
                details: { visit_date, visit_type_actual, has_ai_summary: !!ai_summary_id, chief_complaint: chief_complaint }
            });
        } catch {}

        return syncJson({
            ok: true,
            encounter_id,
            ai_summary_id,
            note_r2_key: noteR2Key,
        }, { status: 201 });
    });
}
