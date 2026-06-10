// =====================================================================
// GET /api/v1/admin/cases/<patient_id> — full per-patient aggregation
// =====================================================================
// Per CLAUDE.md §11 Tier 4 Clinician Workspace. Returns everything a
// clinician needs to review a patient's case in one shot:
//
//   {
//     patient: { ... },
//     intake: { id, status, completion_pct, section_count, sections: [...] },
//     triage_history: [ ... ],
//     appointments: { upcoming: [...], past: [...] },
//     messages: { threads: [...], unread_for_clinician: N },
//     symptoms: { entry_count, latest_date, range, trends: { <key>: [{date,value},...] } },
//     education: { assignments: [...], view_count_total },
//     documents: [ ... ],
//     audit: [ ... last N events ... ],
//   }
//
// The clinician UI hits this endpoint once when the case page loads,
// then renders tabbed sections — no N+1 calls per tab.
//
// Query params:
//   symptom_days:  how many days of diary back (default 30, max 180)
//   audit_limit:   how many audit events (default 30, max 100)
//   trends_keys:   comma-separated list of symptom keys to include
//                  trend data for (default: pelvic_pain_0_10,sleep_quality_0_10,mood_0_10)
// =====================================================================

import { adminRoute, jsonResponse, jsonError } from "../../../../_lib/admin_api.js";

const DEFAULT_SYMPTOM_DAYS = 30;
const MAX_SYMPTOM_DAYS = 180;
const DEFAULT_AUDIT_LIMIT = 30;
const MAX_AUDIT_LIMIT = 100;
const DEFAULT_TREND_KEYS = ["pelvic_pain_0_10", "sleep_quality_0_10", "mood_0_10"];

function ageYears(dob) {
    if (!dob || typeof dob !== "string") return null;
    const m = dob.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const y = parseInt(m[1], 10), mo = parseInt(m[2], 10), d = parseInt(m[3], 10);
    const t = new Date();
    let age = t.getFullYear() - y;
    if (t.getMonth() + 1 < mo || (t.getMonth() + 1 === mo && t.getDate() < d)) age -= 1;
    return Number.isFinite(age) && age >= 0 && age < 130 ? age : null;
}

