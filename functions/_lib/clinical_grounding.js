// =====================================================================
// clinical_grounding.js — clinical claims come from HIS KB, or they do not ship
// =====================================================================
// THE RULE, in the owner's words: "your answers from a clinical standpoint
// should NEVER come from your own general knowledge or internet — it
// should only be derived from my trusted KB."
//
// ---------------------------------------------------------------------
// WHAT WAS ACTUALLY HAPPENING (2026-08-13 audit)
// ---------------------------------------------------------------------
// The KB is real and loaded: 1,144 documents in the `kb_docs` FTS5 index
// (ACOG practice bulletins and committee opinions, UpToDate, JMIG, SMFM,
// primary literature), with a working retrieval seam in `_lib/kb.js`.
// It was wired into ONE endpoint — `admin/ai/suggest-edit.js`, which
// proposes clearer TITLES AND SUMMARIES FOR WEBSITE COPY.
//
// Every clinical path called the model with no KB at all:
//   intake_triage.js        categorises the visit, flags perioperative risk
//   visit_summary.js        the after-visit summary THE PATIENT READS
//   messages/…/draft.js     the clinical reply to a patient's question
//   visit_prep.js           what a member takes to their own OB/GYN
//   prom_recommender.js     which validated instruments to administer
//
// So the clinical content on this site came from a language model's
// general knowledge — the exact thing the KB exists to prevent.
//
// ---------------------------------------------------------------------
// THE GATE I TRIED FIRST, AND WHY IT DOES NOT WORK
// ---------------------------------------------------------------------
// The obvious design is a pre-flight topical gate: retrieve, score how
// much of the question the KB covers, and refuse below a threshold.
// I built it and calibrated it against the live index
// (scripts/calibrate_kb_grounding.mjs). It does not separate:
//
//   IN-SCOPE  (16 CBG/MIGS questions)   mean coverage 98%, min 86%
//   OUT-SCOPE (6 non-gynaecology)       mean coverage 98%, max 100%
//
// "diabetic ketoacidosis insulin infusion protocol" scored 100% — because
// an OR-of-terms FTS query over 1,144 documents returns something for any
// medical phrasing, and across eight documents nearly every term appears
// somewhere. Best-single-document coverage was no better (in-scope min
// 75%, out-of-scope max 80%), and an AND over the rarest terms was worse
// still: it returned ZERO for legitimate vNOTES and GLP-1 questions while
// returning hits for asthma.
//
// The reason is not a tuning failure. This is a GENERAL OB/GYN corpus, and
// real obstetric literature discusses asthma (9 docs), insulin (29) and
// corticosteroids (24) because real patients have comorbidities. There is
// no clean topical boundary in the index to gate on, so any threshold
// either refuses legitimate subspecialty questions or admits everything.
//
// ---------------------------------------------------------------------
// WHAT IS ACTUALLY ENFORCEABLE
// ---------------------------------------------------------------------
// The property the owner asked for is not "refuse off-topic questions".
// It is that every clinical claim be DERIVED FROM the KB. That is
// checkable after the fact, and checking it is the enforcement:
//
//   1. The model is given the retrieved excerpts and nothing else, with an
//      explicit instruction that they are the only clinical authority.
//   2. Every clinical claim must carry a [KB:doc_id] citation.
//   3. AFTER generation, the output is verified:
//        * every cited id must be one actually supplied — a fabricated
//          citation manufactures the appearance of provenance and is worse
//          than none, so it fails the whole output;
//        * every cited claim must be SUPPORTED by the document it cites,
//          checked by term overlap against that document's real text —
//          this catches citing a real id that says something else;
//        * clinical assertions carrying NO citation fail the output, at a
//          threshold set per task.
//   4. A failed verification does not reach the patient. It goes back to
//      him with the offending sentences named.
//
// This inverts the burden correctly. If the KB does not cover a question,
// the model has nothing to cite, and its options are to say so (which the
// prompt demands and which is the right answer) or to write uncited
// clinical claims — which step 3 catches and rejects. Coverage is still
// computed and surfaced as a WARNING, because it is informative to him
// even though it is useless as a gate.
//
// PHI: the KB is reference knowledge, never patient data, so KB context is
// safe to send anywhere a prompt already goes — including the local CLI
// bridge, which is de-identified but not BAA-covered.
// =====================================================================

