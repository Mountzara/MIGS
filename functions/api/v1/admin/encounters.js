// =====================================================================
// GET /api/v1/admin/encounters — the visit-summary review queue
// =====================================================================
// The portal promises: "After each appointment, an AI-generated summary of
// what was discussed, the plan, the medications, and the next steps —
// reviewed and signed off by Dr. Mabini."
//
// The generate/approve API existed. Nothing listed the encounters waiting
// for it, and there was no page — so "signed off by Dr. Mabini" was
// unreachable in practice: he had no way to find an encounter, no way to
// generate a summary for it, and no way to approve one. A patient could
// therefore never see a summary at all, because `status = 'approved'` is
// in the WHERE clause of their read path and nothing could ever set it.
//
// This endpoint is the queue. One row per encounter, newest first, with
// the state of its summary and whether it is even POSSIBLE to draft one:
// an encounter whose note predates key storage (schema 0038) cannot be
// decrypted, and saying "no summary yet" about it would be a lie.
//
// PHI: names and chief complaint are returned, because this is the
// physician's own review queue behind admin Basic Auth — the same posture
// as /admin/triage and /admin/messages. No note text is decrypted here;
// that happens per-encounter on the detail call.
// =====================================================================

import { adminRoute, jsonResponse, jsonError } from "../../../_lib/admin_api.js";
import { STATUS } from "../../../_lib/visit_summary.js";

/** What he needs to know about a row before opening it. */
export function summaryState(enc, sum) {
    if (!enc.note_r2_key) {
        return { state: "no_note", label: "No note yet",
                 hint: "This encounter has no clinical note, so there is nothing to summarise." };
    }
    if (enc.note_key_lost || !enc.note_wrapped_dek) {
        // Distinguishing this from "no summary yet" matters: one is work
        // waiting for him, the other is data that cannot be recovered.
        return { state: "note_unreadable", label: "Note cannot be decrypted",
                 hint: "This note was saved before its encryption key was being stored (schema 0038). Re-sync the encounter from the Transcription app to replace it." };
    }
    if (!sum) {
        return { state: "not_drafted", label: "Not drafted",
                 hint: "Ready to draft. Nothing is shown to the patient until you approve it." };
    }
    if (sum.status === STATUS.APPROVED) {
        return { state: "approved", label: "Approved — visible to patient",
                 hint: sum.patient_first_viewed_at ? "The patient has opened it." : "The patient has not opened it yet." };
    }
    if (sum.status === STATUS.REJECTED) {
        return { state: "rejected", label: "Rejected — not shown",
                 hint: "You rejected this draft. Re-draft it or leave it." };
    }
    return { state: "pending_review", label: "Waiting for your review",
             hint: "Drafted and waiting. The patient cannot see it until you approve it." };
}

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env, request }) => {
        if (!env.DB) return jsonError("D1 not bound", 500);

        const url = new URL(request.url);
        const filter = String(url.searchParams.get("status") || "all");
        const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "100", 10) || 100, 1), 300);

        // LEFT JOIN to the most recent summary per encounter. A correlated
        // subquery rather than a GROUP BY so re-drafts (which insert a new
        // row) resolve to the newest, not an arbitrary one.
        const res = await env.DB.prepare(`
            SELECT e.id, e.patient_id, e.visit_date, e.visit_type_actual,
                   e.chief_complaint, e.note_source, e.created_at,
                   e.note_r2_key, e.note_wrapped_dek, e.note_key_lost,
                   p.first_name, p.last_name, p.preferred_name,
                   s.id AS summary_id, s.status AS summary_status,
                   s.clinician_reviewed_at, s.clinician_review_action,
                   s.patient_first_viewed_at, s.plan_summary, s.next_step_summary,
                   s.ai_model, s.created_at AS summary_created_at
              FROM encounters e
              LEFT JOIN patients p ON p.id = e.patient_id
              LEFT JOIN encounter_ai_summaries s
                     ON s.id = (SELECT id FROM encounter_ai_summaries
                                 WHERE encounter_id = e.id
                                 ORDER BY created_at DESC LIMIT 1)
             ORDER BY e.visit_date DESC, e.created_at DESC
             LIMIT ?
        `).bind(limit).all();

        const rows = (res?.results || []).map((r) => {
            const st = summaryState(r, r.summary_id ? {
                status: r.summary_status,
                patient_first_viewed_at: r.patient_first_viewed_at,
            } : null);
            return {
                encounter_id: r.id,
                patient_id: r.patient_id,
                patient_name: [r.preferred_name || r.first_name, r.last_name].filter(Boolean).join(" ") || "(unnamed)",
                visit_date: r.visit_date,
                visit_type: r.visit_type_actual,
                chief_complaint: r.chief_complaint,
                note_source: r.note_source,
                summary_id: r.summary_id || null,
                summary_status: r.summary_status || null,
                reviewed_at: r.clinician_reviewed_at || null,
                review_action: r.clinician_review_action || null,
                patient_viewed_at: r.patient_first_viewed_at || null,
                plan_summary: r.plan_summary || null,
                next_step_summary: r.next_step_summary || null,
                ai_model: r.ai_model || null,
                ...st,
            };
        });

        const filtered = filter === "all" ? rows : rows.filter((r) => r.state === filter);

        const counts = rows.reduce((acc, r) => { acc[r.state] = (acc[r.state] || 0) + 1; return acc; }, {});

        return jsonResponse({
            ok: true,
            count: filtered.length,
            total: rows.length,
            counts,
            // The number that matters: work actually waiting for him.
            awaiting_review: counts.pending_review || 0,
            ready_to_draft: counts.not_drafted || 0,
            unreadable_notes: counts.note_unreadable || 0,
            rows: filtered,
        });
    });
}
