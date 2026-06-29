// =====================================================================
// functions/_lib/carc_codes.js — CARC/RARC denial-code knowledge base
// =====================================================================
// X12 835 Claim Adjustment Reason Codes (CARC) and Remittance Advice
// Remark Codes (RARC), translated to plain English with a remediation
// strategy. Used by:
//   * billing_ai_preflight.js — to name the LIKELY CARC a risk maps to.
//   * billing_appeal.js — to explain an OBSERVED denial and ground the
//     appeal/corrected-claim recommendation (so even the no-AI fallback
//     produces a useful, code-accurate letter).
//
// Curated for an OB/GYN / MIGS practice's high-frequency denials. This is
// NOT the full CMS WPC list — it's the codes that actually recur for E/M
// + gyn-surgical claims. Extend as new codes show up on real ERAs.
//
// `strategy`: what to DO about it —
//   corrected_claim  → fix data + resubmit (frequency 7); usually no appeal.
//   appeal           → documentation supports it; file a formal appeal.
//   reconsideration  → payer-internal review (auth/COB) before formal appeal.
//   patient_bill     → legitimate patient responsibility; bill the patient.
//   write_off        → contractual; not collectable, not appealable.
// =====================================================================

export const CARC = {
    "1":   { label: "Deductible amount", category: "patient_responsibility", appealable: false, strategy: "patient_bill", plain: "Applied to the patient's deductible. Bill the patient." },
    "2":   { label: "Coinsurance amount", category: "patient_responsibility", appealable: false, strategy: "patient_bill", plain: "Patient coinsurance. Bill the patient." },
    "3":   { label: "Co-payment amount", category: "patient_responsibility", appealable: false, strategy: "patient_bill", plain: "Patient copay. Bill the patient." },
    "4":   { label: "Procedure code inconsistent with the modifier / required modifier missing", category: "coding", appealable: true, strategy: "corrected_claim", plain: "The modifier is missing or doesn't match the procedure. Add/correct the modifier and resubmit as a corrected claim." },
    "11":  { label: "Diagnosis inconsistent with the procedure", category: "medical_necessity", appealable: true, strategy: "appeal", plain: "The linked diagnosis doesn't support medical necessity for the procedure. If the note supports a more specific/appropriate ICD-10, correct the linkage and resubmit; otherwise appeal with the op note." },
    "16":  { label: "Claim/service lacks information or has a submission/billing error", category: "missing_info", appealable: true, strategy: "corrected_claim", plain: "Missing or invalid data element (see the paired RARC for which field). Supply it and resubmit." },
    "18":  { label: "Exact duplicate claim/service", category: "duplicate", appealable: true, strategy: "reconsideration", plain: "Payer sees this as a duplicate. If it's truly a distinct service (e.g., bilateral, repeat), resubmit with the appropriate modifier (50/76/59/XU) and documentation; otherwise it's already adjudicated." },
    "22":  { label: "Care may be covered by another payer per coordination of benefits", category: "coordination_of_benefits", appealable: true, strategy: "reconsideration", plain: "COB issue — payer believes another plan is primary. Verify primacy, submit the primary EOB, and rebill." },
    "23":  { label: "Prior payer(s) adjudication impacted this payment", category: "coordination_of_benefits", appealable: false, strategy: "patient_bill", plain: "Secondary payer adjusted based on the primary's payment. Usually correct; bill residual per the EOB." },
    "27":  { label: "Expenses incurred after coverage terminated", category: "coverage", appealable: true, strategy: "reconsideration", plain: "Payer shows coverage ended before the date of service. Re-verify eligibility for the DOS; if active, appeal with the eligibility record." },
    "29":  { label: "Time limit for filing has expired", category: "timely_filing", appealable: true, strategy: "appeal", plain: "Filed past the payer's timely-filing window. Appeal only with proof of timely original submission (clearinghouse acceptance report / 277CA)." },
    "45":  { label: "Charge exceeds fee schedule / contracted amount", category: "contractual", appealable: false, strategy: "write_off", plain: "Contractual adjustment to the allowed amount. Not appealable; write off the difference." },
    "50":  { label: "Non-covered — not deemed a medical necessity", category: "medical_necessity", appealable: true, strategy: "appeal", plain: "Payer's medical-necessity criteria not met. Appeal with the op note, indication, and supporting guideline/literature." },
    "59":  { label: "Processed based on multiple/concurrent procedure rules", category: "bundling", appealable: true, strategy: "reconsideration", plain: "Multiple-procedure reduction applied. Confirm the reduction is correct per MPFS; if a procedure was distinct, append the right modifier and reconsider." },
    "96":  { label: "Non-covered charge(s)", category: "coverage", appealable: true, strategy: "reconsideration", plain: "Service not covered under the plan (see RARC). If covered with the right code/POS, correct and resubmit; otherwise patient may be billed with a valid waiver." },
    "97":  { label: "Payment is included in another service already adjudicated (bundling / NCCI)", category: "bundling", appealable: true, strategy: "corrected_claim", plain: "NCCI bundling — this code is included in another line. If the services were separate/distinct, append modifier 59 or the X{EPSU} subset and resubmit with documentation." },
    "109": { label: "Claim not covered by this payer/contractor", category: "routing", appealable: true, strategy: "corrected_claim", plain: "Wrong payer or wrong payer ID. Re-route to the correct payer/payer ID and resubmit." },
    "119": { label: "Benefit maximum for this period has been reached", category: "coverage", appealable: false, strategy: "patient_bill", plain: "Plan benefit maximum reached. Bill the patient per plan rules." },
    "151": { label: "Information submitted does not support this many/frequency of services", category: "medical_necessity", appealable: true, strategy: "appeal", plain: "Frequency/units questioned. Appeal with documentation of units/time, or correct units if over-reported." },
    "181": { label: "Procedure code was invalid on the date of service", category: "coding", appealable: true, strategy: "corrected_claim", plain: "CPT/HCPCS not valid for the DOS (code deleted/replaced). Use the correct code for that year and resubmit." },
    "197": { label: "Precertification / authorization / notification absent", category: "authorization", appealable: true, strategy: "reconsideration", plain: "Prior auth missing. If an auth exists, submit the number and reconsider; if retro-auth is allowed, request it; otherwise appeal with medical necessity." },
    "204": { label: "Service not covered under the patient's current benefit plan", category: "coverage", appealable: true, strategy: "reconsideration", plain: "Not a covered benefit. Verify the plan; bill the patient only with a valid advance notice/waiver." },
    "252": { label: "An attachment / additional documentation is required to adjudicate", category: "missing_info", appealable: true, strategy: "corrected_claim", plain: "Payer needs records (see RARC). Send the requested documentation (op note, path, etc.)." },
};

