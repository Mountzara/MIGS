// =====================================================================
// GET /api/v1/admin/billing/claims/:id — full claim drill-down for review.
// =====================================================================
// Returns the claim row, every line, every diagnosis, every compliance
// flag (with severity tally), every upcoding opportunity, every doc
// suggestion, plus the audit-log tail for context. Powers the
// /admin/billing/?id=<claim_id> drill-down view.
//
// Auth: admin Basic Auth via adminRoute.
// =====================================================================

import { adminRoute, jsonResponse, jsonError } from "../../../../../_lib/admin_api.js";

function safeParseJson(s) {
    if (!s || typeof s !== "string") return null;
    try { return JSON.parse(s); } catch { return null; }
}

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env, params, request }) => {
        const claim_id = (params && params.id) ? String(params.id) : "";
        if (!claim_id) return jsonError("missing_claim_id", 400);

        const claim = await env.DB.prepare(`
            SELECT
                bc.*,
                p.first_name AS patient_first_name,
                p.last_name  AS patient_last_name,
                p.email      AS patient_email,
                p.dob        AS patient_dob,   -- the column is `dob`; `date_of_birth` does not exist and threw here
                bp.payer_name,
                bp.payer_kind,
                bp.contract_status AS payer_contract_status,
                bp.clearinghouse_vendor
            FROM billing_claims bc
            LEFT JOIN patients p ON p.id = bc.patient_id
            LEFT JOIN billing_payers bp ON bp.id = bc.payer_id
            WHERE bc.id = ?
        `).bind(claim_id).first();

        if (!claim) return jsonError("claim_not_found", 404);

        // Hydrate JSON fields.
        claim.em_documentation_audit = safeParseJson(claim.em_documentation_audit_json);
        delete claim.em_documentation_audit_json;
        claim.ai_compliance_metrics = safeParseJson(claim.ai_compliance_metrics_json);
        delete claim.ai_compliance_metrics_json;
        claim.clearinghouse_response = safeParseJson(claim.clearinghouse_response_json);
        delete claim.clearinghouse_response_json;

        const [linesR, diagnosesR, flagsR, upcodingR, docSuggR, auditR] = await Promise.all([
            env.DB.prepare(`
                SELECT * FROM billing_claim_lines
                WHERE claim_id = ?
                ORDER BY line_number ASC
            `).bind(claim_id).all(),
            env.DB.prepare(`
                SELECT * FROM billing_claim_diagnoses
                WHERE claim_id = ?
                ORDER BY diagnosis_index ASC
            `).bind(claim_id).all(),
            env.DB.prepare(`
                SELECT * FROM billing_compliance_flags
                WHERE claim_id = ?
                ORDER BY
                    CASE severity
                        WHEN 'error' THEN 1
                        WHEN 'warning' THEN 2
                        WHEN 'info' THEN 3
                        ELSE 4
                    END,
                    created_at DESC
            `).bind(claim_id).all(),
            env.DB.prepare(`
                SELECT * FROM billing_upcoding_opportunities
                WHERE claim_id = ?
                ORDER BY confidence DESC, wrvu_delta DESC
            `).bind(claim_id).all(),
            env.DB.prepare(`
                SELECT * FROM billing_documentation_suggestions
                WHERE claim_id = ?
                ORDER BY
                    CASE priority
                        WHEN 'high' THEN 1
                        WHEN 'medium' THEN 2
                        WHEN 'low' THEN 3
                        ELSE 4
                    END,
                    created_at DESC
            `).bind(claim_id).all(),
            env.DB.prepare(`
                SELECT * FROM billing_audit_log
                WHERE claim_id = ?
                ORDER BY ts DESC
                LIMIT 40
            `).bind(claim_id).all(),
        ]);

        // Hydrate JSON fields in lines + diagnoses.
        const lines = (linesR.results || []).map((ln) => {
            ln.supporting_evidence = safeParseJson(ln.supporting_evidence_json);
            ln.alternatives_considered = safeParseJson(ln.alternatives_considered_json);
            delete ln.supporting_evidence_json;
            delete ln.alternatives_considered_json;
            return ln;
        });
        const diagnoses = (diagnosesR.results || []).map((dx) => {
            dx.supporting_evidence = safeParseJson(dx.supporting_evidence_json);
            delete dx.supporting_evidence_json;
            return dx;
        });
        const flags = flagsR.results || [];
        const upcoding = upcodingR.results || [];
        const doc_suggestions = docSuggR.results || [];
        const audit_tail = (auditR.results || []).map((row) => {
            row.details = safeParseJson(row.details_json);
            delete row.details_json;
            return row;
        });

        // Severity tally for header chips.
        const tally = {
            errors:   flags.filter((f) => f.severity === "error" && !f.resolved).length,
            warnings: flags.filter((f) => f.severity === "warning" && !f.resolved).length,
            info:     flags.filter((f) => f.severity === "info" && !f.resolved).length,
            errors_resolved:   flags.filter((f) => f.severity === "error" && f.resolved).length,
            warnings_resolved: flags.filter((f) => f.severity === "warning" && f.resolved).length,
        };

        return jsonResponse({
            ok: true,
            claim,
            lines,
            diagnoses,
            flags,
            upcoding_opportunities: upcoding,
            documentation_suggestions: doc_suggestions,
            audit_tail,
            tally,
        });
    });
}
