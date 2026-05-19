// =====================================================================
// POST /api/v1/sync/transcription/snapshot — push AI snapshot to website
// =====================================================================
// Phase 9. The MountZaraMedicalTranscription app's PatientIntelligenceService
// generates a PatientProgressSummary after running across all of a patient's
// encounters. It pushes that JSON here so the website's clinician-side
// dashboard at /admin/cases/:id/snapshot can render it.
//
// Snapshots are versioned. We do NOT overwrite. Each push appends a new
// patient_snapshots row, increments version_number for that patient, and
// flips is_current=0 on the previously-current snapshot. The app's local
// SnapshotHistoryStore maintains a parallel history (up to 50 versions);
// the website mirrors that cap on its end too.
//
// Body (JSON) — verbatim PatientProgressSummary serialization (camelCase
// from Swift, mapped to snake_case here):
//   {
//     patient_id:                   required ('ptn_xxx' — already resolved)
//     source_app_snapshot_id:       optional, UUID of the app's SnapshotVersion (for dedupe)
//     generated_at:                 ISO-8601 timestamp (PatientProgressSummary.generatedDate)
//     encounter_count:              integer
//     encounter_ids:                [uuid, uuid, ...]
//     dominant_category:            'obstetric' | 'gynecologic' | 'operative'
//
//     clinical_overview:            "2-3 sentence summary"
//     chief_complaint:              "..."
//     cc_history:                   "..."
//     narrative_patient_story:      "150-300 word patient journey"
//     patient_goals:                [string, ...]
//     surgical_history:             [string, ...]
//     ai_recommendations:           [string, ...]
//
//     problem_list: [
//       { problem, status, last_visit_plan } ...
//     ],
//     diagnostic_trends: [
//       { category, test_name, trend_summary, entries: [ { date, value, interpretation } ] }
//     ],
//     imaging_measurements: [
//       { organ_name, dimension, measurement_date, impression, prior_dimension }
//     ],
//     timeline_events: [
//       { event_date, event_type, event_title, event_detail, icd10_codes }
//     ],
//     action_items: [
//       { description, priority, due_date, rationale }
//     ],
//
//     change_notes:                 "Added encounter 2026-05-15"
//     ai_meta: { model, prompt_version }
//   }
//
// Response (201):
//   { ok: true, snapshot_id, version_number, prior_current_archived: bool,
//     children: { problems, diagnostic_trends, imaging, timeline, action_items } }
// Response (409): { error: "duplicate_source_app_snapshot_id", existing_snapshot_id }
// Auth: Bearer TRANSCRIPTION_SYNC_TOKEN.
// =====================================================================

import { syncRoute, syncJson, syncError } from "../../../../_lib/sync_auth.js";
import { logAudit } from "../../../../_lib/audit.js";
import { newId } from "../../../../_lib/db.js";

const APP = "transcription";

// Max children per snapshot — generous, but bounded to keep one
// snapshot from blowing up the row count.
const MAX_PROBLEMS    = 64;
const MAX_DX_TRENDS   = 64;
const MAX_DX_ENTRIES  = 200;   // per trend
const MAX_IMAGING     = 64;
const MAX_TIMELINE    = 200;
const MAX_ACTIONS     = 64;

const MAX_STR_SHORT = 256;
const MAX_STR_MED   = 2 * 1024;
const MAX_STR_LONG  = 16 * 1024;
const MAX_STR_VERY_LONG = 64 * 1024;
const MAX_JSON_FIELD = 64 * 1024;

const PATIENT_SNAPSHOT_VERSION_CAP = 50;

function s(v, max = MAX_STR_MED) {
    if (v == null) return null;
    const str = String(v);
    return str.length > max ? str.slice(0, max) : str;
}
function arrayOfStrings(v, max = 64, perItemMax = MAX_STR_MED) {
    if (!Array.isArray(v)) return null;
    const out = v
        .filter((x) => typeof x === "string" && x.trim().length > 0)
        .slice(0, max)
        .map((x) => s(x, perItemMax));
    return out.length > 0 ? JSON.stringify(out) : null;
}
function jsonOrNull(v, maxBytes = MAX_JSON_FIELD) {
    if (v == null) return null;
    try {
        const out = JSON.stringify(v);
        return out.length > maxBytes ? null : out;
    } catch { return null; }
}
function isoToEpoch(s) {
    if (!s) return Date.now();
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : Date.now();
}

