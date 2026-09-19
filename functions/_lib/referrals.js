// =====================================================================
// referrals.js — network-aware referral routing and prior-authorization
// =====================================================================
// THE FAILURE THIS PREVENTS. A referral is clinically right and
// financially catastrophic: an HMO member is sent to a specialist who is
// out of that plan's network, or without the plan's designated PCP
// referral, and the visit is denied in full. The patient pays. They
// blame the practice that sent them, correctly.
//
// So the directory records WHICH NETWORKS each destination takes, and
// `coverageRisk()` compares that against the patient's plan type before
// the referral goes out. It returns a verdict plus the REASONS, so the
// physician can override it knowingly — it never silently blocks.
//
// DOCTRINE, inherited from clearinghouse_onboarding.js: never assert a
// payer requirement the payer does not publish. Where the answer depends
// on a specific plan document, the verdict is "verify", never a
// confident yes or no. A tool that guesses confidently gets trusted once
// and then gets someone a surprise bill.
// =====================================================================

export const PLAN_TYPES = ["HMO", "EPO", "POS", "PPO", "Medicare", "Medicaid", "self_pay", "unknown"];

/**
 * Coverage risk for sending THIS patient to THIS destination.
 * Inputs are deliberately explicit — nothing is inferred from a name.
 */
export function coverageRisk({
    plan_type = "unknown",
    payer_name = "",
    destination_networks = [],
    destination_accepts_cash = false,
    ordering_provider_is_plan_pcp = false,
    networks_verified_at = null,
} = {}) {
    const plan = PLAN_TYPES.includes(plan_type) ? plan_type : "unknown";
    const nets = (Array.isArray(destination_networks) ? destination_networks : [])
        .map(n => String(n).trim().toLowerCase()).filter(Boolean);
    const inNetwork = payer_name
        ? nets.some(n => n.includes(String(payer_name).trim().toLowerCase()) ||
                         String(payer_name).trim().toLowerCase().includes(n))
        : false;
    const reasons = [];
    let verdict = "ok";

    if (plan === "self_pay") {
        if (!destination_accepts_cash) {
            verdict = "warn";
            reasons.push("Self-pay patient and this destination has no recorded cash price — have the patient get an estimate before going.");
        } else {
            reasons.push("Self-pay: destination has a recorded cash price. The patient pays the destination directly; our estimate does not cover it.");
        }
        return { verdict, in_network: null, reasons };
    }

    if (!payer_name) {
        verdict = "verify";
        reasons.push("No payer recorded for this patient — network status cannot be checked.");
        return { verdict, in_network: null, reasons };
    }
    if (nets.length === 0) {
        verdict = "verify";
        reasons.push("No networks recorded for this destination — call to confirm participation before sending.");
        return { verdict, in_network: null, reasons };
    }

    if (!inNetwork) {
        if (plan === "HMO" || plan === "EPO" || plan === "Medicaid") {
            verdict = "block";
            reasons.push(`${plan} plans generally provide no out-of-network benefit except emergencies. This destination is not recorded as taking ${payer_name}.`);
        } else {
            verdict = "warn";
            reasons.push(`This destination is not recorded as taking ${payer_name}. A ${plan} plan may still cover it at out-of-network rates, at higher cost to the patient.`);
        }
    } else {
        reasons.push(`Destination is recorded as in network for ${payer_name}.`);
    }

    // The second HMO trap, independent of network status: the plan may
    // only honour a referral written by the member's designated PCP.
    if ((plan === "HMO" || plan === "POS") && !ordering_provider_is_plan_pcp) {
        if (verdict === "ok") verdict = "verify";
        reasons.push(`${plan} plans commonly require the referral to come from the member's designated in-plan PCP. Confirm the plan will honour a referral from this practice, or route it through the PCP.`);
    }

    if (inNetwork && !networks_verified_at) {
        reasons.push("Network list for this destination has never been verified — re-confirm periodically.");
    }
    return { verdict, in_network: inNetwork, reasons };
}

// Advanced imaging is where prior authorization actually bites. This
// returns a RECOMMENDATION with a confidence, never a claim about a
// specific plan's rules.
const ADVANCED_MODALITIES = ["mri", "mra", "ct", "cta", "pet", "nuclear medicine"];

export function priorAuthAdvice({ order_type, modality = "", plan_type = "unknown" } = {}) {
    const m = String(modality).toLowerCase();
    const advanced = ADVANCED_MODALITIES.some(a => m.includes(a));
    if (plan_type === "self_pay") {
        return { recommendation: "not_required", confidence: "high",
                 note: "Self-pay: no payer authorization applies. The patient pays the facility directly." };
    }
    if (order_type === "imaging" && advanced) {
        return { recommendation: "likely_required", confidence: "medium",
                 note: "Most payers require prior authorization for advanced imaging (MRI/CT/PET), usually through a radiology-benefit manager, with clinical notes attached. Confirm with the plan — the ordering practice, not the imaging center, is normally responsible." };
    }
    if (order_type === "imaging") {
        return { recommendation: "usually_not_required", confidence: "medium",
                 note: "Plain film and ultrasound are commonly authorized without prior review, but plan rules vary. Verify if the facility asks." };
    }
    if (order_type === "lab") {
        return { recommendation: "usually_not_required", confidence: "medium",
                 note: "Routine laboratory work is rarely pre-authorized; genetic and specialty send-out panels frequently are. Verify for anything beyond routine chemistry/haematology." };
    }
    if (order_type === "referral") {
        if (plan_type === "HMO" || plan_type === "POS") {
            return { recommendation: "likely_required", confidence: "medium",
                     note: "HMO/POS plans commonly require a plan referral or authorization before a specialist visit is covered." };
        }
        return { recommendation: "verify", confidence: "low",
                 note: "Specialist referral authorization depends on plan design. Verify before the patient is seen." };
    }
    return { recommendation: "verify", confidence: "low", note: "Verify with the plan." };
}

/** Rank directory destinations for a patient: in-network first, then verified. */
export function rankDestinations(destinations, { payer_name = "", plan_type = "unknown" } = {}) {
    return (Array.isArray(destinations) ? destinations : []).map((d) => {
        const risk = coverageRisk({
            plan_type, payer_name,
            destination_networks: d.networks || [],
            destination_accepts_cash: !!d.accepts_cash,
            networks_verified_at: d.networks_verified_at,
        });
        const score = risk.verdict === "ok" ? 0 : risk.verdict === "verify" ? 1 : risk.verdict === "warn" ? 2 : 3;
        return { ...d, risk, _score: score };
    }).sort((a, b) => a._score - b._score || String(a.name).localeCompare(String(b.name)));
}

export default { PLAN_TYPES, coverageRisk, priorAuthAdvice, rankDestinations };
