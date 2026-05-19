// =====================================================================
// functions/_lib/wizard.js — onboarding wizard state computation
// =====================================================================
// Pure logic for: given a patient_id, walk the existing data layer
// (patients row, intake_responses, appointments, education_assignments,
// symptom_diary_entries) and figure out which steps are complete vs.
// not. Result is consumed by /api/v1/patient/wizard/state and rendered
// by portal/_wizard.js.
//
// Steps are intentionally lightweight checks — we don't claim a step is
// "complete" just because a field is non-null; we check the substantive
// completion criterion (e.g., intake => status='submitted', not just
// "any row exists").
// =====================================================================

import { newId } from "./db.js";
import { nowMs } from "./auth.js";

// Canonical step catalog. The order is the order the wizard presents
// them. To add a step: append here, write the predicate, write the
// click-to-go target. Don't reorder — clients persist step_key not index.
export const WIZARD_STEPS = [
    {
        key: "profile_basics",
        title: "Confirm your basics",
        blurb: "Make sure your phone, pronouns, and preferred language are set so we can reach you the right way.",
        cta_label: "Go to your profile",
        cta_route: "/portal/profile",
        time_estimate: "1 min",
    },
    {
        key: "photo_and_nickname",
        title: "Add a photo and what we should call you",
        blurb: "Optional, but it helps the office recognize you at telehealth visits and lets us greet you the way you want to be greeted.",
        cta_label: "Upload photo & nickname",
        cta_route: "/portal/profile",
        time_estimate: "1 min",
    },
    {
        key: "care_goals",
        title: "Your goals & preferences for care",
        blurb: "Tell us what matters most to you about your care — what you want, what you'd rather avoid, what's worked or hasn't.",
        cta_label: "Set your goals",
        cta_route: "/portal/profile",
        time_estimate: "2 min",
    },
    {
        key: "intake",
        title: "Complete the comprehensive intake",
        blurb: "The 19-section MIGS intake. It autosaves as you go, so you can pause and come back. This is the most important step — it shapes everything else.",
        cta_label: "Start (or resume) intake",
        cta_route: "/portal/intake/",
        time_estimate: "20–30 min",
    },
    {
        key: "appointment",
        title: "Schedule a visit",
        blurb: "Pick a slot that fits your visit type. The AI scheduler reads your intake and only shows slots that match.",
        cta_label: "Find a time",
        cta_route: "/portal/appointments/book/",
        time_estimate: "2 min",
    },
    {
        key: "education_ack",
        title: "Read your education materials",
        blurb: "Mark at least one of your assigned primers as read so we know they reached you. You can come back to the rest anytime.",
        cta_label: "Open education library",
        cta_route: "/portal/education/",
        time_estimate: "5–10 min",
    },
    {
        key: "symptom_diary",
        title: "Log your first symptom-diary entry",
        blurb: "A quick check-in on pain, bleeding, mood, and sleep. Visits start better when there's data behind your story.",
        cta_label: "Open your diary",
        cta_route: "/portal/symptoms/",
        time_estimate: "3 min",
    },
];

// Map for quick key lookup.
const STEP_BY_KEY = Object.fromEntries(WIZARD_STEPS.map((s) => [s.key, s]));

function safeParse(s) {
    if (!s || typeof s !== "string") return null;
    try { return JSON.parse(s); } catch { return null; }
}

/**
 * Read the persistent wizard_state row for a patient (creating a default
 * if absent). Returns { row, progress } where progress is the parsed JSON
 * with default-empty fallbacks.
 */
export async function readWizardState(env, patient_id) {
    const row = await env.DB.prepare(
        "SELECT * FROM wizard_state WHERE patient_id = ?"
    ).bind(patient_id).first();
    if (!row) {
        const now = nowMs();
        await env.DB.prepare(`
            INSERT INTO wizard_state (patient_id, enabled, progress_json, started_at, last_opened_at, created_at, updated_at)
            VALUES (?, 1, '{}', NULL, NULL, ?, ?)
        `).bind(patient_id, now, now).run();
        return {
            row: { patient_id, enabled: 1, progress_json: "{}", started_at: null, last_opened_at: null, snooze_until: null, completed_at: null, disabled_at: null, created_at: now, updated_at: now },
            progress: {},
        };
    }
    return { row, progress: safeParse(row.progress_json) || {} };
}

/**
 * Compute completion for every wizard step by reading the actual data
 * layer. The wizard_state.progress_json carries explicit "skipped" /
 * "snoozed_until" intent; the completion bit is derived live so a step
 * can never get stuck "complete" if the underlying data was deleted.
 */
