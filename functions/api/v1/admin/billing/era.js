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

// An ERA may only post against a claim we actually put on the wire. A claim
// still in an editable/pre-submit state (pending_review, edited,
// ready_to_submit) receiving a remittance means the control numbers collided
// or someone is posting to the wrong record — we report it, never flip it.
// Re-posting onto paid/denied IS allowed (payer reversals, secondary ERAs).
const POSTABLE = new Set([
    "submitted", "accepted_by_clearinghouse", "accepted",
    "paid", "partially_paid", "denied", "rejected", "reversed",
]);

async function readEdi(request) {
    const ct = (request.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("application/json")) {
        const j = await request.json().catch(() => ({}));
        return j.edi || "";
    }
    return await request.text();
}

// Constant-time comparison of the pipeline bearer token. A naive `a === b`
// short-circuits on the first differing byte, leaking length/prefix timing.
// Digesting both sides to fixed-width SHA-256 and comparing those bytes
// removes the length and content timing channel.
async function tokensMatch(a, b) {
    if (!a || !b) return false;
    const enc = new TextEncoder();
    const [da, db] = await Promise.all([
        crypto.subtle.digest("SHA-256", enc.encode(a)),
        crypto.subtle.digest("SHA-256", enc.encode(b)),
    ]);
    const va = new Uint8Array(da), vb = new Uint8Array(db);
    let diff = 0;
    for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
    return diff === 0;
}

async function postEra(env, edi, actor, ctx) {
    if (!edi || edi.indexOf("CLP") < 0) return jsonError("body is not an 835 remittance (no CLP segment)", 400);
    const era = parse835(edi);
    const now = Date.now();
    const results = [];
    let matched = 0, postedCents = 0, skipped = 0;

    for (const c of era.claims) {
        const pcn = c.patientControlNumber;
        if (!pcn) { results.push({ patientControlNumber: null, matched: false }); continue; }
        const claim = await env.DB.prepare(`SELECT id, status, total_charge_cents, clearinghouse_response_json FROM billing_claims WHERE id = ?`).bind(pcn).first()
            .catch(() => null);
        if (!claim) { results.push({ patientControlNumber: pcn, matched: false, mappedStatus: c.mappedStatus }); continue; }
        // Status guard: don't let an ERA overwrite a claim we never submitted.
        if (!POSTABLE.has(claim.status)) {
            skipped++;
            results.push({ patientControlNumber: pcn, matched: false, skipped: true, current_status: claim.status, mappedStatus: c.mappedStatus, reason: "claim not in a posted state — ERA not applied" });
            continue;
        }

        const reason = `${c.statusLabel}${c.reasonCodes.length ? " · CARC " + c.reasonCodes.join(",") : ""}`;
        const isPaid = c.mappedStatus === "paid" || c.mappedStatus === "partially_paid";
        // Merge: preserve the submission record (control numbers, 837 ack) and
        // attach the remittance under `.era` rather than clobbering it.
        let merged = {};
        try { merged = claim.clearinghouse_response_json ? JSON.parse(claim.clearinghouse_response_json) : {}; } catch { merged = {}; }
        merged.era = { trace: era.payment.traceNumber, payer: era.payerName, status: c.statusLabel, charge_cents: c.chargeCents, paid_cents: c.paidCents, patient_resp_cents: c.patientRespCents, reason_codes: c.reasonCodes, adjustments: c.adjustments, lines: c.lines, posted_at: now };
        await env.DB.prepare(
            `UPDATE billing_claims
                SET status = ?, status_reason = ?, paid_at = COALESCE(paid_at, ?),
                    clearinghouse_response_json = ?, updated_at = ?
              WHERE id = ?`
        ).bind(
            c.mappedStatus, reason, isPaid ? now : null,
            JSON.stringify(merged),
            now, pcn,
        ).run();
        matched++; postedCents += c.paidCents;
        results.push({ patientControlNumber: pcn, matched: true, mappedStatus: c.mappedStatus, paid_cents: c.paidCents, reason_codes: c.reasonCodes });
    }

    try {
        await logAudit(env, {
            user_id: actor || "pipeline", user_role: actor === "pipeline" ? "app" : "staff",
            action: "claim_era_post", record_type: "billing_era", record_id: era.payment.traceNumber || "era",
            success: true,
            details: { payer: era.payerName, trace: era.payment.traceNumber, claims: era.claims.length, matched, skipped, posted_cents: postedCents },
        }, ctx);
    } catch {}

    return jsonResponse({
        ok: true,
        payer: era.payerName, payee: era.payeeName,
        payment: { trace: era.payment.traceNumber, method: era.payment.method, amount_cents: era.payment.amountCents, date: era.payment.date },
        claims_in_era: era.claims.length, claims_matched: matched, claims_unmatched: era.claims.length - matched, claims_skipped: skipped,
        posted_cents: postedCents,
        results,
    });
}

export async function onRequestPost(ctx) {
    const { request, env } = ctx;
    const token = request.headers.get("X-Pipeline-Token");
    if (token && env.PIPELINE_TOKEN && await tokensMatch(token, env.PIPELINE_TOKEN)) {
        const edi = await readEdi(request);
        return postEra(env, edi, "pipeline", ctx);
    }
    return adminRoute(ctx, async ({ env: e, request: r, admin }) => {
        const edi = await readEdi(r);
        return postEra(e, edi, (admin && admin.user) || "admin", ctx);
    });
}