// Remittance Advice Remark Codes — the field-level detail that pairs with
// a CARC (especially CARC 16/252). High-frequency for E/M + gyn surgery.
export const RARC = {
    "M51":  "Missing/incomplete/invalid procedure code.",
    "M76":  "Missing/incomplete/invalid diagnosis or condition.",
    "M119": "Missing/incomplete/invalid National Drug Code (NDC).",
    "MA13": "Alert: patient may be billed for this denied service per the notice on file.",
    "MA66": "Missing/incomplete/invalid principal procedure code.",
    "N130": "Consult plan benefit documents for information about restrictions.",
    "N290": "Missing/incomplete/invalid rendering provider primary identifier (NPI).",
    "N257": "Missing/incomplete/invalid billing provider/supplier primary identifier.",
    "N522": "Duplicate of a claim processed (or in process) as part of the same claim.",
    "N657": "This should have been billed with the appropriate procedure code.",
    "N701": "Payment adjusted because the service does not meet medical-policy criteria.",
    "N115": "Decision based on a Local Coverage Determination (LCD).",
};

/** Look up a CARC code; returns a generic-but-actionable record if unknown. */
export function lookupCarc(code) {
    const c = String(code || "").trim().toUpperCase();
    if (CARC[c]) return { code: c, ...CARC[c] };
    return { code: c, label: "Unrecognized adjustment reason", category: "unknown", appealable: true, strategy: "reconsideration", plain: "Code not in the local dictionary — review the payer's remittance and EOB to determine the correct response." };
}

/** Look up a RARC remark; returns null if unknown (remarks are advisory). */
export function lookupRarc(code) {
    const c = String(code || "").trim().toUpperCase();
    return RARC[c] ? { code: c, plain: RARC[c] } : null;
}

/**
 * Given a list of observed CARC codes, pick the dominant remediation
 * strategy. Order of precedence reflects what a biller does first:
 * a fixable data/coding error (corrected_claim) before a documentation
 * appeal; patient_responsibility/contractual outcomes only when nothing
 * actionable remains.
 */
export function recommendStrategy(codes) {
    const recs = (codes || []).map(lookupCarc);
    const order = ["corrected_claim", "reconsideration", "appeal", "patient_bill", "write_off"];
    for (const strat of order) {
        if (recs.some((r) => r.strategy === strat)) return strat;
    }
    return "reconsideration";
}

export default { CARC, RARC, lookupCarc, lookupRarc, recommendStrategy };
