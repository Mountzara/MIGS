// =====================================================================
// functions/_lib/patient_briefing.js
// =====================================================================
// Phase 14 Round B — pre-visit briefing engine.
//
// Composes a comprehensive-but-efficient pre-visit briefing object from
// everything we have on a patient:
//   • Profile (incl. Phase 14 humanization: nickname, photo_url, care_goals)
//   • Intake responses (most-recent submitted)
//   • Recent encounters (last 5 by visit_date)
//   • PROM trends (Tier-1 scores: PHQ-2, GAD-2, BPI-SF, EHP-5)
//   • Existing Phase 9 AI snapshot (problem list, timeline, action items)
//   • Personal notes (Phase 14 Round A — pinned first)
//   • Today's / upcoming appointment context
//
// Returns a single structured JSON object the briefing UI can render
// directly OR pass to an LLM for narrative expansion. No PHI leaves the
// Worker — every field comes from D1 + R2 with the same admin auth gate
// as /admin/cases/<id>.
//
// Per CLAUDE.md §12.2 BAA gating: this module does NOT call the Anthropic
// API. The structured object is the deliverable; the existing
// /api/v1/admin/snapshots endpoint already provides the LLM-narrated
// clinical narrative and gets injected here as the `snapshot_summary`
// section.
// =====================================================================

import { getPhiObject } from "./phi.js";

const RECENT_ENCOUNTER_LIMIT = 5;
const RECENT_PROM_WINDOW_MS = 1000 * 60 * 60 * 24 * 365;   // 12 months
const APPT_CONTEXT_WINDOW_MS = 1000 * 60 * 60 * 24 * 90;   // ±90 days


function safeJson(s) {
    if (!s || typeof s !== "string") return null;
    try { return JSON.parse(s); } catch { return null; }
}

function ageFromDob(dob) {
    if (!dob) return null;
    const d = new Date(dob);
    if (Number.isNaN(d.getTime())) return null;
    const now = new Date();
    let age = now.getUTCFullYear() - d.getUTCFullYear();
    const mo = now.getUTCMonth() - d.getUTCMonth();
    if (mo < 0 || (mo === 0 && now.getUTCDate() < d.getUTCDate())) age -= 1;
    return age;
}


// ---------------------------------------------------------------------
// Per-patient data assemblers
// ---------------------------------------------------------------------

async function loadPatientHeader(env, patientId) {
    const row = await env.DB.prepare(`
        SELECT id, email, phone, first_name, last_name, preferred_name,
               nickname, dob, pronouns, preferred_language, timezone,
               status, photo_r2_key, photo_uploaded_at,
               care_goals_json, care_goals_updated_at,
               created_at
        FROM patients
        WHERE id = ?
    `).bind(patientId).first();
    if (!row) return null;
    const care_goals = safeJson(row.care_goals_json);
    return {
        id: row.id,
        first_name: row.first_name,
        last_name: row.last_name,
        preferred_name: row.preferred_name || null,
        nickname: row.nickname || null,
        display_name: row.nickname || row.preferred_name || row.first_name || "",
        full_name: `${row.first_name || ""} ${row.last_name || ""}`.trim(),
        pronouns: row.pronouns || null,
        preferred_language: row.preferred_language || "en",
        age: ageFromDob(row.dob),
        dob: row.dob,
        photo_url: row.photo_r2_key ? `/api/v1/admin/patients/${row.id}/photo` : null,
        photo_uploaded_at: row.photo_uploaded_at || null,
        care_goals,
        care_goals_updated_at: row.care_goals_updated_at || null,
        member_since: row.created_at || null,
    };
}


async function loadLatestIntake(env, patientId) {
    const intake = await env.DB.prepare(`
        SELECT id, status, submitted_at, triage_id, current_section, completion_pct, sections_complete_count
        FROM intake_responses
        WHERE patient_id = ?
        ORDER BY (submitted_at IS NOT NULL) DESC, COALESCE(submitted_at, updated_at) DESC
        LIMIT 1
    `).bind(patientId).first();
    if (!intake) return null;
    return {
        id: intake.id,
        status: intake.status,
        submitted_at: intake.submitted_at,
        completion_pct: intake.completion_pct,
        sections_complete_count: intake.sections_complete_count || 0,
        current_section: intake.current_section || null,
        triage_id: intake.triage_id || null,
    };
}