import { toFtsQuery } from "./kb.js";
import { fieldsForTask, fieldLabel, hasSectionIndex } from "./kb_fields.js";

/** Terms too generic to say anything about topical fit. */
const GENERIC = new Set([
    "patient", "patients", "clinical", "clinically", "history", "symptom", "symptoms",
    "treatment", "treatments", "management", "care", "risk", "risks", "dose", "doses",
    "therapy", "condition", "disease", "medical", "health", "provider", "doctor",
    "visit", "note", "notes", "plan", "review", "follow", "time", "day", "days",
    "week", "weeks", "month", "months", "year", "years", "level", "levels",
    "result", "results", "test", "tests", "normal", "abnormal", "may", "can",
    "should", "would", "could", "also", "used", "using", "use", "with", "have",
    "your", "you", "this", "that", "these", "those", "from", "about", "after",
    "before", "during", "into", "than", "then", "them", "there", "here", "what",
    "when", "which", "while", "will", "been", "being", "does", "done", "each",
    "more", "most", "other", "some", "such", "very", "were", "over", "under",
]);

export function significantTerms(text, max = 24) {
    const seen = new Set();
    const out = [];
    for (const raw of String(text || "").toLowerCase().split(/[^a-z0-9]+/)) {
        if (raw.length < 4 || GENERIC.has(raw) || seen.has(raw)) continue;
        seen.add(raw);
        out.push(raw);
        if (out.length >= max) break;
    }
    return out;
}

/** Stemming-tolerant term overlap. "fibroids" is matched by "fibroid". */
export function coverageOf(terms, corpusText) {
    if (!terms.length) return { covered: [], missing: [], coverage: 0 };
    const hay = String(corpusText || "").toLowerCase();
    const covered = [], missing = [];
    for (const t of terms) {
        const stem = t.length > 5 ? t.slice(0, t.length - 1) : t;
        if (hay.includes(t) || hay.includes(stem)) covered.push(t);
        else missing.push(t);
    }
    return { covered, missing, coverage: covered.length / terms.length };
}

/**
 * Per-task verification policy. These govern what happens AFTER generation,
 * which is where enforcement actually lives.
 *
 * `max_uncited`      clinical assertions with no citation that will be
 *                    tolerated. Zero for anything a patient reads.
 * `min_support`      fraction of a cited sentence's significant terms that
 *                    must appear in the document it cites, for the citation
 *                    to count as supported rather than decorative.
 * `min_docs`         retrieval floor. Below this we do not call the model at
 *                    all — this is the ONE pre-flight check that is reliable,
 *                    because "the KB returned nothing" is unambiguous.
 * `block_on_failure` true means a failed verification is never shown to a
 *                    patient; it goes to him instead.
 */
export const GROUNDING_POLICY = {
    visit_summary:    { max_uncited: 0, min_support: 0.3, min_docs: 2, block_on_failure: true,
                        why: "the patient reads this as the record of their own visit" },
    message_draft:    { max_uncited: 0, min_support: 0.3, min_docs: 2, block_on_failure: true,
                        why: "this becomes clinical advice in the patient's inbox" },
    visit_prep:       { max_uncited: 0, min_support: 0.3, min_docs: 2, block_on_failure: true,
                        why: "the member hands this to their own OB/GYN with his name on it" },
    intake_triage:    { max_uncited: 2, min_support: 0.25, min_docs: 1, block_on_failure: false,
                        why: "triage routes a booking; he reviews every row before release" },
    prom_recommender: { max_uncited: 3, min_support: 0.2, min_docs: 1, block_on_failure: false,
                        why: "selection is constrained to a fixed instrument catalogue" },
};

export function policyFor(kind) {
    return GROUNDING_POLICY[kind] || {
        max_uncited: 0, min_support: 0.3, min_docs: 2, block_on_failure: true,
        why: "unknown clinical task — treated as patient-facing",
    };
}

