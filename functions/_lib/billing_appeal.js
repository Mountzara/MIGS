// =====================================================================
// functions/_lib/billing_appeal.js — AI denial remediation + appeal drafting
// =====================================================================
// The DENIAL-RESPONSE engine. Given a denied/rejected claim and the CARC
// codes from its 835 ERA, it decides the right move (corrected claim vs
// formal appeal vs reconsideration vs patient bill) and drafts the
// payer-ready appeal letter plus the concrete corrected-claim changes.
//
// PHI: a valid appeal letter MUST carry the patient name, member id, DOB,
// claim number, and date of service — there is no de-identified appeal.
// The executed Anthropic BAA (anthropic.js note) permits this. The
// CALLER (appeal endpoint) MUST audit-log the draft as a PHI-bearing AI
// event (action "claim_appeal_draft").
//
// Grounding: every observed CARC is looked up in carc_codes.js first, so
// the strategy and explanations are code-accurate, and the no-AI fallback
// still produces a real, sendable letter. The AI elevates the prose and
// the clinical medical-necessity argument; it does not invent the codes.
// =====================================================================

import { callClaude, AnthropicError, extractJson } from "./anthropic.js";
import { lookupCarc, lookupRarc, recommendStrategy } from "./carc_codes.js";

export const APPEAL_PROMPT_VERSION = "billing-appeal-v1.0-2026-06-29";
const MODEL = (env) => (env && env.BILLING_AI_MODEL) || "claude-sonnet-4-6";

const STRATEGY_LABEL = {
    corrected_claim: "Corrected claim (resubmit)",
    appeal: "Formal appeal",
    reconsideration: "Reconsideration / payer review",
    patient_bill: "Bill the patient",
    write_off: "Contractual write-off",
};

const SYSTEM_PROMPT = `You are a medical-billing appeals specialist for an OB/GYN and minimally-invasive gynecologic surgery (MIGS) practice. A claim was denied or down-coded; you draft the practice's response.

ETHICS: You argue only what the documentation supports. You never fabricate clinical facts, dates, or findings. If the denial is correct (true patient responsibility or contractual), you say so and do NOT draft a meritless appeal.

You receive: the denial's CARC/RARC codes (already translated), the claim's procedure/diagnosis codes, the payer, and the patient/claim identifiers needed for the letter. Output a SINGLE JSON object, no prose, no code fences:

{
  "strategy": "corrected_claim" | "appeal" | "reconsideration" | "patient_bill" | "write_off",
  "strategy_rationale": "<1-2 sentences: why this is the right move for THESE codes>",
  "corrected_claim_changes": [
    { "target": "<line N / claim field>", "change": "<the exact edit>", "reason": "<why>" }
  ],
  "appeal_letter": "<the full letter, ready to send. Use the provided identifiers. Professional, concise, factual. Cite the denial reason, state the basis for reconsideration, reference the enclosed documentation (op note, path, etc.). If strategy is patient_bill or write_off, return an empty string here.>",
  "supporting_points": [ "<bullet the biller should verify/enclose>", "..." ],
  "deadline_note": "<the timely-appeal window to watch, in general terms>"
}

RULES:
- If strategy is corrected_claim, the letter may be brief (cover note) and the real value is corrected_claim_changes.
- If strategy is patient_bill or write_off, appeal_letter = "" and corrected_claim_changes = [].
- Be specific to the actual codes. Reference the CPT/ICD-10 on the claim by number.
- Never include a Social Security number. Use member id + DOB for identification.
- Output JSON ONLY.`;

function providerBlock(env) {
    return {
        name: env.BILLING_PROVIDER_NAME || "Mount Zara, LLC",
        npi: (env.BILLING_PROVIDER_NPI || "").replace(/\D/g, ""),
        tin: env.BILLING_PROVIDER_TIN || "",
        contact_phone: env.BILLING_CONTACT_PHONE || "",
        address: {
            line1: env.BILLING_PROVIDER_ADDR1 || "",
            city: env.BILLING_PROVIDER_CITY || "Evanston",
            state: env.BILLING_PROVIDER_STATE || "IL",
            zip: env.BILLING_PROVIDER_ZIP || "60202",
        },
    };
}

// Build the grounded denial context (CARC/RARC translated) shared by AI + fallback.
function denialContext(era) {
    const carcCodes = Array.from(new Set([...(era.reason_codes || []), ...((era.adjustments || []).map((a) => a.reason).filter(Boolean))]));
    const explanations = carcCodes.map((c) => {
        const r = lookupCarc(c);
        return { code: r.code, label: r.label, category: r.category, appealable: r.appealable, strategy: r.strategy, plain: r.plain };
    });
    return { carcCodes, explanations, strategy: recommendStrategy(carcCodes) };
}

