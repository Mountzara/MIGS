// =====================================================================
// /api/v1/admin/encounters/<id>/summary — generate, review, sign off
// =====================================================================
// GET  → the current summary and its status.
// POST { action: "generate" } → draft both summaries from the note.
// POST { action: "review", review_action, patient_text?, note? }
//      → approve as written, approve with edits, or reject.
//
// NOTHING HERE IS VISIBLE TO A PATIENT UNTIL status === 'approved'. That
// is enforced in the patient read path, not here — but it is the reason
// this endpoint exists at all rather than the generator writing straight
// through. The portal promises "reviewed and signed off by Dr. Mabini",
// which is a clinical safety claim, and an unreviewed AI summary of a
// medical visit reaching a patient is precisely the harm it prevents.
// =====================================================================

import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../../../_lib/admin_api.js";
import { logAudit } from "../../../../../_lib/audit.js";
import { newId } from "../../../../../_lib/db.js";
import { putPhiObject, getPhiObject } from "../../../../../_lib/phi.js";
import {
    STATUS, generateSummary, applyReview, checkPatientTone,
    extractDenormalised, REVIEW_ACTIONS, VISIT_SUMMARY_PROMPT_VERSION,
} from "../../../../../_lib/visit_summary.js";

const now = () => Date.now();

async function readBody(env, key, wrapped, aad) {
    if (!key) return "";
    try {
        const got = await getPhiObject(env, key, wrapped, aad);
        return typeof got === "string" ? got : new TextDecoder().decode(got?.plaintext || got || new Uint8Array());
    } catch { return ""; }
}

