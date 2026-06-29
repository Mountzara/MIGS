// =====================================================================
// functions/_lib/clearinghouse.js — multi-clearinghouse submission ADAPTER
// =====================================================================
// One interface, many providers. A clearinghouse is an aggregator that
// forwards your X12 837 to ANY payer (BCBS, Aetna, Cigna, UHC, Humana,
// Medicare, Medicaid/Medi-Cal, Blue Shield, Health Net, Molina, Centene…)
// — so you connect to ONE clearinghouse, enroll your payers inside it, and
// it reaches them all. This adapter lets you drop in whichever account you
// hold.
//
// Select with env.CLEARINGHOUSE_VENDOR:
//   mock              — DEFAULT. Simulated 277CA accepted; no network. Keep
//                       until a real account + enrollment + a verified test
//                       claim are done.
//   stedi             — API-first X12 (Key auth).
//   change_healthcare — Optum / Change Healthcare Medical Network (OAuth2).
//   availity          — Availity Essentials API (OAuth2).
//   claim_md          — Claim.MD REST (AccountKey).
//   office_ally       — Office Ally (REST where enabled; else SFTP batch — see runbook).
//   waystar           — Waystar API (Bearer).
//
// Each provider config is DATA (auth style + endpoints), read from env so
// nothing is hardcoded per-tenant. Endpoints/paths CAN change vendor-side —
// override via env.<VENDOR>_BASE_URL / _SUBMIT_PATH etc. and confirm against
// the vendor's current API docs at enrollment.
//
// SECURITY: an 837 is PHI. Live calls leave Cloudflare to a BAA-covered
// clearinghouse over TLS. Real submission also requires usage indicator 'P'
// (env.CLEARINGHOUSE_LIVE=1) — until then claims build as 'T' (test).
// =====================================================================

// auth: 'key' (Authorization: Key <k>) | 'bearer' | 'basic' | 'oauth2' | 'accountkey-body'
const PROVIDERS = {
    mock: { label: "Mock (no network)" },
    stedi: {
        label: "Stedi", auth: "key",
        baseUrl: "https://core.us.stedi.com", submitPath: "/2023-08-01/x12/transactions",
        eligibilityPath: "/2024-04-01/healthcare/eligibility", statusPath: "/2023-08-01/x12/transactions",
        keyEnv: "STEDI_API_KEY", contentType: "application/edi-x12",
    },
    change_healthcare: {
        label: "Change Healthcare / Optum", auth: "oauth2",
        baseUrl: "https://apis.changehealthcare.com", submitPath: "/medicalnetwork/professionalclaims/v3/submission",
        eligibilityPath: "/medicalnetwork/eligibility/v3", statusPath: "/medicalnetwork/claimstatus/v2",
        tokenPath: "/apip/auth/v2/token", idEnv: "CHC_CLIENT_ID", secretEnv: "CHC_CLIENT_SECRET",
        contentType: "application/json",
    },
    availity: {
        label: "Availity Essentials", auth: "oauth2",
        baseUrl: "https://api.availity.com", submitPath: "/availity/v1/claim-submissions",
        eligibilityPath: "/availity/v1/coverages", statusPath: "/availity/v1/claim-statuses",
        tokenPath: "/v1/token", idEnv: "AVAILITY_CLIENT_ID", secretEnv: "AVAILITY_CLIENT_SECRET",
        contentType: "application/json",
    },
    claim_md: {
        label: "Claim.MD", auth: "accountkey-body",
        baseUrl: "https://svc.claim.md", submitPath: "/services/upload/",
        eligibilityPath: "/services/eligibility/", statusPath: "/services/response/",
        keyEnv: "CLAIMMD_ACCOUNT_KEY", contentType: "multipart/form-data",
    },
    office_ally: {
        label: "Office Ally", auth: "basic",
        baseUrl: "", submitPath: "", // REST only on some plans; SFTP batch otherwise (see runbook)
        userEnv: "OFFICEALLY_USER", passEnv: "OFFICEALLY_PASS", contentType: "application/edi-x12",
        note: "Office Ally is typically SFTP batch (host ftp10.officeally.com). REST submit only where enabled.",
    },
    waystar: {
        label: "Waystar", auth: "bearer",
        baseUrl: "https://api.waystar.com", submitPath: "/claims/v1/professional",
        eligibilityPath: "/eligibility/v1", statusPath: "/claimstatus/v1",
        keyEnv: "WAYSTAR_API_KEY", contentType: "application/json",
    },
};

