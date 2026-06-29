// =====================================================================
// functions/_lib/billing_ai_preflight.js — AI pre-flight claim reviewer
// =====================================================================
// A SECOND OPINION on a fully-assembled claim, AFTER the deterministic
// clean-claim scrub passes, BEFORE the 837 goes out. The scrub catches
// structural defects (missing NPI, $0 charge, bad dx pointer). This
// catches the judgment-call denial patterns a rules engine can't:
//   * dx↔CPT medical-necessity mismatches
//   * NCCI/MUE bundling that needs a 59/X{EPSU} modifier
//   * E/M-with-procedure needing modifier 25
//   * POS/modifier combinations a given payer kind rejects
//   * frequency/units that look unsupported
// and names the LIKELY CARC each would draw, so the biller fixes it
// before the payer denies it — the "undeniable first-time claim" goal.
//
// DATA MINIMIZATION (per anthropic.js BAA note): this reviewer does NOT
// need patient identity to assess denial risk. We send ONLY codes,
// modifiers, diagnoses, POS, units, charges, and payer KIND — never the
// name / member id / DOB. So this path carries no PHI even though the
// BAA would permit it.
//
// Graceful fallback: with no ANTHROPIC_API_KEY (or on API error) it
// returns a useful review derived from the deterministic scrub, so the
// endpoint always responds.
// =====================================================================

import { callClaude, AnthropicError, extractJson } from "./anthropic.js";
import { CARC } from "./carc_codes.js";

export const PREFLIGHT_PROMPT_VERSION = "billing-preflight-v1.0-2026-06-29";
const MODEL = (env) => (env && env.BILLING_AI_MODEL) || "claude-sonnet-4-6";

const SYSTEM_PROMPT = `You are a senior medical-billing denial-prevention reviewer for an OB/GYN and minimally-invasive gynecologic surgery (MIGS) practice. You review a single CLEAN-passed professional claim and predict which denials a payer would issue, so the biller can prevent them BEFORE submission.

CRITICAL ETHICS: You NEVER recommend upcoding beyond what is documented. You flag UNDER-coding only as an advisory ("documentation may support a higher level — verify the note"), never as an instruction to change a code without documentation. Your job is the UNDENIABLE claim, not the inflated one.

You receive a de-identified claim (codes only — no patient identity). Output a SINGLE JSON object, no prose, no code fences:

{
  "risk_level": "low" | "medium" | "high",
  "ready_to_submit": true | false,
  "confidence": 0.0-1.0,
  "summary": "<=140 chars, the headline denial risk (or 'clean')",
  "issues": [
    {
      "severity": "block" | "warn" | "info",
      "category": "medical_necessity" | "bundling" | "modifier" | "pos" | "frequency" | "coding" | "coverage" | "other",
      "finding": "<what is wrong or risky, specific to the codes on THIS claim>",
      "fix": "<the concrete change: add modifier 25 to 99214, point 58571 at N80.9, etc.>",
      "likely_carc": "<the CARC code this would most likely draw, e.g. '97', '11', '4'; or '' if n/a>"
    }
  ]
}

RULES:
- "block" = would almost certainly deny or reject; should be fixed before submit. "warn" = elevated denial risk; biller should confirm. "info" = optional optimization.
- Be specific to the actual codes present. Do not invent issues; if the claim is clean, return risk_level "low", ready_to_submit true, issues [].
- Prefer naming a real CARC from this set when applicable: ${Object.keys(CARC).join(", ")}.
- ready_to_submit is false ONLY if there is at least one "block".
- Output JSON ONLY.`;

// Minimized, PHI-free projection of the normalized claim.
function minimize(norm) {
    const cl = norm.claim || {};
    return {
        payer_kind: (norm.payer && norm.payer.kind) || "commercial",
        place_of_service: cl.placeOfService,
        frequency_code: cl.frequencyCode,
        diagnoses: cl.diagnoses || [],
        lines: (norm.lines || []).map((l, i) => ({
            n: i + 1,
            cpt: l.procedureCode,
            modifiers: l.modifiers || [],
            units: l.units,
            charge_usd: Math.round((Number(l.chargeCents) || 0)) / 100,
            dx_pointers: l.diagnosisPointers || [],
            pos: l.placeOfService || cl.placeOfService,
        })),
    };
}

