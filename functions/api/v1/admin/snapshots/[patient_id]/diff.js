// =====================================================================
// GET /api/v1/admin/snapshots/:patient_id/diff?from=<v>&to=<v>
// =====================================================================
// Phase 9 Round B. Computes the diff between two snapshot versions for
// the same patient. Mirrors the Swift SnapshotDiff struct (Sources/.../
// SnapshotHistory.swift) so the website can show the same "what changed
// since last visit" view the app exposes locally.
//
// Computed fields:
//   newProblems[]         — present in `to`, absent in `from`
//   resolvedProblems[]    — present in `from` with status='Active',
//                           present in `to` with status='Resolved'
//   changedStatuses[]     — same problem text, different status
//   newRecommendations[]  — present in to.ai_recommendations, absent in from
//   removedRecommendations[]
//   newActionItems[]      — present in to, absent in from (by description)
//   imagingDeltas[]       — same organ_name, dimension changed
//   summaryDiff           — { from_version, to_version, days_between,
//                             encounter_delta, dominant_category_change }
//
// Auth: admin Basic Auth.
// =====================================================================

import { adminRoute, jsonResponse, jsonError } from "../../../../../_lib/admin_api.js";

function safeJson(s) {
    if (!s || typeof s !== "string") return null;
    try { return JSON.parse(s); } catch { return null; }
}

function parseMaxDim(dim) {
    if (!dim || typeof dim !== "string") return null;
    const nums = (dim.match(/-?\d+(?:\.\d+)?/g) || []).map(Number).filter(Number.isFinite);
    return nums.length ? Math.max(...nums) : null;
}

async function loadSnapshotByVersion(env, patient_id, version) {
    const head = await env.DB.prepare(`
        SELECT * FROM patient_snapshots
        WHERE patient_id = ? AND version_number = ?
        LIMIT 1
    `).bind(patient_id, version).first();
    if (!head) return null;
    const [pR, iR, aR] = await Promise.all([
        env.DB.prepare(`SELECT problem, status, last_visit_plan FROM snapshot_problem_list WHERE snapshot_id = ? ORDER BY seq ASC`).bind(head.id).all(),
        env.DB.prepare(`SELECT organ_name, dimension, prior_dimension, measurement_date FROM snapshot_imaging_measurements WHERE snapshot_id = ? ORDER BY seq ASC`).bind(head.id).all(),
        env.DB.prepare(`SELECT description, priority, due_date FROM snapshot_action_items WHERE snapshot_id = ? ORDER BY seq ASC`).bind(head.id).all(),
    ]);
    return {
        head,
        problems: pR.results || [],
        imaging: iR.results || [],
        actions: aR.results || [],
        ai_recommendations: safeJson(head.ai_recommendations_json) || [],
    };
}

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env, params, request }) => {
        const patient_id = params && params.patient_id ? String(params.patient_id) : "";
        if (!patient_id) return jsonError("missing_patient_id", 400);

        const url = new URL(request.url);
        const fromV = parseInt(url.searchParams.get("from") || "", 10);
        const toV   = parseInt(url.searchParams.get("to") || "", 10);
        if (!Number.isFinite(fromV) || !Number.isFinite(toV)) {
            return jsonError("invalid_version_params", 400, { hint: "?from=<int>&to=<int>" });
        }
        if (fromV === toV) return jsonError("identical_versions", 400);

        const patient = await env.DB.prepare(`SELECT id FROM patients WHERE id = ?`).bind(patient_id).first();
        if (!patient) return jsonError("patient_not_found", 404);

        const [from_snap, to_snap] = await Promise.all([
            loadSnapshotByVersion(env, patient_id, fromV),
            loadSnapshotByVersion(env, patient_id, toV),
        ]);
        if (!from_snap) return jsonError("from_version_not_found", 404);
        if (!to_snap)   return jsonError("to_version_not_found", 404);

        // ---- Diff problems ----
        // Key on canonicalized problem text (lowercased, whitespace-collapsed).
        const canon = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
        const fromByText = new Map(from_snap.problems.map((p) => [canon(p.problem), p]));
        const toByText   = new Map(to_snap.problems.map((p) => [canon(p.problem), p]));

        const newProblems = [];
        const resolvedProblems = [];
        const changedStatuses = [];

        for (const [k, p] of toByText) {
            const prior = fromByText.get(k);
            if (!prior) {
                newProblems.push({ problem: p.problem, status: p.status, last_visit_plan: p.last_visit_plan });
            } else if (prior.status !== p.status) {
                if (prior.status === "Active" && p.status === "Resolved") {
                    resolvedProblems.push({ problem: p.problem, prior_status: prior.status, new_status: p.status });
                } else {
                    changedStatuses.push({ problem: p.problem, prior_status: prior.status, new_status: p.status });
                }
            }
        }
        // Problems that disappeared entirely in `to`.
        const removedProblems = [];
        for (const [k, p] of fromByText) {
            if (!toByText.has(k)) {
                removedProblems.push({ problem: p.problem, status: p.status });
            }
        }

        // ---- Diff recommendations ----
        const fromRecs = new Set(from_snap.ai_recommendations.map(canon));
        const toRecs   = new Set(to_snap.ai_recommendations.map(canon));
        const newRecommendations = to_snap.ai_recommendations.filter((r) => !fromRecs.has(canon(r)));
        const removedRecommendations = from_snap.ai_recommendations.filter((r) => !toRecs.has(canon(r)));

        // ---- Diff action items ----
        const fromActions = new Set(from_snap.actions.map((a) => canon(a.description)));
        const newActionItems = to_snap.actions
            .filter((a) => !fromActions.has(canon(a.description)))
            .map((a) => ({ description: a.description, priority: a.priority, due_date: a.due_date }));

        // ---- Imaging deltas ----
        // Key on canon(organ_name); compare current dimension.
        const fromImaging = new Map(from_snap.imaging.map((m) => [canon(m.organ_name), m]));
        const imagingDeltas = [];
        for (const m of to_snap.imaging) {
            const prior = fromImaging.get(canon(m.organ_name));
            if (!prior) continue;
            if (m.dimension !== prior.dimension) {
                const curMax = parseMaxDim(m.dimension);
                const priorMax = parseMaxDim(prior.dimension);
                imagingDeltas.push({
                    organ_name: m.organ_name,
                    prior_dimension: prior.dimension,
                    new_dimension: m.dimension,
                    max_axis_delta_cm: (curMax != null && priorMax != null) ? (curMax - priorMax) : null,
                    measurement_date: m.measurement_date,
                    prior_date: prior.measurement_date,
                });
            }
        }

        // ---- Summary ----
        const days_between = Math.round((to_snap.head.generated_at - from_snap.head.generated_at) / 86400000);
        const summaryDiff = {
            from_version: fromV,
            to_version: toV,
            from_generated_at: from_snap.head.generated_at,
            to_generated_at: to_snap.head.generated_at,
            days_between,
            encounter_delta: (to_snap.head.encounter_count || 0) - (from_snap.head.encounter_count || 0),
            dominant_category_change: from_snap.head.dominant_category !== to_snap.head.dominant_category
                ? { from: from_snap.head.dominant_category, to: to_snap.head.dominant_category }
                : null,
        };

        return jsonResponse({
            ok: true,
            patient_id,
            summary: summaryDiff,
            newProblems,
            resolvedProblems,
            changedStatuses,
            removedProblems,
            newRecommendations,
            removedRecommendations,
            newActionItems,
            imagingDeltas,
        });
    });
}