/**
 * Retrieve KB support for a clinical question.
 *
 * The ONLY pre-flight refusal is "the KB returned fewer than min_docs
 * documents", because that is the one condition that can be judged
 * reliably. Topical fit is reported (`coverage`, `missing_terms`) for his
 * information and is deliberately NOT a gate — see the header.
 *
 * The full text of each document is retained on the returned chunks so
 * verifyGrounding() can check a citation against what the document
 * actually says, rather than against the fact that it exists.
 */
export async function groundClinical(env, { kind, query, topK = 8, maxChars = 6000 } = {}) {
    const policy = policyFor(kind);
    const terms = significantTerms(query);
    const base = { kind, policy, grounded: false, chunks: [], context: "",
                   citations: [], allowed_doc_ids: [], coverage: 0, missing_terms: terms };

    if (!env?.DB) return { ...base, reason: "no_database" };
    const match = toFtsQuery(query);
    if (!match) return { ...base, reason: "question_had_no_searchable_terms" };

    // ------------------------------------------------------------------
    // FIELD-AWARE RETRIEVAL — the app's own structure, used properly.
    // ------------------------------------------------------------------
    // The KB chunks are structured records: counseling points written FOR
    // PATIENTS, critical thresholds, decision points, a management
    // algorithm. Different fields answer different questions. When
    // kb_sections is loaded we retrieve from the fields that answer THIS
    // task, in priority order (see _lib/kb_fields.js).
    //
    // Without it we fall back to the flattened kb_docs index, which works
    // but cannot tell counseling language apart from a device-safety
    // paper — the first live run of this grounded a draft reply to a
    // patient in a JMIG article about robotic device malfunctions.
    let hits = [];
    let retrieval = "flat";
    const wantFields = fieldsForTask(kind);
    try {
        if (await hasSectionIndex(env)) {
            retrieval = "field_aware";
            const placeholders = wantFields.map(() => "?").join(",");
            const res = await env.DB.prepare(
                `SELECT doc_id, field, source, title, text
                   FROM kb_sections
                  WHERE kb_sections MATCH ?
                    AND field IN (${placeholders})
                  ORDER BY rank
                  LIMIT ?`
            ).bind(match, ...wantFields, topK * 3).all();

            // Rank by the task's field priority first, FTS rank second, so
            // counseling points beat an abstract that merely shares
            // vocabulary. One section per document — the best-matching
            // field — so eight results are eight sources, not one document
            // quoted eight ways.
            const order = new Map(wantFields.map((f, i) => [f, i]));
            const seen = new Set();
            hits = (res?.results || [])
                .map((r, i) => ({ ...r, _prio: order.get(r.field) ?? 99, _rank: i }))
                .sort((a, b) => a._prio - b._prio || a._rank - b._rank)
                .filter((r) => !seen.has(r.doc_id) && seen.add(r.doc_id))
                .slice(0, topK);
        }
        if (!hits.length) {
            retrieval = retrieval === "field_aware" ? "field_aware_empty_fell_back" : "flat";
            const res = await env.DB.prepare(
                `SELECT doc_id, source, title, text
                   FROM kb_docs WHERE kb_docs MATCH ? ORDER BY rank LIMIT ?`
            ).bind(match, topK).all();
            hits = res?.results || [];
        }
    } catch (e) {
        // A retrieval failure must never silently become an ungrounded answer.
        console.error("clinical_grounding: KB search failed", String(e?.message || e));
        return { ...base, reason: "kb_search_failed" };
    }

    if (hits.length < policy.min_docs) {
        return { ...base, reason: "kb_returned_nothing", found_docs: hits.length };
    }

    const corpus = hits.map((h) => `${h.title || ""} ${h.text || ""}`).join(" ");
    const cov = coverageOf(terms, corpus);

    const used = [];
    let budget = maxChars;
    const perDoc = Math.max(400, Math.floor(maxChars / Math.max(1, hits.length)));
    for (const h of hits) {
        const body = String(h.text || "").slice(0, perDoc);
        // Naming the FIELD tells the model what kind of material this is.
        // "what to say to a patient" and "the numbers that change
        // management" are written differently and should be used
        // differently, and that is invisible if every excerpt looks alike.
        const which = h.field ? ` · ${fieldLabel(h.field)}` : "";
        const block = `[KB:${h.doc_id}] ${h.source || "KB"}${which} — ${h.title || "(untitled)"}\n${body}\n`;
        if (block.length > budget) break;
        budget -= block.length;
        used.push({
            doc_id: String(h.doc_id), source: h.source || "KB", title: h.title || "(untitled)",
            field: h.field || null,
            field_label: h.field ? fieldLabel(h.field) : null,
            text: String(h.text || ""),   // full text, for citation support checking
            block,
        });
    }
    if (used.length < policy.min_docs) {
        return { ...base, reason: "kb_context_did_not_fit_budget", found_docs: hits.length };
    }

    return {
        grounded: true,
        reason: "ok",
        kind,
        policy,
        chunks: used.map(({ block, text, ...r }) => r),
        citations: used.map(({ block, text, ...r }) => r),
        docs: used.map(({ block, ...r }) => r),      // carries text, for verification
        allowed_doc_ids: used.map((u) => u.doc_id),
        context: used.map((u) => u.block).join("\n---\n"),
        coverage: cov.coverage,
        covered_terms: cov.covered,
        missing_terms: cov.missing,
        // "field_aware" means kb_sections is loaded and the retrieval used
        // the parts of each document that answer THIS task. "flat" means it
        // fell back to the concatenated index and cannot tell counseling
        // language from a device-safety paper — run scripts/kb_load_d1.py.
        retrieval,
        fields_searched: retrieval.startsWith("field_aware") ? wantFields : null,
        // Surfaced to him, never used as a gate. See the header for the
        // calibration showing coverage cannot separate in- from out-of-scope.
        coverage_is_advisory: true,
    };
}

