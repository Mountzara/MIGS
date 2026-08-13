// denial_router.js — TIERED AUTONOMY for denial remediation.
//
// The design decision this file encodes (2026-08-12, agreed with Dr. Mabini):
// every claim submitted under his NPI is HIS attestation, and on federal
// payers the False Claims Act attaches. So a machine may act alone ONLY where
// the correct value is knowable from data already on file and no clinical
// judgment is involved. Everything touching medical necessity, E/M level, or
// clinical narrative is prepared completely by the agent and then WAITS for a
// one-tap physician approval — seconds of his time, attestation intact.
//
//   Tier A  auto            clerical defect, correct value derivable from our
//                           own record; auto-correct + resubmit (837 freq 7).
//   Tier B  physician_approve  clinical content; agent assembles letter +
//                           note passages + policy cites + records, he taps.
//   Tier C  hold            federal payer + clinical/level change, OR the
//                           denial looks CORRECT, OR no verified deadline.
//
// Grounding: routing keys off the CARC catalog's own `category` / `strategy` /
// `appealable` fields — never off a model's opinion about the code.

import { CARC } from "./carc_codes.js";

// CARC categories whose remedy is a data fix with a knowable-correct value.
const CLERICAL_CATEGORIES = new Set(["coding", "missing_info", "duplicate"]);

// Categories that are inherently clinical — always physician-attested.
const CLINICAL_CATEGORIES = new Set(["medical_necessity", "coverage", "bundling"]);

// Categories that are not a dispute at all.
const NON_DISPUTE = new Set(["patient_responsibility", "contractual"]);

const FEDERAL_KINDS = new Set(["medicare", "medicaid", "tricare"]);

/**
 * Only these specific fixes may execute unattended. Each is a field-level
 * correction whose right answer comes from OUR OWN record (the encounter, the
 * roster, the claim itself) — not from a judgment about the patient's care.
 * Anything not on this list is not Tier A, regardless of CARC category.
 */
export const TIER_A_FIXES = {
    dx_pointer_range: {
        label: "Diagnosis pointer references a line that doesn't exist",
        why_safe: "The valid pointer set is defined by the claim's own diagnosis list.",
    },
    pos_mismatch_telehealth: {
        label: "Place of service inconsistent with a telehealth encounter",
        why_safe: "POS is determined by the encounter type already recorded (doxy.me telehealth vs in-office).",
    },
    missing_modifier_95: {
        label: "Telehealth modifier absent on a telehealth encounter",
        why_safe: "Derived from the encounter's own modality flag, not from clinical content.",
    },
    npi_taxonomy_field: {
        label: "Rendering/billing NPI or taxonomy field invalid",
        why_safe: "Values come from the practice roster, which is a static credentialing fact.",
    },
    duplicate_false_positive: {
        label: "Payer duplicate flag on a genuinely distinct service",
        why_safe: "Distinctness is established by the encounter timestamps already on file.",
        requires: "distinct_encounter_proof",
    },
};

/**
 * Decide the autonomy tier for a denial.
 *
 * @param {object} a
 * @param {string[]} a.carcCodes       observed CARC codes from the 835
 * @param {string}   a.payerKind       'medicare' | 'medicaid' | 'commercial' | ...
 * @param {string[]} a.proposedFixes   Tier-A fix keys the scrub believes apply
 * @param {boolean}  a.changesClinical does the remedy alter clinical content or level?
 * @param {object}   a.deadline        result of computeDueDate()
 * @returns {{tier, approval_state, strategy, reasons, appealable, blocking}}
 */
export function routeDenial({ carcCodes = [], payerKind = "commercial", proposedFixes = [], changesClinical = false, deadline = null } = {}) {
    const reasons = [];
    const known = carcCodes.map((c) => ({ code: String(c), meta: CARC[String(c)] || null }));
    const unknown = known.filter((k) => !k.meta).map((k) => k.code);
    if (unknown.length) reasons.push(`Unrecognized CARC ${unknown.join(", ")} — not in the curated catalog, so the remedy is not machine-known.`);

    const cats = known.filter((k) => k.meta).map((k) => k.meta.category);
    const strategies = known.filter((k) => k.meta).map((k) => k.meta.strategy);
    const appealable = known.some((k) => k.meta && k.meta.appealable);

    // Not a dispute — the payer is right; nothing to appeal.
    if (cats.length && cats.every((c) => NON_DISPUTE.has(c))) {
        reasons.push("Every CARC is patient-responsibility or contractual — this is not a denial to fight.");
        return {
            tier: "C_hold", approval_state: "awaiting_physician",
            strategy: strategies.includes("write_off") ? "write_off" : "patient_bill",
            reasons, appealable: false, blocking: false,
        };
    }

    // A deadline we cannot see is the MOST urgent state, not a neutral one:
    // acting without knowing the window risks filing into a closed door.
    if (deadline && deadline.reason !== "ok") {
        reasons.push(`No verified appeal window for this payer (${deadline.reason}) — refusing to compute a due date from an assumption.`);
        return {
            tier: "C_hold", approval_state: "awaiting_physician",
            strategy: pickStrategy(strategies), reasons, appealable, blocking: true,
        };
    }

    const clinical = changesClinical || cats.some((c) => CLINICAL_CATEGORIES.has(c));

    // Federal payer + clinical/level change = hardest stop in the system.
    if (clinical && FEDERAL_KINDS.has(payerKind)) {
        reasons.push(`${payerKind} claim with a clinical/level change — physician attestation required (False Claims Act exposure).`);
        return {
            tier: "C_hold", approval_state: "awaiting_physician",
            strategy: pickStrategy(strategies), reasons, appealable, blocking: true,
        };
    }

    if (clinical) {
        reasons.push("Remedy touches medical necessity, level, or clinical narrative — agent prepares the full package; physician approves.");
        return {
            tier: "B_physician_approve", approval_state: "awaiting_physician",
            strategy: pickStrategy(strategies), reasons, appealable, blocking: false,
        };
    }

    // Tier A requires BOTH a clerical category AND a whitelisted fix.
    const allowed = proposedFixes.filter((f) => TIER_A_FIXES[f]);
    const allClerical = cats.length > 0 && cats.every((c) => CLERICAL_CATEGORIES.has(c));
    if (allClerical && allowed.length && allowed.length === proposedFixes.length && !unknown.length) {
        reasons.push(`Clerical only — ${allowed.map((f) => TIER_A_FIXES[f].label).join("; ")}. Correct value comes from our own record.`);
        return {
            tier: "A_auto", approval_state: "auto_executed",
            strategy: "corrected_claim", reasons, appealable, blocking: false,
        };
    }

    if (proposedFixes.length && allowed.length !== proposedFixes.length) {
        reasons.push(`Proposed fixes include actions outside the Tier-A whitelist (${proposedFixes.filter((f) => !TIER_A_FIXES[f]).join(", ")}) — routing to physician.`);
    }
    if (!proposedFixes.length) reasons.push("No deterministic fix identified — physician review.");
    return {
        tier: "B_physician_approve", approval_state: "awaiting_physician",
        strategy: pickStrategy(strategies), reasons, appealable, blocking: false,
    };
}

function pickStrategy(strategies) {
    for (const s of ["appeal", "reconsideration", "corrected_claim", "patient_bill", "write_off"]) {
        if (strategies.includes(s)) return s;
    }
    return "appeal";
}

export default { routeDenial, TIER_A_FIXES };
