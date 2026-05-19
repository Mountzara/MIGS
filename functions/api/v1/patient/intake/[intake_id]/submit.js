// =====================================================================
// POST /api/v1/patient/intake/<intake_id>/submit — finalize an intake
// =====================================================================
// Marks the intake_responses row status='submitted' + submitted_at=now,
// which freezes section edits (the PATCH endpoint rejects writes once
// status is not in_progress).
//
// Side effects per §11.6:
//   * If mental_health_screening shows PHQ-2 ≥ 3 OR surgical_anxiety
//     in {moderate, severe}, record a `mental_health_flag` detail on
//     the audit row so the clinician dashboard can surface it.
//   * Schedule (Phase 2.5) AI triage runs off intake_submit downstream;
//     we just write the audit row here and let the triage worker pick
//     up the work.
// =====================================================================

import { previewAccess, preLaunchNotFound } from "../../../../../_lib/preview_gate.js";
import { requireRole, nowMs } from "../../../../../_lib/auth.js";
import { logAudit } from "../../../../../_lib/audit.js";
import { triageForIntake } from "./triage.js";
import { recommendAndAssignPROMs } from "../../../../../_lib/prom_intake_orchestrator.js";
import {
    buildCareGoalsFromSection4,
    shouldOverwriteCareGoals,
} from "../../../../../_lib/care_goals_mapper.js";