/**
 * The instruction block. Deliberately blunt, and it names the failure mode
 * rather than gesturing at it — a model that has an answer in training
 * needs an explicit reason not to use it, and "you will be checked" is a
 * more effective reason than "please don't".
 */
export function groundingInstruction(kb) {
    return `CLINICAL SOURCE RULE — THIS OVERRIDES EVERYTHING ELSE IN THIS PROMPT.

Every clinical statement you make must come from the REFERENCE EXCERPTS below and from nothing else. Not from your training data, not from anything you believe you know about medicine, not from any other source. This practice's reference library is the only clinical authority here; it was curated deliberately, and it is what the physician stands behind.

Rules:
  * After every clinical claim, cite the excerpt it came from as [KB:<doc_id>], using the ids exactly as printed below.
  * Never cite an id that is not listed below, and never invent one. Your output is checked against the supplied ids after you write it, and a citation that does not match discards the entire response.
  * The claim must actually be supported by the document you cite. Citing a real id that says something else is checked for too.
  * If the excerpts do not support something you were asked about, WRITE PLAINLY THAT YOU CANNOT ADDRESS IT FROM THE PRACTICE'S REFERENCES, and stop there. Do not fill the gap from general knowledge. An honest gap is useful to the physician; a confident answer from the wrong source is a liability.
  * Non-clinical language needs no citation — logistics, scheduling, tone, or restating in plain English something already established in the material you were given. Only clinical assertions need one.
  * If two excerpts disagree, say so and cite both rather than picking one.

REFERENCE EXCERPTS (${kb.citations.length} document${kb.citations.length === 1 ? "" : "s"} from the practice library):

${kb.context}

END OF REFERENCE EXCERPTS. The only citation ids you may use: ${kb.allowed_doc_ids.map((d) => `[KB:${d}]`).join(" ")}`;
}

// ---------------------------------------------------------------------
// Deciding what counts as a clinical assertion
// ---------------------------------------------------------------------
// This has to be right in BOTH directions. Miss a real claim and
// ungrounded medicine ships. Fire on "Your surgery is scheduled for the
// 14th" and the gate blocks ordinary correspondence, at which point
// somebody turns it off — which is the more likely failure in practice.
//
// So three exclusions run BEFORE the clinical test:
//   1. An honest refusal. "I cannot address that from the practice's
//      references" contains the word "medication" and would otherwise be
//      flagged as an uncited clinical claim — punishing the model for
//      doing precisely what it was told to do, which would train it back
//      toward answering from general knowledge.
//   2. Scheduling and logistics. These borrow clinical nouns ("your
//      surgery", "your medication list") without asserting anything.
//   3. Greetings and section headings.
// A sentence excluded by 1-3 is still re-admitted if it carries a STRONG
// clinical marker — a dose, a percentage, "indicated", "contraindicated",
// "evidence" — because those do not appear in ordinary logistics.

