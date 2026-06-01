// =====================================================================
// POST /api/v1/patient/intake/<intake_id>/triage — AI triage on submit
// =====================================================================
// Per CLAUDE.md §11.7. Reads the patient's submitted intake, runs the
// de-identified payload through Claude, writes the categorization to
// appointment_triage.
//
// Auth: patient must own the intake. (Admin Basic Auth lifts the
// preview gate; the patient session cookie carries identity.)
//
// Idempotency: at most one triage row per intake. If a row already
// exists, return it (200) rather than re-running Claude.
//
// Fallback: if ANTHROPIC_API_KEY is missing OR the Anthropic call fails
// OR the response fails validation, write a "manual_review_required"
// triage row instead of leaving the intake unrouted. The clinician
// dashboard surfaces these for hand-triage. Operational safety > AI.
// =====================================================================

import { previewAccess, preLaunchNotFound } from "../../../../../_lib/preview_gate.js";
import { requireRole, nowMs } from "../../../../../_lib/auth.js";
import { logAudit } from "../../../../../_lib/audit.js";
import { newId } from "../../../../../_lib/db.js";
import { runTriage, TRIAGE_PROMPT_VERSION } from "../../../../../_lib/intake_triage.js";
import {
    getLicensedStates,
    isLicensedInState,
    recordLicensureBlock,
} from "../../../../../_lib/licensure.js";

const MANUAL_REVIEW_PLACEHOLDER = "manual_review_required";

