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

// Words a patient would have to look up. The draft lifts his clinical
// language verbatim — which is correct for a DRAFT and wrong for the
// thing she reads — so approving one unedited quietly hands her the
// note. This does not block: it is his call, and some drafts are already
// plain. It just makes the choice visible at the moment he makes it.
const JARGON = [
    ["leiomyoma", "fibroid"], ["menorrhagia", "heavy periods"], ["metrorrhagia", "bleeding between periods"],
    ["dysmenorrhea", "painful periods"], ["dyspareunia", "pain with sex"], ["adenomyosis", "adenomyosis (explain it)"],
    ["endometrioma", "ovarian cyst from endometriosis"], ["adnexal", "near the ovary or tube"],
    ["hysterosalpingogram", "dye test of the tubes"], ["laparoscopy", "keyhole surgery"],
    ["myomectomy", "surgery to remove a fibroid"], ["hysterectomy", "surgery to remove the uterus"],
    ["oophorectomy", "surgery to remove an ovary"], ["salpingectomy", "surgery to remove a tube"],
    ["endometrial", "lining of the womb"], ["anovulatory", "cycles without ovulation"],
    ["euvolemic", "normal fluid balance"], ["afebrile", "no fever"], ["gravida", "pregnancies"],
    ["para ", "births"], ["NSAID", "anti-inflammatory painkiller"], ["LNG-IUS", "hormonal IUD"],
    ["TXA", "tranexamic acid"], ["ferritin", "iron stores blood test"],
    ["CBC", "full blood count"], ["CMP", "routine chemistry panel"],
    ["etiology", "cause"], ["idiopathic", "no known cause"], ["prn", "as needed"],
    ["bid", "twice a day"], ["tid", "three times a day"], ["qhs", "at bedtime"],
];

/**
 * Terms in a patient-facing draft that a patient would not know.
 * Returns [{ term, plain }] — never throws, never rewrites.
 */
export function flagJargon(text) {
    const t = String(text || "");
    const hits = [];
    for (const [term, plain] of JARGON) {
        const re = new RegExp(`\\b${term.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
        if (re.test(t)) hits.push({ term: term.trim(), plain });
    }
    return hits;
}

// Shown to HIM in the admin review screen — never inside the patient
// text, where a disclaimer about drafting would be noise to the reader.
export const DRAFT_NOTICE =
    "Drafted automatically from your note — the assessment and plan are your own words, lifted verbatim. " +
    "Rewrite it in patient language before approving; nothing here reaches the patient until you do.";

export default { parseSoap, draftFromNote, flagJargon, DRAFT_NOTICE };