async function loadIntakeTriage(env, triageId) {
    if (!triageId) return null;
    const t = await env.DB.prepare(`
        SELECT id, visit_type, estimated_duration_min, urgency, in_person_required,
               preferred_time_of_day, rationale, secondary_concerns_json,
               clinician_override_visit_type, status, created_at
        FROM appointment_triage
        WHERE id = ?
    `).bind(triageId).first();
    if (!t) return null;
    return {
        id: t.id,
        visit_type: t.clinician_override_visit_type || t.visit_type,
        ai_visit_type: t.visit_type,
        clinician_override_visit_type: t.clinician_override_visit_type || null,
        estimated_duration_min: t.estimated_duration_min || null,
        urgency: t.urgency || null,
        in_person_required: !!t.in_person_required,
        preferred_time_of_day: t.preferred_time_of_day || null,
        rationale: t.rationale || null,
        secondary_concerns: safeJson(t.secondary_concerns_json) || [],
        status: t.status || null,
    };
}


async function loadRecentEncounters(env, patientId) {
    const { results } = await env.DB.prepare(`
        SELECT id, visit_date, visit_type_actual, chief_complaint,
               omt_codes_json, cpt_codes_json, icd10_codes_json
        FROM encounters
        WHERE patient_id = ?
        ORDER BY visit_date DESC
        LIMIT ?
    `).bind(patientId, RECENT_ENCOUNTER_LIMIT).all();
    return (results || []).map((e) => ({
        id: e.id,
        visit_date: e.visit_date,
        visit_type: e.visit_type_actual,
        chief_complaint: e.chief_complaint || null,
        omt_codes: safeJson(e.omt_codes_json) || [],
        cpt_codes: safeJson(e.cpt_codes_json) || [],
        icd10_codes: safeJson(e.icd10_codes_json) || [],
    }));
}


async function loadPROMTrends(env, patientId) {
    // Pull most-recent two scores per assignment, grouped by prom_slug,
    // limited to the last 12 months. We surface trend direction + delta.
    const cutoff = Date.now() - RECENT_PROM_WINDOW_MS;
    const { results } = await env.DB.prepare(`
        SELECT pr.id AS response_id, pr.assignment_id, pr.prom_slug,
               pr.score_total, pr.score_interpretation, pr.completed_at,
               pa.period_label, pa.assigned_by_kind,
               pd.short_name, pd.title, pd.tier, pd.domain
        FROM prom_responses pr
        JOIN prom_assignments pa ON pa.id = pr.assignment_id
        LEFT JOIN prom_definitions pd ON pd.slug = pr.prom_slug
        WHERE pr.patient_id = ? AND pr.completed_at >= ?
        ORDER BY pr.prom_slug, pr.completed_at DESC
    `).bind(patientId, cutoff).all();
    const rows = results || [];

    // Group by prom_slug
    const groups = new Map();
    for (const r of rows) {
        if (!groups.has(r.prom_slug)) groups.set(r.prom_slug, []);
        groups.get(r.prom_slug).push(r);
    }

    const trends = [];
    for (const [slug, list] of groups.entries()) {
        const latest = list[0];
        const previous = list[1] || null;
        const delta = (latest && previous && Number.isFinite(latest.score_total) && Number.isFinite(previous.score_total))
            ? latest.score_total - previous.score_total
            : null;
        trends.push({
            slug,
            short_name: latest.short_name || slug.toUpperCase(),
            title: latest.title || slug,
            tier: latest.tier,
            domain: latest.domain,
            latest_score: latest.score_total,
            latest_interpretation: latest.score_interpretation,
            latest_completed_at: latest.completed_at,
            latest_period: latest.period_label,
            previous_score: previous ? previous.score_total : null,
            previous_completed_at: previous ? previous.completed_at : null,
            delta,
            direction: delta == null ? null : (delta < 0 ? "improved" : delta > 0 ? "worsened" : "stable"),
            total_completions: list.length,
        });
    }
    // Sort PHQ-2 / GAD-2 / BPI-SF first (tier 1), then by latest_completed_at desc.
    trends.sort((a, b) => {
        if ((a.tier || 9) !== (b.tier || 9)) return (a.tier || 9) - (b.tier || 9);
        return (b.latest_completed_at || 0) - (a.latest_completed_at || 0);
    });
    return trends;
}