const REFUSAL = /\b(?:cannot|can't|could not|couldn't|unable to)\s+(?:address|answer|advise|comment|speak to|find)|not (?:covered|addressed|supported) (?:by|in) the (?:practice|reference|library)|nothing in the (?:practice )?(?:library|references)|no (?:reference|source|document)s? (?:for|covering|support)/i;

const SCHEDULING = /\b(?:scheduled|schedule|appointment|reschedul\w*|the office will|call the office|our office|arrive|check[- ]in|parking|paperwork|front desk|confirm(?:ed|ation)?|calendar|time slot|we will call|you will receive|portal|log in|sign in)\b/i;

const HEADING_OR_GREETING = /^(?:hi|hello|dear|thank|thanks|please|sincerely|regards)\b/i
    || null;

const STRONG_CLINICAL = new RegExp([
    "\\b(?:",
    "indicated|contraindicat\\w*|recommend\\w*|guideline\\w*|evidence|first[- ]line|second[- ]line",
    "|standard of care|efficac\\w*|adverse|side effects?|complication\\w*|prognos\\w*",
    "|contraindication|absolute risk|relative risk|increases? (?:the )?risk|reduces? (?:the )?risk",
    ")\\b",
    "|\\b\\d+\\s*(?:mg|mcg|g|ml|units?)\\b",
    "|\\b\\d+(?:\\.\\d+)?\\s*%",
].join(""), "i");

const CLINICAL_ASSERTION = new RegExp([
    "\\b(?:",
    "diagnos\\w*|treat(?:s|ed|ing|ment|ments)?|therap\\w*|medicat\\w*|dosage|dosing",
    "|surg(?:ery|ical|eries)|operat(?:ion|ive)|procedur\\w*",
    "|associated with|caused? by|leads? to|results? in",
    // Effect verbs. A logistics sentence rarely says a thing "reduces" or
    // "relieves" something — and if it does, the scheduling exclusion
    // above has already taken it out.
    "|reduces?|reduced|increases?|increased|lowers?|raises?|improves?|improved",
    "|relieves?|prevents?|worsens?|resolves?|delays?|suppress\\w*",
    "|indicated|contraindicat\\w*|recommend\\w*|guideline\\w*|evidence|studies|study|trial\\w*",
    "|efficac\\w*|effective(?:ness)?|adverse|side effects?|complication\\w*|prognos\\w*",
    "|screening|first[- ]line|second[- ]line|management of|standard of care",
    "|symptoms? (?:of|include)|typical(?:ly)? (?:presents?|occurs?)|is a (?:sign|symptom|marker)",
    "|risk of|risks?\\b",
    ")",
    "|\\b\\d+\\s*(?:mg|mcg|g|ml|units?)\\b",
    "|\\b\\d+(?:\\.\\d+)?\\s*%",
].join(""), "i");

const SECTION_HEADING = /^\s*(?:what we talked about|the plan|your medicines|what happens next|uncertain:)/i;

export function isClinicalAssertion(sentence) {
    const s = String(sentence || "").trim();
    if (s.length < 15) return false;
    if (SECTION_HEADING.test(s)) return false;

    const strong = STRONG_CLINICAL.test(s);

    // An honest "not in the library" is the behaviour we want most; never
    // penalise it. This exclusion is unconditional — a refusal that quotes
    // a dose is still a refusal.
    if (REFUSAL.test(s)) return false;

    // Greetings and sign-offs.
    if (/^(?:hi|hello|dear|thanks?|thank you|sincerely|regards|best)\b/i.test(s) && !strong) return false;

    // Logistics borrow clinical nouns without asserting anything.
    if (SCHEDULING.test(s) && !strong) return false;

    return CLINICAL_ASSERTION.test(s);
}

function sentencesOf(text) {
    return String(text || "")
        .replace(/\s*\n\s*/g, " ")
        .split(/(?<=[.!?])\s+/)
        .map((x) => x.trim())
        .filter(Boolean);
}

