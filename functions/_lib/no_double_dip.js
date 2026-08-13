// =====================================================================
// no_double_dip.js — make billing a membership benefit STRUCTURALLY fail
// =====================================================================
// The owner's instruction, verbatim: "I will be taking NO chances with
// 'double dipping' and this infrastructure better be designed so this is
// impossible."
//
// Policy is not design. A rule in a handbook is broken by a busy person
// on a Tuesday. This module is the mechanism: it sits in the claim path
// and REFUSES to build a claim line for anything the patient's membership
// already paid for. Not a warning, not a flag on a report someone reads
// later — a refusal, before the claim exists.
//
// ---------------------------------------------------------------------
// WHAT DOUBLE DIPPING ACTUALLY IS HERE
// ---------------------------------------------------------------------
// It is NOT "a member had surgery and we billed insurance". That is
// correct and expected: membership never covers medical care, so the
// operation is billed exactly as it would be for anyone else.
//
// It IS "we charged a monthly fee that includes messaging with the
// surgeon, AND separately billed that patient's insurance for an online
// digital E/M". The patient paid twice for one thing, once directly and
// once through their premium. That is what the payer contract prohibits,
// what a state insurance regulator would call the fee a policy for, and
// what the OIG would look at first.
//
// THE CONCRETE RISK THAT ALREADY EXISTED IN THIS SYSTEM
// The Standard (free) tier deliberately routes clinically-significant
// messages into a billable online digital E/M — CPT 99421-99423 — so
// unpaid work does not accumulate. That is right for Standard. But
// Navigator, Priority and Complete all INCLUDE messaging in the fee. Bill
// 99421 for one of those members and the practice has been paid twice for
// the same message. Nothing stopped that until this file existed.
//
// ---------------------------------------------------------------------
// HOW THE GUARANTEE IS CONSTRUCTED
// ---------------------------------------------------------------------
//   1. Every membership benefit is declared non-covered
//      (membership.validateTierLegality). That is the first gate and it
//      guards the OFFER.
//   2. This module guards the CLAIM. Each tier declares the CPT ranges its
//      fee has already paid for. A claim line in that set, for a patient
//      with that tier active, is blocked outright.
//   3. The block is checked in BOTH directions: a new membership benefit
//      that maps onto a billable code fails the test suite, so the offer
//      cannot drift into the claim's territory either.
//
// The result is that the two revenue streams cannot touch: membership
// buys only things with no CPT code, and anything with a CPT code is
// billed to insurance and to nobody else.
// =====================================================================

import { tier } from "./membership.js";

/**
 * What each paid tier's fee has already bought, expressed as the codes
 * that must therefore never be billed for that member.
 *
 * Deliberately expressed as CODES rather than descriptions: a claim
 * carries codes, and matching on prose would be a guess.
 */
export const TIER_PAID_FOR = {
    // Free tier pays for nothing, so nothing is blocked. Messaging that
    // needs his judgement SHOULD become a billable online digital E/M —
    // that is the whole design of the free tier.
    standard: { codes: [], why: "The free tier includes no paid benefit, so nothing is blocked." },

    navigator: {
        codes: [],
        why: "Navigator buys preparation documents, which have no CPT code and are never billed. Its members' clinical care is billed normally.",
    },

    priority: {
        codes: ["99421", "99422", "99423", "98970", "98971", "98972", "99446", "99447", "99448", "99449", "99451"],
        why: "Priority's fee includes direct asynchronous messaging with the surgeon. Billing an online digital E/M (99421-99423) or an interprofessional consult for the same exchange charges the patient twice for one thing.",
    },

    complete: {
        codes: ["99421", "99422", "99423", "98970", "98971", "98972", "99446", "99447", "99448", "99449", "99451",
                "99358", "99359", "99366", "99367", "99368"],
        why: "Complete's fee includes messaging, quarterly review sessions and coordination with other clinicians. Prolonged non-face-to-face service and care-team conference codes describe work its fee has already paid for.",
    },
};

