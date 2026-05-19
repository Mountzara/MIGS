// =====================================================================
// functions/_lib/proms.js — PROM repository helpers (D1 reads/writes)
// =====================================================================
// Thin layer over D1. The actual PROM definitions live in JSON files
// under /assets/proms/<slug>.json, seeded into prom_definitions at
// deploy time via the /api/v1/admin/proms/seed endpoint. Patient APIs
// read definitions from the D1 table.
// =====================================================================

import { scorePROM } from "./prom_scorer.js";
import { recordEncounterEvent } from "./encounters.js";

function uuid() {
    return crypto.randomUUID();
}

function nowIso() {
    return new Date().toISOString();
}

// -- Definitions ----------------------------------------------------------

export async function getDefinition(env, slug) {
    if (!env.DB || !slug) return null;
    const row = await env.DB.prepare(
        "SELECT * FROM prom_definitions WHERE slug = ? AND is_active = 1 LIMIT 1"
    ).bind(slug).first();
    if (!row) return null;
    return hydrateDefinition(row);
}

function hydrateDefinition(row) {
    let items = [], scoring = {}, thresholds = [];
    try { items      = JSON.parse(row.items_json      || "[]"); } catch {}
    try { scoring    = JSON.parse(row.scoring_json    || "{}"); } catch {}
    try { thresholds = JSON.parse(row.thresholds_json || "[]"); } catch {}
    return {
        slug: row.slug,
        title: row.title,
        short_name: row.short_name,
        tier: row.tier,
        domain: row.domain,
        description: row.description,
        estimated_minutes: row.estimated_minutes,
        items,
        scoring,
        thresholds,
        citation: row.citation,
        license_note: row.license_note,
        version: row.version
    };
}

// -- Assignments ----------------------------------------------------------

export async function listAssignments(env, patient_id, statusFilter = null) {
    if (!env.DB || !patient_id) return [];
    const where = statusFilter
        ? "WHERE patient_id = ? AND status = ?"
        : "WHERE patient_id = ?";
    const args = statusFilter ? [patient_id, statusFilter] : [patient_id];
    const sql = `
        SELECT a.*, d.title, d.short_name, d.domain, d.tier, d.estimated_minutes
          FROM prom_assignments a
          LEFT JOIN prom_definitions d ON d.slug = a.prom_slug
          ${where}
          ORDER BY
            CASE a.status WHEN 'pending' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END,
            a.assigned_at DESC
    `;
    const rs = await env.DB.prepare(sql).bind(...args).all();
    return (rs && rs.results) || [];
}

export async function getAssignment(env, assignment_id, patient_id = null) {
    if (!env.DB || !assignment_id) return null;
    const where = patient_id
        ? "WHERE a.id = ? AND a.patient_id = ?"
        : "WHERE a.id = ?";
    const args = patient_id ? [assignment_id, patient_id] : [assignment_id];
    const sql = `
        SELECT a.*, d.title, d.short_name, d.tier, d.domain, d.estimated_minutes
          FROM prom_assignments a
          LEFT JOIN prom_definitions d ON d.slug = a.prom_slug
          ${where}
          LIMIT 1
    `;
    return await env.DB.prepare(sql).bind(...args).first();
}

/**
 * Idempotent: if patient already has an open assignment for this slug, returns
 * that one instead of creating a duplicate.
 */
export async function assignPROM(env, {
    patient_id, prom_slug, assigned_by_kind, assigned_by_id,
    trigger_reason, period_label, due_days = 7,
}) {
    if (!env.DB || !patient_id || !prom_slug) {
        throw new Error("assignPROM requires DB, patient_id, prom_slug");
    }
    // Skip if there's already an open assignment for this slug
    const existing = await env.DB.prepare(
        "SELECT id FROM prom_assignments WHERE patient_id = ? AND prom_slug = ? AND status IN ('pending','in_progress') LIMIT 1"
    ).bind(patient_id, prom_slug).first();
    if (existing) return { id: existing.id, deduped: true };

    const id = uuid();
    const now = nowIso();
    const due = due_days
        ? new Date(Date.now() + due_days * 86400000).toISOString()
        : null;

    await env.DB.prepare(`
        INSERT INTO prom_assignments
          (id, patient_id, prom_slug, assigned_by_kind, assigned_by_id,
           trigger_reason, period_label, assigned_at, due_at, status)
        VALUES (?,?,?,?,?,?,?,?,?,'pending')
    `).bind(
        id, patient_id, prom_slug, assigned_by_kind, assigned_by_id || null,
        trigger_reason || null, period_label || null, now, due
    ).run();

    return { id, deduped: false };
}