// Deterministic review when AI is unavailable — maps the scrub output into
// the same issue shape so the UI renders identically.
function fallbackReview(scrub) {
    const issues = [];
    for (const b of (scrub.blocks || [])) issues.push({ severity: "block", category: "coding", finding: b.message, fix: "Resolve before submission.", likely_carc: b.code === "dx_pointer_range" || b.code === "diagnosis" ? "11" : "16" });
    for (const w of (scrub.warnings || [])) {
        const carc = w.code === "modifier_25" ? "97" : w.code === "duplicate_line" ? "18" : w.code === "dx_specificity" ? "11" : "";
        issues.push({ severity: "warn", category: w.code && w.code.startsWith("modifier") ? "modifier" : "coding", finding: w.message, fix: "Review and confirm.", likely_carc: carc });
    }
    const hasBlock = issues.some((i) => i.severity === "block");
    return {
        ai_used: false,
        model: null,
        prompt_version: PREFLIGHT_PROMPT_VERSION,
        risk_level: hasBlock ? "high" : (issues.length ? "medium" : "low"),
        ready_to_submit: !hasBlock,
        confidence: 0.4,
        summary: hasBlock ? "Blocking issues from the deterministic scrub." : (issues.length ? "Advisory denial risks from the scrub." : "Clean per the deterministic scrub."),
        issues,
        note: "AI reviewer unavailable — this is the rule-based scrub projection. Set ANTHROPIC_API_KEY to enable the AI second opinion.",
    };
}

/**
 * @param {object} env
 * @param {object} args
 * @param {object} args.norm  - normalized claim from claim_assembler.assembleClaim
 * @param {object} args.scrub - scrubClaim() result
 * @returns {Promise<object>} review object (see SYSTEM_PROMPT shape) + ai_used flag
 */
export async function aiPreflightReview(env, { norm, scrub }) {
    if (!env || !env.ANTHROPIC_API_KEY) return fallbackReview(scrub);
    const minimal = minimize(norm);
    let result;
    try {
        result = await callClaude(env, {
            model: MODEL(env),
            system: SYSTEM_PROMPT,
            messages: [{ role: "user", content: "Review this de-identified claim and predict denials:\n\n" + JSON.stringify(minimal, null, 2) }],
            max_tokens: 1400,
            temperature: 0.1,
        });
    } catch (e) {
        const fb = fallbackReview(scrub);
        fb.note = `AI reviewer error (${e instanceof AnthropicError ? e.status : "network"}) — showing rule-based scrub projection.`;
        return fb;
    }
    const parsed = extractJson(result.text);
    if (!parsed || typeof parsed !== "object") {
        const fb = fallbackReview(scrub);
        fb.note = "AI reviewer returned unparseable output — showing rule-based scrub projection.";
        return fb;
    }
    // Normalize/guard the shape.
    const issues = Array.isArray(parsed.issues) ? parsed.issues.map((i) => ({
        severity: ["block", "warn", "info"].includes(i.severity) ? i.severity : "warn",
        category: String(i.category || "other"),
        finding: String(i.finding || "").slice(0, 600),
        fix: String(i.fix || "").slice(0, 600),
        likely_carc: String(i.likely_carc || ""),
    })) : [];
    const hasBlock = issues.some((i) => i.severity === "block");
    return {
        ai_used: true,
        model: MODEL(env),
        prompt_version: PREFLIGHT_PROMPT_VERSION,
        risk_level: ["low", "medium", "high"].includes(parsed.risk_level) ? parsed.risk_level : (hasBlock ? "high" : "low"),
        ready_to_submit: typeof parsed.ready_to_submit === "boolean" ? parsed.ready_to_submit : !hasBlock,
        confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.7,
        summary: String(parsed.summary || "").slice(0, 200),
        issues,
        usage: result.usage || {},
    };
}

export default { aiPreflightReview, PREFLIGHT_PROMPT_VERSION };
