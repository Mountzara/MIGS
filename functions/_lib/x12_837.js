// =====================================================================
// functions/_lib/x12_837.js — X12 5010 837P professional-claim generator
// =====================================================================
// The OUTBOUND rail of the billing pipeline. Takes a normalized claim
// object (provider + payer + subscriber/patient + claim + service lines)
// and emits a structurally-valid ANSI ASC X12 5010A1 837P electronic
// claim — the open EDI standard every clearinghouse (Stedi, Claim.MD,
// Office Ally, Availity, Change Healthcare) accepts.
//
// Scope/notes:
//   * Professional claim (837P). Institutional (837I) is a separate format.
//   * Single subscriber == patient (self) is the common case; a distinct
//     patient (Loop 2000C/2010CA) is emitted when claim.patientIsSubscriber
//     is false.
//   * This builds well-formed structure for the typical office/telehealth
//     encounter. It is NOT a substitute for clearinghouse-side validation
//     (NM1 qualifier nuances, payer-specific companion guides) — the
//     clearinghouse 277CA still adjudicates structure. Pair with claim_scrub.js
//     (clean-claim gate) BEFORE generating.
//
// Delimiters (5010 standard): element '*', sub-element ':', repetition '^',
// segment terminator '~'.
// =====================================================================

const EL = "*";        // element separator
const SUB = ":";       // component/sub-element separator
const REP = "^";       // repetition separator
const SEG = "~";       // segment terminator

const pad = (s, n) => String(s == null ? "" : s).padEnd(n).slice(0, n);
const clean = (s) => String(s == null ? "" : s).replace(/[*~:^]/g, " ").trim();
const upper = (s) => clean(s).toUpperCase();
const digits = (s) => String(s == null ? "" : s).replace(/[^0-9]/g, "");
const cents = (c) => (Math.round(Number(c) || 0) / 100).toFixed(2);
const yyyymmdd = (s) => digits(s).slice(0, 8);

