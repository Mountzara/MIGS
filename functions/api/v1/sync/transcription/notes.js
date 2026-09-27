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

        // DRY RUN — validate a REAL note without storing it.
        //
        // Every test of this rail so far used synthetic notes, which proves
        // the plumbing and nothing about whether the practice's actual
        // dictation survives it. This answers that question without writing
        // PHI: it parses the note, shows the draft that WOULD be produced,
        // names the jargon a patient would meet, and lists the education
        // that would attach — then discards everything.
        if (body.dry_run === true) {
            const { draftFromNote, parseSoap, flagJargon } = await import("../../../../_lib/note_extract.js");
            const soap = parseSoap(note_body);
            const draft = patient_visible_summary || draftFromNote(note_body, {
                chiefComplaint: chief_complaint, plan_summary, next_step_summary,
                medications: medications_list,
            });
            let education = [];
            try {
                const edu = await import("../../../../_lib/avs_education.js");
                const lib = await env.DB.prepare(
                    `SELECT id, slug, title, summary, topic_tags_json FROM education_materials WHERE status='published'`).all();
                education = edu.selectForVisit(lib?.results || [], {
                    icd10: Array.isArray(body.icd10_codes) ? body.icd10_codes : [],
                    visit_type: visit_type_actual || "",
                }).materials.map((m) => m.title);
            } catch { education = []; }
            return syncJson({
                ok: true, dry_run: true, wrote_nothing: true,
                note_bytes: noteBytes,
                parsed_sections: Object.keys(soap).filter((k) => soap[k]),
                // The two that decide whether this rail is useful on a real note.
                would_draft_summary: Boolean(draft),
                draft_source: patient_visible_summary ? "app_supplied" : (draft ? "note_extract" : null),
                draft_preview: draft ? String(draft).slice(0, 600) : null,
                jargon_a_patient_would_look_up: draft ? flagJargon(draft).map((j) => `${j.term} → ${j.plain}`) : [],
                education_that_would_attach: education,
                warnings: [
                    !soap.assessment && "no Assessment section found — no summary could be drafted from this note",
                    !soap.plan && !plan_summary && "no Plan section found",
                    !chief_complaint && "no chief_complaint sent",
                    !Array.isArray(body.icd10_codes) || body.icd10_codes.length === 0
                        ? "no icd10_codes sent — no patient education can be matched to this visit" : null,
                ].filter(Boolean),
            });
        }

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

        // NEAR-DUPLICATE WATCH. A second note for the same patient on the
        // same visit date, minutes after the first, is a real clinical and
        // billing hazard — two encounters for one visit means two claims
        // for one visit. It is NOT blocked: two notes for one day is
        // legitimate (a morning call and an afternoon procedure), and the
        // server cannot tell those apart from a duplicate. It is reported,
        // so whichever layer is creating them can see it happening instead
        // of discovering it in a payer rejection.
        let near_duplicate = null;
        try {
            const recent = await env.DB.prepare(`
                SELECT id, transcription_session_id, created_at FROM encounters
                 WHERE patient_id = ? AND visit_date = ? AND created_at >= ?
                 ORDER BY created_at DESC LIMIT 1
            `).bind(patient_id, visit_date, Date.now() - 15 * 60 * 1000).first();
            if (recent) {
                near_duplicate = {
                    existing_encounter_id: recent.id,
                    existing_session_id: recent.transcription_session_id,
                    minutes_ago: Math.round((Date.now() - Number(recent.created_at)) / 60000),
                    message: "Another encounter for this patient and visit date was created minutes ago under a different session id. If this visit produced one note, one of these is a duplicate.",
                };
            }
        } catch { /* advisory only */ }

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
        // If the app sent no patient-facing recap, draft one from the note
        // it DID send. Otherwise the encounter lands as "not drafted": no
        // draft waiting for him, nothing for the patient, and a manual
        // click on every visit. Nothing is authored here — his assessment
        // and plan are lifted verbatim (see _lib/note_extract.js) — and the
        // draft is created pending review, so it cannot reach a patient
        // until he has rewritten and approved it.
        let auto_drafted = false;
        let effective_patient_summary = patient_visible_summary;
        if (!effective_patient_summary) {
            try {
                const { draftFromNote } = await import("../../../../_lib/note_extract.js");
                const draft = draftFromNote(note_body, {
                    chiefComplaint: chief_complaint,
                    plan_summary, next_step_summary,
                    medications: medications_list,
                });
                if (draft) { effective_patient_summary = draft; auto_drafted = true; }
            } catch (e) {
                console.error("notes sync: auto-draft failed", String(e).slice(0, 200));
            }
        }

        if (effective_patient_summary || clinician_full_summary) {
            ai_summary_id = newId();
            let pvKey = null, pvDek = null, cfKey = null, cfDek = null;
            if (effective_patient_summary) {
                pvKey = `encounter/${patient_id}/${encounter_id}/summary_patient.bin`;
                try {
                    const put = await putPhiObject(env, pvKey, effective_patient_summary,
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
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_clinician_review', ?, ?)
            `).bind(
                ai_summary_id, encounter_id, patient_id, CLINICIAN_ID,
                // Distinguish a recap the app wrote from one this server
                // lifted out of the note — he should know which he is
                // reading before he approves it.
                auto_drafted ? "note_extract" : "transcription_app",
                session_id, auto_drafted ? "note-extract/1" : ai_model, ai_prompt_version,
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
            auto_drafted,
            near_duplicate,
            encounter_id,
            ai_summary_id,
            note_r2_key: noteR2Key,
        }, { status: 201 });
    });
}
