// =====================================================================
// functions/_lib/prom_intake_orchestrator.js
// =====================================================================
// Single entry point called from intake submit:
//   1. Load intake_section_data rows for the intake.
//   2. De-identify via intake_triage.deidentifyIntake().
//   3. Call prom_recommender to choose Tier-1/2 slugs.
//   4. Assign each via proms.assignPROM() (idempotent).
//   5. Best-effort audit log; never throws back to caller.
// =====================================================================

import { deidentifyIntake } from "./intake_triage.js";
import { recommendPROMsForIntake } from "./prom_recommender.js";
import { assignPROM } from "./proms.js";
import { logAudit } from "./audit.js";

export async function recommendAndAssignPROMs(ctx, intake_id) {
    const { env, request } = ctx;
    if (!env.DB || !intake_id) {
        return { ok: false, error: "missing_env_or_intake" };
    }

    // Resolve intake → patient_id + dob (for age bucketing in de-id).
    const intake = await env.DB.prepare(`
        SELECT i.id, i.patient_id, p.dob
          FROM intake_responses i
          LEFT JOIN patients p ON p.id = i.patient_id
         WHERE i.id = ?
         LIMIT 1
    `).bind(intake_id).first();
    if (!intake) return { ok: false, error: "intake_not_found" };
    const patient_id = intake.patient_id;
    const dob = intake.dob;

    // Load all sections in one query and unpack into the shape deidentifyIntake expects.
    const rs = await env.DB.prepare(`
        SELECT section_number, data_json
          FROM intake_section_data
         WHERE intake_id = ?
    `).bind(intake_id).all();
    const sections = {};
    for (const row of (rs && rs.results) || []) {
        let data = {};
        try { data = JSON.parse(row.data_json || "{}"); } catch {}
        sections[Number(row.section_number)] = { data };
    }

    // The de-id helper produces the safe summary Claude sees.
    const deid = deidentifyIntake({ triage_id: intake_id, dob, sections });

    // Recommendation step — AI with rule-based fallback.
    let rec;
    try {
        rec = await recommendPROMsForIntake({ env, deid });
    } catch (e) {
        return { ok: false, error: "recommender_threw", detail: String(e && e.message || e) };
    }

    const recommended = Array.isArray(rec.recommended_slugs) ? rec.recommended_slugs : [];
    const assigned = [];
    const deduped = [];
    const errors = [];

    for (const slug of recommended) {
        try {
            const { id, deduped: wasDuped } = await assignPROM(env, {
                patient_id,
                prom_slug: slug,
                assigned_by_kind: rec.ai_used ? "ai_intake_triage" : "ai_intake_triage_fallback",
                assigned_by_id: null,
                trigger_reason: rec.rationale ? rec.rationale.slice(0, 500) : "intake submit",
                period_label: "baseline",
                due_days: 7
            });
            if (wasDuped) deduped.push({ slug, id });
            else assigned.push({ slug, id });
        } catch (e) {
            errors.push({ slug, error: String(e && e.message || e) });
        }
    }

    // Best-effort audit
    try {
        await logAudit(env, {
            user_id: patient_id,
            user_role: "patient",
            action: "prom_intake_assignment",
            record_type: "intake",
            record_id: intake_id,
            ip: request?.headers?.get("CF-Connecting-IP") || "",
            user_agent: request?.headers?.get("User-Agent") || "",
            success: errors.length === 0,
            details: {
                recommended,
                assigned: assigned.map(a => a.slug),
                deduped: deduped.map(d => d.slug),
                errors,
                ai_used: !!rec.ai_used,
                fallback_reason: rec.reason || null
            }
        });
    } catch {}

    return {
        ok: true,
        recommended,
        assigned,
        deduped,
        errors,
        rationale: rec.rationale || "",
        ai_used: !!rec.ai_used,
        prompt_version: rec.prompt_version || null
    };
}