async function loadCurrentSnapshot(env, patientId) {
    // Returns the most-recent is_current=1 snapshot's executive_summary +
    // problem list + action items. We do NOT re-decrypt the full snapshot
    // body here — the briefing widget can deep-link to /admin/snapshots/<id>
    // for the full document.
    const snapshot = await env.DB.prepare(`
        SELECT id, version_number, is_current,
               executive_summary, narrative_summary,
               problem_count, action_item_count,
               generated_at, last_event_id_seen
        FROM patient_snapshots
        WHERE patient_id = ? AND is_current = 1
        ORDER BY version_number DESC
        LIMIT 1
    `).bind(patientId).first();
    if (!snapshot) return null;

    const [pR, aR] = await Promise.all([
        env.DB.prepare(`
            SELECT label, status, severity, seq
            FROM snapshot_problem_list
            WHERE snapshot_id = ?
            ORDER BY seq ASC
            LIMIT 12
        `).bind(snapshot.id).all(),
        env.DB.prepare(`
            SELECT label, due_at, priority, status, seq
            FROM snapshot_action_items
            WHERE snapshot_id = ?
            ORDER BY seq ASC
            LIMIT 8
        `).bind(snapshot.id).all(),
    ]);

    return {
        id: snapshot.id,
        version_number: snapshot.version_number,
        executive_summary: snapshot.executive_summary || null,
        narrative_summary: snapshot.narrative_summary || null,
        problem_count: snapshot.problem_count || 0,
        action_item_count: snapshot.action_item_count || 0,
        generated_at: snapshot.generated_at,
        problems_preview: pR.results || [],
        action_items_preview: aR.results || [],
    };
}


async function loadPersonalNotes(env, patientId) {
    const { results } = await env.DB.prepare(`
        SELECT id, category, summary, body_r2_key, body_wrapped_dek,
               is_pinned, body_size_bytes, created_at, updated_at
        FROM patient_personal_notes
        WHERE patient_id = ?
        ORDER BY is_pinned DESC, updated_at DESC
        LIMIT 20
    `).bind(patientId).all();
    const rows = results || [];
    const out = [];
    for (const r of rows) {
        let body = "";
        try {
            const aad = `patient-personal-note/${patientId}/${r.id}`;
            const bytes = await getPhiObject(env, r.body_r2_key, r.body_wrapped_dek, aad);
            if (bytes) body = new TextDecoder().decode(bytes);
        } catch (e) {
            body = `[decrypt failed: ${(e.message || e).toString().slice(0, 60)}]`;
        }
        out.push({
            id: r.id,
            category: r.category,
            summary: r.summary || "",
            body,
            is_pinned: !!r.is_pinned,
            created_at: r.created_at,
            updated_at: r.updated_at,
        });
    }
    return out;
}


async function loadAppointmentContext(env, patientId, focusAppointmentId) {
    const now = Date.now();
    const lookbackCutoff = now - APPT_CONTEXT_WINDOW_MS;
    const lookaheadCutoff = now + APPT_CONTEXT_WINDOW_MS;

    // Focused appointment (if caller specified one)
    let focused = null;
    if (focusAppointmentId) {
        const a = await env.DB.prepare(`
            SELECT id, visit_type, starts_at, ends_at, duration_min, modality,
                   status, chief_complaint_summary, doxy_room_url, triage_id
            FROM appointments
            WHERE id = ? AND patient_id = ?
        `).bind(focusAppointmentId, patientId).first();
        if (a) focused = a;
    }

    // Last 3 completed
    const last = await env.DB.prepare(`
        SELECT id, visit_type, starts_at, ends_at, modality, status, chief_complaint_summary
        FROM appointments
        WHERE patient_id = ? AND status = 'completed' AND starts_at >= ?
        ORDER BY starts_at DESC
        LIMIT 3
    `).bind(patientId, lookbackCutoff).all();

    // Next 3 scheduled
    const next = await env.DB.prepare(`
        SELECT id, visit_type, starts_at, ends_at, modality, status, chief_complaint_summary, doxy_room_url
        FROM appointments
        WHERE patient_id = ? AND status = 'scheduled' AND starts_at >= ? AND starts_at <= ?
        ORDER BY starts_at ASC
        LIMIT 3
    `).bind(patientId, now, lookaheadCutoff).all();

    return {
        focused,
        recent_completed: last.results || [],
        upcoming_scheduled: next.results || [],
    };
}


