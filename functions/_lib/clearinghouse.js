// =====================================================================
// functions/_lib/clearinghouse.js — clearinghouse submission ADAPTER
// =====================================================================
// One interface, pluggable providers. The 837 EDI (x12_837.js) is handed
// here for transport to a clearinghouse, which forwards to the payer and
// returns a 277CA acknowledgment (accepted / rejected at the front end)
// and, later, an 835 ERA (remittance).
//
// Providers are selected by env.CLEARINGHOUSE_VENDOR:
//   'mock'        — DEFAULT. No network; returns a simulated 277CA "accepted"
//                   so the full pipeline is demonstrable BEFORE payer
//                   enrollment / EDI agreements exist. Use until a real
//                   clearinghouse account + per-payer enrollment is live.
//   'stedi'       — Stedi modern API (Bearer env.STEDI_API_KEY). API-first
//                   X12 over JSON.
//   'claim_md' / 'office_ally' / 'availity' — scaffolded; wire when enrolled.
//
// SECURITY: claims are PHI. A real provider call leaves Cloudflare to a BAA-
// covered clearinghouse over TLS. Do NOT enable a live vendor until the
// clearinghouse BAA + payer EDI enrollment are in place (env-gated below).
// =====================================================================

export function clearinghouseVendor(env) {
    return String((env && env.CLEARINGHOUSE_VENDOR) || "mock").toLowerCase();
}

// Returns { ok, provider, clearinghouseClaimId, status, acknowledgment, raw, error }
// status maps onto billing_claims.status: 'submitted' | 'accepted_by_clearinghouse' | 'rejected'
export async function submitClaim(env, { edi, claim, payer }) {
    const vendor = clearinghouseVendor(env);
    try {
        if (vendor === "mock") return submitMock({ edi, claim });
        if (vendor === "stedi") return await submitStedi(env, { edi, claim, payer });
        // Enrolled-but-unimplemented vendors fail closed with a clear reason.
        return { ok: false, provider: vendor, status: "ready_to_submit", error: `clearinghouse vendor "${vendor}" not yet implemented` };
    } catch (e) {
        return { ok: false, provider: vendor, status: "ready_to_submit", error: e && e.message ? e.message : String(e) };
    }
}

// --- mock: simulated 277CA accepted -------------------------------------
function submitMock({ edi, claim }) {
    const id = "MOCK-" + (claim && claim.claim && claim.claim.patientControlNumber ? claim.claim.patientControlNumber : "CLM") + "-" + shortHash(edi);
    return {
        ok: true,
        provider: "mock",
        clearinghouseClaimId: id,
        status: "accepted_by_clearinghouse",
        acknowledgment: "277CA (simulated): A2 — accepted by clearinghouse front-end edits.",
        raw: { simulated: true, bytes: edi.length, note: "Set CLEARINGHOUSE_VENDOR + creds to submit for real." },
    };
}

// --- stedi: API-first X12 clearinghouse ---------------------------------
async function submitStedi(env, { edi, claim }) {
    const key = env.STEDI_API_KEY;
    if (!key) return { ok: false, provider: "stedi", status: "ready_to_submit", error: "STEDI_API_KEY not configured" };
    // Stedi accepts the raw X12 837 for submission; partner/endpoint come from env.
    const url = env.STEDI_CLAIMS_URL || "https://core.us.stedi.com/2023-08-01/x12/transactions";
    const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Key ${key}`, "Content-Type": "application/edi-x12" },
        body: edi,
    });
    const raw = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, provider: "stedi", status: "ready_to_submit", error: `stedi ${res.status}`, raw };
    return {
        ok: true,
        provider: "stedi",
        clearinghouseClaimId: raw.transactionId || raw.id || null,
        status: "submitted",
        acknowledgment: "Submitted to Stedi; await 277CA.",
        raw,
    };
}

function shortHash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
    return Math.abs(h).toString(36).slice(0, 8);
}

export default { submitClaim, clearinghouseVendor };