// -- Submission + scoring + flag firing ----------------------------------

export async function submitResponse(env, {
    assignment_id, patient_id, response_data, context = {}
}) {
    if (!env.DB || !assignment_id || !patient_id || !response_data) {
        throw new Error("submitResponse requires DB + assignment_id + patient_id + response_data");
    }
    const assignment = await env.DB.prepare(
        "SELECT * FROM prom_assignments WHERE id = ? AND patient_id = ? LIMIT 1"
    ).bind(assignment_id, patient_id).first();
    if (!assignment) throw new Error("assignment_not_found");
    if (assignment.status === "completed") throw new Error("already_completed");

    const def = await getDefinition(env, assignment.prom_slug);
    if (!def) throw new Error("definition_missing");

    // Try to look up baseline total for delta_vs_baseline rules
    let baseline_total = null;
    if ((def.thresholds || []).some(t => /delta_vs_baseline/.test(t.rule || ""))) {
        const baselineRow = await env.DB.prepare(`
            SELECT computed_scores
              FROM prom_responses
             WHERE patient_id = ? AND prom_slug = ?
             ORDER BY submitted_at ASC
             LIMIT 1
        `).bind(patient_id, def.slug).first();
        if (baselineRow) {
            try {
                const s = JSON.parse(baselineRow.computed_scores);
                if (typeof s.total === "number") baseline_total = s.total;
            } catch {}
        }
    }

    const scored = scorePROM(def, response_data, { baseline_total, ...context });
    const response_id = uuid();
    const now = nowIso();

    await env.DB.prepare(`
        INSERT INTO prom_responses
          (id, assignment_id, patient_id, prom_slug, response_data,
           computed_scores, threshold_flags, submitted_at)
        VALUES (?,?,?,?,?,?,?,?)
    `).bind(
        response_id, assignment_id, patient_id, def.slug,
        JSON.stringify(response_data),
        JSON.stringify(scored.computed_scores),
        JSON.stringify(scored.threshold_flags || []),
        now
    ).run();

    // Update assignment
    await env.DB.prepare(`
        UPDATE prom_assignments
           SET status='completed', completed_at=?, response_id=?
         WHERE id=?
    `).bind(now, response_id, assignment_id).run();

    // Fire flags into prom_triage_flags + record a clinician-visible encounter event
    for (const f of scored.threshold_flags || []) {
        const flag_id = uuid();
        await env.DB.prepare(`
            INSERT INTO prom_triage_flags
              (id, response_id, patient_id, prom_slug, flag_type, severity, message, created_at)
            VALUES (?,?,?,?,?,?,?,?)
        `).bind(
            flag_id, response_id, patient_id, def.slug,
            f.flag_type, f.severity || "info", f.message || "", now
        ).run();
        try {
            await recordEncounterEvent(env, {
                patient_id,
                event_type: "prom_flag",
                event_summary: `${(def.short_name || def.slug || "").toUpperCase()}: ${f.message || f.flag_type}`,
                severity: f.severity || "info",
                ref_kind: "prom_response",
                ref_id: response_id,
                details: { flag_type: f.flag_type, prom_slug: def.slug, total: scored.computed_scores?.total }
            });
        } catch {}
    }
    // Also record a "PROM completed" event when no flags fired (low-key, info-only,
    // useful as a positive data point in the timeline).
    if (!scored.threshold_flags?.length) {
        try {
            await recordEncounterEvent(env, {
                patient_id,
                event_type: "prom_completed",
                event_summary: `${(def.short_name || def.slug || "").toUpperCase()} completed${typeof scored.computed_scores?.total === "number" ? ` — total ${Number(scored.computed_scores.total).toFixed(scored.computed_scores.total % 1 ? 1 : 0)}` : ""}`,
                severity: "info",
                ref_kind: "prom_response",
                ref_id: response_id,
                details: { prom_slug: def.slug, total: scored.computed_scores?.total }
            });
        } catch {}
    }

    return {
        response_id,
        computed_scores: scored.computed_scores,
        threshold_flags: scored.threshold_flags || [],
        baseline_total
    };
}

// -- Triage flag queries (admin-side) ------------------------------------

export async function openFlagsForPatient(env, patient_id) {
    if (!env.DB || !patient_id) return [];
    const rs = await env.DB.prepare(`
        SELECT *
          FROM prom_triage_flags
         WHERE patient_id = ? AND acknowledged_at IS NULL
         ORDER BY
           CASE severity WHEN 'urgent' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
           created_at DESC
    `).bind(patient_id).all();
    return (rs && rs.results) || [];
}
