// =====================================================================
// GET /api/v1/admin/billing/claims — list claims for the review queue.
// =====================================================================
// Powers /admin/billing/ (the claim queue UI). Filters:
//   status      — comma-separated list of statuses (default: pending_review,edited)
//   payer_id    — filter to a specific payer
//   patient_id  — filter to a specific patient
//   days        — visit_date within last N days (default 60)
//   q           — search across patient name + em_code + visit_type
//   limit       — pagination (default 50, max 200)
//   offset      — pagination (default 0)
//
// Auth: admin Basic Auth via adminRoute.
// =====================================================================

import { adminRoute, jsonResponse, jsonError } from "../../../../_lib/admin_api.js";

const DEFAULT_STATUSES = ["pending_review", "edited"];
const ALL_STATUSES = new Set([
    "pending_review", "edited", "rejected",
    "ready_to_submit", "submitting",
    "submitted", "accepted_by_clearinghouse",
    "paid", "partially_paid",
    "denied", "appealed", "rebilled",
    "written_off",
]);

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env, request }) => {
        const url = new URL(request.url);
        const statusParam = url.searchParams.get("status");
        const statuses = statusParam
            ? statusParam.split(",").map((s) => s.trim()).filter((s) => ALL_STATUSES.has(s))
            : DEFAULT_STATUSES;
        if (statuses.length === 0) return jsonError("invalid_status_filter", 400);

        const payer_id   = url.searchParams.get("payer_id");
        const patient_id = url.searchParams.get("patient_id");
        const q          = (url.searchParams.get("q") || "").trim();
        const days       = Math.max(1, Math.min(365, parseInt(url.searchParams.get("days") || "60", 10) || 60));
        const limit      = Math.max(1, Math.min(200, parseInt(url.searchParams.get("limit") || "50", 10) || 50));
        const offset     = Math.max(0, parseInt(url.searchParams.get("offset") || "0", 10) || 0);

        const sinceDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

        // Build query dynamically.
        const conds = [
            `bc.status IN (${statuses.map(() => "?").join(",")})`,
            `bc.visit_date >= ?`,
        ];
        const args = [...statuses, sinceDate];

        if (payer_id) { conds.push(`bc.payer_id = ?`); args.push(payer_id); }
        if (patient_id) { conds.push(`bc.patient_id = ?`); args.push(patient_id); }
        if (q) {
            conds.push(`(LOWER(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')) LIKE ?
                       OR LOWER(COALESCE(bc.em_code, '')) LIKE ?
                       OR LOWER(COALESCE(bc.visit_type, '')) LIKE ?)`);
            const qLower = `%${q.toLowerCase()}%`;
            args.push(qLower, qLower, qLower);
        }

        const where = `WHERE ${conds.join(" AND ")}`;

        const rowsResult = await env.DB.prepare(`
            SELECT
                bc.id,
                bc.patient_id,
                bc.encounter_id,
                bc.source_session_id,
                bc.visit_date,
                bc.visit_type,
                bc.em_code,
                bc.em_mdm_level,
                bc.em_wrvu,
                bc.em_confidence,
                bc.total_wrvu,
                bc.total_charge_cents,
                bc.expected_collection_cents,
                bc.compliance_status,
                bc.medico_legal_score,
                bc.status,
                bc.status_reason,
                bc.payer_id,
                bp.payer_name,
                bp.payer_kind,
                bc.clinician_reviewed_at,
                bc.submitted_at,
                bc.paid_at,
                bc.created_at,
                bc.updated_at,
                p.first_name AS patient_first_name,
                p.last_name  AS patient_last_name,
                p.email      AS patient_email,
                (SELECT COUNT(*) FROM billing_compliance_flags WHERE claim_id = bc.id AND severity = 'error' AND resolved = 0) AS unresolved_errors,
                (SELECT COUNT(*) FROM billing_compliance_flags WHERE claim_id = bc.id AND severity = 'warning' AND resolved = 0) AS unresolved_warnings,
                (SELECT COUNT(*) FROM billing_upcoding_opportunities WHERE claim_id = bc.id AND accepted = 0) AS unaccepted_upcoding,
                (SELECT COUNT(*) FROM billing_documentation_suggestions WHERE claim_id = bc.id AND priority = 'high' AND applied = 0) AS unapplied_high_docsugg
            FROM billing_claims bc
            LEFT JOIN patients p ON p.id = bc.patient_id
            LEFT JOIN billing_payers bp ON bp.id = bc.payer_id
            ${where}
            ORDER BY bc.visit_date DESC, bc.created_at DESC
            LIMIT ? OFFSET ?
        `).bind(...args, limit, offset).all();

        const totalResult = await env.DB.prepare(`
            SELECT COUNT(*) AS n
            FROM billing_claims bc
            LEFT JOIN patients p ON p.id = bc.patient_id
            ${where}
        `).bind(...args).first();

        return jsonResponse({
            ok: true,
            claims: rowsResult.results || [],
            total: totalResult ? totalResult.n : 0,
            filters: { statuses, payer_id, patient_id, q, days, limit, offset },
        });
    });
}
