// =====================================================================
// GET /api/v1/admin/analytics — practice-wide dashboard data
// =====================================================================
// Cross-patient aggregations rendered on /admin/analytics. Single
// round-trip; UI renders multiple panels from the same payload.
//
// Returns:
//   {
//     window: { from, to, days },
//     totals: { patients, intakes_in_progress, intakes_submitted,
//               appointments_total, appointments_upcoming, appointments_completed,
//               messages_threads, messages_unread_for_clinician,
//               symptom_entries_window, documents, education_published, education_assigned },
//     intake_funnel: { started, in_progress, submitted, reviewed },
//     triage: { total, pending, released, booked, manual_review_required,
//               by_visit_type: [{ visit_type, count }, ...],
//               by_urgency: [{ urgency, count }, ...] },
//     appointments: { upcoming_by_modality: { in_person, telehealth },
//                     by_status: [{ status, count }],
//                     by_visit_type: [{ visit_type, count }],
//                     next_5: [...] },
//     messaging_activity: { messages_window, clinician_replies_window,
//                           threads_with_unread, oldest_unread_thread_ms },
//     symptom_signals: { unique_patients_logging, recent_pain_avg,
//                        recent_pain_high_count, urgent_pain_patients: [...] },
//     audit_signals: { events_window_total, by_action: [{ action, count }] },
//   }
//
// Query: window=14|30|90  (days, default 30).
// =====================================================================

