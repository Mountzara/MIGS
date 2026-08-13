// eligibility_router.js — check coverage first, then route the claim.
//
// WHAT THIS REPLACES (2026-08-12). The clearinghouse page asked the physician
// to "assign each payer category to the clearinghouse you enrolled it with" —
// a manual mapping table, maintained by hand, by someone who has said plainly
// that billing is foreign to him. Wrong division of labor. This module decides
// automatically:
//
//     eligibility (270/271) ──► active? ──► pick the best clearinghouse for
//                                            THIS payer ──► submit (837P)
//                              └► inactive/error ──► STOP before submitting
//
// WHY ELIGIBILITY FIRST: "patient not eligible / coverage terminated" (CARC 27)
// is one of the most common denials and one of the most preventable — the
// answer is knowable BEFORE the claim is sent. A claim submitted against dead
// coverage is guaranteed rework. Checking first converts a denial into a
// front-desk conversation.
//
// ROUTING DOCTRINE: route by CAPABILITY, not by preference. A vendor is only
// eligible to carry a payer if (a) the practice is actually enrolled with that
// vendor, and (b) the vendor is confirmed to reach that payer for that
// transaction. Anything else falls to the default. Capability facts come from
// the vendor catalog (clearinghouse.js) and the practice's own enrollment
// records — never from an assumption about who "probably" supports whom.

import { CLEARINGHOUSES } from "./clearinghouse.js";

/** Transaction kinds we route independently — a vendor may be great at one and absent at another. */
export const TXN = { ELIGIBILITY: "eligibility", CLAIM: "claim", ERA: "era" };

/**
 * Practice enrollment state, loaded from D1. A vendor the practice has NOT
 * enrolled with is not a routing candidate no matter how capable it is.
 * @returns {Promise<Array<{vendor, enrolled, payer_ids:Set<string>, txns:Set<string>}>>}
 */
export async function loadEnrollments(env) {
    if (!env || !env.DB) return [];
    const rows = await env.DB.prepare(
        `SELECT vendor, status, supported_txns, payer_ids
           FROM billing_clearinghouse_enrollments
          WHERE status = 'active'`
    ).all().catch(() => ({ results: [] }));
    return (rows.results || []).map((r) => ({
        vendor: r.vendor,
        enrolled: true,
        payer_ids: new Set(safeParseArray(r.payer_ids)),
        txns: new Set(safeParseArray(r.supported_txns)),
    }));
}

function safeParseArray(s) {
    try { const v = JSON.parse(s || "[]"); return Array.isArray(v) ? v : []; }
    catch { return []; }
}

/**
 * Choose the clearinghouse for one transaction against one payer.
 *
 * Preference order, applied ONLY among vendors the practice is enrolled with
 * and that support the transaction:
 *   1. A vendor explicitly listing this payer id (a confirmed connection).
 *   2. The vendor flagged `recommended` in the catalog.
 *   3. Any remaining enrolled vendor (deterministic: alphabetical, so routing
 *      is reproducible and auditable rather than incidental).
 *
 * @returns {{vendor:string|null, reason:string, candidates:string[]}}
 */
export function chooseVendor({ enrollments = [], payerId = "", txn = TXN.CLAIM } = {}) {
    const usable = enrollments.filter((e) => e.enrolled && (e.txns.size === 0 || e.txns.has(txn)));
    if (!usable.length) {
        return {
            vendor: null,
            reason: "No enrolled clearinghouse supports this transaction yet — enrollment is the blocker, not configuration.",
            candidates: [],
        };
    }
    const direct = usable.filter((e) => payerId && e.payer_ids.has(String(payerId)));
    if (direct.length === 1) {
        return { vendor: direct[0].vendor, reason: `Confirmed connection to payer ${payerId}.`, candidates: direct.map((d) => d.vendor) };
    }
    if (direct.length > 1) {
        const pick = preferRecommended(direct);
        return { vendor: pick, reason: `Multiple vendors reach payer ${payerId}; chose the catalog-recommended one.`, candidates: direct.map((d) => d.vendor) };
    }
    const pick = preferRecommended(usable);
    return {
        vendor: pick,
        reason: payerId
            ? `No vendor lists payer ${payerId} explicitly — using the recommended enrolled vendor. Verify this payer is reachable before relying on it.`
            : "No payer id supplied — using the recommended enrolled vendor.",
        candidates: usable.map((u) => u.vendor),
    };
}

function preferRecommended(list) {
    const recommended = new Set(CLEARINGHOUSES.filter((c) => c.recommended).map((c) => c.vendor));
    const rec = list.filter((e) => recommended.has(e.vendor)).map((e) => e.vendor).sort();
    if (rec.length) return rec[0];
    return list.map((e) => e.vendor).sort()[0];
}

/**
 * Interpret a 271 eligibility response into a submit / hold decision.
 * Conservative by construction: anything that is not an affirmative "active"
 * holds the claim. An unreadable response is NOT treated as coverage.
 *
 * @param {object} resp normalized 271 result from the clearinghouse adapter
 * @returns {{active:boolean, submit:boolean, reason:string, payerId:string|null,
 *            planName:string|null, copayCents:number|null, deductibleRemainingCents:number|null}}
 */
export function interpretEligibility(resp) {
    if (!resp || typeof resp !== "object") {
        return { active: false, submit: false, reason: "No eligibility response — holding the claim rather than assuming coverage.", payerId: null, planName: null, copayCents: null, deductibleRemainingCents: null };
    }
    const status = String(resp.coverage_status || resp.status || "").toLowerCase();
    const active = status === "active" || resp.active === true;
    const payerId = resp.payer_id ? String(resp.payer_id) : null;
    const planName = resp.plan_name || null;

    if (!active) {
        const why = status === "inactive" || status === "terminated"
            ? "Payer reports coverage INACTIVE for this date of service."
            : `Payer did not affirm active coverage (status: ${status || "unknown"}).`;
        return {
            active: false, submit: false,
            reason: `${why} Resolve with the patient before submitting — this is CARC 27 waiting to happen.`,
            payerId, planName, copayCents: null, deductibleRemainingCents: null,
        };
    }
    return {
        active: true, submit: true,
        reason: "Active coverage confirmed for the date of service.",
        payerId, planName,
        copayCents: intOrNull(resp.copay_cents),
        deductibleRemainingCents: intOrNull(resp.deductible_remaining_cents),
    };
}

function intOrNull(v) { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : null; }

/**
 * The whole front half, in one call: verify coverage, then pick the carrier.
 * Returns a decision object the claim pipeline (and the UI) can act on without
 * anyone hand-maintaining a payer→vendor table.
 */
export async function planSubmission(env, { eligibilityResponse, payerId, txn = TXN.CLAIM } = {}) {
    const elig = interpretEligibility(eligibilityResponse);
    const enrollments = await loadEnrollments(env);
    const effectivePayer = elig.payerId || payerId || "";
    const route = chooseVendor({ enrollments, payerId: effectivePayer, txn });

    const blocked = !elig.submit || !route.vendor;
    return {
        eligibility: elig,
        routing: route,
        submit: !blocked,
        blocked_reason: blocked
            ? (!elig.submit ? elig.reason : route.reason)
            : null,
    };
}

export default { planSubmission, chooseVendor, interpretEligibility, loadEnrollments, TXN };