function err(status, code, message) {
    return new Response(JSON.stringify({ error: code, message }), {
        status,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

export async function onRequestPost(ctx) {
    const { request, env, params } = ctx;
    const { allow } = await previewAccess(request, env);
    if (!allow) return preLaunchNotFound();

    let session;
    try { session = await requireRole(ctx, ["patient"]); }
    catch (resp) { return resp; }
    if (!session.patient_id || !env.DB) return err(500, "server_error", "DB not bound");

    const intake_id = String(params?.intake_id || "");
    if (!intake_id) return err(400, "bad_params", "intake_id required");

    const intake = await env.DB.prepare(`
        SELECT id, status FROM intake_responses WHERE id = ? AND patient_id = ?
    `).bind(intake_id, session.patient_id).first();
    if (!intake) return err(404, "intake_not_found", "no such intake for this patient");
    if (intake.status === "submitted" || intake.status === "reviewed") {
        return err(409, "already_submitted", `intake is ${intake.status}`);
    }

    // Confirm at least the consent (section 2) is on file before submit.
    const consent = await env.DB.prepare(`
        SELECT data_json FROM intake_section_data WHERE intake_id = ? AND section_number = 2
    `).bind(intake_id).first();
    if (!consent) {
        return err(409, "consent_required", "section 2 (consent) must be saved before submit");
    }

    // Inspect section 17 (mental health) for flagging.
    let mh_flag = null;
    try {
        const mh = await env.DB.prepare(`
            SELECT data_json FROM intake_section_data WHERE intake_id = ? AND section_number = 17
        `).bind(intake_id).first();
        if (mh?.data_json) {
            const d = JSON.parse(mh.data_json);
            const phq2 = (Number(d?.phq2_anhedonia) || 0) + (Number(d?.phq2_depressed) || 0);
            const anx = String(d?.surgical_anxiety || "").toLowerCase();
            if (phq2 >= 3 || anx === "moderate" || anx === "severe") {
                mh_flag = { phq2_total: phq2, surgical_anxiety: anx || null };
            }
        }
    } catch (e) {
        console.warn("intake submit mh parse warn", { error: String(e) });
    }

    const now = nowMs();
    try {
        await env.DB.prepare(`
            UPDATE intake_responses
            SET status = 'submitted', submitted_at = ?, updated_at = ?
            WHERE id = ?
        `).bind(now, now, intake_id).run();
    } catch (e) {
        console.error("intake submit DB.run threw", { error: String(e) });
        return err(500, "server_error", "could not submit intake");
    }

    await logAudit(env, {
        user_id: session.patient_id,
        user_role: "patient",
        action: "intake_submit",
        record_type: "intake",
        record_id: intake_id,
        ip: request.headers.get("CF-Connecting-IP") || "",
        user_agent: request.headers.get("User-Agent") || "",
        success: true,
        details: mh_flag ? { mental_health_flag: mh_flag } : null,
    });

    // Phase 14 Round B+ — map Section 4 "Treatment Goals & Expectations" into
    // the canonical patients.care_goals_json. Idempotent + non-clobbering:
    // if the clinician has manually PATCHed care_goals AFTER intake.submitted_at
    // we leave their edit in place and just log a 'intake-suggests-update'
    // detail. Failure here MUST NOT fail the intake submit.
    try {
        const s4row = await env.DB.prepare(`
            SELECT data_json FROM intake_section_data
            WHERE intake_id = ? AND section_number = 4
        `).bind(intake_id).first();
        if (s4row?.data_json) {
            let s4 = null;
            try { s4 = JSON.parse(s4row.data_json); } catch {}
            const derived = buildCareGoalsFromSection4(s4);
            if (derived) {
                const p = await env.DB.prepare(`
                    SELECT care_goals_updated_at FROM patients WHERE id = ?
                `).bind(session.patient_id).first();
                const allow = shouldOverwriteCareGoals({
                    care_goals_updated_at: p?.care_goals_updated_at || null,
                    intake_submitted_at: now,
                });
                if (allow) {
                    await env.DB.prepare(`
                        UPDATE patients
                        SET care_goals_json = ?, care_goals_updated_at = ?, updated_at = ?
                        WHERE id = ?
                    `).bind(JSON.stringify(derived), now, now, session.patient_id).run();
                } else {
                    await logAudit(env, {
                        user_id: session.patient_id, user_role: "patient",
                        action: "care_goals_overwrite_skipped",
                        record_type: "patient",
                        record_id: session.patient_id,
                        success: true,
                        details: {
                            reason: "clinician_manually_edited_after_intake",
                            patient_care_goals_updated_at: p?.care_goals_updated_at,
                            intake_submitted_at: now,
                            derived_from_intake: derived,
                        },
                    });
                }
            }
        }
    } catch (e) {
        console.warn("intake submit care_goals map warn", { error: String(e) });
    }

    // Phase 9 — mark patient as dirty for app-side context pulls. The
    // MountZaraMedicalTranscription app polls /api/v1/sync/transcription/patients
    // ?since=<cursor> and will see this patient surface on the next pull,
    // pre-loaded with the freshly-submitted intake answers. Best-effort;
    // a write failure here MUST NOT fail the intake submit.
    try {
        await env.DB.prepare(`
            INSERT INTO patient_dirty_flag (patient_id, dirty_since, dirty_reason, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(patient_id) DO UPDATE SET
                dirty_since = excluded.dirty_since,
                dirty_reason = excluded.dirty_reason,
                updated_at = excluded.updated_at
        `).bind(session.patient_id, now, "intake_submitted", now).run();
    } catch (e) {
        console.warn("intake submit dirty-flag write warn", { error: String(e) });
    }

    // Phase 9.5 — surface intake submission on the case-view "what's new"
    // panel. Mental-health flag elevates severity to warning so the
    // clinician sees PHQ-2 ≥ 3 / surgical anxiety positives at a glance.
    try {
        const { recordEncounterEvent } = await import("../../../../../_lib/encounters.js");
        await recordEncounterEvent(env, {
            patient_id: session.patient_id,
            event_type: "intake_submitted",
            event_summary: mh_flag
                ? `Intake submitted with mental-health flag (PHQ-2=${mh_flag.phq2_total}${mh_flag.surgical_anxiety ? `, anxiety=${mh_flag.surgical_anxiety}` : ""})`
                : `Intake submitted — ready for clinician review`,
            severity: mh_flag ? "warning" : "info",
            ref_kind: "intake",
            ref_id: intake_id,
            details: { mental_health_flag: mh_flag }
        });
    } catch {}

    // Chain auto-triage (§11.7 Phase 2.5). Failure inside triage MUST NOT
    // fail the submit response — the intake was successfully captured;
    // triage is a downstream enrichment. The triage helper handles its
    // own fallback to a `manual_review_required` row if Anthropic is
    // unreachable or the response fails validation, so a clinician can
    // still hand-triage from the dashboard.
    let triage = null;
    try {
        triage = await triageForIntake(ctx, intake_id);
    } catch (e) {
        console.error("intake submit auto-triage threw", { error: String(e), intake_id });
    }

    // Phase 10 Round A — AI-driven PROM assignment from the same intake.
    // Tier 1 universal panels (PHQ-2, GAD-2) plus condition-triggered Tier 2
    // (BPI-SF, EHP-5, ...) per the validated-questionnaire library. Failure
    // here MUST NOT fail the intake submit — the patient can still be
    // hand-assigned PROMs from the admin side if this enrichment fails.
    let prom_assignments = null;
    try {
        prom_assignments = await recommendAndAssignPROMs(ctx, intake_id);
    } catch (e) {
        console.error("intake submit PROM recommend threw", { error: String(e), intake_id });
    }

    return new Response(JSON.stringify({
        ok: true,
        intake_id,
        status: "submitted",
        submitted_at: now,
        mental_health_flag: mh_flag,
        triage: triage && triage.ok ? {
            id: triage.triage_id || triage.row?.id || null,
            ai_used: !!triage.ai_used,
            visit_type: triage.row?.ai_visit_type || null,
            duration_min: triage.row?.ai_duration_min || null,
            urgency: triage.row?.ai_urgency || null,
            in_person_required: !!triage.row?.ai_in_person_required,
            preferred_time_of_day: triage.row?.ai_preferred_time_of_day || null,
            fallback_reason: triage.fallback_reason || null,
            existing: !!triage.existing,
        } : { error: triage?.error || "triage_failed" },
    }), {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}