export async function onRequestPost(ctx) {
    return syncRoute(ctx, APP, async ({ env, request }) => {
        let body;
        try { body = await request.json(); } catch { return syncError("invalid_json_body", 400); }

        const patient_id = s(body.patient_id, 64);
        if (!patient_id) return syncError("missing_patient_id", 400);

        // Confirm patient exists.
        const patient = await env.DB.prepare(`SELECT id FROM patients WHERE id = ?`).bind(patient_id).first();
        if (!patient) return syncError("patient_not_found", 404);

        const source_app_snapshot_id = s(body.source_app_snapshot_id, 64);

        // Dedup on (source_app, source_app_snapshot_id) when provided.
        if (source_app_snapshot_id) {
            const dup = await env.DB.prepare(`
                SELECT id FROM patient_snapshots
                WHERE source_app = ? AND source_app_snapshot_id = ?
                LIMIT 1
            `).bind(APP, source_app_snapshot_id).first();
            if (dup) {
                return syncError("duplicate_source_app_snapshot_id", 409, { existing_snapshot_id: dup.id });
            }
        }

        const generated_at = isoToEpoch(body.generated_at);
        const encounter_count = parseInt(body.encounter_count, 10) || 0;
        const encounter_ids_json = jsonOrNull(body.encounter_ids);
        const dominant_category = s(body.dominant_category, 32);

        const clinical_overview       = s(body.clinical_overview, MAX_STR_LONG);
        const chief_complaint         = s(body.chief_complaint, MAX_STR_MED);
        const cc_history              = s(body.cc_history, MAX_STR_LONG);
        const narrative_patient_story = s(body.narrative_patient_story, MAX_STR_VERY_LONG);

        const patient_goals_json      = arrayOfStrings(body.patient_goals, 32, MAX_STR_MED);
        const surgical_history_json   = arrayOfStrings(body.surgical_history, 64, MAX_STR_MED);
        const ai_recommendations_json = arrayOfStrings(body.ai_recommendations, 32, MAX_STR_MED);

        const change_notes = s(body.change_notes, MAX_STR_SHORT);
        const ai_meta = body.ai_meta || {};
        const ai_model = s(ai_meta.model, 64);
        const ai_prompt_version = s(ai_meta.prompt_version, 64);

        const snapshot_id = newId();
        const now = Date.now();

        // Determine version number + archive prior current.
        const prior = await env.DB.prepare(`
            SELECT id, version_number FROM patient_snapshots
            WHERE patient_id = ? AND is_current = 1
            ORDER BY version_number DESC
            LIMIT 1
        `).bind(patient_id).first();
        const version_number = prior ? (prior.version_number + 1) : 1;
        let prior_current_archived = false;

        const headWrites = [];
        if (prior) {
            headWrites.push(env.DB.prepare(`UPDATE patient_snapshots SET is_current = 0, updated_at = ? WHERE id = ?`).bind(now, prior.id));
            prior_current_archived = true;
        }

        headWrites.push(env.DB.prepare(`
            INSERT INTO patient_snapshots
                (id, patient_id, source_app, source_app_snapshot_id,
                 generated_at, encounter_count, encounter_ids_json,
                 clinical_overview, chief_complaint, cc_history, narrative_patient_story,
                 dominant_category, patient_goals_json, surgical_history_json, ai_recommendations_json,
                 version_number, change_notes, is_current,
                 ai_model, ai_prompt_version,
                 created_at, updated_at)
            VALUES (?, ?, ?, ?,
                    ?, ?, ?,
                    ?, ?, ?, ?,
                    ?, ?, ?, ?,
                    ?, ?, 1,
                    ?, ?,
                    ?, ?)
        `).bind(
            snapshot_id, patient_id, APP, source_app_snapshot_id,
            generated_at, encounter_count, encounter_ids_json,
            clinical_overview, chief_complaint, cc_history, narrative_patient_story,
            dominant_category, patient_goals_json, surgical_history_json, ai_recommendations_json,
            version_number, change_notes,
            ai_model, ai_prompt_version,
            now, now,
        ));

        await env.DB.batch(headWrites);

        // Children — collected then batched together for atomicity.
        const childWrites = [];

        // Problem list.
        const problems = Array.isArray(body.problem_list) ? body.problem_list.slice(0, MAX_PROBLEMS) : [];
        problems.forEach((p, idx) => {
            const problem = s(p.problem, MAX_STR_MED);
            if (!problem) return;
            childWrites.push(env.DB.prepare(`
                INSERT INTO snapshot_problem_list
                    (id, snapshot_id, seq, problem, status, last_visit_plan, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).bind(
                newId(), snapshot_id, idx,
                problem,
                s(p.status, 32) || "Active",
                s(p.last_visit_plan, MAX_STR_LONG),
                now,
            ));
        });

        // Diagnostic trends.
        const trends = Array.isArray(body.diagnostic_trends) ? body.diagnostic_trends.slice(0, MAX_DX_TRENDS) : [];
        trends.forEach((t, idx) => {
            const testName = s(t.test_name, MAX_STR_SHORT);
            if (!testName) return;
            // Normalize entries.
            const entries = Array.isArray(t.entries) ? t.entries.slice(0, MAX_DX_ENTRIES).map((e) => ({
                date: s(e.date, 24),
                value: s(e.value, MAX_STR_SHORT),
                interpretation: s(e.interpretation, MAX_STR_SHORT),
            })).filter((e) => e.date || e.value) : [];
            childWrites.push(env.DB.prepare(`
                INSERT INTO snapshot_diagnostic_trends
                    (id, snapshot_id, seq, category, test_name, trend_summary, entries_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
                newId(), snapshot_id, idx,
                s(t.category, 32) || "Labs",
                testName,
                s(t.trend_summary, MAX_STR_LONG),
                jsonOrNull(entries),
                now,
            ));
        });

        // Imaging measurements.
        const imaging = Array.isArray(body.imaging_measurements) ? body.imaging_measurements.slice(0, MAX_IMAGING) : [];
        imaging.forEach((m, idx) => {
            const organ = s(m.organ_name, 64);
            if (!organ) return;
            childWrites.push(env.DB.prepare(`
                INSERT INTO snapshot_imaging_measurements
                    (id, snapshot_id, seq, organ_name, dimension, measurement_date, impression, prior_dimension, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
                newId(), snapshot_id, idx,
                organ,
                s(m.dimension, MAX_STR_SHORT) || "",
                s(m.measurement_date, 24),
                s(m.impression, MAX_STR_LONG),
                s(m.prior_dimension, MAX_STR_SHORT),
                now,
            ));
        });

        // Timeline events.
        const timeline = Array.isArray(body.timeline_events) ? body.timeline_events.slice(0, MAX_TIMELINE) : [];
        timeline.forEach((ev, idx) => {
            const title = s(ev.event_title, MAX_STR_MED);
            if (!title) return;
            childWrites.push(env.DB.prepare(`
                INSERT INTO snapshot_timeline_events
                    (id, snapshot_id, seq, event_date, event_type, event_title, event_detail, icd10_codes_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
                newId(), snapshot_id, idx,
                s(ev.event_date, 24),
                s(ev.event_type, 24),
                title,
                s(ev.event_detail, MAX_STR_LONG),
                arrayOfStrings(ev.icd10_codes, 12, 16),
                now,
            ));
        });

        // Action items.
        const actions = Array.isArray(body.action_items) ? body.action_items.slice(0, MAX_ACTIONS) : [];
        actions.forEach((a, idx) => {
            const desc = s(a.description, MAX_STR_LONG);
            if (!desc) return;
            childWrites.push(env.DB.prepare(`
                INSERT INTO snapshot_action_items
                    (id, snapshot_id, seq, description, priority, due_date, rationale, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
                newId(), snapshot_id, idx,
                desc,
                s(a.priority, 8) || "medium",
                s(a.due_date, 24),
                s(a.rationale, MAX_STR_LONG),
                now,
            ));
        });

        if (childWrites.length > 0) {
            await env.DB.batch(childWrites);
        }

        // Prune older versions beyond the cap.
        await env.DB.prepare(`
            DELETE FROM patient_snapshots
            WHERE id IN (
                SELECT id FROM patient_snapshots
                WHERE patient_id = ?
                ORDER BY version_number DESC
                LIMIT -1 OFFSET ?
            )
        `).bind(patient_id, PATIENT_SNAPSHOT_VERSION_CAP).run();

        // Update patient_sync_state — record this push.
        const sync_state_id = `${APP}:${patient_id}`;
        await env.DB.prepare(`
            INSERT INTO patient_sync_state
                (id, app, patient_id, last_pulled_at, last_pushed_at, last_snapshot_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                last_pushed_at = excluded.last_pushed_at,
                last_snapshot_id = excluded.last_snapshot_id,
                updated_at = excluded.updated_at
        `).bind(sync_state_id, APP, patient_id, now, now, snapshot_id, now, now).run();

        // Clear the dirty flag — fresh snapshot means context is current.
        await env.DB.prepare(`DELETE FROM patient_dirty_flag WHERE patient_id = ?`).bind(patient_id).run();

        // HIPAA audit_log row.
        await logAudit(env, {
            user_id: null, user_role: "app",
            action: "phi_write",
            record_type: "patient_snapshot",
            record_id: snapshot_id,
            ip: request.headers.get("CF-Connecting-IP") || "",
            user_agent: request.headers.get("User-Agent") || "",
            success: true,
            details: {
                app: APP,
                op: "snapshot_push",
                patient_id,
                version_number,
                problems: problems.length,
                diagnostic_trends: trends.length,
                imaging: imaging.length,
                timeline: timeline.length,
                actions: actions.length,
                encounter_count,
                prior_current_archived,
            },
        });

        return syncJson({
            ok: true,
            snapshot_id,
            version_number,
            prior_current_archived,
            children: {
                problems: problems.length,
                diagnostic_trends: trends.length,
                imaging: imaging.length,
                timeline: timeline.length,
                action_items: actions.length,
            },
        }, { status: 201 });
    });
}
