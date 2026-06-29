// =====================================================================
// functions/_lib/payer_directory.js — IL / CA + national payer scaffold
// =====================================================================
// A starting directory of the payers a CBG/MIGS practice in Illinois and
// California most commonly bills, plus the big national plans. Seeds
// billing_payers so claims can be routed.
//
// ⚠️  PAYER IDs ARE CLEARINGHOUSE-SPECIFIC. The same payer can have a
//     different electronic payer ID at Availity vs Change Healthcare vs
//     Office Ally vs Claim.MD. The `payer_id` here is a COMMONLY-USED
//     starting value (or "" where it must be looked up); `verify` marks how
//     much to trust it. The AUTHORITATIVE source is your live clearinghouse's
//     payer list — pull it once connected (the seed endpoint can sync it) and
//     let it overwrite these. Do NOT submit real claims on an unverified ID:
//     a wrong payer ID is a guaranteed front-end rejection.
//
// verify:
//   'common'  — widely-standardized national commercial ID; low risk, still confirm.
//   'required'— Blues / Medicare MAC / Medicaid / MCO — MUST confirm per clearinghouse + state.
//   'lookup'  — id unknown here; resolve from the clearinghouse payer list.
// =====================================================================

export const PAYERS = [
    // ---- National commercial (fairly standardized IDs) ----
    { key: "aetna",         name: "Aetna",                              kind: "commercial", states: ["IL","CA","US"], payer_id: "60054", verify: "common" },
    { key: "cigna",         name: "Cigna",                              kind: "commercial", states: ["IL","CA","US"], payer_id: "62308", verify: "common" },
    { key: "uhc",           name: "UnitedHealthcare",                   kind: "commercial", states: ["IL","CA","US"], payer_id: "87726", verify: "common" },
    { key: "umr",           name: "UMR (UnitedHealthcare)",             kind: "commercial", states: ["IL","CA","US"], payer_id: "39026", verify: "common" },
    { key: "humana",        name: "Humana",                             kind: "commercial", states: ["IL","CA","US"], payer_id: "61101", verify: "common" },
    { key: "oscar",         name: "Oscar Health",                       kind: "commercial", states: ["CA","US"],      payer_id: "",      verify: "lookup" },
    { key: "tricare_west",  name: "TRICARE West (TriWest)",             kind: "commercial", states: ["CA","US"],      payer_id: "",      verify: "required" },

    // ---- Blues ----
    { key: "bcbs_il",       name: "Blue Cross Blue Shield of Illinois (HCSC)", kind: "commercial", states: ["IL"], payer_id: "00621", verify: "required" },
    { key: "anthem_bc_ca",  name: "Anthem Blue Cross of California",    kind: "commercial", states: ["CA"],         payer_id: "",      verify: "required" },
    { key: "blue_shield_ca",name: "Blue Shield of California",          kind: "commercial", states: ["CA"],         payer_id: "",      verify: "required" },
    { key: "bcbs_fep",      name: "BCBS Federal Employee Program",      kind: "commercial", states: ["IL","CA","US"],payer_id: "",      verify: "required" },

    // ---- Medicare ----
    { key: "medicare_il",   name: "Medicare Part B — Illinois (NGS, J6)",     kind: "medicare", states: ["IL"], payer_id: "", verify: "required" },
    { key: "medicare_ca",   name: "Medicare Part B — California (Noridian, JE)", kind: "medicare", states: ["CA"], payer_id: "", verify: "required" },
    { key: "railroad_medicare", name: "Railroad Medicare (Palmetto GBA)",  kind: "medicare", states: ["US"],      payer_id: "RRMCR", verify: "required" },

    // ---- Medicaid (FFS + major MCOs) ----
    { key: "medicaid_il",   name: "Illinois Medicaid (HFS)",            kind: "medicaid", states: ["IL"], payer_id: "", verify: "required" },
    { key: "medical_ca",    name: "Medi-Cal (California Medicaid)",      kind: "medicaid", states: ["CA"], payer_id: "", verify: "required" },
    { key: "meridian_il",   name: "Meridian Health Plan (IL Medicaid MCO)", kind: "medicaid", states: ["IL"], payer_id: "", verify: "required" },
    { key: "countycare_il", name: "CountyCare (IL Medicaid MCO)",       kind: "medicaid", states: ["IL"], payer_id: "", verify: "required" },
    { key: "bcch_il",       name: "Blue Cross Community Health Plans (IL)", kind: "medicaid", states: ["IL"], payer_id: "", verify: "required" },
    { key: "lacare_ca",     name: "L.A. Care Health Plan (Medi-Cal)",   kind: "medicaid", states: ["CA"], payer_id: "", verify: "required" },
    { key: "iehp_ca",       name: "Inland Empire Health Plan (Medi-Cal)", kind: "medicaid", states: ["CA"], payer_id: "", verify: "required" },
    { key: "partnership_ca",name: "Partnership HealthPlan of California", kind: "medicaid", states: ["CA"], payer_id: "", verify: "required" },

    // ---- Multi-state managed care (Medicaid + marketplace) ----
    { key: "molina",        name: "Molina Healthcare",                  kind: "commercial", states: ["IL","CA","US"], payer_id: "", verify: "required" },
    { key: "centene_ambetter", name: "Centene / Ambetter",              kind: "commercial", states: ["IL","CA","US"], payer_id: "", verify: "required" },
    { key: "health_net_ca", name: "Health Net (California)",            kind: "commercial", states: ["CA"], payer_id: "95567", verify: "required" },
    { key: "kaiser",        name: "Kaiser Permanente",                  kind: "commercial", states: ["CA","IL"], payer_id: "", verify: "lookup",
      notes: "Kaiser is largely a closed system — external claims usually only for authorized out-of-network/referral care. Confirm billability." },
];

// Convert a directory entry → a billing_payers row (id/timestamps filled by caller).
export function toPayerRow(p, nowMs) {
    return {
        payer_id: p.payer_id || null,
        payer_name: p.name,
        payer_kind: p.kind,
        contract_status: "pending",
        clearinghouse_vendor: null,         // set to your selected clearinghouse
        notes: JSON.stringify({ directory_key: p.key, states: p.states, verify: p.verify, note: p.notes || null }),
        created_at: nowMs,
        updated_at: nowMs,
    };
}

export default { PAYERS, toPayerRow };
