// =====================================================================
// /api/v1/admin/billing/payers/:id — edit + delete a payer contract
// =====================================================================
// Phase 8 Round B.
//
// GET    — single payer detail (with claim summary)
// PATCH  — update fields. Only provided fields are touched.
// DELETE — soft-block if any billing_claims still reference the payer;
//          otherwise hard-deletes.
//
// Auth: admin Basic Auth.
// =====================================================================

import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../../../_lib/admin_api.js";

const ALLOWED_KINDS = new Set(["commercial", "medicare", "medicaid", "workers_comp", "self_pay"]);
const ALLOWED_CONTRACT_STATUS = new Set(["pending", "signed", "active", "terminated"]);
const ALLOWED_VENDORS = new Set(["availity", "office_ally", "change_healthcare", "waystar", "claim_md", "direct"]);

function s(v, max = 256) {
    if (v == null) return v;       // distinguish "not provided" from "cleared"
    if (v === "") return null;
    const str = String(v);
    return str.length > max ? str.slice(0, max) : str;
}
function isDateOrNull(v) {
    if (v == null) return v;
    if (v === "") return null;
    return /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : null;
}

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env, params }) => {
        const id = params && params.id ? String(params.id) : "";
        if (!id) return jsonError("missing_id", 400);

        const payer = await env.DB.prepare(`
            SELECT
                bp.*,
                (SELECT COUNT(*) FROM billing_claims WHERE payer_id = bp.id) AS claim_count,
                (SELECT COUNT(*) FROM billing_claims WHERE payer_id = bp.id AND status = 'paid') AS claim_paid_count,
                (SELECT COUNT(*) FROM billing_claims WHERE payer_id = bp.id AND status = 'denied') AS claim_denied_count
            FROM billing_payers bp
            WHERE bp.id = ?
        `).bind(id).first();
        if (!payer) return jsonError("payer_not_found", 404);
        return jsonResponse({ ok: true, payer });
    });
}

export async function onRequestPatch(ctx) {
    return adminRoute(ctx, async ({ env, params, request }) => {
        const id = params && params.id ? String(params.id) : "";
        if (!id) return jsonError("missing_id", 400);

        const existing = await env.DB.prepare(`SELECT id FROM billing_payers WHERE id = ?`).bind(id).first();
        if (!existing) return jsonError("payer_not_found", 404);

        const body = await readJsonBody(request);
        const sets = [];
        const args = [];

        function push(col, v) { sets.push(`${col} = ?`); args.push(v); }

        if ("payer_id" in body)               push("payer_id", s(body.payer_id, 32));
        if ("payer_name" in body) {
            const v = s(body.payer_name, 256);
            if (!v) return jsonError("payer_name_required", 400);
            push("payer_name", v);
        }
        if ("payer_kind" in body) {
            const v = s(body.payer_kind, 32);
            if (v && !ALLOWED_KINDS.has(v)) return jsonError("invalid_payer_kind", 400, { allowed: Array.from(ALLOWED_KINDS) });
            push("payer_kind", v);
        }
        if ("contract_status" in body) {
            const v = s(body.contract_status, 32);
            if (v && !ALLOWED_CONTRACT_STATUS.has(v)) return jsonError("invalid_contract_status", 400, { allowed: Array.from(ALLOWED_CONTRACT_STATUS) });
            push("contract_status", v);
        }
        if ("contract_effective_date" in body)    push("contract_effective_date", isDateOrNull(body.contract_effective_date));
        if ("contract_termination_date" in body)  push("contract_termination_date", isDateOrNull(body.contract_termination_date));
        if ("fee_schedule_pct_medicare" in body) {
            if (body.fee_schedule_pct_medicare == null || body.fee_schedule_pct_medicare === "") {
                push("fee_schedule_pct_medicare", null);
            } else {
                const n = Number(body.fee_schedule_pct_medicare);
                if (!Number.isFinite(n)) return jsonError("invalid_fee_pct", 400);
                push("fee_schedule_pct_medicare", n);
            }
        }
        if ("submission_address" in body) push("submission_address", s(body.submission_address, 512));
        if ("appeals_address" in body)    push("appeals_address", s(body.appeals_address, 512));
        if ("notes" in body)              push("notes", s(body.notes, 2000));
        if ("clearinghouse_vendor" in body) {
            const v = s(body.clearinghouse_vendor, 32);
            if (v && !ALLOWED_VENDORS.has(v)) return jsonError("invalid_clearinghouse_vendor", 400, { allowed: Array.from(ALLOWED_VENDORS) });
            push("clearinghouse_vendor", v);
        }
        if ("rate_schedule" in body) {
            if (body.rate_schedule == null) push("rate_schedule_json", null);
            else if (typeof body.rate_schedule === "object") {
                try { push("rate_schedule_json", JSON.stringify(body.rate_schedule).slice(0, 64 * 1024)); }
                catch { return jsonError("invalid_rate_schedule", 400); }
            } else return jsonError("invalid_rate_schedule", 400);
        }

        if (sets.length === 0) return jsonError("no_fields_to_update", 400);

        const now = Date.now();
        sets.push("updated_at = ?");
        args.push(now);
        args.push(id);

        await env.DB.prepare(`UPDATE billing_payers SET ${sets.join(", ")} WHERE id = ?`).bind(...args).run();
        return jsonResponse({ ok: true, id, updated_at: now });
    });
}

export async function onRequestDelete(ctx) {
    return adminRoute(ctx, async ({ env, params }) => {
        const id = params && params.id ? String(params.id) : "";
        if (!id) return jsonError("missing_id", 400);

        const claim_check = await env.DB.prepare(`SELECT COUNT(*) AS n FROM billing_claims WHERE payer_id = ?`).bind(id).first();
        if (claim_check && claim_check.n > 0) {
            return jsonError("payer_has_claims", 409, {
                claim_count: claim_check.n,
                hint: "Re-assign or close those claims first, or set contract_status='terminated' to disable without deleting.",
            });
        }
        await env.DB.prepare(`DELETE FROM billing_payers WHERE id = ?`).bind(id).run();
        return jsonResponse({ ok: true, deleted: id });
    });
}