/**
 * Codes that must NEVER be blocked, whatever tier the patient holds.
 * Surgery, real office visits, imaging, pathology — the medical care
 * membership explicitly does not cover.
 *
 * This exists as a CONSISTENCY GUARANTEE, not documentation: the test
 * suite asserts none of these ever appears in a tier's block list. A
 * member who is under-billed has still been failed, and suppressing a
 * legitimate claim is its own kind of harm.
 *
 * The first version of this file expressed the idea as numeric PREFIXES
 * and got it wrong — it listed "994" as always-safe while separately
 * blocking 99421-99423, which begin with 994. Two rules that contradict
 * each other are worse than one rule, because whichever is consulted
 * second looks authoritative. Explicit codes, checked by test.
 */
export const NEVER_BLOCKED = [
    "58150", "58571", "58661", "58662", "58570", "58572",  // hysterectomy, lysis, laparoscopy
    "58558", "58563", "58565",                              // hysteroscopy
    "49320", "58925", "58940",                              // diagnostic lap, ovarian
    "99202", "99203", "99204", "99205",                     // new-patient office E/M
    "99212", "99213", "99214", "99215",                     // established office E/M
    "99384", "99385", "99386", "99395", "99396",            // preventive visits
    "76830", "76856", "76857",                              // pelvic ultrasound
    "88305",                                                // surgical pathology
    "57454", "57455", "57456",                              // colposcopy with biopsy
    "58300", "58301",                                       // IUD insertion / removal
];

function normalise(code) {
    return String(code || "").trim().toUpperCase().split("-")[0];
}

/**
 * May this CPT code be billed for a patient on this tier?
 *
 * @returns {{allowed, reason, code, tier}}
 */
export function canBill(code, tierKey) {
    const c = normalise(code);
    const t = String(tierKey || "standard").toLowerCase();
    const rule = TIER_PAID_FOR[t];

    if (!c) return { allowed: false, code: c, tier: t, reason: "no procedure code on the line" };
    if (!rule) return { allowed: true, code: c, tier: t, reason: `no membership rules for tier "${t}"` };

    if (rule.codes.includes(c)) {
        return {
            allowed: false, code: c, tier: t,
            reason: `${c} describes work this patient's ${tier(t)?.name || t} membership fee has already paid for. ${rule.why}`,
        };
    }
    return { allowed: true, code: c, tier: t, reason: null };
}

/**
 * Screen a whole claim before it is built.
 *
 * FAIL CLOSED: returns ok:false and the offending lines. The caller must
 * refuse to submit, not warn — a claim that goes out cannot be recalled,
 * and "we caught it on the remittance" is not a control.
 *
 * @param lines  [{ cpt, ... }]
 * @param tierKey the patient's ACTIVE tier, or null / 'standard'
 */
export function screenClaim(lines = [], tierKey = null) {
    const t = String(tierKey || "standard").toLowerCase();
    const blocked = [];
    const allowed = [];

    for (const line of lines) {
        const code = line?.cpt || line?.procedure_code || line?.code;
        const v = canBill(code, t);
        if (v.allowed) allowed.push(line);
        else blocked.push({ line, code: v.code, reason: v.reason });
    }

    return {
        ok: blocked.length === 0,
        tier: t,
        blocked,
        allowed,
        // Said plainly, because whoever sees this needs to understand it is
        // not a system error.
        summary: blocked.length === 0
            ? null
            : `${blocked.length} line${blocked.length === 1 ? "" : "s"} cannot be billed for this patient: their membership fee has already paid for that work. Billing it as well would charge them twice for one thing. Remove the line, or end the membership first.`,
    };
}

/**
 * The reverse direction: does a proposed membership benefit describe
 * something that has a billing code? If so the offer has drifted into
 * the claim's territory and the tier is no longer safe.
 *
 * Matched on prose, because a benefit is written in prose. Deliberately
 * broad — a false positive costs a rewording; a false negative is the
 * exact thing the owner said he would take no chances with.
 */