export async function computeStepStatus(env, patient_id) {
    const { row, progress } = await readWizardState(env, patient_id);

    // Patient row — for profile_basics + photo_and_nickname + care_goals.
    const p = await env.DB.prepare(`
        SELECT phone, pronouns, preferred_language, timezone,
               nickname, photo_r2_key, care_goals_json
        FROM patients WHERE id = ?
    `).bind(patient_id).first();

    // Latest intake — submitted vs. in_progress.
    const intake = await env.DB.prepare(
        "SELECT id, status, completion_pct FROM intake_responses WHERE patient_id = ? ORDER BY created_at DESC LIMIT 1"
    ).bind(patient_id).first().catch(() => null);

    // Appointment scheduled (any).
    const appt = await env.DB.prepare(
        "SELECT id FROM appointments WHERE patient_id = ? AND status NOT IN ('cancelled','no_show') LIMIT 1"
    ).bind(patient_id).first().catch(() => null);

    // Education ack — any assignment marked acknowledged or completed.
    const eduRow = await env.DB.prepare(`
        SELECT id FROM patient_education_assignments
        WHERE patient_id = ? AND (status IN ('acknowledged','completed') OR acknowledged_at IS NOT NULL)
        LIMIT 1
    `).bind(patient_id).first().catch(() => null);

    // Symptom diary — any entry.
    const diaryRow = await env.DB.prepare(
        "SELECT id FROM symptom_diary_entries WHERE patient_id = ? LIMIT 1"
    ).bind(patient_id).first().catch(() => null);

    const predicates = {
        profile_basics:     !!(p && p.phone && p.preferred_language && p.timezone),
        photo_and_nickname: !!(p && (p.nickname || p.photo_r2_key)),
        care_goals:         !!(p && p.care_goals_json),
        intake:             !!(intake && (intake.status === "submitted" || intake.status === "reviewed")),
        appointment:        !!appt,
        education_ack:      !!eduRow,
        symptom_diary:      !!diaryRow,
    };

    const steps = WIZARD_STEPS.map((s) => {
        const ui = progress[s.key] || {};
        return {
            key: s.key,
            title: s.title,
            blurb: s.blurb,
            cta_label: s.cta_label,
            cta_route: s.cta_route,
            time_estimate: s.time_estimate,
            completed: !!predicates[s.key],
            skipped: !!ui.skipped,
            snoozed_until: typeof ui.snoozed_until === "number" ? ui.snoozed_until : null,
        };
    });

    const total = steps.length;
    const completed_count = steps.filter((s) => s.completed).length;
    const all_done = completed_count === total;

    // Detect first-not-completed step (skipping ones the user explicitly
    // skipped or snoozed) — that's the one the wizard auto-pops to.
    const now = nowMs();
    const next_step = steps.find((s) => !s.completed && !s.skipped && (!s.snoozed_until || s.snoozed_until <= now)) || null;

    return {
        enabled: !!row.enabled,
        snooze_until_global: row.snooze_until || null,
        started_at: row.started_at,
        last_opened_at: row.last_opened_at,
        completed_at: row.completed_at,
        steps,
        total,
        completed_count,
        completion_pct: Math.round((completed_count / total) * 100),
        all_done,
        next_step_key: next_step ? next_step.key : null,
        should_auto_open: !!row.enabled && !all_done && next_step && (!row.snooze_until || row.snooze_until <= now),
    };
}

/**
 * Update wizard_state from a patient-side action. Merges into
 * progress_json without clobbering siblings.
 */
export async function patchWizardState(env, patient_id, mutations) {
    const { row, progress } = await readWizardState(env, patient_id);
    const now = nowMs();
    const updates = [];
    const args = [];

    if (typeof mutations.enabled === "boolean") {
        updates.push("enabled = ?");
        args.push(mutations.enabled ? 1 : 0);
        if (!mutations.enabled) { updates.push("disabled_at = ?"); args.push(now); }
    }

    if (mutations.step_key && typeof mutations.step_key === "string") {
        const key = mutations.step_key;
        if (!STEP_BY_KEY[key]) throw new Error(`unknown step_key: ${key}`);
        progress[key] = progress[key] || {};
        if (mutations.skipped === true) progress[key].skipped = true;
        if (mutations.skipped === false) delete progress[key].skipped;
        if (typeof mutations.snooze_for_ms === "number" && mutations.snooze_for_ms > 0) {
            progress[key].snoozed_until = now + Math.min(mutations.snooze_for_ms, 30 * 24 * 60 * 60 * 1000);
        }
        if (mutations.clear_snooze === true) delete progress[key].snoozed_until;
        updates.push("progress_json = ?");
        args.push(JSON.stringify(progress));
    }

    if (typeof mutations.snooze_until_global_ms === "number") {
        updates.push("snooze_until = ?");
        args.push(now + Math.min(mutations.snooze_until_global_ms, 30 * 24 * 60 * 60 * 1000));
    }
    if (mutations.clear_global_snooze === true) {
        updates.push("snooze_until = NULL");
    }

    if (mutations.bump_opened === true) {
        updates.push("last_opened_at = ?");
        args.push(now);
        if (!row.started_at) {
            updates.push("started_at = ?");
            args.push(now);
        }
    }

    if (updates.length === 0) return { ok: true, no_op: true };

    updates.push("updated_at = ?");
    args.push(now);
    args.push(patient_id);

    await env.DB.prepare(
        `UPDATE wizard_state SET ${updates.join(", ")} WHERE patient_id = ?`
    ).bind(...args).run();

    return { ok: true };
}
