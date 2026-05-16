// =====================================================================
// GET / PATCH /api/v1/admin/patients/<id>
// =====================================================================
// Clinician-side patient detail. Returns the patients row plus light
// joined context (latest intake status, latest triage state, next
// scheduled appointment, unread message count). Heavy aggregation —
// section data, symptom history, documents, audit timeline — lives
// on /api/v1/admin/cases/<patient_id>.
//
// PATCH accepts a small allowlist of clinician-editable fields
// (preferred_name, phone, status). Identity fields (email, DOB, names)
// are NOT editable here — those need a clinician sign-off ritual that
// Phase 5 doesn't include yet.
// =====================================================================

import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../../_lib/admin_api.js";
import { logAudit } from "../../../../_lib/audit.js";
import { now } from "../../../../_lib/db.js";

const ALLOWED_PATCH = new Set(["preferred_name", "phone", "pronouns", "preferred_language", "timezone", "mrn", "status"]);
const ALLOWED_STATUS = new Set(["active", "suspended", "closed"]);

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

async function loadPatient(env, id) {
    return env.DB.prepare(`
        SELECT id, email, phone, first_name, last_name, preferred_name,
               dob, mrn, pronouns, preferred_language, timezone,
               password_hash IS NOT NULL AS has_password,
               email_verified_at, status, created_at, updated_at
        FROM patients WHERE id = ?
    `).bind(id).first();
}

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env }) => {
        const id = String(ctx.params?.id || "");
        if (!id) return jsonError("missing_id", 400);
        const p = await loadPatient(env, id);
        if (!p) return jsonError("patient_not_found", 404);

        // Quick joined context for the patient header.
        const intake = await env.DB.prepare(`
            SELECT id, status, started_at, submitted_at, completion_pct
            FROM intake_responses WHERE patient_id = ?
            ORDER BY started_at DESC LIMIT 1
        `).bind(id).first();

        const triage = await env.DB.prepare(`
            SELECT id, ai_visit_type, final_visit_type, ai_urgency,
                   clinician_reviewed_at, appointment_id, created_at
            FROM appointment_triage WHERE patient_id = ?
            ORDER BY created_at DESC LIMIT 1
        `).bind(id).first();

        const nextAppt = await env.DB.prepare(`
            SELECT id, visit_type, starts_at, ends_at, modality, status, doxy_room_url
            FROM appointments
            WHERE patient_id = ? AND status = 'scheduled' AND starts_at >= ?
            ORDER BY starts_at ASC LIMIT 1
        `).bind(id, Date.now()).first();

        const lastAppt = await env.DB.prepare(`
            SELECT id, visit_type, starts_at, status
            FROM appointments WHERE patient_id = ? AND starts_at < ?
            ORDER BY starts_at DESC LIMIT 1
        `).bind(id, Date.now()).first();

        const unreadRow = await env.DB.prepare(`
            SELECT COALESCE(SUM(clinician_unread_count), 0) AS unread,
                   COUNT(*) AS thread_count
            FROM message_threads WHERE patient_id = ?
        `).bind(id).first();

        const symptomRow = await env.DB.prepare(`
            SELECT COUNT(*) AS n,
                   MAX(entry_date) AS latest_entry_date,
                   MIN(entry_date) AS earliest_entry_date
            FROM symptom_diary_entries WHERE patient_id = ?
        `).bind(id).first();

        const docRow = await env.DB.prepare(`
            SELECT COUNT(*) AS n FROM documents WHERE patient_id = ?
        `).bind(id).first();

        return jsonResponse({
            patient: {
                ...p,
                has_password: !!p.has_password,
                age_years: ageYears(p.dob),
                display_name: [p.preferred_name || p.first_name, p.last_name].filter(Boolean).join(" "),
            },
            summary: {
                intake: intake ? {
                    id: intake.id, status: intake.status,
                    started_at: intake.started_at, submitted_at: intake.submitted_at,
                    completion_pct: intake.completion_pct,
                } : null,
                triage: triage ? {
                    id: triage.id,
                    visit_type: triage.final_visit_type || triage.ai_visit_type,
                    urgency: triage.ai_urgency,
                    reviewed: !!triage.clinician_reviewed_at,
                    booked: !!triage.appointment_id,
                    created_at: triage.created_at,
                } : null,
                next_appointment: nextAppt || null,
                last_appointment: lastAppt || null,
                messages: {
                    thread_count: unreadRow?.thread_count || 0,
                    unread_for_clinician: unreadRow?.unread || 0,
                },
                symptoms: {
                    entry_count: symptomRow?.n || 0,
                    latest_entry_date: symptomRow?.latest_entry_date || null,
                    earliest_entry_date: symptomRow?.earliest_entry_date || null,
                },
                documents: { count: docRow?.n || 0 },
            },
        });
    });
}

export async function onRequestPatch(ctx) {
    return adminRoute(ctx, async ({ env, request, admin }) => {
        const id = String(ctx.params?.id || "");
        if (!id) return jsonError("missing_id", 400);
        const p = await loadPatient(env, id);
        if (!p) return jsonError("patient_not_found", 404);

        const body = await readJsonBody(request);
        const update = {};
        for (const k of Object.keys(body || {})) {
            if (!ALLOWED_PATCH.has(k)) continue;
            const v = body[k];
            if (k === "status") {
                if (!ALLOWED_STATUS.has(v)) return jsonError("invalid_status", 400);
                update[k] = v;
            } else if (v === null) {
                update[k] = null;
            } else if (typeof v === "string") {
                const t = v.trim();
                update[k] = t.length > 0 ? t.slice(0, 200) : null;
            } else {
                return jsonError("invalid_value", 400, { field: k });
            }
        }
        if (Object.keys(update).length === 0) return jsonError("no_allowed_fields_to_update", 400);

        const t = now();
        update.updated_at = t;
        const cols = Object.keys(update);
        const set = cols.map(c => `${c} = ?`).join(", ");
        const binds = cols.map(c => update[c]);
        binds.push(id);

        await env.DB.prepare(`UPDATE patients SET ${set} WHERE id = ?`).bind(...binds).run();

        await logAudit(env, {
            user_id: admin.user, user_role: admin.role,
            action: "patient_update",
            record_type: "patient",
            record_id: id,
            ip: request.headers.get("CF-Connecting-IP") || "",
            user_agent: request.headers.get("User-Agent") || "",
            success: true,
            details: { fields_changed: cols.filter(c => c !== "updated_at") },
        });

        const after = await loadPatient(env, id);
        return jsonResponse({
            ok: true,
            patient: { ...after, age_years: ageYears(after.dob) },
        });
    });
}
