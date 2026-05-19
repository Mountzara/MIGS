// =====================================================================
// functions/_lib/encounters.js — encounter event recorder
// =====================================================================
// Single helper that any endpoint can call when a patient-touching
// event happens. Two writes per call (in one round trip):
//   1. INSERT into encounter_events (the chronological log)
//   2. UPSERT patient_dirty_flag (so the Transcription app picks up
//      the patient on its next sync cycle and queues snapshot regen)
//
// Best-effort: a failure here MUST NOT fail the originating user
// action. Every caller wraps the call in try/catch.
//
// Usage:
//   await recordEncounterEvent(env, {
//       patient_id, event_type: 'symptom_threshold',
//       event_summary: 'Pain 9/10 sustained 3 days',
//       severity: 'warning',
//       ref_kind: 'symptom_diary_entry',
//       ref_id: entry.id,
//       details: { pain_avg_3d: 9 }
//   });
// =====================================================================

function uuid() {
    return crypto.randomUUID();
}

function nowIso() {
    return new Date().toISOString();
}

const VALID_SEVERITY = new Set(["info", "warning", "urgent"]);

export async function recordEncounterEvent(env, {
    patient_id, event_type, event_summary,
    severity = "info", ref_kind = null, ref_id = null, details = null
}) {
    if (!env || !env.DB || !patient_id || !event_type || !event_summary) return null;
    if (!VALID_SEVERITY.has(severity)) severity = "info";
    const id = uuid();
    const now = nowIso();
    try {
        await env.DB.prepare(`
            INSERT INTO encounter_events
              (id, patient_id, event_type, event_summary, severity,
               ref_kind, ref_id, details_json, occurred_at)
            VALUES (?,?,?,?,?,?,?,?,?)
        `).bind(
            id, patient_id, event_type, event_summary.slice(0, 500),
            severity, ref_kind, ref_id,
            details ? JSON.stringify(details) : null,
            now
        ).run();
    } catch (e) {
        // Hard failure of the event log shouldn't break the user action.
        console.warn("recordEncounterEvent insert failed", { error: String(e && e.message || e), event_type, patient_id });
        return null;
    }

    // Mark the patient dirty so the Transcription app sees them next poll.
    // patient_dirty_flag uses an integer ms timestamp (Phase 9 convention).
    const dirty_since_ms = Date.now();
    try {
        await env.DB.prepare(`
            INSERT INTO patient_dirty_flag (patient_id, dirty_since, dirty_reason, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(patient_id) DO UPDATE SET
                dirty_since = excluded.dirty_since,
                dirty_reason = excluded.dirty_reason,
                updated_at = excluded.updated_at
        `).bind(patient_id, dirty_since_ms, event_type, dirty_since_ms).run();
    } catch (e) {
        console.warn("recordEncounterEvent dirty-flag write failed", { error: String(e && e.message || e) });
    }

    return { id, occurred_at: now };
}

/**
 * Pull events for a patient since the given ISO timestamp (or last N events
 * if no cutoff). Used by the /admin/cases/:id/whats-new endpoint.
 */
export async function listEventsForPatient(env, patient_id, { sinceIso = null, limit = 50 } = {}) {
    if (!env || !env.DB || !patient_id) return [];
    let sql, args;
    if (sinceIso) {
        sql = `
            SELECT id, event_type, event_summary, severity, ref_kind, ref_id, details_json, occurred_at
              FROM encounter_events
             WHERE patient_id = ? AND occurred_at > ?
             ORDER BY occurred_at DESC
             LIMIT ?
        `;
        args = [patient_id, sinceIso, Math.min(limit, 200)];
    } else {
        sql = `
            SELECT id, event_type, event_summary, severity, ref_kind, ref_id, details_json, occurred_at
              FROM encounter_events
             WHERE patient_id = ?
             ORDER BY occurred_at DESC
             LIMIT ?
        `;
        args = [patient_id, Math.min(limit, 200)];
    }
    const rs = await env.DB.prepare(sql).bind(...args).all();
    const rows = (rs && rs.results) || [];
    return rows.map(r => {
        let details = null;
        if (r.details_json) { try { details = JSON.parse(r.details_json); } catch {} }
        return { ...r, details };
    });
}