export async function onRequest(ctx) {
    return adminRoute(ctx, async ({ env, request, admin, params }) => {
        if (!env.DB) return jsonError("D1 not bound", 500);
        const encounterId = params?.id;
        if (!encounterId) return jsonError("encounter id required", 400);

        const enc = await env.DB.prepare(
            `SELECT id, patient_id, clinician_id, visit_date, visit_type_actual,
                    chief_complaint, note_r2_key, note_wrapped_dek, note_aad, note_key_lost
               FROM encounters WHERE id = ? LIMIT 1`
        ).bind(encounterId).first();
        if (!enc) return jsonError("encounter not found", 404);

        const existing = await env.DB.prepare(
            `SELECT * FROM encounter_ai_summaries WHERE encounter_id = ?
              ORDER BY created_at DESC LIMIT 1`
        ).bind(encounterId).first();

        // ---- GET ------------------------------------------------------
        if (request.method === "GET") {
            let patientText = "", clinicianText = "";
            if (existing) {
                patientText = await readBody(env, existing.patient_visible_r2_key,
                    existing.patient_visible_wrapped_dek, `visit_summary_patient:${existing.id}`);
                clinicianText = await readBody(env, existing.clinician_full_r2_key,
                    existing.clinician_full_wrapped_dek, `visit_summary_clinician:${existing.id}`);
            }
            return jsonResponse({
                ok: true,
                encounter: { id: enc.id, visit_date: enc.visit_date, visit_type: enc.visit_type_actual,
                             chief_complaint: enc.chief_complaint,
                             has_note: Boolean(enc.note_r2_key) && !enc.note_key_lost,
                             // Distinguishing "no note" from "a note we cannot open"
                             // matters: the second is a data-loss event the clinician
                             // must be told about, not an empty visit.
                             note_key_lost: Boolean(enc.note_key_lost) },
                summary: existing ? {
                    id: existing.id, status: existing.status,
                    patient_text: patientText, clinician_text: clinicianText,
                    plan_summary: existing.plan_summary,
                    next_step_summary: existing.next_step_summary,
                    medications: (() => { try { return JSON.parse(existing.medications_list_json || "[]"); } catch { return []; } })(),
                    tone: checkPatientTone(patientText),
                    reviewed_at: existing.clinician_reviewed_at,
                    review_action: existing.clinician_review_action,
                    patient_first_viewed_at: existing.patient_first_viewed_at,
                    visible_to_patient: existing.status === STATUS.APPROVED,
                } : null,
                review_actions: REVIEW_ACTIONS,
            });
        }

        if (request.method !== "POST") return jsonError("method_not_allowed", 405);
        const body = await readJsonBody(request);
        const action = String(body?.action || "");

        // ---- generate -------------------------------------------------
        if (action === "generate") {
            if (!enc.note_r2_key) {
                return jsonError("This encounter has no note yet. A summary of nothing would be a fabrication.", 409);
            }
            // These used to be `null, null`. The wrapped DEK was never
            // stored (schema/0038), so this could only ever fail — and
            // passing a null AAD made getPhiObject skip its AAD check, so
            // the failure surfaced as a generic decrypt error that read
            // like something transient rather than a missing key.
            if (enc.note_key_lost || !enc.note_wrapped_dek) {
                return jsonError(
                    "This note was saved before the encryption key was being stored, so it cannot be decrypted. " +
                    "Re-sync the encounter from the Transcription app to replace it.", 409);
            }
            const noteText = await readBody(env, enc.note_r2_key, enc.note_wrapped_dek, enc.note_aad || null);
            if (!noteText.trim()) return jsonError("the encounter note could not be read", 500);

            const gen = await generateSummary(env, {
                noteText, visitDate: enc.visit_date, visitType: enc.visit_type_actual,
                chiefComplaint: enc.chief_complaint,
                encounterId: enc.id, patientId: enc.patient_id,
            });
            if (!gen.ok) return jsonError(gen.error, 502);
            if (gen.queued) {
                return jsonResponse({ ok: true, queued: true, job_id: gen.job_id, message: gen.message });
            }

            const id = existing?.id || newId();
            const pKey = `visit-summaries/${id}-patient.txt`;
            const cKey = `visit-summaries/${id}-clinician.txt`;
            const pPut = await putPhiObject(env, pKey, new TextEncoder().encode(gen.patient), `visit_summary_patient:${id}`);
            const cPut = await putPhiObject(env, cKey, new TextEncoder().encode(gen.clinician), `visit_summary_clinician:${id}`);

            const d = gen.denormalised;
            const ts = now();
            await env.DB.prepare(
                `INSERT INTO encounter_ai_summaries
                   (id, encounter_id, patient_id, clinician_id, source, ai_model, ai_prompt_version,
                    patient_visible_r2_key, clinician_full_r2_key,
                    patient_visible_wrapped_dek, clinician_full_wrapped_dek,
                    plan_summary, medications_list_json, next_step_summary,
                    status, created_at, updated_at)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                 ON CONFLICT(id) DO UPDATE SET
                    ai_model=excluded.ai_model, ai_prompt_version=excluded.ai_prompt_version,
                    patient_visible_r2_key=excluded.patient_visible_r2_key,
                    clinician_full_r2_key=excluded.clinician_full_r2_key,
                    patient_visible_wrapped_dek=excluded.patient_visible_wrapped_dek,
                    clinician_full_wrapped_dek=excluded.clinician_full_wrapped_dek,
                    plan_summary=excluded.plan_summary,
                    medications_list_json=excluded.medications_list_json,
                    next_step_summary=excluded.next_step_summary,
                    -- REGENERATING RESETS APPROVAL. A summary he approved is
                    -- not the summary he is now looking at, and carrying the
                    -- old approval forward would publish text he never read.
                    status='${STATUS.PENDING}',
                    clinician_reviewed_at=NULL, clinician_review_action=NULL,
                    updated_at=excluded.updated_at`
            ).bind(id, enc.id, enc.patient_id, enc.clinician_id || admin.user, "manual",
                   gen.model, VISIT_SUMMARY_PROMPT_VERSION,
                   pKey, cKey, pPut?.wrapped_dek || null, cPut?.wrapped_dek || null,
                   d.plan_summary, JSON.stringify(d.medications), d.next_step_summary,
                   STATUS.PENDING, ts, ts).run();

            await logAudit(env, { user_id: admin.user, user_role: admin.role, action: "admin_override",
                record_type: "encounter_ai_summary", record_id: id, success: true,
                details: { encounter_id: enc.id, generated: true, tone_flags: gen.tone.violations.length } });

            return jsonResponse({
                ok: true, summary_id: id, status: STATUS.PENDING,
                patient_text: gen.patient, clinician_text: gen.clinician,
                denormalised: d, tone: gen.tone,
                message: "Drafted and waiting for your review. The patient cannot see it until you approve it.",
            });
        }

        // ---- review ---------------------------------------------------
        if (action === "review") {
            if (!existing) return jsonError("nothing to review — generate a summary first", 409);
            const r = applyReview(body?.review_action);
            if (!r.ok) return jsonError(r.error, 400);

            // Approving with edits replaces the patient-facing text with HIS
            // words. The point of the edit is that the model got something
            // wrong; keeping the model's version would defeat it.
            if (body?.review_action === "edited_and_approved") {
                const edited = String(body?.patient_text || "").trim();
                if (!edited) return jsonError("approving with edits requires the edited patient text", 400);
                const put = await putPhiObject(env, existing.patient_visible_r2_key,
                    new TextEncoder().encode(edited), `visit_summary_patient:${existing.id}`);
                const d = extractDenormalised(edited);
                await env.DB.prepare(
                    `UPDATE encounter_ai_summaries
                        SET patient_visible_wrapped_dek=?, plan_summary=?, medications_list_json=?,
                            next_step_summary=?, updated_at=?
                      WHERE id=?`
                ).bind(put?.wrapped_dek || existing.patient_visible_wrapped_dek,
                       d.plan_summary, JSON.stringify(d.medications), d.next_step_summary,
                       now(), existing.id).run();
            }

            await env.DB.prepare(
                `UPDATE encounter_ai_summaries
                    SET status=?, clinician_reviewed_at=?, clinician_review_action=?,
                        clinician_review_note=?, updated_at=?
                  WHERE id=?`
            ).bind(r.status, now(), String(body.review_action),
                   String(body?.note || "").slice(0, 1000) || null, now(), existing.id).run();

            await logAudit(env, { user_id: admin.user, user_role: admin.role, action: "admin_override",
                record_type: "encounter_ai_summary", record_id: existing.id, success: true,
                details: { encounter_id: enc.id, review_action: body.review_action, status: r.status } });

            // TELL HER. Approving used to say "the patient can now see it in
            // their portal" and enqueue nothing — and until 2026-08-14 there
            // was no portal page either, so the sentence was false twice
            // over. The email carries no clinical content, same posture as
            // every other template: something is ready, sign in to read it.
            let notified = false;
            if (r.patient_sees) {
                try {
                    const pt = await env.DB.prepare(
                        "SELECT email FROM patients WHERE id = ? LIMIT 1"
                    ).bind(enc.patient_id).first();
                    if (pt?.email) {
                        const { notify } = await import("../../../../../_lib/notify.js");
                        const out = await notify(env, {
                            to: pt.email, template: "visit_summary_ready",
                            patient_id: enc.patient_id,
                            data: { portalUrl: `${new URL(request.url).origin}/portal/visits/` },
                        });
                        notified = Boolean(out?.sent);
                    }
                } catch (e) {
                    // Never fail an approval because an email did not go out.
                    console.error("summary approve: notify failed", String(e).slice(0, 200));
                }
            }

            return jsonResponse({
                ok: true, status: r.status, visible_to_patient: r.patient_sees,
                patient_notified: notified,
                message: r.patient_sees
                    ? (notified
                        ? "Approved. It is in her portal now and she has been emailed."
                        : "Approved and visible in her portal. The email did not send — check /api/v1/admin/notifications/health.")
                    : "Rejected. The patient will never see this draft.",
            });
        }

        return jsonError("unknown_action — expected generate | review", 400);
    });
}
