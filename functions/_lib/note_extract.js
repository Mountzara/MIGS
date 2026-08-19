// =====================================================================
// note_extract.js — a first draft of the after-visit summary, from the note
// =====================================================================
// The transcription app pushes the clinical note but not always a
// patient-facing recap, so those encounters landed as "not drafted": no
// draft waiting for Dr. Mabini, nothing for the patient, and a manual
// click needed on every visit. Automatic AI drafting is not available on
// this deployment (no API key; the CLI bridge has not run in six days),
// so waiting for it would mean waiting indefinitely.
//
// This does the part that needs no model at all: it reads the note's own
// structure and lifts the Assessment and Plan into a draft, VERBATIM.
//
// WHAT THIS DELIBERATELY DOES NOT DO:
//   * It does not write clinical content. Every sentence is already in
//     his note; nothing is generated, softened, explained or inferred.
//     The standing rule — clinical content comes from his own words or
//     his curated library, never from a model's general knowledge — is
//     satisfied by construction here, because nothing is authored.
//   * It does not reach the patient. The draft is created as
//     `pending_clinician_review`; the patient read path filters on
//     `approved`. He rewrites it into patient language and approves, or
//     rejects it. The draft's job is to remove the blank page, not to
//     replace his judgement.
//   * It does not guess at structure. A note with no recognisable
//     Assessment or Plan produces NO draft rather than a mangled one.
// =====================================================================

const HEADS = [
    { key: "subjective", re: /^\s*(s|subjective)\s*[:\-]/i },
    { key: "objective",  re: /^\s*(o|objective)\s*[:\-]/i },
    { key: "assessment", re: /^\s*(a|assessment(?:\s*(?:and|&|\/)\s*plan)?)\s*[:\-]/i },
    { key: "plan",       re: /^\s*(p|plan)\s*[:\-]/i },
];

/**
 * Split a SOAP note into its sections. Handles both line-per-section and
 * run-on "S: ... O: ... A: ... P: ..." forms, which the app produces
 * interchangeably.
 */
export function parseSoap(noteText) {
    const text = String(noteText || "");
    if (!text.trim()) return {};
    const out = {};

    // Run-on form: split on the section letters wherever they appear.
    const inline = text.split(/(?=\b[SOAP]\s*:)/g).map((p) => p.trim()).filter(Boolean);
    if (inline.length > 1) {
        for (const chunk of inline) {
            const m = chunk.match(/^([SOAP])\s*:\s*([\s\S]*)$/i);
            if (!m) continue;
            const key = { s: "subjective", o: "objective", a: "assessment", p: "plan" }[m[1].toLowerCase()];
            if (key && !out[key]) out[key] = m[2].trim();
        }
        if (out.assessment || out.plan) return out;
    }

    // Line form.
    let current = null;
    for (const line of text.split(/\r?\n/)) {
        const head = HEADS.find((h) => h.re.test(line));
        if (head) {
            current = head.key;
            const rest = line.replace(/^\s*[a-z]+\s*[:\-]\s*/i, "").trim();
            out[current] = rest ? [rest] : [];
            continue;
        }
        if (current && line.trim()) (out[current] = out[current] || []).push(line.trim());
    }
    for (const k of Object.keys(out)) {
        if (Array.isArray(out[k])) out[k] = out[k].join(" ").trim();
    }
    return out;
}

/**
 * Build the draft. Returns null when the note has nothing usable — no
 * draft is better than a draft assembled from fragments.
 */
export function draftFromNote(noteText, { chiefComplaint, plan_summary, next_step_summary, medications } = {}) {
    const soap = parseSoap(noteText);
    const assessment = (soap.assessment || "").trim();
    const plan = (plan_summary || soap.plan || "").trim();
    if (!assessment && !plan) return null;

    const parts = [];
    parts.push("What we talked about");
    parts.push(chiefComplaint
        ? `You came in about ${chiefComplaint.trim().replace(/\.$/, "")}.${assessment ? ` ${assessment}` : ""}`
        : assessment);

    if (plan) {
        parts.push("");
        parts.push("The plan");
        parts.push(plan);
    }
    const meds = Array.isArray(medications) ? medications.filter(Boolean) : [];
    if (meds.length) {
        parts.push("");
        parts.push("Your medicines");
        parts.push(meds.join(", "));
    }
    if (next_step_summary) {
        parts.push("");
        parts.push("What happens next");
        parts.push(String(next_step_summary).trim());
    }
    return parts.join("\n").trim();
}

// Shown to HIM in the admin review screen — never inside the patient
// text, where a disclaimer about drafting would be noise to the reader.
export const DRAFT_NOTICE =
    "Drafted automatically from your note — the assessment and plan are your own words, lifted verbatim. " +
    "Rewrite it in patient language before approving; nothing here reaches the patient until you do.";

export default { parseSoap, draftFromNote, DRAFT_NOTICE };
