// =====================================================================
// POST /api/v1/admin/billing/era — ingest an 835 ERA, auto-post to claims
// =====================================================================
// The INBOUND rail. Accepts a raw X12 835 remittance (text body, or JSON
// { edi }), parses it, and posts each claim payment: flips billing_claims
// to paid / partially_paid / denied / reversed, stamps paid_at, records the
// CARC/RARC reason codes and the remittance detail, and audit-logs it.
//
// Auth (either):
//   * admin (adminRoute) — manual paste/upload from the go-live console, OR
//   * X-Pipeline-Token: <PIPELINE_TOKEN> — automated push from a clearinghouse
//     webhook / cron ERA fetch.
//
// Match: 835 CLP01 (patient control number) === billing_claims.id (the submit
// endpoint sets CLM01 to the claim id). Unmatched claims are reported, never
// guessed.
// =====================================================================

import { adminRoute, jsonResponse, jsonError } from "../../../../_lib/admin_api.js";
import { logAudit } from "../../../../_lib/audit.js";
import { parse835 } from "../../../../_lib/x12_835.js";

async function readEdi(request) {
    const ct = (request.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("application/json")) {
        const j = await request.json().catch(() => ({}));
        return j.edi || "";
    }
    return await request.text();
}

async function postEra(env, edi, actor, ctx) {
    if (!edi || edi.indexOf("CLP") < 0) return jsonError("body is not an 835 remittance (no CLP segment)", 400);
    const era = parse835(edi);
    const now = Date.now();
    const results = [];
    let matched = 0, postedCents = 0;

    for (const c of era.claims) {
        const pcn = c.patientControlNumber;
        if (!pcn) { results.push({ patientControlNumber: null, matched: false }); continue; }
        const claim = await env.DB.prepare(`SELECT id, status, total_charge_cents FROM billing_claims WHERE id = ?`).bind(pcn).first()
            .catch(() => null);
        if (!claim) { results.push({ patientControlNumber: pcn, matched: false, mappedStatus: c.mappedStatus }); continue; }

        const reason = `${c.statusLabel}${c.reasonCodes.length ? " · CARC " + c.reasonCodes.join(",") : ""}`;
        const isPaid = c.mappedStatus === "paid" || c.mappedStatus === "partially_paid";
        await env.DB.prepare(
            `UPDATE billing_claims
                SET status = ?, status_reason = ?, paid_at = COALESCE(paid_at, ?),
                    clearinghouse_response_json = ?, updated_at = ?
              WHERE id = ?`
        ).bind(
            c.mappedStatus, reason, isPaid ? now : null,
            JSON.stringify({ era: { trace: era.payment.traceNumber, payer: era.payerName, status: c.statusLabel, charge_cents: c.chargeCents, paid_cents: c.paidCents, patient_resp_cents: c.patientRespCents, reason_codes: c.reasonCodes, adjustments: c.adjustments, lines: c.lines } }),
            now, pcn,
        ).run();
        matched++; postedCents += c.paidCents;
        results.push({ patientControlNumber: pcn, matched: true, mappedStatus: c.mappedStatus, paid_cents: c.paidCents, reason_codes: c.reasonCodes });
    }

    try {
        await logAudit(env, {
            actor: actor || "era", action: "billing.era.post",
            entity_type: "billing_era", entity_id: era.payment.traceNumber || "era",
            detail: JSON.stringify({ payer: era.payerName, trace: era.payment.traceNumber, claims: era.claims.length, matched, posted_cents: postedCents }),
        }, ctx);
    } catch {}

    return jsonResponse({
        ok: true,
        payer: era.payerName, payee: era.payeeName,
        payment: { trace: era.payment.traceNumber, method: era.payment.method, amount_cents: era.payment.amountCents, date: era.payment.date },
        claims_in_era: era.claims.length, claims_matched: matched, claims_unmatched: era.claims.length - matched,
        posted_cents: postedCents,
        results,
    });
}

export async function onRequestPost(ctx) {
    const { request, env } = ctx;
    const token = request.headers.get("X-Pipeline-Token");
    if (token && env.PIPELINE_TOKEN && token === env.PIPELINE_TOKEN) {
        const edi = await readEdi(request);
        return postEra(env, edi, "pipeline", ctx);
    }
    return adminRoute(ctx, async ({ env: e, request: r, admin }) => {
        const edi = await readEdi(r);
        return postEra(e, edi, (admin && admin.user) || "admin", ctx);
    });
}