function todayParts(nowMs) {
    // nowMs passed in (Date.now is unavailable in workflow scripts but fine in Functions;
    // callers pass Date.now()). Format a US date.
    const d = new Date(nowMs);
    return d.toISOString().slice(0, 10);
}

// Deterministic, sendable letter when AI is unavailable.
function fallbackDraft(env, ctxData, dctx, nowMs) {
    const prov = providerBlock(env);
    const { claim, payer, patient, insurance, lines, diags } = ctxData;
    const strategy = dctx.strategy;
    const memberId = (insurance && insurance.member_id) || "";
    const dob = (patient && patient.dob) || (insurance && insurance.subscriber_dob) || "";
    const name = `${(patient && patient.first_name) || ""} ${(patient && patient.last_name) || ""}`.trim();
    const codeList = (lines || []).map((l) => l.user_override_code || l.code).filter(Boolean).join(", ");
    const dxList = (diags || []).map((d) => d.user_override_code || d.icd10_code).filter(Boolean).join(", ");
    const carcLine = dctx.explanations.map((e) => `CARC ${e.code} (${e.label})`).join("; ") || "the stated reason";

    let letter = "";
    const changes = [];
    if (strategy === "patient_bill" || strategy === "write_off") {
        letter = "";
    } else {
        letter =
`${prov.name}
NPI ${prov.npi} · TIN ${prov.tin}
${prov.address.line1 ? prov.address.line1 + "\n" : ""}${prov.address.city}, ${prov.address.state} ${prov.address.zip}
${prov.contact_phone ? "Phone: " + prov.contact_phone + "\n" : ""}
${todayParts(nowMs)}

${payer ? payer.payer_name : "Claims Department"}
${(payer && payer.appeals_address) || (payer && payer.submission_address) || "[Payer appeals address]"}

RE: ${strategy === "corrected_claim" ? "Corrected Claim" : "Request for Reconsideration / Appeal"}
Patient: ${name || "[patient]"}
Member ID: ${memberId || "[member id]"}   DOB: ${dob || "[dob]"}
Claim #: ${claim.clearinghouse_claim_id || claim.id}
Date(s) of Service: ${claim.visit_date || "[DOS]"}
Procedure(s): ${codeList || "[CPT]"}    Diagnosis(es): ${dxList || "[ICD-10]"}

To Whom It May Concern:

We are writing regarding the above claim, which was adjudicated with ${carcLine}. We respectfully request ${STRATEGY_LABEL[strategy].toLowerCase()}.

${dctx.explanations.map((e) => `• ${e.plain}`).join("\n")}

The services billed are supported by the medical record. Enclosed please find the operative/clinical documentation substantiating medical necessity and the codes as submitted. We ask that you reprocess this claim accordingly.

Thank you for your review.

Sincerely,
${prov.name} — Billing`;
        if (strategy === "corrected_claim") {
            for (const e of dctx.explanations) {
                if (e.code === "4") changes.push({ target: "service line modifier", change: "Add/correct the procedure modifier", reason: e.label });
                else if (e.code === "97" || e.code === "59") changes.push({ target: "bundled line", change: "Append modifier 59 or X{EPSU} if services were distinct", reason: e.label });
                else if (e.code === "16" || e.code === "252") changes.push({ target: "claim data", change: "Supply the missing element / attach requested documentation", reason: e.label });
                else if (e.code === "11") changes.push({ target: "diagnosis linkage", change: "Re-point the line to a supporting ICD-10 (per the note)", reason: e.label });
                else if (e.code === "109") changes.push({ target: "payer", change: "Re-route to the correct payer/payer ID", reason: e.label });
            }
        }
    }
    return {
        ai_used: false,
        model: null,
        prompt_version: APPEAL_PROMPT_VERSION,
        strategy,
        strategy_label: STRATEGY_LABEL[strategy],
        strategy_rationale: strategy === "patient_bill" ? "Denial reflects legitimate patient responsibility." : strategy === "write_off" ? "Contractual adjustment — not appealable." : "Documentation supports the billed services; pursue per the CARC strategy.",
        carc_explanations: dctx.explanations,
        corrected_claim_changes: changes,
        appeal_letter: letter,
        supporting_points: [
            "Attach the operative note / clinical documentation for the date of service.",
            "Confirm the member ID and date of birth against the card.",
            strategy === "corrected_claim" ? "Resubmit as a corrected claim (frequency code 7) referencing the original claim number." : "Send to the payer's appeals address within the timely-appeal window.",
        ],
        deadline_note: "Watch the payer's timely-appeal window (commonly 90–180 days from the remittance date; Medicare redetermination is 120 days).",
        note: "AI drafter unavailable — this is the rule-based, code-grounded draft. Set ANTHROPIC_API_KEY to enable AI letter authoring.",
    };
}