// ---------------------------------------------------------------------
// Heuristic narrative composition (no LLM, no PHI leaves the Worker)
// ---------------------------------------------------------------------

function composeExecutiveLede(header, snapshot, triage, prom_trends, personal_notes, focused_appt) {
    const parts = [];
    const greet = header.nickname
        ? `${header.nickname} (${header.full_name})`
        : (header.preferred_name || header.first_name || "Patient");
    let lede = `${greet}${header.age ? `, ${header.age}` : ""}${header.pronouns ? ` (${header.pronouns})` : ""}`;
    if (focused_appt) {
        const dt = new Date(focused_appt.starts_at);
        const date = dt.toLocaleString("en-US", {
            weekday: "short", month: "short", day: "numeric",
            hour: "numeric", minute: "2-digit",
        });
        lede += ` — ${focused_appt.modality === "telehealth" ? "telehealth" : "in-person"} ${focused_appt.visit_type} at ${date}`;
    }
    parts.push(lede + ".");

    if (focused_appt && focused_appt.chief_complaint_summary) {
        parts.push(`Today's chief complaint: ${focused_appt.chief_complaint_summary}.`);
    } else if (triage && triage.rationale) {
        parts.push(`Triage rationale: ${triage.rationale}.`);
    }

    if (snapshot && snapshot.executive_summary) {
        parts.push(snapshot.executive_summary);
    } else if (snapshot && snapshot.problem_count) {
        parts.push(`${snapshot.problem_count} active problem${snapshot.problem_count === 1 ? "" : "s"} on the most-recent snapshot.`);
    }

    const concerningProms = prom_trends.filter(
        (p) => p.direction === "worsened" && p.tier === 1
    ).slice(0, 2);
    if (concerningProms.length) {
        const lines = concerningProms.map(
            (p) => `${p.short_name} ${p.previous_score}→${p.latest_score}`
        );
        parts.push(`PROM trend to watch: ${lines.join(", ")}.`);
    }

    const pinnedPersonal = personal_notes.find((n) => n.is_pinned && n.category === "personal");
    if (pinnedPersonal && pinnedPersonal.summary) {
        parts.push(`Personal touchpoint: ${pinnedPersonal.summary}.`);
    }

    return parts.join(" ");
}


function composeSuggestedQuestions(snapshot, triage, prom_trends, care_goals) {
    const out = [];

    // From the snapshot's open action items
    if (snapshot && snapshot.action_items_preview) {
        for (const a of snapshot.action_items_preview.slice(0, 3)) {
            if (a.status && a.status !== "completed") {
                out.push(`Follow up on: ${a.label}`);
            }
        }
    }

    // From PROM deteriorations
    for (const p of prom_trends) {
        if (p.direction === "worsened" && p.tier === 1) {
            out.push(`Probe the ${p.short_name} jump (${p.previous_score}→${p.latest_score}) — what changed since last visit?`);
        }
    }

    // From the triage rationale
    if (triage && triage.secondary_concerns && triage.secondary_concerns.length) {
        out.push(`Cover triage's secondary concern(s): ${triage.secondary_concerns.slice(0, 3).join(", ")}.`);
    }

    // From care goals
    if (care_goals && Array.isArray(care_goals.goals) && care_goals.goals.length) {
        out.push(`Where are we vs. their stated goal: "${care_goals.goals[0]}"?`);
    }

    return out.slice(0, 6);
}


function composeWatchFor(prom_trends, snapshot, care_goals) {
    const items = [];

    // Worsening PROMs
    for (const p of prom_trends) {
        if (p.direction === "worsened" && p.delta != null && p.delta >= 3) {
            items.push({
                kind: "prom_worsened",
                label: `${p.short_name} ${p.previous_score}→${p.latest_score} (Δ +${p.delta})`,
                severity: p.tier === 1 ? "high" : "moderate",
            });
        }
    }
    // Snapshot high-severity problems
    if (snapshot && snapshot.problems_preview) {
        for (const pr of snapshot.problems_preview) {
            if (String(pr.severity || "").toLowerCase().includes("severe")
                || String(pr.severity || "").toLowerCase().includes("high")) {
                items.push({
                    kind: "active_problem",
                    label: pr.label,
                    severity: "high",
                });
            }
        }
    }
    // Care-goal explicit avoidances
    if (care_goals && Array.isArray(care_goals.avoid) && care_goals.avoid.length) {
        for (const a of care_goals.avoid) {
            items.push({ kind: "patient_avoid", label: a, severity: "preference" });
        }
    }
    return items.slice(0, 8);
}


