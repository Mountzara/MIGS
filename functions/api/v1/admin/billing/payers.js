// =====================================================================
// /api/v1/admin/billing/payers — list + create insurance payer contracts
// =====================================================================
// Phase 8 Round B. Powers /admin/billing/payers.
//
// GET   — list every billing_payers row (no pagination — solo practice
//          will have <50 contracts realistically).
// POST  — create a new payer contract.
//
// Auth: admin Basic Auth.
// =====================================================================

import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../../_lib/admin_api.js";
import { newId } from "../../../../_lib/db.js";

const ALLOWED_KINDS = new Set(["commercial", "medicare", "medicaid", "workers_comp", "self_pay"]);
const ALLOWED_CONTRACT_STATUS = new Set(["pending", "signed", "active", "terminated"]);
const ALLOWED_VENDORS = new Set(["availity", "office_ally", "change_healthcare", "waystar", "claim_md", "direct"]);

function s(v, max = 256) {
    if (v == null) return null;
    const str = String(v);
    return str.length > max ? str.slice(0, max) : str;
}
function isDateOrNull(v) {
    if (!v) return null;
    return /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : null;
}

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env }) => {
        const rowsR = await env.DB.prepare(`
            SELECT
                bp.*,
                (SELECT COUNT(*) FROM billing_claims WHERE payer_id = bp.id) AS claim_count,
                (SELECT COUNT(*) FROM billing_claims WHERE payer_id = bp.id AND status = 'paid') AS claim_paid_count,
                (SELECT SUM(expected_collection_cents) FROM billing_claims WHERE payer_id = bp.id AND status IN ('submitted','accepted_by_clearinghouse','paid','partially_paid')) AS in_flight_cents
            FROM billing_payers bp
            ORDER BY bp.contract_status ASC, bp.payer_name ASC
        `).all();
        return jsonResponse({ ok: true, payers: rowsR.results || [] });
    });
}

export async function onRequestPost(ctx) {
    return adminRoute(ctx, async ({ env, request, admin }) => {
        const body = await readJsonBody(request);
        const payer_name = s(body.payer_name, 256);
        if (!payer_name) return jsonError("missing_payer_name", 400);

        const payer_kind = s(body.payer_kind, 32) || "commercial";
        if (!ALLOWED_KINDS.has(payer_kind)) {
            return jsonError("invalid_payer_kind", 400, { allowed: Array.from(ALLOWED_KINDS) });
        }
        const contract_status = s(body.contract_status, 32) || "pending";
        if (!ALLOWED_CONTRACT_STATUS.has(contract_status)) {
            return jsonError("invalid_contract_status", 400, { allowed: Array.from(ALLOWED_CONTRACT_STATUS) });
        }
        const clearinghouse_vendor = body.clearinghouse_vendor ? s(body.clearinghouse_vendor, 32) : null;
        if (clearinghouse_vendor && !ALLOWED_VENDORS.has(clearinghouse_vendor)) {
            return jsonError("invalid_clearinghouse_vendor", 400, { allowed: Array.from(ALLOWED_VENDORS) });
        }

        const id = newId();
        const now = Date.now();
        const fee_pct = (body.fee_schedule_pct_medicare != null) ? Number(body.fee_schedule_pct_medicare) : null;
        let rate_schedule_json = null;
        if (body.rate_schedule && typeof body.rate_schedule === "object") {
            try { rate_schedule_json = JSON.stringify(body.rate_schedule).slice(0, 64 * 1024); } catch {}
        } else if (typeof body.rate_schedule_json === "string") {
            // Caller already provided a JSON string — validate parseability.
            try { JSON.parse(body.rate_schedule_json); rate_schedule_json = body.rate_schedule_json.slice(0, 64 * 1024); }
            catch { return jsonError("invalid_rate_schedule_json", 400); }
        }

        await env.DB.prepare(`
            INSERT INTO billing_payers
                (id, payer_id, payer_name, payer_kind,
                 contract_status, contract_effective_date, contract_termination_date,
                 rate_schedule_json, fee_schedule_pct_medicare,
                 submission_address, appeals_address,
                 clearinghouse_vendor, notes,
                 created_at, updated_at)
            VALUES (?, ?, ?, ?,
                    ?, ?, ?,
                    ?, ?,
                    ?, ?,
                    ?, ?,
                    ?, ?)
        `).bind(
            id,
            s(body.payer_id, 32),
            payer_name, payer_kind,
            contract_status,
            isDateOrNull(body.contract_effective_date),
            isDateOrNull(body.contract_termination_date),
            rate_schedule_json,
            (fee_pct != null && Number.isFinite(fee_pct)) ? fee_pct : null,
            s(body.submission_address, 512),
            s(body.appeals_address, 512),
            clearinghouse_vendor,
            s(body.notes, 2000),
            now, now,
        ).run();

        return jsonResponse({ ok: true, id, payer_name, payer_kind, contract_status, clearinghouse_vendor }, { status: 201 });
    });
}