/**
 * THE ENFORCEMENT POINT. Verify the model honoured the rule.
 *
 * @param text  the model's output
 * @param kb    the result of groundClinical() — needs `docs` (with text)
 * @returns {{ok, blocked, fabricated, unsupported, uncited, ...}}
 */
export function verifyGrounding(text, kb) {
    const policy = kb?.policy || policyFor(kb?.kind);
    const allowed = new Set((kb?.allowed_doc_ids || []).map(String));
    const byId = new Map((kb?.docs || []).map((d) => [String(d.doc_id), d]));
    const s = String(text || "");

    const cited = [...new Set((s.match(/\[KB:([^\]]+)\]/g) || []).map((m) => m.slice(4, -1).trim()))];
    const fabricated = cited.filter((c) => !allowed.has(c));

    const sentences = sentencesOf(s);
    const uncited = [];
    const unsupported = [];

    for (const sent of sentences) {
        const ids = [...new Set((sent.match(/\[KB:([^\]]+)\]/g) || []).map((m) => m.slice(4, -1).trim()))];
        if (!ids.length) {
            if (isClinicalAssertion(sent)) uncited.push(sent);
            continue;
        }
        // A citation must be supported by what the document actually says,
        // not merely point at a document that exists.
        const claimTerms = significantTerms(sent.replace(/\[KB:[^\]]+\]/g, " "));
        if (!claimTerms.length) continue;
        const supportingText = ids.map((id) => byId.get(id)?.text || "").join(" ");
        const cov = coverageOf(claimTerms, supportingText);
        if (cov.coverage < policy.min_support) {
            unsupported.push({
                sentence: sent.slice(0, 200),
                cited: ids,
                support: Math.round(cov.coverage * 100) / 100,
                not_in_cited_doc: cov.missing.slice(0, 6),
            });
        }
    }

    const ok = fabricated.length === 0
        && uncited.length <= policy.max_uncited
        && unsupported.length === 0;

    return {
        ok,
        blocked: !ok && policy.block_on_failure,
        fabricated,
        cited,
        cited_count: cited.length,
        uncited,
        uncited_count: uncited.length,
        unsupported,
        unsupported_count: unsupported.length,
        policy,
        summary: ok
            ? `Grounded: ${cited.length} citation${cited.length === 1 ? "" : "s"} to the practice library, all verified.`
            : [
                fabricated.length ? `${fabricated.length} invented citation(s): ${fabricated.join(", ")}` : null,
                unsupported.length ? `${unsupported.length} claim(s) cite a document that does not support them` : null,
                uncited.length > policy.max_uncited ? `${uncited.length} clinical statement(s) with no source` : null,
              ].filter(Boolean).join("; "),
    };
}

/**
 * What to tell the PHYSICIAN when nothing could be generated. The patient
 * never sees a refusal — they simply do not get an AI draft, which is the
 * correct outcome.
 */
export function refusalMessage(kb) {
    const base = {
        no_database: "The reference library is not reachable.",
        kb_search_failed: "The reference library search failed.",
        question_had_no_searchable_terms: "There was not enough clinical text here to search the reference library.",
        kb_returned_nothing: `The practice library returned ${kb.found_docs ?? 0} document(s) for this; ${kb.policy.min_docs} are required.`,
        kb_context_did_not_fit_budget: "The matching reference documents were too large for the prompt budget.",
    }[kb.reason] || "The practice library could not support this request.";

    return `${base} No draft was written, because ${kb.policy.why}. Writing it from general medical knowledge is exactly what this rule exists to prevent — so this one is yours, or the source material needs adding to the library.`;
}

/** A short, honest provenance line to show alongside any grounded output. */
export function provenanceLine(kb, verdict) {
    if (!kb?.grounded) return "Not grounded in the practice library.";
    const used = verdict?.cited?.length
        ? kb.citations.filter((c) => verdict.cited.includes(c.doc_id))
        : kb.citations;
    const srcs = [...new Set(used.map((c) => c.source))].slice(0, 4);
    return `Drawn from ${used.length} document(s) in the practice library${srcs.length ? ` (${srcs.join(", ")})` : ""}.`;
}

export default {
    significantTerms, coverageOf, GROUNDING_POLICY, policyFor,
    groundClinical, groundingInstruction, isClinicalAssertion,
    verifyGrounding, refusalMessage, provenanceLine,
};