export const BILLABLE_SERVICE_NOUNS =
    /\b(office visits?|clinic visits?|in-?person visits?|annual exams?|well[- ]woman|preventive (?:exams?|visits?)|ultrasounds?|imaging|MRIs?|biops(?:y|ies)|colposcop(?:y|ies)|IUDs?|procedures?|surger(?:y|ies)|operations?|lab work|labs|blood work|pathology|consultations?)\b/i;

// Plurals were missing in the first version: "Unlimited office visits"
// slipped straight through, because \boffice visit\b will not match
// "office visits" — the trailing s is a word character, so there is no
// boundary. The single most likely wording of the exact violation this
// screener exists to catch was the one it could not see.

/**
 * The verbs that turn a mention into an offer. "Imaging you already
 * have" is a description; "imaging included" is a covered service being
 * sold, and that is the insurance characterisation.
 *
 * The first version matched the NOUN alone and flagged three legitimate
 * benefits — "care coordination: imaging, labs and outside records
 * chased on your behalf", "a written second opinion on the records and
 * imaging you already have", and Standard's own disclosure that surgery
 * is billed to the health plan. A screener that fires on the disclaimer
 * telling patients their insurance is unchanged is worse than useless:
 * it would have been switched off within a day.
 */
export const PROVISION_VERBS =
    /\b(includ(?:es|ed|ing)|cover(?:s|ed|ing)?|provid(?:es|ed|ing)|free|no (?:cost|charge)|waive[ds]?|complimentary|unlimited|at no (?:extra )?(?:cost|charge)|comes with|bundled)\b/i;

/** Phrases that are the OPPOSITE of a violation — they are the disclosure. */
export const DISCLOSURE_PHRASES =
    /\b(billed to your health plan|billed to your plan|billed to insurance|your plan pays|you already have|on your behalf|chased on your behalf|no membership fee)\b/i;

/**
 * @returns {{ok, problems:[{benefit, why}]}}
 */
export function screenTierBenefits(t) {
    const problems = [];
    for (const b of (t?.benefits || [])) {
        const label = String(b.label || "");
        if (DISCLOSURE_PHRASES.test(label)) continue;        // it is the disclaimer, not an offer
        const noun = label.match(BILLABLE_SERVICE_NOUNS);
        if (!noun) continue;
        const verb = label.match(PROVISION_VERBS);
        if (!verb) continue;                                  // mentioned, not offered
        problems.push({
            benefit: label,
            why: `"${verb[0]}" offers "${noun[0]}", which is a covered service with a billing code. Selling it as a membership benefit is the insurance characterisation, and would be billed twice.`,
        });
    }
    return { ok: problems.length === 0, problems };
}

/**
 * The sentence a member should see, and the one a patient choosing
 * between Standard and a paid tier needs in order to choose honestly.
 */
export function separationStatement(tierKey) {
    const t = String(tierKey || "standard").toLowerCase();
    if (t === "standard") {
        return "Your care is billed to your health plan, and that is the whole arrangement. You pay your plan's copay, coinsurance and deductible exactly as you would anywhere else, and you pay this practice nothing beyond that.";
    }
    const rule = TIER_PAID_FOR[t];
    return "Your medical care is still billed to your health plan exactly as it would be without a membership — the visits, the procedures, the surgery. "
        + "Your membership fee buys only the things insurance does not cover and this practice therefore never bills for: access, time, coordination and preparation. "
        + (rule && rule.codes.length
            ? "The two are kept apart in the software, not just in policy: while your membership is active, this practice is blocked from submitting a claim for the services your fee already covers. It cannot be billed twice."
            : "Nothing your fee covers has a billing code at all, so there is nothing that could be billed twice.");
}

export default {
    TIER_PAID_FOR, canBill, screenClaim,
    BILLABLE_SERVICE_NOUNS, PROVISION_VERBS, DISCLOSURE_PHRASES,
    NEVER_BLOCKED, screenTierBenefits, separationStatement,
};