/**
 * @param {object} env
 * @param {object} ctxData - { claim, era, lines, diags, payer, patient, insurance, flags }
 *   where `era` is the parsed clearinghouse_response_json.era object.
 * @param {number} nowMs - Date.now() from the caller (Functions runtime).
 * @returns {Promise<object>} appeal draft (see SYSTEM_PROMPT shape) + ai_used flag.
 */
export async function draftAppeal(env, ctxData, nowMs) {
    const era = ctxData.era || {};
    const dctx = denialContext(era);

    if (!env || !env.ANTHROPIC_API_KEY) return fallbackDraft(env, ctxData, dctx, nowMs);

    const prov = providerBlock(env);
    const { claim, payer, patient, insurance, lines, diags } = ctxData;
    const userPayload = {
        provider: prov,
        date: todayParts(nowMs),
        payer: payer ? { name: payer.payer_name, payer_id: payer.payer_id, kind: payer.payer_kind, appeals_address: payer.appeals_address || payer.submission_address || null } : null,
        patient: { name: `${(patient && patient.first_name) || ""} ${(patient && patient.last_name) || ""}`.trim(), member_id: (insurance && insurance.member_id) || "", dob: (patient && patient.dob) || (insurance && insurance.subscriber_dob) || "" },
        claim: { claim_number: claim.clearinghouse_claim_id || claim.id, date_of_service: claim.visit_date, charge_usd: Math.round((claim.total_charge_cents || 0)) / 100 },
        procedures: (lines || []).map((l) => ({ cpt: l.user_override_code || l.code, modifiers: [l.modifier_1, l.modifier_2, l.modifier_3, l.modifier_4].filter(Boolean), units: l.units || 1 })),
        diagnoses: (diags || []).map((d) => d.user_override_code || d.icd10_code).filter(Boolean),
        denial: {
            carc: dctx.explanations,
            rarc: (era.rarc_codes || []).map(lookupRarc).filter(Boolean),
            status_label: era.status || "denied",
            recommended_strategy: dctx.strategy,
        },
    };

    let result;
    try {
        result = await callClaude(env, {
            model: MODEL(env),
            system: SYSTEM_PROMPT,
            messages: [{ role: "user", content: "Draft the response for this denial:\n\n" + JSON.stringify(userPayload, null, 2) }],
            max_tokens: 2200,
            temperature: 0.2,
        });
    } catch (e) {
        const fb = fallbackDraft(env, ctxData, dctx, nowMs);
        fb.note = `AI drafter error (${e instanceof AnthropicError ? e.status : "network"}) — showing rule-based draft.`;
        return fb;
    }
    const parsed = extractJson(result.text);
    if (!parsed || typeof parsed !== "object") {
        const fb = fallbackDraft(env, ctxData, dctx, nowMs);
        fb.note = "AI drafter returned unparseable output — showing rule-based draft.";
        return fb;
    }
    const strategy = ["corrected_claim", "appeal", "reconsideration", "patient_bill", "write_off"].includes(parsed.strategy) ? parsed.strategy : dctx.strategy;
    return {
        ai_used: true,
        model: MODEL(env),
        prompt_version: APPEAL_PROMPT_VERSION,
        strategy,
        strategy_label: STRATEGY_LABEL[strategy] || strategy,
        strategy_rationale: String(parsed.strategy_rationale || "").slice(0, 600),
        carc_explanations: dctx.explanations,
        corrected_claim_changes: Array.isArray(parsed.corrected_claim_changes) ? parsed.corrected_claim_changes.slice(0, 12).map((c) => ({ target: String(c.target || ""), change: String(c.change || ""), reason: String(c.reason || "") })) : [],
        appeal_letter: String(parsed.appeal_letter || ""),
        supporting_points: Array.isArray(parsed.supporting_points) ? parsed.supporting_points.slice(0, 12).map(String) : [],
        deadline_note: String(parsed.deadline_note || ""),
        usage: result.usage || {},
    };
}

export default { draftAppeal, APPEAL_PROMPT_VERSION };