// Build one segment from an array of elements (trailing empties trimmed).
function seg(...els) {
    let parts = els.map((e) => (e == null ? "" : String(e)));
    while (parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
    return parts.join(EL) + SEG;
}

// ---------------------------------------------------------------------
// generate837P(claim) -> { edi, controlNumbers, segmentCount }
// ---------------------------------------------------------------------
export function generate837P(input) {
    const c = input || {};
    const ctl = c.control || {};
    const now = new Date();
    const ccyymmdd = ctl.date || (now.getUTCFullYear() + pad2(now.getUTCMonth() + 1) + pad2(now.getUTCDate()));
    const yymmdd = ccyymmdd.slice(2);
    const hhmm = ctl.time || (pad2(now.getUTCHours()) + pad2(now.getUTCMinutes()));
    const icn = String(ctl.interchangeControlNumber || "000000001").slice(0, 9).padStart(9, "0");
    const gcn = String(ctl.groupControlNumber || icn).replace(/^0+/, "") || "1";
    const tcn = String(ctl.transactionControlNumber || "0001").padStart(4, "0").slice(0, 9);
    const usage = ctl.usageIndicator === "P" ? "P" : "T"; // T=test until enrolled+verified

    const sub = c.submitter || {};
    const rcv = c.receiver || {};
    const bp = c.billingProvider || {};
    const subsc = c.subscriber || {};
    const payer = c.payer || {};
    const claim = c.claim || {};
    const lines = Array.isArray(c.lines) ? c.lines : [];
    const dx = (claim.diagnoses || []).map(clean).filter(Boolean).slice(0, 12);
    const patientIsSubscriber = c.claim ? c.claim.patientIsSubscriber !== false : true;
    const pat = c.patient || subsc;

    // ----- Interchange / functional group envelope (ISA/GS) -----
    const isa = [
        "ISA", "00", pad("", 10), "00", pad("", 10),
        "ZZ", pad(upper(sub.id || sub.name || "SUBMITTER"), 15),
        "ZZ", pad(upper(rcv.id || rcv.name || "RECEIVER"), 15),
        ccyymmdd.slice(2), hhmm, REP, "00501", icn, "0", usage, SUB,
    ].join(EL) + SEG;
    const gs = seg("GS", "HC", upper(sub.id || "SUBMITTER"), upper(rcv.id || "RECEIVER"),
        ccyymmdd, hhmm, gcn, "X", "005010X222A1");

    // ----- Transaction set (ST..SE) collected so we can count segments -----
    const S = [];
    S.push(seg("ST", "837", tcn, "005010X222A1"));
    S.push(seg("BHT", "0019", "00", tcn, ccyymmdd, hhmm, "CH")); // CH = chargeable

    // 1000A Submitter
    S.push(seg("NM1", "41", "2", clean(sub.name || bp.orgName), "", "", "", "", "46", upper(sub.id || "")));
    S.push(seg("PER", "IC", clean(sub.contactName || sub.name || ""), "TE", digits(sub.contactPhone || "")));
    // 1000B Receiver
    S.push(seg("NM1", "40", "2", clean(rcv.name || "CLEARINGHOUSE"), "", "", "", "", "46", upper(rcv.id || "")));

    // 2000A Billing provider hierarchical level
    S.push(seg("HL", "1", "", "20", "1"));
    if (bp.taxonomy) S.push(seg("PRV", "BI", "PXC", clean(bp.taxonomy)));
    // 2010AA Billing provider
    S.push(seg("NM1", "85", "2", clean(bp.orgName), "", "", "", "", "XX", digits(bp.npi)));
    const ba = bp.address || {};
    S.push(seg("N3", clean(ba.line1)));
    S.push(seg("N4", clean(ba.city), upper(ba.state), digits(ba.zip)));
    S.push(seg("REF", "EI", digits(bp.taxId))); // employer tax ID

    // 2000B Subscriber hierarchical level
    S.push(seg("HL", "2", "1", "22", patientIsSubscriber ? "0" : "1"));
    // SBR: payer responsibility P=primary, relationship 18=self
    S.push(seg("SBR", "P", patientIsSubscriber ? "18" : "", clean(subsc.groupNumber || ""), "", "", "", "", "", payerKind(payer.kind)));
    // 2010BA Subscriber name
    S.push(seg("NM1", "IL", "1", upper(subsc.lastName), clean(subsc.firstName), clean(subsc.middleName || ""), "", "", "MI", clean(subsc.memberId)));
    const sa = subsc.address || {};
    if (sa.line1) { S.push(seg("N3", clean(sa.line1))); S.push(seg("N4", clean(sa.city), upper(sa.state), digits(sa.zip))); }
    if (patientIsSubscriber) S.push(seg("DMG", "D8", yyyymmdd(subsc.dob), gender(subsc.gender)));
    // 2010BB Payer name
    S.push(seg("NM1", "PR", "2", clean(payer.name), "", "", "", "", "PI", clean(payer.payerId)));

    // 2000C/2010CA patient (only when patient != subscriber)
    if (!patientIsSubscriber) {
        S.push(seg("HL", "3", "2", "23", "0"));
        S.push(seg("PAT", relationshipCode(claim.patientRelationship)));
        S.push(seg("NM1", "QC", "1", upper(pat.lastName), clean(pat.firstName)));
        const pa = pat.address || {};
        if (pa.line1) { S.push(seg("N3", clean(pa.line1))); S.push(seg("N4", clean(pa.city), upper(pa.state), digits(pa.zip))); }
        S.push(seg("DMG", "D8", yyyymmdd(pat.dob), gender(pat.gender)));
    }

    // 2300 Claim
    const totalCharge = lines.reduce((a, l) => a + (Math.round(Number(l.chargeCents) || 0)), 0);
    const pos = clean(claim.placeOfService || "11"); // 11 office, 02/10 telehealth
    // CLM05 = facility:claim-freq composite (frequency 1=original, 7=replacement/corrected)
    const freq = clean(claim.frequencyCode || "1");
    S.push(seg("CLM", clean(claim.patientControlNumber || "CLAIM"), cents(totalCharge), "", "",
        [pos, "B", freq].join(SUB),
        claim.providerSignature === false ? "N" : "Y",
        "A", // provider accepts assignment
        claim.assignmentOfBenefits === false ? "N" : "Y",
        claim.releaseOfInfo || "Y"));
    if (claim.onsetDate) S.push(seg("DTP", "431", "D8", yyyymmdd(claim.onsetDate)));
    // HI diagnoses — first is ABK (principal), rest ABF
    if (dx.length) {
        const hi = ["HI"];
        dx.forEach((code, i) => hi.push([i === 0 ? "ABK" : "ABF", code.replace(/\./g, "")].join(SUB)));
        S.push(seg(...hi));
    }

    // 2400 Service lines
    lines.forEach((l, idx) => {
        S.push(seg("LX", String(idx + 1)));
        const mods = (l.modifiers || []).map(clean).filter(Boolean).slice(0, 4);
        const sv1Proc = ["HC", clean(l.procedureCode), ...mods].join(SUB);
        S.push(seg("SV1", sv1Proc, cents(l.chargeCents), "UN", String(l.units || 1), clean(l.placeOfService || pos),
            "", (l.diagnosisPointers || [1]).join(SUB)));
        S.push(seg("DTP", "472", "D8", yyyymmdd(l.serviceDate || claim.serviceDate || ccyymmdd)));
    });

    // SE trailer — segment count includes ST through SE inclusive
    const seCount = S.length + 1;
    S.push(seg("SE", String(seCount), tcn));

    const ge = seg("GE", "1", gcn);
    const iea = seg("IEA", "1", icn);

    const edi = isa + gs + S.join("") + ge + iea;
    return {
        edi,
        controlNumbers: { interchange: icn, group: gcn, transaction: tcn, usageIndicator: usage },
        segmentCount: seCount,
        totalChargeCents: totalCharge,
    };
}

function pad2(n) { return String(n).padStart(2, "0"); }
function gender(g) { const x = upper(g)[0]; return x === "M" || x === "F" ? x : "U"; }
function payerKind(k) {
    return ({ medicare: "MB", medicaid: "MC", commercial: "CI", workers_comp: "WC", self_pay: "09" }[k] || "CI");
}
function relationshipCode(r) {
    return ({ spouse: "01", child: "19", self: "18", other: "G8" }[r] || "G8");
}

export default { generate837P };
