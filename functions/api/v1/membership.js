// =====================================================================
// /api/v1/membership — the public membership offer
// =====================================================================
// GET → tiers, what each is worth a la carte, the evidence behind the
//       comparison, and the compliance posture. No authentication: this
//       is the shop window, and a price a patient has to sign in to see
//       is a price they assume is bad.
//
// WHAT IS DELIBERATELY NOT HERE
//   * No unit economics. Margins, his hourly rate and the capacity model
//     are operator figures — useful in the admin console, nobody else's
//     business, and actively harmful in a sales context.
//   * No enrolment. Buying requires a session; see
//     /api/v1/patient/membership/subscribe.
//
// The evidence is served alongside the prices on purpose. The argument
// for this model is not "we are nicer" — it is that the ordinary path
// costs a patient 41.8 days to be seen and a mean 6.8 years to a
// diagnosis of endometriosis, both of which are published and checkable.
// Serving the citations with the price lets a patient verify the claim
// rather than trust it.
// =====================================================================

import {
    TIERS, valueComparison, EVIDENCE, MODEL_COMPARISON,
    SELF_PAY_PRINCIPLES, MEMBERSHIP_VERSION, validateTierLegality,
} from "../../_lib/membership.js";
import { DELIVERABLES, PATIENT_DISCLAIMER, licensedStates, licenceWarnings } from "../../_lib/visit_prep.js";

const CACHE_SECONDS = 300;

function json(body, status = 200) {
    return new Response(JSON.stringify(body, null, 2), {
        status,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            // Public and slow-changing. Short TTL so a price change is
            // live within minutes rather than whenever a cache expires.
            "Cache-Control": `public, max-age=60, s-maxage=${CACHE_SECONDS}`,
        },
    });
}

export async function onRequestGet(ctx) {
    const { env } = ctx;

    // A tier that fails its own legality check must never be offered for
    // sale. This runs on every request rather than at build time because
    // the failure mode is someone editing copy, and copy is what the
    // check reads.
    const offered = [];
    const suppressed = [];
    for (const t of TIERS) {
        const v = validateTierLegality(t);
        if (v.ok) offered.push(t);
        else suppressed.push({ tier: t.key, problems: v.problems });
    }
    if (suppressed.length) {
        console.error("membership: tier suppressed by legality check", JSON.stringify(suppressed));
    }

    const tiers = offered.map((t) => {
        const value = valueComparison(t.key);
        return {
            key: t.key,
            name: t.name,
            tagline: t.tagline,
            summary: t.summary,
            price_month: t.price_month,
            price_year: t.price_year,
            // Two months free on the annual term — stated rather than
            // left for the patient to work out.
            annual_saving: t.price_month > 0
                ? Math.max(0, t.price_month * 12 - t.price_year)
                : 0,
            benefits: (t.benefits || []).map((b) => b.label),
            scope_note: t.scope_note || null,
            value: value && value.alacarte_total > 0
                ? { alacarte_total: value.alacarte_total, headline: value.headline, rows: value.rows }
                : null,
        };
    });

    return json({
        ok: true,
        version: MEMBERSHIP_VERSION,
        tiers,
        comparison: MODEL_COMPARISON,
        evidence: EVIDENCE.map((e) => ({
            claim: e.claim, detail: e.detail, source: e.source,
            url: e.url, year: e.year, caveat: e.caveat || null,
        })),
        visit_prep: {
            deliverables: DELIVERABLES.map((d) => ({ name: d.name, what: d.what, why: d.why })),
            disclaimer: PATIENT_DISCLAIMER,
        },
        self_pay: SELF_PAY_PRINCIPLES,
        // Where a clinical consultation can actually be offered. Shown so
        // a patient outside those states is not sold an escalation path
        // that does not exist for them.
        consultation_states: licensedStates(env),
        // A lapsed licence would silently change the offer. If one is
        // expiring, say so here rather than discovering it at booking.
        licence_notice: licenceWarnings()
            .filter((w) => w.severity === "critical")
            .map((w) => w.message),
        disclosures: [
            "Membership is not insurance and does not pay for medical care.",
            "Your visits and procedures continue to be billed to your health plan in the ordinary way.",
            "Membership buys access and convenience — never a covered medical service.",
            "You may cancel at any time. Unused prepaid months are refunded pro rata.",
        ],
    });
}