function isoToday() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function addDaysISO(iso, days) {
    const [y, m, d] = iso.split("-").map(n => parseInt(n, 10));
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + days);
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth()+1).padStart(2,"0")}-${String(dt.getUTCDate()).padStart(2,"0")}`;
}

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env, request }) => {
        const patient_id = String(ctx.params?.patient_id || "");
        if (!patient_id) return jsonError("missing_patient_id", 400);

        const url = new URL(request.url);
        const symptomDays = Math.min(Math.max(parseInt(url.searchParams.get("symptom_days") || DEFAULT_SYMPTOM_DAYS, 10), 1), MAX_SYMPTOM_DAYS);
        const auditLimit = Math.min(Math.max(parseInt(url.searchParams.get("audit_limit") || DEFAULT_AUDIT_LIMIT, 10), 1), MAX_AUDIT_LIMIT);
        const trendKeys = (url.searchParams.get("trends_keys") || DEFAULT_TREND_KEYS.join(","))
            .split(",").map(s => s.trim()).filter(Boolean);

        // ============================================================
        // 1. Patient row.
        // ============================================================
        const patient = await env.DB.prepare(`
            SELECT id, email, phone, first_name, last_name, preferred_name,
                   dob, mrn, pronouns, preferred_language, timezone,
                   email_verified_at, status, created_at, updated_at
            FROM patients WHERE id = ?
        `).bind(patient_id).first();
        if (!patient) return jsonError("patient_not_found", 404);

        // ============================================================
        // 2. Intake (latest only) + every saved section payload.
        // ============================================================
        const intakeRow = await env.DB.prepare(`
            SELECT id, status, locale, started_at, submitted_at, reviewed_at,
                   reviewed_by_clinician_id, updated_at, completion_pct
            FROM intake_responses WHERE patient_id = ?
            ORDER BY started_at DESC LIMIT 1
        `).bind(patient_id).first();

        let intakeSections = [];
        if (intakeRow) {
            const r = await env.DB.prepare(`
                SELECT section_number, section_key, data_json, last_updated_at
                FROM intake_section_data WHERE intake_id = ?
                ORDER BY section_number ASC
            `).bind(intakeRow.id).all();
            intakeSections = (r?.results || []).map(s => {
                let data = {};
                try { data = JSON.parse(s.data_json || "{}"); } catch {}
                return {
                    section_number: s.section_number,
                    section_key: s.section_key,
                    last_updated_at: s.last_updated_at,
                    data,
                };
            });
        }

        // ============================================================
        // 3. Triage history (all, newest first).
        // ============================================================
        const triageRes = await env.DB.prepare(`
            SELECT id, intake_id, ai_prompt_version, ai_visit_type, ai_duration_min,
                   ai_urgency, ai_in_person_required, ai_preferred_time_of_day,
                   ai_rationale, ai_secondary_concerns_json,
                   clinician_override_visit_type, clinician_override_duration_min,
                   clinician_override_reason, clinician_reviewed_at, clinician_reviewer_id,
                   final_visit_type, final_duration_min, appointment_id,
                   actual_visit_type, actual_duration_min,
                   created_at, updated_at
            FROM appointment_triage WHERE patient_id = ?
            ORDER BY created_at DESC
        `).bind(patient_id).all();
        const triage_history = (triageRes?.results || []).map(t => ({
            ...t,
            ai_secondary_concerns: safeJson(t.ai_secondary_concerns_json) || [],
            ai_secondary_concerns_json: undefined,
        }));

        // ============================================================
        // 4. Appointments split into upcoming + past.
        // ============================================================
        const nowMs = Date.now();
        // Phase 17 R5 (Sprint 1 close-out): join the most-recent device/
        // connection tech-check per UPCOMING appointment so the case page
        // can show a "device check passed / failed / not yet run" badge.
        // Correlated subquery on idx_tech_check_appointment — one row each,
        // no N+1. Past appointments don't need it (the visit already ran).
        const upcomingRes = await env.DB.prepare(`
            SELECT a.id, a.visit_type, a.starts_at, a.ends_at, a.duration_min, a.modality,
                   a.status, a.doxy_room_url, a.doxy_join_logged_at,
                   a.chief_complaint_summary, a.triage_id, a.created_at,
                   tc.overall_ok AS tc_overall_ok, tc.network_kbps AS tc_network_kbps,
                   tc.failure_reasons_json AS tc_failure_reasons_json,
                   tc.checked_at AS tc_checked_at
            FROM appointments a
            LEFT JOIN tech_check_results tc ON tc.id = (
                SELECT id FROM tech_check_results
                WHERE appointment_id = a.id
                ORDER BY checked_at DESC, id DESC LIMIT 1
            )
            WHERE a.patient_id = ? AND a.starts_at >= ?
            ORDER BY a.starts_at ASC LIMIT 20
        `).bind(patient_id, nowMs).all();
        const pastRes = await env.DB.prepare(`
            SELECT id, visit_type, starts_at, ends_at, duration_min, modality,
                   status, cancellation_reason, chief_complaint_summary, triage_id, created_at
            FROM appointments
            WHERE patient_id = ? AND starts_at < ?
            ORDER BY starts_at DESC LIMIT 20
        `).bind(patient_id, nowMs).all();

        // ============================================================
        // 5. Messages — list threads + clinician unread total.
        // ============================================================
        const threadRes = await env.DB.prepare(`
            SELECT id, subject, last_message_at, last_message_from_role,
                   last_message_preview, clinician_unread_count, patient_unread_count,
                   status, related_appointment_id, related_intake_id,
                   created_at, updated_at
            FROM message_threads WHERE patient_id = ?
            ORDER BY last_message_at DESC LIMIT 40
        `).bind(patient_id).all();
        const unreadForClinician = (threadRes?.results || []).reduce((s, t) => s + (t.clinician_unread_count || 0), 0);

        // ============================================================
        // 6. Symptoms — diary range + dense trends for chart keys.
        // ============================================================
        const today = isoToday();
        const from = addDaysISO(today, -(symptomDays - 1));
        const diaryRes = await env.DB.prepare(`
            SELECT entry_date, values_json, note, updated_at
            FROM symptom_diary_entries
            WHERE patient_id = ? AND entry_date >= ?
            ORDER BY entry_date ASC
        `).bind(patient_id, from).all();
        const diary = (diaryRes?.results || []).map(r => ({
            entry_date: r.entry_date,
            values: safeJson(r.values_json) || {},
            note: r.note,
            updated_at: r.updated_at,
        }));

        // Build dense series for each trend key.
        const trends = {};
        for (const key of trendKeys) {
            const byDate = new Map();
            for (const e of diary) {
                const raw = e.values[key];
                let v = null;
                if (raw === null || raw === undefined) v = null;
                else if (typeof raw === "boolean") v = raw ? 1 : 0;
                else if (Array.isArray(raw)) v = raw.length;
                else if (Number.isFinite(Number(raw))) v = Number(raw);
                if (v !== null) byDate.set(e.entry_date, v);
            }
            const series = [];
            let cur = from;
            while (cur <= today) {
                series.push({ date: cur, value: byDate.has(cur) ? byDate.get(cur) : null });
                cur = addDaysISO(cur, 1);
            }
            trends[key] = series;
        }

        // ============================================================
        // 7. Education — assignments + per-assignment view state.
        // ============================================================
        const eduRes = await env.DB.prepare(`
            SELECT a.id AS assignment_id, a.material_id, a.assigned_by_role,
                   a.assigned_by_id, a.reason, a.assigned_at,
                   a.first_opened_at, a.completed_at,
                   m.slug, m.title, m.summary, m.topic_tags_json,
                   m.target_audience, m.status, m.published_at,
                   v.view_count, v.first_viewed_at, v.last_viewed_at, v.completed
            FROM patient_education_assignments a
            LEFT JOIN education_materials m ON m.id = a.material_id
            LEFT JOIN patient_content_views v
                ON v.patient_id = a.patient_id
               AND v.content_kind = 'education_material'
               AND v.content_id = m.slug
            WHERE a.patient_id = ?
            ORDER BY a.assigned_at DESC
        `).bind(patient_id).all();
        const assignments = (eduRes?.results || []).map(a => ({
            assignment_id: a.assignment_id,
            material_id: a.material_id,
            slug: a.slug,
            title: a.title,
            summary: a.summary,
            topic_tags: safeJson(a.topic_tags_json) || [],
            target_audience: a.target_audience,
            material_status: a.status,
            published_at: a.published_at,
            assigned_by_role: a.assigned_by_role,
            assigned_by_id: a.assigned_by_id,
            reason: a.reason,
            assigned_at: a.assigned_at,
            first_opened_at: a.first_opened_at,
            completed_at: a.completed_at,
            view_count: a.view_count || 0,
        }));

        // ============================================================
        // 8. Documents.
        // ============================================================
        const docRes = await env.DB.prepare(`
            SELECT id, kind, filename, mime_type, size_bytes, sha256,
                   uploaded_by_role, source_app, description, uploaded_at
            FROM documents WHERE patient_id = ?
            ORDER BY uploaded_at DESC LIMIT 50
        `).bind(patient_id).all();

        // ============================================================
        // 9. Recent audit timeline scoped to this patient or any of
        //    their records (intake_id / triage_id / appointment_id /
        //    thread_id / etc.). Patient-id direct match catches almost
        //    everything; we also OR-in record_ids of their intakes
        //    and triage rows to catch staff-driven events.
        // ============================================================
        const recordIds = [
            patient_id,
            ...(intakeRow ? [intakeRow.id] : []),
            ...triage_history.map(t => t.id),
            ...(upcomingRes?.results || []).map(a => a.id),
            ...(pastRes?.results || []).map(a => a.id),
            ...(threadRes?.results || []).map(t => t.id),
            ...(eduRes?.results || []).map(e => e.material_id).filter(Boolean),
        ].filter(Boolean);
        const placeholders = recordIds.map(() => "?").join(",") || "''";
        const auditRes = recordIds.length > 0
            ? await env.DB.prepare(`
                SELECT id, ts, user_id, user_role, action, record_type, record_id,
                       success, details_json
                FROM audit_log
                WHERE user_id = ? OR record_id IN (${placeholders})
                ORDER BY ts DESC LIMIT ?
            `).bind(patient_id, ...recordIds, auditLimit).all()
            : { results: [] };
        const audit = (auditRes?.results || []).map(a => ({
            id: a.id,
            user_id: a.user_id,
            user_role: a.user_role,
            action: a.action,
            record_type: a.record_type,
            record_id: a.record_id,
            success: !!a.success,
            details: safeJson(a.details_json) || null,
            ts: a.ts,
        }));

        return jsonResponse({
            patient: {
                ...patient,
                age_years: ageYears(patient.dob),
                display_name: [patient.preferred_name || patient.first_name, patient.last_name].filter(Boolean).join(" "),
            },
            intake: intakeRow ? {
                ...intakeRow,
                section_count: intakeSections.length,
                sections: intakeSections,
            } : null,
            triage_history,
            appointments: {
                upcoming: (upcomingRes?.results || []).map(withDeviceCheck),
                past: pastRes?.results || [],
            },
            messages: {
                threads: threadRes?.results || [],
                unread_for_clinician: unreadForClinician,
            },
            symptoms: {
                window: { from, to: today, days: symptomDays },
                entry_count: diary.length,
                diary,
                trends,
            },
            education: {
                assignments,
                completed_count: assignments.filter(a => a.completed_at).length,
            },
            documents: docRes?.results || [],
            audit,
        });
    });
}

function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }

// Phase 17 R5 — fold the joined latest-tech-check columns (tc_*) into a
// compact `device_check` object and strip the raw columns from the row.
// Returns { status: "passed"|"failed", checked_at, network_kbps, failures }
// or null when no tech-check has been run for the appointment.
function withDeviceCheck(row) {
    const { tc_overall_ok, tc_network_kbps, tc_failure_reasons_json, tc_checked_at, ...rest } = row;
    let device_check = null;
    if (tc_checked_at != null) {
        let failures = [];
        const parsed = safeJson(tc_failure_reasons_json);
        if (Array.isArray(parsed)) failures = parsed.slice(0, 6);
        device_check = {
            status: tc_overall_ok ? "passed" : "failed",
            checked_at: tc_checked_at,
            network_kbps: tc_network_kbps,
            failures,
        };
    }
    return { ...rest, device_check };
}
