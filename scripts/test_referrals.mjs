#!/usr/bin/env node
// Deploy gate: referral coverage. A false "ok" here sends an HMO patient
// out of network and hands them the bill, so every branch is asserted.
import r from "../functions/_lib/referrals.js";

let pass = 0, fail = 0;
const t = (n, c) => { if (c) pass++; else { fail++; console.error("FAIL:", n); } };

// --- HMO: the expensive mistake --------------------------------------
const hmoOut = r.coverageRisk({ plan_type: "HMO", payer_name: "Aetna", destination_networks: ["BCBS IL PPO"] });
t("HMO out of network blocks", hmoOut.verdict === "block");
t("HMO block explains why", hmoOut.reasons.some(x => /no out-of-network benefit/.test(x)));
t("EPO out of network blocks", r.coverageRisk({ plan_type: "EPO", payer_name: "Cigna", destination_networks: ["Aetna"] }).verdict === "block");
t("Medicaid out of network blocks", r.coverageRisk({ plan_type: "Medicaid", payer_name: "IL Medicaid", destination_networks: ["Aetna"] }).verdict === "block");

// --- PPO tolerates out of network, at a price ------------------------
const ppoOut = r.coverageRisk({ plan_type: "PPO", payer_name: "Aetna", destination_networks: ["Cigna"] });
t("PPO out of network warns, not blocks", ppoOut.verdict === "warn");
t("PPO warning mentions higher cost", ppoOut.reasons.some(x => /higher cost/.test(x)));

// --- in network ------------------------------------------------------
const ppoIn = r.coverageRisk({ plan_type: "PPO", payer_name: "Aetna", destination_networks: ["Aetna", "Cigna"], networks_verified_at: "2026-08-01" });
t("PPO in network is ok", ppoIn.verdict === "ok");
t("in-network flag set", ppoIn.in_network === true);
t("verified network raises no staleness note", !ppoIn.reasons.some(x => /never been verified/.test(x)));
t("unverified network notes staleness",
  r.coverageRisk({ plan_type: "PPO", payer_name: "Aetna", destination_networks: ["Aetna"] }).reasons.some(x => /never been verified/.test(x)));
t("substring match counts as in network",
  r.coverageRisk({ plan_type: "PPO", payer_name: "Aetna", destination_networks: ["aetna better health"] }).in_network === true);

// --- the second HMO trap: who wrote the referral ---------------------
const hmoInNotPcp = r.coverageRisk({ plan_type: "HMO", payer_name: "Aetna", destination_networks: ["Aetna"], ordering_provider_is_plan_pcp: false });
t("HMO in network but not PCP -> verify", hmoInNotPcp.verdict === "verify");
t("PCP requirement explained", hmoInNotPcp.reasons.some(x => /designated in-plan PCP/.test(x)));
t("HMO in network as PCP is ok",
  r.coverageRisk({ plan_type: "HMO", payer_name: "Aetna", destination_networks: ["Aetna"], ordering_provider_is_plan_pcp: true }).verdict === "ok");
t("POS also raises the PCP question",
  r.coverageRisk({ plan_type: "POS", payer_name: "Aetna", destination_networks: ["Aetna"] }).verdict === "verify");

// --- unknowns never masquerade as answers ----------------------------
t("no payer -> verify", r.coverageRisk({ plan_type: "PPO", payer_name: "" }).verdict === "verify");
t("no recorded networks -> verify", r.coverageRisk({ plan_type: "PPO", payer_name: "Aetna", destination_networks: [] }).verdict === "verify");
t("verify leaves in_network null", r.coverageRisk({ plan_type: "PPO", payer_name: "Aetna" }).in_network === null);

// --- self pay --------------------------------------------------------
t("self pay with cash price is ok",
  r.coverageRisk({ plan_type: "self_pay", destination_accepts_cash: true }).verdict === "ok");
t("self pay without cash price warns",
  r.coverageRisk({ plan_type: "self_pay", destination_accepts_cash: false }).verdict === "warn");
t("self pay says the destination bills separately",
  r.coverageRisk({ plan_type: "self_pay", destination_accepts_cash: true }).reasons.some(x => /does not cover it/.test(x)));

// --- prior authorization advice --------------------------------------
t("MRI likely requires PA", r.priorAuthAdvice({ order_type: "imaging", modality: "MRI pelvis" }).recommendation === "likely_required");
t("CT likely requires PA", r.priorAuthAdvice({ order_type: "imaging", modality: "CT abdomen" }).recommendation === "likely_required");
t("PA note names the ordering practice as responsible",
  /ordering practice/.test(r.priorAuthAdvice({ order_type: "imaging", modality: "MRI" }).note));
t("ultrasound usually not required", r.priorAuthAdvice({ order_type: "imaging", modality: "pelvic ultrasound" }).recommendation === "usually_not_required");
t("routine labs usually not required", r.priorAuthAdvice({ order_type: "lab" }).recommendation === "usually_not_required");
t("lab note flags genetic panels", /[Gg]enetic/.test(r.priorAuthAdvice({ order_type: "lab" }).note));
t("HMO referral likely requires PA", r.priorAuthAdvice({ order_type: "referral", plan_type: "HMO" }).recommendation === "likely_required");
t("PPO referral -> verify", r.priorAuthAdvice({ order_type: "referral", plan_type: "PPO" }).recommendation === "verify");
t("self pay needs no PA", r.priorAuthAdvice({ order_type: "imaging", modality: "MRI", plan_type: "self_pay" }).recommendation === "not_required");
t("PA advice never claims certainty on a plan",
  ["high", "medium", "low"].includes(r.priorAuthAdvice({ order_type: "imaging", modality: "MRI" }).confidence));

// --- ranking ---------------------------------------------------------
const ranked = r.rankDestinations([
    { name: "Zeta Imaging", networks: ["Cigna"] },
    { name: "Alpha Imaging", networks: ["Aetna"], networks_verified_at: "2026-08-01" },
    { name: "Beta Imaging", networks: [] },
], { payer_name: "Aetna", plan_type: "HMO" });
t("in-network destination ranks first", ranked[0].name === "Alpha Imaging");
t("unknown-network ranks above blocked", ranked[1].name === "Beta Imaging");
t("blocked destination ranks last", ranked[2].name === "Zeta Imaging");
t("each ranked row carries its verdict", ranked.every(d => d.risk && d.risk.verdict));
t("empty list is safe", r.rankDestinations(null, {}).length === 0);

console.log(`referrals: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