// ---------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------

/**
 * Build a full pre-visit briefing for a single patient.
 * @param {object} env — CF Pages env (DB, PHI bindings)
 * @param {string} patientId
 * @param {object} [opts]
 * @param {string} [opts.appointment_id] — focus the briefing on a specific appointment
 * @returns {Promise<object|null>}
 */
export async function buildPatientBriefing(env, patientId, opts = {}) {
    const header = await loadPatientHeader(env, patientId);
    if (!header) return null;

    const [intake, encounters, prom_trends, snapshot, personal_notes, appts] =
        await Promise.all([
            loadLatestIntake(env, patientId),
            loadRecentEncounters(env, patientId),
            loadPROMTrends(env, patientId),
            loadCurrentSnapshot(env, patientId),
            loadPersonalNotes(env, patientId),
            loadAppointmentContext(env, patientId, opts.appointment_id || null),
        ]);
    const triage = intake ? await loadIntakeTriage(env, intake.triage_id) : null;

    const focused = appts.focused || null;

    return {
        patient: header,
        appointment_focus: focused,
        appointments_context: {
            recent_completed: appts.recent_completed,
            upcoming_scheduled: appts.upcoming_scheduled,
        },
        executive_lede: composeExecutiveLede(
            header, snapshot, triage, prom_trends, personal_notes, focused
        ),
        intake_summary: intake,
        triage,
        snapshot_summary: snapshot,
        recent_encounters: encounters,
        prom_trends,
        personal_touchpoints: personal_notes.filter((n) => n.is_pinned || n.category === "personal"),
        all_personal_notes: personal_notes,
        care_goals: header.care_goals,
        watch_for: composeWatchFor(prom_trends, snapshot, header.care_goals),
        suggested_questions: composeSuggestedQuestions(snapshot, triage, prom_trends, header.care_goals),
        generated_at: Date.now(),
    };
}


/**
 * Build briefings for every patient with an appointment in the given window.
 *
 * @param {object} env
 * @param {object} opts
 * @param {number} opts.starts_at_min  — ms epoch (inclusive)
 * @param {number} opts.starts_at_max  — ms epoch (exclusive)
 * @param {string} [opts.clinician_id]
 * @returns {Promise<Array<object>>}
 */
export async function buildScheduleBriefings(env, opts) {
    const binds = [];
    let q = `
        SELECT a.id AS appointment_id, a.patient_id, a.visit_type, a.starts_at,
               a.ends_at, a.duration_min, a.modality, a.status,
               a.chief_complaint_summary, a.doxy_room_url
        FROM appointments a
        WHERE a.starts_at >= ? AND a.starts_at < ?
          AND a.status IN ('scheduled', 'completed')
    `;
    binds.push(opts.starts_at_min, opts.starts_at_max);
    if (opts.clinician_id) {
        q += ` AND a.clinician_id = ?`;
        binds.push(opts.clinician_id);
    }
    q += ` ORDER BY a.starts_at ASC`;

    const { results } = await env.DB.prepare(q).bind(...binds).all();
    const appts = results || [];

    // Dedupe: if the same patient appears in two appointments within the window
    // (e.g. half-day morning + afternoon), we build one briefing focused on
    // the EARLIEST appointment but list both in the schedule sidebar.
    const seen = new Set();
    const briefings = [];
    for (const a of appts) {
        if (seen.has(a.patient_id)) continue;
        seen.add(a.patient_id);
        const briefing = await buildPatientBriefing(env, a.patient_id, {
            appointment_id: a.appointment_id,
        });
        if (briefing) briefings.push(briefing);
    }

    return {
        window: { starts_at_min: opts.starts_at_min, starts_at_max: opts.starts_at_max },
        appointments: appts,            // raw appointment list for the schedule rail
        briefings,                       // per-unique-patient briefings, in schedule order
        generated_at: Date.now(),
    };
}