import { adminRoute, jsonResponse, jsonError } from "../../../_lib/admin_api.js";

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env, request }) => {
        const url = new URL(request.url);
        const win = Math.min(Math.max(parseInt(url.searchParams.get("window") || "30", 10), 1), 365);
        const nowMs = Date.now();
        const fromMs = nowMs - win * 24 * 3600 * 1000;
        const today = isoToday();
        const from = addDaysISO(today, -(win - 1));

        // ---- totals ----
        const totals = {
            patients:                          await scalar(env, `SELECT COUNT(*) AS n FROM patients`),
            intakes_in_progress:               await scalar(env, `SELECT COUNT(*) AS n FROM intake_responses WHERE status = 'in_progress'`),
            intakes_submitted:                 await scalar(env, `SELECT COUNT(*) AS n FROM intake_responses WHERE status IN ('submitted','reviewed')`),
            appointments_total:                await scalar(env, `SELECT COUNT(*) AS n FROM appointments`),
            appointments_upcoming:             await scalarBind(env, `SELECT COUNT(*) AS n FROM appointments WHERE status='scheduled' AND starts_at >= ?`, [nowMs]),
            appointments_completed:            await scalar(env, `SELECT COUNT(*) AS n FROM appointments WHERE status='completed'`),
            messages_threads:                  await scalar(env, `SELECT COUNT(*) AS n FROM message_threads`),
            messages_unread_for_clinician:     await scalar(env, `SELECT COALESCE(SUM(clinician_unread_count), 0) AS n FROM message_threads`),
            symptom_entries_window:            await scalarBind(env, `SELECT COUNT(*) AS n FROM symptom_diary_entries WHERE entry_date >= ?`, [from]),
            documents:                         await scalar(env, `SELECT COUNT(*) AS n FROM documents`),
            education_published:               await scalar(env, `SELECT COUNT(*) AS n FROM education_materials WHERE status = 'published'`),
            education_assigned:                await scalar(env, `SELECT COUNT(*) AS n FROM patient_education_assignments`),
        };

        // ---- intake funnel ----
        const intake_funnel = {
            started:     await scalar(env, `SELECT COUNT(*) AS n FROM intake_responses`),
            in_progress: await scalar(env, `SELECT COUNT(*) AS n FROM intake_responses WHERE status = 'in_progress'`),
            submitted:   await scalar(env, `SELECT COUNT(*) AS n FROM intake_responses WHERE status = 'submitted'`),
            reviewed:    await scalar(env, `SELECT COUNT(*) AS n FROM intake_responses WHERE status = 'reviewed'`),
        };

        // ---- triage breakdown ----
        const triage = {
            total:                       await scalar(env, `SELECT COUNT(*) AS n FROM appointment_triage`),
            pending:                     await scalar(env, `SELECT COUNT(*) AS n FROM appointment_triage WHERE clinician_reviewed_at IS NULL`),
            released:                    await scalar(env, `SELECT COUNT(*) AS n FROM appointment_triage WHERE clinician_reviewed_at IS NOT NULL`),
            booked:                      await scalar(env, `SELECT COUNT(*) AS n FROM appointment_triage WHERE appointment_id IS NOT NULL`),
            manual_review_required:      await scalar(env, `SELECT COUNT(*) AS n FROM appointment_triage WHERE ai_visit_type = 'manual_review_required'`),
            by_visit_type: ((await env.DB.prepare(`
                SELECT COALESCE(final_visit_type, ai_visit_type) AS visit_type, COUNT(*) AS count
                FROM appointment_triage
                GROUP BY COALESCE(final_visit_type, ai_visit_type)
                ORDER BY count DESC
            `).all())?.results || []),
            by_urgency: ((await env.DB.prepare(`
                SELECT ai_urgency AS urgency, COUNT(*) AS count
                FROM appointment_triage
                GROUP BY ai_urgency
                ORDER BY count DESC
            `).all())?.results || []),
        };

        // ---- appointments breakdown ----
        const upcomingByModality = await env.DB.prepare(`
            SELECT modality, COUNT(*) AS count
            FROM appointments
            WHERE status = 'scheduled' AND starts_at >= ?
            GROUP BY modality
        `).bind(nowMs).all();
        const apptByStatus = await env.DB.prepare(`
            SELECT status, COUNT(*) AS count FROM appointments GROUP BY status ORDER BY count DESC
        `).all();
        const apptByVisitType = await env.DB.prepare(`
            SELECT visit_type, COUNT(*) AS count FROM appointments GROUP BY visit_type ORDER BY count DESC
        `).all();
        const next5 = await env.DB.prepare(`
            SELECT a.id, a.visit_type, a.starts_at, a.ends_at, a.duration_min,
                   a.modality, a.status, a.patient_id,
                   p.first_name, p.last_name
            FROM appointments a
            LEFT JOIN patients p ON p.id = a.patient_id
            WHERE a.status = 'scheduled' AND a.starts_at >= ?
            ORDER BY a.starts_at ASC LIMIT 5
        `).bind(nowMs).all();
        const upMod = (upcomingByModality?.results || []).reduce((m, r) => { m[r.modality] = r.count; return m; }, {});
        const appointments = {
            upcoming_by_modality: { in_person: upMod.in_person || 0, telehealth: upMod.telehealth || 0 },
            by_status: apptByStatus?.results || [],
            by_visit_type: apptByVisitType?.results || [],
            next_5: (next5?.results || []).map(a => ({
                ...a,
                patient_name: [a.first_name, a.last_name].filter(Boolean).join(" "),
            })),
        };

        // ---- messaging activity (in window) ----
        const messaging_activity = {
            messages_window: await scalarBind(env, `SELECT COUNT(*) AS n FROM messages WHERE created_at >= ?`, [fromMs]),
            clinician_replies_window: await scalarBind(env, `SELECT COUNT(*) AS n FROM messages WHERE created_at >= ? AND from_role IN ('clinician','staff')`, [fromMs]),
            threads_with_unread: await scalar(env, `SELECT COUNT(*) AS n FROM message_threads WHERE clinician_unread_count > 0`),
            oldest_unread_thread_at: await scalar(env, `SELECT MIN(last_message_at) AS n FROM message_threads WHERE clinician_unread_count > 0`),
        };

        // ---- symptom signals ----
        // Average pelvic_pain_0_10 across all recent entries in the window
        // (interpreted from values_json). To avoid pulling and parsing
        // every JSON in SQL we do it in JS over the row results.
        const recentSymp = await env.DB.prepare(`
            SELECT patient_id, entry_date, values_json
            FROM symptom_diary_entries
            WHERE entry_date >= ?
        `).bind(addDaysISO(today, -6)).all();
        const recentRows = recentSymp?.results || [];
        const uniquePatients = new Set(recentRows.map(r => r.patient_id));
        let painSum = 0, painN = 0;
        const painHighPatients = new Map();
        for (const r of recentRows) {
            try {
                const v = JSON.parse(r.values_json || "{}");
                const pain = Number(v.pelvic_pain_0_10);
                if (Number.isFinite(pain)) {
                    painSum += pain; painN++;
                    if (pain >= 8) {
                        const prev = painHighPatients.get(r.patient_id) || { pain_max: 0, latest_date: "" };
                        painHighPatients.set(r.patient_id, {
                            pain_max: Math.max(prev.pain_max, pain),
                            latest_date: prev.latest_date > r.entry_date ? prev.latest_date : r.entry_date,
                        });
                    }
                }
            } catch {}
        }
        const urgentPainIds = [...painHighPatients.keys()];
        let urgentPainPatients = [];
        if (urgentPainIds.length > 0) {
            const ph = urgentPainIds.map(() => "?").join(",");
            const pRes = await env.DB.prepare(`
                SELECT id, first_name, last_name, email FROM patients WHERE id IN (${ph})
            `).bind(...urgentPainIds).all();
            urgentPainPatients = (pRes?.results || []).map(p => ({
                id: p.id,
                name: [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email,
                email: p.email,
                pain_max: painHighPatients.get(p.id)?.pain_max,
                latest_date: painHighPatients.get(p.id)?.latest_date,
            })).sort((a, b) => b.pain_max - a.pain_max);
        }
        const symptom_signals = {
            unique_patients_logging_last_7d: uniquePatients.size,
            recent_pain_avg: painN > 0 ? Math.round((painSum / painN) * 10) / 10 : null,
            recent_pain_high_count: painHighPatients.size,
            urgent_pain_patients: urgentPainPatients,
        };

        // ---- audit signals (window) ----
        const auditByAction = await env.DB.prepare(`
            SELECT action, COUNT(*) AS count FROM audit_log
            WHERE ts >= ?
            GROUP BY action ORDER BY count DESC LIMIT 20
        `).bind(fromMs).all();
        const audit_signals = {
            events_window_total: await scalarBind(env, `SELECT COUNT(*) AS n FROM audit_log WHERE ts >= ?`, [fromMs]),
            by_action: auditByAction?.results || [],
        };

        return jsonResponse({
            window: { from, to: today, days: win },
            totals,
            intake_funnel,
            triage,
            appointments,
            messaging_activity,
            symptom_signals,
            audit_signals,
        });
    });
}

// ---------------------------------------------------------------------
// Small SQL helpers.
// ---------------------------------------------------------------------
async function scalar(env, sql) {
    const r = await env.DB.prepare(sql).first();
    return r?.n ?? 0;
}
async function scalarBind(env, sql, binds) {
    const r = await env.DB.prepare(sql).bind(...binds).first();
    return r?.n ?? 0;
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
