// =====================================================================
// /api/v1/admin/billing/claims/:id/appeal
// =====================================================================
// DENIAL REMEDIATION. For a denied / rejected / partially-paid claim:
//   GET  → list prior appeal drafts for this claim.
//   POST → draft the response (corrected claim vs appeal vs reconsideration
//          vs patient-bill), grounded in the claim's 835 CARC codes; the
//          AI authors the letter + the medical-necessity argument. The
//          draft is persisted to billing_appeals.
//
// POST body (JSON, optional):
//   { mark_appealed: true }  → also transition the claim status to
//                              'appealed' and stamp status_reason.
//
// PHI: the appeal letter carries patient identifiers by necessity; the
// executed Anthropic BAA permits this and the draft is audit-logged as a
// PHI-bearing AI event. Auth: adminRoute.
// =====================================================================

import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../../../../_lib/admin_api.js";
import { logAudit } from "../../../../../../_lib/audit.js";
import { draftAppeal } from "../../../../../../_lib/billing_appeal.js";
import { newId } from "../../../../../../_lib/db.js";

const APPEALABLE = new Set(["denied", "rejected", "partially_paid", "appealed"]);

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env, params }) => {
        const id = params && params.id ? String(params.id) : "";
        if (!id) return jsonError("missing_claim_id", 400);
        const rows = await env.DB.prepare(
            `SELECT id, claim_id, strategy, status, carc_codes, deadline_note, ai_used, model, created_by, created_at, updated_at
               FROM billing_appeals WHERE claim_id = ? ORDER BY created_at DESC`
        ).bind(id).all().then((r) => r.results || []).catch(() => []);
        return jsonResponse({ appeals: rows });
    });
}

export async function onRequestPost(ctx) {
    return adminRoute(ctx, async ({ env, params, request, admin }) => {
        const id = params && params.id ? String(params.id) : "";
        if (!id) return jsonError("missing_claim_id", 400);
        const body = (await readJsonBody(request)) || {};

        const claim = await env.DB.prepare(`SELECT * FROM billing_claims WHERE id = ?`).bind(id).first();
        if (!claim) return jsonError("claim_not_found", 404);
        if (!APPEALABLE.has(claim.status)) {
            return jsonError(`claim status "${claim.status}" is not in a denied/rejected state — nothing to appeal`, 409, { status: claim.status });
        }

        // Pull the ERA denial detail recorded by the inbound rail.
        let era = {};
        try {
            const j = claim.clearinghouse_response_json ? JSON.parse(claim.clearinghouse_response_json) : {};
            era = j.era || {};
        } catch { era = {}; }
        // If the ERA had no codes, fall back to any codes parsed out of status_reason ("… · CARC 97,11").
        if (!(era.reason_codes && era.reason_codes.length)) {
            const m = String(claim.status_reason || "").match(/CARC\s+([0-9A-Za-z,]+)/);
            if (m) era.reason_codes = m[1].split(",").map((s) => s.trim()).filter(Boolean);
        }

        const [lines, diags, patient, insurance, payer] = await Promise.all([
            env.DB.prepare(`SELECT * FROM billing_claim_lines WHERE claim_id = ? ORDER BY line_number`).bind(id).all().then((r) => r.results || []),
            env.DB.prepare(`SELECT * FROM billing_claim_diagnoses WHERE claim_id = ? ORDER BY diagnosis_index`).bind(id).all().then((r) => r.results || []),
            env.DB.prepare(`SELECT first_name, last_name, dob FROM patients WHERE id = ?`).bind(claim.patient_id).first().catch(() => null),
            env.DB.prepare(`SELECT * FROM patient_insurance WHERE patient_id = ? AND active = 1 AND rank = 'primary' ORDER BY updated_at DESC LIMIT 1`).bind(claim.patient_id).first().catch(() => null),
            claim.payer_id ? env.DB.prepare(`SELECT * FROM billing_payers WHERE id = ?`).bind(claim.payer_id).first().catch(() => null) : Promise.resolve(null),
        ]);
        const payerRow = payer || (insurance && insurance.payer_id ? await env.DB.prepare(`SELECT * FROM billing_payers WHERE id = ?`).bind(insurance.payer_id).first().catch(() => null) : null);

        const now = Date.now();
        const draft = await draftAppeal(env, { claim, era, lines, diags, payer: payerRow, patient, insurance }, now);

        const appealId = newId();
        try {
            await env.DB.prepare(
                `INSERT INTO billing_appeals (id, claim_id, strategy, status, carc_codes, letter_text, remediation_json, deadline_note, ai_used, model, prompt_version, created_by, created_at, updated_at)
                 VALUES (?, ?, ?, 'drafted', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
                appealId, id, draft.strategy || null,
                JSON.stringify((era.reason_codes) || []),
                draft.appeal_letter || "",
                JSON.stringify({ carc_explanations: draft.carc_explanations, corrected_claim_changes: draft.corrected_claim_changes, supporting_points: draft.supporting_points, strategy_rationale: draft.strategy_rationale }),
                draft.deadline_note || "",
                draft.ai_used ? 1 : 0, draft.model || null, draft.prompt_version || null,
                (admin && admin.user) || "admin", now, now,
            ).run();
        } catch (e) { /* table may not exist on first deploy; still return the draft */ }

        // Optionally flag the claim as appealed.
        let statusChanged = false;
        if (body.mark_appealed === true && claim.status !== "appealed") {
            await env.DB.prepare(`UPDATE billing_claims SET status = 'appealed', status_reason = ?, updated_at = ? WHERE id = ?`)
                .bind(`Appeal drafted (${draft.strategy})`, now, id).run().catch(() => {});
            statusChanged = true;
        }

        try {
            await logAudit(env, {
                user_id: (admin && admin.user) || "admin", user_role: "staff", action: "claim_appeal_draft",
                record_type: "billing_claim", record_id: id, success: true,
                // PHI-free audit detail: codes + strategy only, never patient identity.
                details: { appeal_id: appealId, ai_used: draft.ai_used, strategy: draft.strategy, carc: (era.reason_codes) || [], mark_appealed: statusChanged, model: draft.model, phi_sent_to_ai: !!(env.ANTHROPIC_API_KEY) },
            }, ctx);
        } catch {}

        return jsonResponse({ ok: true, claim_id: id, appeal_id: appealId, status_changed: statusChanged, draft });
    });
}