export function clearinghouseVendor(env) {
    return String((env && env.CLEARINGHOUSE_VENDOR) || "mock").toLowerCase();
}
export function providerConfig(env, vendor) {
    const v = vendor || clearinghouseVendor(env);
    const base = PROVIDERS[v];
    if (!base) return null;
    // env overrides for any path/base (vendors change endpoints)
    const U = v.toUpperCase();
    return {
        vendor: v, label: base.label, auth: base.auth, contentType: base.contentType, note: base.note,
        baseUrl: (env[`${U}_BASE_URL`] || base.baseUrl || ""),
        submitPath: (env[`${U}_SUBMIT_PATH`] || base.submitPath || ""),
        eligibilityPath: (env[`${U}_ELIGIBILITY_PATH`] || base.eligibilityPath || ""),
        statusPath: (env[`${U}_STATUS_PATH`] || base.statusPath || ""),
        tokenPath: base.tokenPath, keyEnv: base.keyEnv, idEnv: base.idEnv, secretEnv: base.secretEnv,
        userEnv: base.userEnv, passEnv: base.passEnv,
    };
}

export function isConfigured(env, vendor) {
    const v = vendor || clearinghouseVendor(env);
    if (v === "mock") return true;
    const cfg = providerConfig(env, v);
    if (!cfg) return false;
    if (cfg.auth === "key" || cfg.auth === "bearer" || cfg.auth === "accountkey-body") return !!env[cfg.keyEnv];
    if (cfg.auth === "oauth2") return !!(env[cfg.idEnv] && env[cfg.secretEnv]);
    if (cfg.auth === "basic") return !!(env[cfg.userEnv] && env[cfg.passEnv]);
    return false;
}

async function authHeaders(env, cfg) {
    if (cfg.auth === "key") return { Authorization: `Key ${env[cfg.keyEnv]}` };
    if (cfg.auth === "bearer") return { Authorization: `Bearer ${env[cfg.keyEnv]}` };
    if (cfg.auth === "accountkey-body") return {}; // key travels in the body
    if (cfg.auth === "basic") return { Authorization: "Basic " + btoa(`${env[cfg.userEnv]}:${env[cfg.passEnv]}`) };
    if (cfg.auth === "oauth2") {
        const tok = await oauthToken(env, cfg);
        return { Authorization: `Bearer ${tok}` };
    }
    return {};
}

async function oauthToken(env, cfg) {
    const res = await fetch(cfg.baseUrl + cfg.tokenPath, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "client_credentials", client_id: env[cfg.idEnv], client_secret: env[cfg.secretEnv] }),
    });
    if (!res.ok) throw new Error(`${cfg.vendor} oauth ${res.status}`);
    const j = await res.json();
    return j.access_token;
}

