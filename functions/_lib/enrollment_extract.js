// =====================================================================
// enrollment_extract.js — read a practice document, propose profile fields
// =====================================================================
// The physician already HAS these numbers. They are on a W-9, a CMS-855
// approval, a Medicare PTAN letter, a state Medicaid welcome packet. What
// he does not have is the patience to transcribe them into a dozen boxes
// without a typo. So: upload the document, get proposed values.
//
// WHY THIS IS NOT correspondence_extract.js
// That module handles PAYER LETTERS ABOUT PATIENTS, so it runs the text
// through prepareDocumentForAI() and fails closed rather than let an
// identifier reach the model. Here the identifiers ARE the payload — a
// W-9's whole purpose is to carry a legal name and a TIN. De-identifying
// this input would strip exactly what we are trying to read. Two documents
// with opposite requirements need two pipelines; sharing one would either
// leak PHI or return nothing useful.
//
// The trade is handled differently instead:
//   * ADMISSION IS GATED DETERMINISTICALLY, not by asking the model
//     nicely. `looksLikePatientDocument()` runs _lib/deidentify.js — the
//     same Safe-Harbor scrubber correspondence_extract.js uses, itself the
//     JS mirror of the Mac app's DeidentificationService — over the text
//     and REFUSES upload when it finds patient-only markers (MRN, member
//     or subscriber ID) or clinical vocabulary. A W-9's ZIP, phone and
//     TIN are expected here and are not disqualifying; an MRN is. The
//     refusal happens BEFORE the model sees a byte, so a misrouted patient
//     document cannot reach an AI processor through this door.
//   * The file is stored envelope-encrypted (R2 + _lib/phi.js) because a
//     W-9 carries an EIN or, for a sole proprietor, an SSN.
//   * Nothing is auto-committed. Every extracted value is a PROPOSAL shown
//     beside what is already entered, with the verbatim quote it came
//     from, and the physician accepts field by field.
//
// EVIDENCE OR IT DID NOT HAPPEN. Every proposed field must carry `quote`,
// a verbatim span from the document. A value with no quote is dropped
// rather than shown — the same doctrine correspondence_extract.js applies
// to deadlines, for the same reason: a number you cannot trace is worse
// than a blank box, because a blank box gets checked.
// =====================================================================

import { routeFor, enqueueAiJob } from "./ai_router.js";
import { scrubForAI } from "./deidentify.js";
import { npiValid, zip9Valid, tinValid, taxonomyValid } from "./clearinghouse_onboarding.js";

export const ENROLLMENT_PROMPT_VERSION = "enrollment-extract-v1.0-2026-08-13";

/**
 * Documents worth uploading here. Deliberately excludes anything clinical
 * — this pipeline does not de-identify, so a patient document must never
 * be routed into it.
 */
export const DOC_TYPES = [
    { key: "w9", label: "W-9",
      yields: ["legal_name", "entity_type", "tin", "practice address"] },
    { key: "nppes", label: "NPPES confirmation / NPI notification",
      yields: ["legal_name", "npi_individual", "npi_group", "taxonomy_code"] },
    { key: "cms855", label: "CMS-855 approval letter",
      yields: ["legal_name", "npi_individual", "medicare_ptan", "practice address"] },
    { key: "ptan", label: "Medicare PTAN / MAC letter",
      yields: ["medicare_ptan", "legal_name"] },
    { key: "medicaid", label: "State Medicaid welcome / approval letter",
      yields: ["medicaid_id", "legal_name"] },
    { key: "license", label: "State medical license",
      yields: ["license_number", "license_state"] },
    { key: "clearinghouse_welcome", label: "Clearinghouse welcome letter",
      yields: ["account identifiers", "submitter ID"] },
    { key: "edi_approval", label: "Payer EDI enrollment approval",
      yields: ["payer name", "approval date", "reference number"] },
    { key: "other", label: "Something else", yields: [] },
];

/** Fields this extractor is permitted to propose. Nothing else is accepted
 *  from the model, so a hallucinated key cannot reach the profile. */
export const EXTRACTABLE_FIELDS = new Set([
    "legal_name", "dba_name", "entity_type", "tin",
    "npi_individual", "npi_group", "taxonomy_code",
    "license_state", "license_number", "medicare_ptan", "medicaid_id", "caqh_id",
    "practice_street", "practice_street2", "practice_city", "practice_state", "practice_zip",
    "payto_street", "payto_street2", "payto_city", "payto_state", "payto_zip",
    "contact_name", "contact_title", "contact_phone", "contact_fax", "contact_email",
]);

