// =====================================================================
// functions/_lib/x12_835.js — X12 5010 835 ERA (remittance) PARSER
// =====================================================================
// The INBOUND rail. A payer/clearinghouse returns an 835 Electronic
// Remittance Advice telling you, per claim: what was paid, what was
// adjusted (CARC/RARC), patient responsibility, and the claim status
// (paid / denied / reversed). Parsing it lets the pipeline auto-post
// payments and flip claims to paid / partially_paid / denied — closing
// the loop to "paid / outstanding / remediation".
//
// Deterministic, no PHI-dependent calls — pure function, unit-testable.
// Amounts in the 835 are dollars; we return integer cents.
// =====================================================================

const toCents = (s) => Math.round(parseFloat(s || "0") * 100) || 0;

// CLP02 claim status code → our billing_claims.status intent.
const CLAIM_STATUS = {
    "1": "paid",            // processed as primary
    "2": "paid",            // processed as secondary
    "3": "paid",            // processed as tertiary
    "4": "denied",          // denied
    "19": "paid",           // processed as primary, forwarded
    "20": "paid",           // processed as secondary, forwarded
    "21": "paid",           // processed as tertiary, forwarded
    "22": "reversed",       // reversal of previous payment
    "23": "denied",         // not our claim / forwarded to additional payer
    "25": "denied",         // predetermination pricing only — no payment
};
const STATUS_LABEL = {
    "1": "Processed as primary", "2": "Processed as secondary", "3": "Processed as tertiary",
    "4": "Denied", "19": "Primary, forwarded", "20": "Secondary, forwarded", "21": "Tertiary, forwarded",
    "22": "Reversal of previous payment", "23": "Not our claim / forwarded", "25": "Predetermination only",
};

export function parse835(edi) {
    if (typeof edi !== "string") return { ok: false, error: "not a string", claims: [] };
    const segs = edi.split("~").map((s) => s.trim()).filter(Boolean).map((s) => s.split("*"));

    const out = { ok: true, payerName: null, payeeName: null, payment: { method: null, amountCents: 0, traceNumber: null, date: null }, claims: [] };
    let claim = null, entity = null;

    for (const el of segs) {
        const tag = el[0];
        switch (tag) {
            case "BPR":
                out.payment.method = el[4] || null;         // ACH | CHK | NON
                out.payment.amountCents = toCents(el[2]);   // total provider payment
                break;
            case "TRN":
                out.payment.traceNumber = el[2] || null;    // check / EFT trace
                break;
            case "N1":
                entity = el[1];                              // PR payer, PE payee
                if (entity === "PR") out.payerName = el[2] || null;
                if (entity === "PE") out.payeeName = el[2] || null;
                break;
            case "DTM":
                if (el[1] === "405") out.payment.date = el[2] || null;   // production date
                break;
            case "CLP":
                claim = {
                    patientControlNumber: el[1] || null,     // YOUR claim id (CLM01 echoed)
                    statusCode: el[2] || null,
                    statusLabel: STATUS_LABEL[el[2]] || `Status ${el[2]}`,
                    chargeCents: toCents(el[3]),
                    paidCents: toCents(el[4]),
                    patientRespCents: toCents(el[5]),
                    payerClaimId: el[7] || null,             // payer's internal claim control number
                    adjustments: [],
                    lines: [],
                    _line: null,
                };
                // refine: paid>0 but < charge AND status paid → partially_paid
                out.claims.push(claim);
                break;
            case "CAS": {
                // CAS*<group>*<reason>*<amount>[*<qty>]... repeated triplets
                const group = el[1];
                const adj = [];
                for (let i = 2; i + 1 < el.length; i += 3) {
                    if (!el[i]) continue;
                    adj.push({ group, reason: el[i], amountCents: toCents(el[i + 1]) });
                }
                if (claim && claim._line) claim._line.adjustments.push(...adj);
                else if (claim) claim.adjustments.push(...adj);
                break;
            }
            case "SVC": {
                // SVC*<HC:proc[:mods]>*<charge>*<paid>*<rev>*<units>
                const proc = (el[1] || "").split(":");
                const line = {
                    procedure: proc[1] || proc[0] || null,
                    modifiers: proc.slice(2),
                    chargeCents: toCents(el[2]),
                    paidCents: toCents(el[3]),
                    units: parseInt(el[5] || "1", 10) || 1,
                    adjustments: [],
                };
                if (claim) { claim.lines.push(line); claim._line = line; }
                break;
            }
            default:
                break;
        }
    }

    // finalize status mapping (paid vs partially_paid) + cleanup
    for (const c of out.claims) {
        delete c._line;
        const base = CLAIM_STATUS[c.statusCode] || "unknown";
        c.mappedStatus = (base === "paid" && c.paidCents > 0 && c.paidCents < c.chargeCents) ? "partially_paid" : base;
        // top-level denial/adjustment reasons (CARC codes) for remediation
        c.reasonCodes = [...new Set([...c.adjustments, ...c.lines.flatMap((l) => l.adjustments)].map((a) => a.reason))];
    }
    out.totalPaidCents = out.claims.reduce((a, c) => a + c.paidCents, 0);
    return out;
}

export default { parse835 };
