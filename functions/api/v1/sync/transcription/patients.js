// =====================================================================
// GET /api/v1/sync/transcription/patients — list patients for app pull
// =====================================================================
// Phase 9. Called by the MountZaraMedicalTranscription app at launch
// (and periodically) to discover patients whose context has changed
// since its last pull. Returns a delta list when ?since=<ts> is provided
// or a full list otherwise.
//
// Patients are surfaced in two cases:
//   1. patient_dirty_flag has a row for this patient (intake submitted,
//      profile updated, symptom logged, etc.) AND dirty_since >= since.
//   2. patient row updated_at >= since (covers new patients that haven't
//      yet been pulled and don't have a dirty flag).
//
// Query params:
//   since      — ISO timestamp or epoch-ms. Optional. Default: 0 (full).
//   limit      — pagination (default 100, max 500).
//   cursor     — opaque pagination cursor; pass back what the prior
//                response returned in next_cursor.
//
// Response (200):
//   {
//     ok: true,
//     patients: [
//       { patient_id, first_name, last_name, date_of_birth,
//         dirty_reason, dirty_since, last_intake_submitted_at,
//         updated_at },
//       ...
//     ],
//     next_cursor: string | null,
//     server_time: epoch-ms
//   }
//
// Auth: Bearer TRANSCRIPTION_SYNC_TOKEN.
// =====================================================================

import { syncRoute, syncJson, syncError } from "../../../../_lib/sync_auth.js";

const APP = "transcription";

function parseSince(v) {
    if (!v) return 0;
    // Epoch-ms numeric?
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
    // ISO string?
    const t = Date.parse(String(v));
    return Number.isFinite(t) ? t : 0;
}

export async function onRequestGet(ctx) {
    return syncRoute(ctx, APP, async ({ env, request }) => {
        const url = new URL(request.url);
        const since = parseSince(url.searchParams.get("since"));
        const limit = Math.max(1, Math.min(500, parseInt(url.searchParams.get("limit") || "100", 10) || 100));
        const cursor = parseInt(url.searchParams.get("cursor") || "0", 10) || 0;

        // Two-axis union — dirty patients OR newly created/updated patients
        // not yet pulled. Both gated by `since`.
        const rowsResult = await env.DB.prepare(`
            SELECT
                p.id           AS patient_id,
                p.first_name,
                p.last_name,
                p.date_of_birth,
                p.updated_at,
                p.created_at,
                pdf.dirty_reason,
                pdf.dirty_since,
                (
                    SELECT MAX(ir.submitted_at)
                    FROM intake_responses ir
                    WHERE ir.patient_id = p.id AND ir.status = 'submitted'
                ) AS last_intake_submitted_at,
                pss.last_pulled_at AS app_last_pulled_at
            FROM patients p
            LEFT JOIN patient_dirty_flag pdf ON pdf.patient_id = p.id
            LEFT JOIN patient_sync_state pss ON pss.id = ('${APP}:' || p.id)
            WHERE
                (pdf.dirty_since IS NOT NULL AND pdf.dirty_since >= ?)
                OR (p.updated_at >= ? AND (pss.last_pulled_at IS NULL OR pss.last_pulled_at < p.updated_at))
                OR (? = 0)
            ORDER BY
                COALESCE(pdf.dirty_since, p.updated_at) DESC,
                p.id
            LIMIT ? OFFSET ?
        `).bind(since, since, since, limit + 1, cursor).all();

        const allRows = rowsResult.results || [];
        const hasMore = allRows.length > limit;
        const rows = hasMore ? allRows.slice(0, limit) : allRows;
        const next_cursor = hasMore ? String(cursor + limit) : null;

        return syncJson({
            ok: true,
            patients: rows,
            next_cursor,
            server_time: Date.now(),
            since,
        });
    });
}
