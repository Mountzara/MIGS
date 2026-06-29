// =====================================================================
// functions/_lib/claim_scrub.js — pre-submission CLEAN-CLAIM gate
// =====================================================================
// "Undeniable first-time claim" = a CLEAN claim: complete, internally
// consistent, and free of the structural defects payers reject on. You
// don't beat payer denials by gaming them — you give them nothing to
// reject. This runs on a normalized claim BEFORE 837 generation and
// returns hard BLOCKS (must fix; claim cannot go out) and WARNINGS
// (advisory; common denial risks worth a human glance).
//
// Deterministic, no PHI-dependent external calls — pure function, fully
// unit-testable. It encodes the high-frequency front-end-rejection and
// CARC/RARC denial classes; it is NOT a full NCCI/MUE edit engine (those
// need CMS edit tables) — extend `ncciHints` as edits are loaded.
// =====================================================================

const isEM = (code) => /^992\d\d$/.test(String(code || ""));   // office/outpatient E/M
const isProcedure = (code) => /^\d{5}$/.test(String(code || "")) && !isEM(code);
const has = (v) => v != null && String(v).trim() !== "";

export function scrubClaim(claim) {
    const c = claim || {};
    const blocks = [];
    const warnings = [];
    const block = (code, message, field) => blocks.push({ code, message, field });
    const warn = (code, message, field) => warnings.push({ code, message, field });

    const bp = c.billingProvider || {};
    const payer = c.payer || {};
    const subsc = c.subscriber || {};
    const cl = c.claim || {};
    const lines = Array.isArray(c.lines) ? c.lines : [];
    const dx = (cl.diagnoses || []).filter(has);

    // --- Billing provider ---
    if (!/^\d{10}$/.test(String(bp.npi || "").replace(/\D/g, ""))) block("npi", "Billing provider NPI must be 10 digits.", "billingProvider.npi");
    if (!has(bp.taxId)) block("tax_id", "Billing provider Tax ID (EIN) is required.", "billingProvider.taxId");
    if (!has(bp.orgName)) block("billing_name", "Billing provider name is required.", "billingProvider.orgName");

    // --- Payer ---
    if (!has(payer.name)) block("payer_name", "Payer name is required.", "payer.name");
    if (!has(payer.payerId)) block("payer_id", "Electronic payer ID is required for clearinghouse submission.", "payer.payerId");

    // --- Subscriber / patient ---
    if (!has(subsc.lastName) || !has(subsc.firstName)) block("subscriber_name", "Subscriber first and last name are required.", "subscriber");
    if (!has(subsc.memberId)) block("member_id", "Subscriber member ID is required.", "subscriber.memberId");
    const dobOk = /^\d{8}$/.test(String(subsc.dob || "").replace(/\D/g, ""));
    if ((cl.patientIsSubscriber !== false) && !dobOk) block("dob", "Subscriber date of birth (YYYYMMDD) is required.", "subscriber.dob");

    // --- Claim header ---
    if (!has(cl.patientControlNumber)) warn("pcn", "No patient control number — clearinghouse will assign one; set it for reconciliation.", "claim.patientControlNumber");
    if (!has(cl.placeOfService)) block("pos", "Place of service code is required (e.g., 11 office, 10/02 telehealth).", "claim.placeOfService");
    if (dx.length === 0) block("diagnosis", "At least one diagnosis (ICD-10) is required.", "claim.diagnoses");
    if (dx.length > 12) warn("dx_count", "More than 12 diagnoses — only the first 12 are sent on an 837P.", "claim.diagnoses");

    // --- Service lines ---
    if (lines.length === 0) block("no_lines", "Claim has no service lines.", "lines");
    let total = 0;
    lines.forEach((l, i) => {
        const where = `lines[${i}]`;
        if (!/^[A-Z0-9]{5}$/.test(String(l.procedureCode || ""))) block("proc_code", `Line ${i + 1}: a valid 5-char CPT/HCPCS code is required.`, where);
        const charge = Math.round(Number(l.chargeCents) || 0);
        if (charge <= 0) block("charge", `Line ${i + 1}: charge must be greater than $0.`, where);
        total += charge;
        if (!(Number(l.units) >= 1)) block("units", `Line ${i + 1}: units must be ≥ 1.`, where);
        if (!/^\d{8}$/.test(String(l.serviceDate || cl.serviceDate || "").replace(/\D/g, ""))) block("service_date", `Line ${i + 1}: service date (YYYYMMDD) is required.`, where);
        const ptrs = l.diagnosisPointers || [];
        if (!ptrs.length) block("dx_pointer", `Line ${i + 1}: at least one diagnosis pointer is required.`, where);
        ptrs.forEach((p) => { if (!(p >= 1 && p <= dx.length)) block("dx_pointer_range", `Line ${i + 1}: diagnosis pointer ${p} has no matching diagnosis.`, where); });
        (l.modifiers || []).forEach((m) => { if (!/^[A-Z0-9]{2}$/.test(String(m))) warn("modifier_fmt", `Line ${i + 1}: modifier "${m}" is not a valid 2-char modifier.`, where); });
    });
    if (lines.length && total <= 0) block("total_charge", "Total claim charge is $0.", "lines");

    // --- High-frequency denial heuristics (advisory) ---
    const emLines = lines.filter((l) => isEM(l.procedureCode));
    const procLines = lines.filter((l) => isProcedure(l.procedureCode));
    if (emLines.length && procLines.length) {
        const emHas25 = emLines.some((l) => (l.modifiers || []).map(String).includes("25"));
        if (!emHas25) warn("modifier_25", "E/M billed same day as a procedure without modifier 25 on the E/M — a top denial cause. Confirm the E/M was separately identifiable.", "lines");
    }
    // duplicate procedure (same code+modifiers+date) → likely NCCI/duplicate denial
    const seen = new Set();
    lines.forEach((l, i) => {
        const key = [l.procedureCode, (l.modifiers || []).join(","), l.serviceDate].join("|");
        if (seen.has(key)) warn("duplicate_line", `Line ${i + 1}: duplicate of an earlier line (same code/modifiers/date) — payers reject duplicates.`, `lines[${i}]`);
        seen.add(key);
    });
    // unspecified-diagnosis advisory (specificity drives medical-necessity denials)
    dx.forEach((d) => { if (/9$/.test(String(d).replace(/\./g, "")) ) warn("dx_specificity", `Diagnosis ${d} looks unspecified — a more specific code (where the note supports it) lowers medical-necessity denials.`, "claim.diagnoses"); });

    return {
        clean: blocks.length === 0,
        blocks,
        warnings,
        total_charge_cents: total,
        summary: blocks.length
            ? `${blocks.length} blocking issue(s) — not ready to submit.`
            : (warnings.length ? `Clean to submit · ${warnings.length} advisory warning(s).` : "Clean claim — ready to submit."),
    };
}

export default { scrubClaim };
