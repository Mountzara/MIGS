// correspondence_extract.js — turn a scanned payer letter into a routed action.
//
// Pipeline (2026-08-12):
//   OCR text (PHI)
//     -> prepareDocumentForAI()   indexed date tokens + Safe-Harbor scrub + VERIFY
//     -> Claude                   classify + extract  (sees NO identifiers, NO real dates)
//     -> resolveDateToken()       deadline resolved LOCALLY from the token map
//     -> routeDenial()            same Tier A/B/C router as electronic denials
//
// The letter's own words are what make the extracted deadline auditable:
// `deadline_basis` must be a verbatim quote from the (de-identified) text, so a
// human can see WHY the system thinks a response is due. An extraction with no
// quote is treated as unverified.
//
// FAIL-CLOSED: prepareDocumentForAI throws rather than returning dirty text, so
// there is no code path where un-scrubbed letter text reaches the model.

import { prepareDocumentForAI, resolveDateToken } from "./deidentify.js";
import { routeDenial } from "./denial_router.js";
import { callClaude, AnthropicError, extractJson } from "./anthropic.js";

export const CORRESPONDENCE_PROMPT_VERSION = "correspondence-extract-v1.0-2026-08-12";

const MODEL = (env) => (env && env.BILLING_AI_MODEL) || "claude-opus-4-8";

export const DOC_TYPES = [
    "denial", "adr_records_request", "appeal_determination",
    "overpayment_demand", "audit_notice", "credentialing", "eob_paper", "other",
];

const SYSTEM_PROMPT = `You classify and extract structured data from a scanned payer letter for a private OB/GYN practice.

The text has been de-identified: names, addresses, phone numbers, member IDs and MRNs appear as [NAME], [ADDRESS], [PHONE], [MEMBER_ID], [MRN]. Every DATE appears as an indexed token like [DATE_1], [DATE_2]. This is intentional — refer to dates ONLY by their token.

Output a SINGLE JSON object, no prose, no code fences:

{
  "doc_type": "denial" | "adr_records_request" | "appeal_determination" | "overpayment_demand" | "audit_notice" | "credentialing" | "eob_paper" | "other",
  "payer_name_guess": "<payer named in the letter, or ''>",
  "payer_claim_control": "<the payer's claim/ICN/DCN number if printed, else ''>",
  "carc_codes": ["<CARC codes the letter cites, if any>"],
  "requested_action": "<in one plain sentence, what the payer wants the practice to DO>",
  "amount_cents": <integer or null>,
  "response_due_date_token": "<the DATE_n token that is the RESPONSE DEADLINE, or '' if the letter states none>",
  "deadline_basis": "<VERBATIM sentence from the letter that establishes the deadline; '' if none>",
  "deadline_confidence": 0.0-1.0,
  "changes_clinical": true | false,
  "proposed_fixes": ["<zero or more of: dx_pointer_range, pos_mismatch_telehealth, missing_modifier_95, npi_taxonomy_field, duplicate_false_positive>"],
  "summary": "<=200 chars, what this letter is and why it matters"
}

RULES:
- response_due_date_token MUST be one of the [DATE_n] tokens present in the text, written without brackets (e.g. "DATE_3"). Never invent a date. If the letter gives a duration ("within 30 days of the date of this letter") rather than an explicit due date, set the token to the LETTER DATE and put the duration sentence in deadline_basis.
- deadline_basis must be copied verbatim from the text. Do not paraphrase. An empty basis means you did not find one.
- changes_clinical = true whenever responding requires medical-necessity argument, records, or a level change.
- proposed_fixes may ONLY contain the listed clerical keys, and only when the letter makes the defect explicit.
- Output JSON ONLY.`;

/**
 * @returns {{ok, extraction, routing, deid_findings, ai_used, model, prompt_version, error?}}
 */