function err(status, code, message) {
    return new Response(JSON.stringify({ error: code, message }), {
        status,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

/**
 * Internal entry point also used by /submit.js to chain auto-triage.
 * Returns the canonical row + a fallback flag.
 */
export async function triageForIntake(ctx, intake_id) {
    const { env, request } = ctx;
    if (!env.DB) return { ok: false, error: "db_not_bound" };

    // Already triaged? Return the existing row.
    const existing = await env.DB.prepare(`
        SELECT id, ai_visit_type, ai_duration_min, ai_urgency,
               ai_in_person_required, ai_preferred_time_of_day,
               ai_rationale, ai_secondary_concerns_json,
               ai_prompt_version, created_at
        FROM appointment_triage WHERE intake_id = ? LIMIT 1
    `).bind(intake_id).first();
    if (existing) {
        return { ok: true, existing: true, row: existing };
    }

    // Load the intake + its sections.
    const intake = await env.DB.prepare(`
        SELECT id, patient_id, status FROM intake_responses WHERE id = ?
    `).bind(intake_id).first();
    if (!intake) return { ok: false, error: "intake_not_found" };
    if (intake.status === "in_progress") {
        return { ok: false, error: "intake_not_submitted" };
    }

    // Patient DOB for the age-bucket de-identification only.
    const patient = await env.DB.prepare(
        "SELECT dob FROM patients WHERE id = ?"
    ).bind(intake.patient_id).first();

    const sectionsRes = await env.DB.prepare(`
        SELECT section_number, data_json FROM intake_section_data WHERE intake_id = ?
    `).bind(intake_id).all();
    const sections = {};
    for (const row of (sectionsRes?.results || [])) {
        try { sections[row.section_number] = { data: JSON.parse(row.data_json) }; }
        catch { sections[row.section_number] = { data: {} }; }
    }

    // Phase 17 R3 — short-circuit triage if the clinician is not licensed in
    // the patient's state of residence (Section 1 address_state). Saves an
    // Anthropic call for an encounter that cannot lawfully proceed. submit.js
    // is the primary gate (blocks the submit before this runs); this is
    // defense-in-depth for the standalone POST /triage path. Only enforced
    // when a valid state is present — submit.js owns the "state required" rule.
    const triage_state = (() => {
        const raw = sections?.[1]?.data?.address_state;
        const code = typeof raw === "string" ? raw.trim().toUpperCase() : "";
        return /^[A-Z]{2}$/.test(code) ? code : null;
    })();
    if (triage_state && !(await isLicensedInState(env, triage_state))) {
        const licensed_states = await getLicensedStates(env);
        await recordLicensureBlock(env, {
            patient_id: intake.patient_id,
            state: triage_state,
            reason: `triage short-circuit — clinician not licensed in ${triage_state}`,
        });
        return { ok: false, error: "license_state_mismatch", licensed_states };
    }

    const triage_id = newId();
    const now = nowMs();

    // Try the AI path; if it fails for any reason, fall back to manual review.
    let decision = null;
    let prompt_version = TRIAGE_PROMPT_VERSION;
    let secondary_concerns = [];
    let rationale = null;
    let ai_latency_ms = null;
    let fallback_reason = null;

    try {
        const res = await runTriage(env, {
            triage_id,
            dob: patient?.dob || null,
            sections,
        });
        decision = res.decision;
        prompt_version = res.prompt_version;
        secondary_concerns = decision.secondary_concerns || [];
        rationale = decision.rationale || null;
        ai_latency_ms = res.anthropic_latency_ms;
    } catch (e) {
        fallback_reason = String(e && e.message ? e.message : e).slice(0, 200);
        console.warn("triage AI path failed — writing manual_review_required row", {
            module: "api/v1/patient/intake/triage",
            intake_id,
            reason: fallback_reason,
        });
    }

    // Compose the row to insert. If AI succeeded we use its decision;
    // otherwise we write a conservative placeholder that flags the row
    // for the clinician dashboard.
    const row = decision ? {
        ai_visit_type: decision.visit_type,
        ai_duration_min: decision.duration_min,
        ai_urgency: decision.urgency,
        ai_in_person_required: decision.in_person_required ? 1 : 0,
        ai_preferred_time_of_day: decision.preferred_time_of_day,
        ai_rationale: rationale,
        ai_secondary_concerns_json: JSON.stringify(secondary_concerns),
    } : {
        ai_visit_type: MANUAL_REVIEW_PLACEHOLDER,
        ai_duration_min: 45,
        ai_urgency: "routine",
        ai_in_person_required: 0,
        ai_preferred_time_of_day: "any",
        ai_rationale: `AI triage unavailable — manual review required. Reason: ${fallback_reason || "unknown"}`,
        ai_secondary_concerns_json: JSON.stringify([]),
    };

    try {
        await env.DB.prepare(`
            INSERT INTO appointment_triage
                (id, intake_id, patient_id, ai_prompt_version,
                 ai_visit_type, ai_duration_min, ai_urgency,
                 ai_in_person_required, ai_preferred_time_of_day,
                 ai_rationale, ai_secondary_concerns_json,
                 created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
            triage_id, intake_id, intake.patient_id, prompt_version,
            row.ai_visit_type, row.ai_duration_min, row.ai_urgency,
            row.ai_in_person_required, row.ai_preferred_time_of_day,
            row.ai_rationale, row.ai_secondary_concerns_json,
            now, now
        ).run();
    } catch (e) {
        console.error("triage DB.insert threw", { error: String(e), intake_id });
        return { ok: false, error: "db_insert_failed" };
    }

    await logAudit(env, {
        user_id: intake.patient_id,
        user_role: "patient",
        action: "triage_run",
        record_type: "triage",
        record_id: triage_id,
        ip: request?.headers?.get("CF-Connecting-IP") || "",
        user_agent: request?.headers?.get("User-Agent") || "",
        success: !!decision,
        details: {
            ai_used: !!decision,
            fallback_reason,
            visit_type: row.ai_visit_type,
            duration_min: row.ai_duration_min,
            urgency: row.ai_urgency,
            in_person_required: !!row.ai_in_person_required,
            anthropic_latency_ms: ai_latency_ms,
            prompt_version,
        },
    });

    return {
        ok: true,
        existing: false,
        triage_id,
        ai_used: !!decision,
        fallback_reason,
        row: {
            id: triage_id,
            ...row,
            ai_prompt_version: prompt_version,
        },
    };
}

export async function onRequestPost(ctx) {
    const { request, env, params } = ctx;
    const { allow } = await previewAccess(request, env);
    if (!allow) return preLaunchNotFound();

    let session;
    try { session = await requireRole(ctx, ["patient"]); }
    catch (resp) { return resp; }
    if (!session.patient_id || !env.DB) {
        return err(500, "server_error", "DB not bound");
    }

    const intake_id = String(params?.intake_id || "");
    if (!intake_id) return err(400, "bad_params", "intake_id required");

    // Confirm ownership before the heavier triage path.
    const owned = await env.DB.prepare(
        "SELECT id, status FROM intake_responses WHERE id = ? AND patient_id = ?"
    ).bind(intake_id, session.patient_id).first();
    if (!owned) return err(404, "intake_not_found", "no such intake for this patient");

    const result = await triageForIntake(ctx, intake_id);
    if (!result.ok) {
        // Surface the licensure block as 422 (consistent with submit + book),
        // distinguished by error code, with the licensed-states for the UI.
        if (result.error === "license_state_mismatch") {
            return new Response(JSON.stringify({
                error: "license_state_mismatch",
                message: "Dr. Mabini isn't currently licensed to provide care to patients located in your state. Please contact the office.",
                licensed_states: result.licensed_states || [],
            }), { status: 422, headers: { "content-type": "application/json", "cache-control": "no-store" } });
        }
        return err(409, result.error, "could not triage");
    }

    return new Response(JSON.stringify(result), {
        status: result.existing ? 200 : 201,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}