// ---------------------------------------------------------------------
// submitClaim(env, { edi, claim, payer }) -> normalized result
//   { ok, provider, clearinghouseClaimId, status, acknowledgment, raw, error }
//   status maps onto billing_claims.status.
// ---------------------------------------------------------------------
export async function submitClaim(env, { edi, claim, payer }) {
    const vendor = clearinghouseVendor(env);
    try {
        if (vendor === "mock") return submitMock({ edi, claim });
        const cfg = providerConfig(env, vendor);
        if (!cfg) return fail(vendor, `unknown clearinghouse vendor "${vendor}"`);
        if (!isConfigured(env, vendor)) return fail(vendor, `${cfg.label} credentials not configured (set ${credEnvList(cfg)})`);
        if (!cfg.baseUrl || !cfg.submitPath) return fail(vendor, `${cfg.label} has no REST submit endpoint configured — batch/SFTP path (see runbook), or set ${cfg.vendor.toUpperCase()}_BASE_URL/_SUBMIT_PATH`);

        const headers = Object.assign({ "Content-Type": cfg.contentType, Accept: "application/json" }, await authHeaders(env, cfg));
        let body = edi;
        if (cfg.auth === "accountkey-body") {
            const fd = new FormData();
            fd.append("AccountKey", env[cfg.keyEnv]); fd.append("File", new Blob([edi]), "claim.x12");
            body = fd; delete headers["Content-Type"]; // let fetch set multipart boundary
        }
        const res = await fetch(cfg.baseUrl + cfg.submitPath, { method: "POST", headers, body });
        const raw = await res.json().catch(() => ({ _nonjson: true }));
        if (!res.ok) return fail(vendor, `${cfg.label} ${res.status}`, raw);
        return {
            ok: true, provider: vendor,
            clearinghouseClaimId: raw.claimId || raw.transactionId || raw.id || raw.controlNumber || null,
            status: raw.accepted === false || /reject/i.test(raw.status || "") ? "rejected" : "submitted",
            acknowledgment: raw.message || `Submitted to ${cfg.label}; awaiting 277CA.`,
            raw,
        };
    } catch (e) {
        return fail(vendor, e && e.message ? e.message : String(e));
    }
}

// ---------------------------------------------------------------------
// checkEligibility / checkStatus — interface present for every provider.
// Real 270/271 + 276/277 generation is the inbound-rail slice; these post
// to the vendor's eligibility/status endpoint when configured.
// ---------------------------------------------------------------------
export async function checkEligibility(env, payload) {
    const vendor = clearinghouseVendor(env);
    if (vendor === "mock") return { ok: true, provider: "mock", coverage: { active: true, simulated: true } };
    const cfg = providerConfig(env, vendor);
    if (!cfg || !isConfigured(env, vendor) || !cfg.eligibilityPath) return { ok: false, error: "eligibility_not_configured", provider: vendor };
    try {
        const headers = Object.assign({ "Content-Type": "application/json", Accept: "application/json" }, await authHeaders(env, cfg));
        const res = await fetch(cfg.baseUrl + cfg.eligibilityPath, { method: "POST", headers, body: JSON.stringify(payload) });
        const raw = await res.json().catch(() => ({}));
        return { ok: res.ok, provider: vendor, raw };
    } catch (e) { return { ok: false, provider: vendor, error: String(e && e.message || e) }; }
}

function submitMock({ edi, claim }) {
    const pcn = claim && claim.claim && claim.claim.patientControlNumber ? claim.claim.patientControlNumber : "CLM";
    return {
        ok: true, provider: "mock",
        clearinghouseClaimId: "MOCK-" + pcn + "-" + shortHash(edi),
        status: "accepted_by_clearinghouse",
        acknowledgment: "277CA (simulated): A2 — accepted by clearinghouse front-end edits.",
        raw: { simulated: true, bytes: edi.length, note: "Set CLEARINGHOUSE_VENDOR + creds + CLEARINGHOUSE_LIVE=1 to submit for real." },
    };
}
function fail(provider, error, raw) { return { ok: false, provider, status: "ready_to_submit", error, raw: raw || null }; }
function credEnvList(cfg) {
    if (cfg.auth === "oauth2") return `${cfg.idEnv} + ${cfg.secretEnv}`;
    if (cfg.auth === "basic") return `${cfg.userEnv} + ${cfg.passEnv}`;
    return cfg.keyEnv;
}
function shortHash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h).toString(36).slice(0, 8); }

export const CLEARINGHOUSES = Object.keys(PROVIDERS).map((k) => ({ vendor: k, label: PROVIDERS[k].label, auth: PROVIDERS[k].auth || "none" }));
export default { submitClaim, checkEligibility, clearinghouseVendor, providerConfig, isConfigured, CLEARINGHOUSES };