/**
 * Deterministic admission gate. Runs the Safe-Harbor scrubber purely as a
 * DETECTOR — we keep the original text, we only read what it found.
 *
 * The distinction that matters: a practice document legitimately contains
 * an address, a phone number and a tax ID, so those findings prove
 * nothing. What only ever appears on a PATIENT document is a medical
 * record number, a subscriber/member ID, or clinical narrative. Those are
 * disqualifying, and the refusal is a hard stop rather than a warning.
 *
 * @returns {{patient: boolean, reasons: string[]}}
 */
export function looksLikePatientDocument(text) {
    const t = String(text || "");
    const reasons = [];

    const { findings } = scrubForAI(t);
    const found = new Set(findings.map((f) => f.key));
    if (found.has("mrn")) reasons.push("a medical record number");
    if (found.has("member_id")) reasons.push("a health-plan member or subscriber ID");

    // Clinical vocabulary. Kept deliberately narrow — these words do not
    // appear on a W-9, a PTAN letter or a clearinghouse welcome packet.
    const CLINICAL = [
        /\bdate\s+of\s+(birth|service)\b/i,
        /\b(DOB|D\.O\.B\.)\b/,
        /\bpatient\s+(name|account|id|number)\b/i,
        /\b(diagnosis|chief\s+complaint|operative\s+report|history\s+of\s+present\s+illness)\b/i,
        /\bICD-?10\b/i,
        /\bexplanation\s+of\s+benefits\b/i,
        /\bclaim\s+number\b/i,
    ];
    for (const re of CLINICAL) {
        if (re.test(t)) { reasons.push("clinical or claim-level language"); break; }
    }

    return { patient: reasons.length > 0, reasons };
}

export function buildPrompt(docType, text) {
    const t = DOC_TYPES.find((d) => d.key === docType);
    return `You are reading an administrative document belonging to a solo medical practice, to help its physician fill in a clearinghouse enrollment form without retyping numbers by hand.

DOCUMENT TYPE THE UPLOADER SELECTED: ${t ? t.label : docType}

Extract ONLY these fields, and ONLY when the document states them plainly:
  legal_name        the legal business or person name as written
  dba_name          a "doing business as" / trade name, if distinct
  entity_type       one of: sole_proprietor | llc | pc | corp
  tin               EIN or SSN, digits only
  npi_individual    a 10-digit Type 1 NPI
  npi_group         a 10-digit Type 2 NPI
  taxonomy_code     a 10-character NUCC taxonomy code
  license_state     two-letter state
  license_number    state medical licence number
  medicare_ptan     Medicare PTAN / provider transaction access number
  medicaid_id       state Medicaid provider ID
  caqh_id           CAQH ProView ID
  practice_street, practice_street2, practice_city, practice_state, practice_zip
  payto_street, payto_street2, payto_city, payto_state, payto_zip
  contact_name, contact_title, contact_phone, contact_fax, contact_email

RULES, in order of importance:

1. EVERY field you return MUST include "quote" — a VERBATIM span copied
   from the document showing where the value came from. If you cannot
   quote it, do not return the field. Never paraphrase a quote.
2. Never infer, complete or correct a value. If a ZIP appears as five
   digits, return five digits. If a name is abbreviated, return the
   abbreviation. The physician will correct it; you will not guess.
3. If the document does not contain a field, omit it entirely. An empty
   string is not an answer.
4. "confidence" is one of high | medium | low. Use low whenever the label
   is ambiguous, the text is OCR-garbled, or more than one candidate value
   appears.
5. If the document appears to concern a PATIENT rather than the practice
   itself, return {"not_practice_document": true} and nothing else.

Return ONLY JSON in this shape:
{
  "doc_type_detected": "w9",
  "fields": {
    "legal_name": {"value": "...", "quote": "...", "confidence": "high"}
  },
  "notes": ["anything the physician should check by hand"]
}

DOCUMENT TEXT:
${text}`;
}