export async function extractCorrespondence(env, { ocrText, knownNames = [], payerKind = "commercial", deadlineRow = null }) {
    // 1. PHI gate — throws if anything high-risk survives.
    let prepared;
    try {
        prepared = prepareDocumentForAI(ocrText, { knownNames });
    } catch (e) {
        return { ok: false, error: String(e.message || e), stage: "deidentify", ai_used: false };
    }

    if (!env || !env.ANTHROPIC_API_KEY) {
        return {
            ok: false, stage: "no_ai",
            error: "No AI configured — letter stored and queued for manual review.",
            deid_findings: prepared.findings, ai_used: false,
        };
    }

    // 2. Extract from de-identified, date-tokenized text.
    let parsed;
    try {
        const res = await callClaude(env, {
            model: MODEL(env),
            system: SYSTEM_PROMPT,
            messages: [{ role: "user", content: "Classify and extract this payer letter:\n\n" + prepared.text.slice(0, 24000) }],
            max_tokens: 1400,
            temperature: 0.1,
        });
        parsed = extractJson(res.text);
    } catch (e) {
        return {
            ok: false, stage: "ai_call",
            error: `AI extraction failed (${e instanceof AnthropicError ? e.status : "network"}) — queued for manual review.`,
            deid_findings: prepared.findings, ai_used: false,
        };
    }
    if (!parsed || typeof parsed !== "object") {
        return { ok: false, stage: "parse", error: "Unparseable extraction — queued for manual review.", ai_used: true };
    }

    // 3. Resolve the deadline LOCALLY from the token map.
    const token = String(parsed.response_due_date_token || "").trim();
    const resolved = token ? resolveDateToken(token, prepared.dateMap) : null;
    const basis = String(parsed.deadline_basis || "").trim();

    // An unquoted deadline is not a deadline we trust.
    const deadlineTrusted = Boolean(resolved && basis);

    const docType = DOC_TYPES.includes(parsed.doc_type) ? parsed.doc_type : "other";
    const carc = Array.isArray(parsed.carc_codes) ? parsed.carc_codes.map(String).filter(Boolean) : [];
    const fixes = Array.isArray(parsed.proposed_fixes) ? parsed.proposed_fixes.map(String) : [];

    // 4. Route with the SAME tiered-autonomy logic as electronic denials.
    // A letter whose deadline we could not verify is deliberately handed the
    // "unverified" deadline shape so the router escalates rather than acting.
    const routing = routeDenial({
        carcCodes: carc,
        payerKind,
        proposedFixes: fixes,
        changesClinical: parsed.changes_clinical !== false || docType !== "denial",
        deadline: deadlineTrusted
            ? { due: resolved, reason: "ok", source: "letter" }
            : { due: null, reason: "unverified" },
    });

    return {
        ok: true,
        ai_used: true,
        model: MODEL(env),
        prompt_version: CORRESPONDENCE_PROMPT_VERSION,
        deid_findings: prepared.findings,
        extraction: {
            doc_type: docType,
            payer_name_guess: String(parsed.payer_name_guess || ""),
            payer_claim_control: String(parsed.payer_claim_control || ""),
            carc_codes: carc,
            requested_action: String(parsed.requested_action || "").slice(0, 400),
            amount_cents: Number.isFinite(parsed.amount_cents) ? Math.round(parsed.amount_cents) : null,
            response_due_date: deadlineTrusted ? normalizeDate(resolved) : null,
            deadline_basis: basis.slice(0, 400),
            deadline_confidence: deadlineTrusted ? clamp01(parsed.deadline_confidence) : 0,
            deadline_unverified_reason: deadlineTrusted ? null : (!resolved ? "no_date_token" : "no_verbatim_basis"),
            changes_clinical: parsed.changes_clinical !== false,
            proposed_fixes: fixes,
            summary: String(parsed.summary || "").slice(0, 200),
        },
        routing,
    };
}

function clamp01(v) { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5; }

/** Best-effort normalization of a letter date to YYYY-MM-DD; returns raw on failure. */
function normalizeDate(raw) {
    const s = String(raw).trim();
    let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2}|\d{4})$/);
    if (m) {
        const yy = m[3].length === 2 ? `20${m[3]}` : m[3];
        return `${yy}-${String(m[1]).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const t = Date.parse(s);
    if (Number.isFinite(t)) return new Date(t).toISOString().slice(0, 10);
    return s;
}

export default { extractCorrespondence, CORRESPONDENCE_PROMPT_VERSION, DOC_TYPES };