/** Shape/format checks on whatever the model proposed. */
export function validateExtraction(fields = {}) {
    const accepted = {};
    const rejected = [];

    for (const [key, item] of Object.entries(fields)) {
        if (!EXTRACTABLE_FIELDS.has(key)) {
            rejected.push({ key, why: "not a field this extractor may propose" });
            continue;
        }
        const value = String(item?.value ?? "").trim();
        const quote = String(item?.quote ?? "").trim();
        if (!value) { rejected.push({ key, why: "empty value" }); continue; }
        if (!quote) {
            // The core doctrine: no evidence, no proposal.
            rejected.push({ key, why: "no verbatim quote — a value that cannot be traced is dropped" });
            continue;
        }

        let why = null;
        if ((key === "npi_individual" || key === "npi_group") && !npiValid(value)) {
            why = "fails the NPI check digit — likely an OCR misread";
        }
        if (key === "tin" && !tinValid(value)) why = "not nine digits";
        if (key === "taxonomy_code" && !taxonomyValid(value)) why = "not a 10-character taxonomy code";
        if (key === "entity_type" && !["sole_proprietor", "llc", "pc", "corp"].includes(value)) {
            why = "not one of the four entity types";
        }
        if (why) { rejected.push({ key, value, why }); continue; }

        const warn = (key === "practice_zip" || key === "payto_zip") && !zip9Valid(value)
            ? "only five digits — Medicare needs ZIP+4, so complete this by hand"
            : null;

        accepted[key] = {
            value, quote,
            confidence: ["high", "medium", "low"].includes(item?.confidence) ? item.confidence : "low",
            warn,
        };
    }

    return { accepted, rejected };
}

function parseModelJson(raw) {
    if (!raw) return null;
    const s = String(raw);
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

/**
 * Run the extraction.
 *
 * Routes through ai_router, so it obeys the owner's rule that the API key
 * is for billing only: with no key configured this ENQUEUES a bridge job
 * and returns {queued:true} rather than failing. The wizard then shows
 * "waiting for your Claude CLI" instead of a dead button — the same
 * fail-visible posture the notification outbox uses.
 */
export async function extractEnrollmentDocument(env, { text, docType = "other", documentId = null }) {
    const clean = String(text || "").trim();
    if (!clean) return { ok: false, error: "no text to read — the document produced no extractable text" };
    if (clean.length > 60000) {
        return { ok: false, error: "document is too long; upload the pages that carry the identifiers" };
    }

    // Fail closed BEFORE the model sees anything. This pipeline does not
    // de-identify, so a patient document must never enter it.
    const gate = looksLikePatientDocument(clean);
    if (gate.patient) {
        return {
            ok: false,
            not_practice_document: true,
            error: `This looks like a patient document — it contains ${gate.reasons.join(" and ")}. `
                 + "This uploader is for your practice's own paperwork and deliberately does NOT de-identify, "
                 + "because a W-9's whole purpose is to carry the identifiers we are reading. "
                 + "Nothing was sent to any AI processor. Route patient correspondence through the "
                 + "correspondence pipeline, which Safe-Harbor scrubs before the model sees it.",
            reasons: gate.reasons,
        };
    }

    const prompt = buildPrompt(docType, clean);
    const route = routeFor(env, "enrollment_extract");

    if (route === "bridge") {
        const job = await enqueueAiJob(env, {
            kind: "enrollment_extract",
            payload: { document_id: documentId, doc_type: docType },
        });
        return {
            ok: true, queued: true, job_id: job.id, route,
            message: "Queued for your Claude CLI bridge. It will appear here once the bridge picks it up; nothing is lost if the bridge is offline.",
        };
    }

    if (route === "blocked") {
        return { ok: false, error: "No AI route is configured for document extraction." };
    }

    let raw;
    try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-api-key": env.ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
                model: env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
                max_tokens: 2000,
                messages: [{ role: "user", content: prompt }],
            }),
        });
        if (!res.ok) {
            const body = (await res.text().catch(() => "")).slice(0, 200);
            return { ok: false, error: `model call failed (HTTP ${res.status}) ${body}` };
        }
        const j = await res.json();
        raw = (j.content || []).map((c) => c.text || "").join("");
    } catch (e) {
        return { ok: false, error: `model call failed: ${String(e).slice(0, 200)}` };
    }

    const parsed = parseModelJson(raw);
    if (!parsed) return { ok: false, error: "the model did not return usable JSON" };

    if (parsed.not_practice_document) {
        return {
            ok: false,
            not_practice_document: true,
            error: "That looks like a patient document. This uploader is for the practice's own paperwork and does not de-identify — upload patient correspondence through the correspondence pipeline instead.",
        };
    }

    const { accepted, rejected } = validateExtraction(parsed.fields || {});
    return {
        ok: true,
        route,
        doc_type_detected: parsed.doc_type_detected || docType,
        fields: accepted,
        rejected,
        notes: Array.isArray(parsed.notes) ? parsed.notes.slice(0, 8) : [],
        prompt_version: ENROLLMENT_PROMPT_VERSION,
    };
}

export default {
    DOC_TYPES, EXTRACTABLE_FIELDS, ENROLLMENT_PROMPT_VERSION,
    buildPrompt, validateExtraction, extractEnrollmentDocument,
    looksLikePatientDocument,
};
