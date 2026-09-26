// =====================================================================
// visit_prep.js — prepare a patient for an appointment with SOMEONE ELSE
// =====================================================================
// THE IDEA, AND WHY IT CHANGES THE BUSINESS
//
// Every tier before this assumed the patient leaves their OB/GYN and
// comes here. That is a small market and a slow sale. This one does not:
// the patient keeps their own doctor, and buys a subspecialist's help
// getting the most out of the fifteen minutes they are about to spend
// with them.
//
// It is also the cheapest thing the practice sells, in the only currency
// that is scarce — his time. The deliverables below are assembled from
// the patient's own history by the system. He is not in the loop, so the
// panel has no ceiling, which is the opposite of every other tier.
//
// ---------------------------------------------------------------------
// THE LINE THAT MUST NOT BE CROSSED, AND HOW IT IS ENFORCED
// ---------------------------------------------------------------------
// There are two different products hiding in this idea and they have
// completely different regulatory shapes:
//
//   1. ORGANISING WHAT THE PATIENT ALREADY KNOWS. A symptom timeline, a
//      medication list, their imaging results laid out in date order, a
//      list of questions drawn from their own history, a plain-language
//      glossary. This is patient education and navigation. It creates no
//      physician-patient relationship, needs no licence in their state,
//      and is not a covered service — so it can be a membership benefit.
//
//   2. TELLING THEM WHAT IS WRONG, OR WHAT TO DO. "Your imaging suggests
//      adenomyosis." "You should ask for an MRI." That is the practice of
//      medicine. It requires licensure IN THE PATIENT'S STATE, creates a
//      physician-patient relationship with everything that follows, and —
//      because a second opinion is frequently a COVERED service — must be
//      a billed encounter, never something folded into a membership fee.
//
// This module builds (1) and refuses (2). `SCOPE_RULES` is enforced in
// the prompt AND re-checked on the output, because a language model asked
// to be helpful will drift across that line every time. Output containing
// a diagnosis, a recommendation, or an interpretation is REJECTED, not
// softened — a hedged diagnosis is still a diagnosis.
//
// When the patient genuinely needs his opinion, the right answer is to
// say so and book a real consultation. `escalation` carries that.
// =====================================================================

import { routeFor, enqueueAiJob } from "./ai_router.js";
import { groundClinical, groundingInstruction, verifyGrounding, refusalMessage, provenanceLine }
    from "./clinical_grounding.js";

export const VISIT_PREP_VERSION = "visit-prep-v1-2026-08-13";

/**
 * The licences, with their numbers and expiry dates.
 *
 * Educational deliverables are available everywhere — organising a
 * patient's own history is not the practice of medicine. Anything that
 * WOULD be the practice of medicine is gated on this list.
 *
 * EXPIRY IS CHECKED, NOT ASSUMED. A licence that lapses quietly does not
 * announce itself; it just makes every consultation in that state
 * unlawful from a date nobody was watching. `canConsult()` treats an
 * expired licence as no licence, and `licenceWarnings()` gives ninety
 * days of notice.
 *
 * Numbers are public record via each board's verification lookup.
 */
export const LICENSES = [
    { state: "IL", number: "036.166236",
      board: "Illinois Department of Financial and Professional Regulation",
      expires: "2029-07-31",
      // NPPES publishes "125075291" against the Illinois taxonomy record.
      // That is NOT the licence number on the licence itself. Payers and
      // clearinghouses verify against the STATE BOARD, so the licence is
      // authoritative and NPPES is stale — see nppesMismatch() below,
      // which is why the clearinghouse wizard must not silently autofill
      // the NPPES value.
      nppes_says: "125075291" },
    { state: "CA", number: "20A24823",
      board: "Osteopathic Medical Board of California",
      expires: "2027-11-30" },
];

/**
 * Licences where the NPPES record disagrees with the licence itself.
 *
 * This matters more than it looks: the clearinghouse wizard fills
 * `license_number` from NPPES, and an EDI enrollment submitted with a
 * licence number the state board does not recognise comes back rejected
 * weeks later with no useful explanation.
 */
export function nppesMismatch() {
    return LICENSES
        .filter((l) => l.nppes_says && l.nppes_says !== l.number)
        .map((l) => ({
            state: l.state,
            on_licence: l.number,
            nppes_says: l.nppes_says,
            message: `NPPES lists your ${l.state} licence as ${l.nppes_says}, but the licence itself says ${l.number}. Payers verify against the state board, so use ${l.number} — and update NPPES, because a mismatch is a common cause of enrollment rejection.`,
        }));
}

export const LICENSED_STATES = LICENSES.map((l) => l.state);

/** Days until a licence expires; null when no expiry is recorded. */
export function daysUntilExpiry(license, now = new Date()) {
    if (!license?.expires) return null;
    const end = Date.parse(license.expires + "T23:59:59Z");
    if (Number.isNaN(end)) return null;
    return Math.floor((end - now.getTime()) / 86400000);
}

/**
 * The states he may practise in RIGHT NOW. An expired licence is excluded
 * even though it is still listed, because the list is a record and this
 * is a gate.
 */
export function licensedStates(env = null, now = new Date()) {
    const raw = String(env?.LICENSED_STATES || "").trim();
    if (raw) {
        const list = raw.split(/[,\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
        if (list.length) return list;
    }
    return LICENSES
        .filter((l) => { const d = daysUntilExpiry(l, now); return d === null || d > 0; })
        .map((l) => l.state);
}

export function canConsult(state, env = null, now = new Date()) {
    return licensedStates(env, now).includes(String(state || "").trim().toUpperCase());
}

/**
 * Anything the operator needs to act on. Surfaced in the admin console
 * because renewal is the kind of task that is invisible until it is late.
 */
export function licenceWarnings(now = new Date()) {
    const out = [];
    for (const l of LICENSES) {
        const d = daysUntilExpiry(l, now);
        if (d === null) {
            out.push({ state: l.state, severity: "info",
                message: `No expiry recorded for the ${l.state} licence (${l.number}). Add it so renewal cannot be missed.` });
        } else if (d <= 0) {
            out.push({ state: l.state, severity: "critical",
                message: `The ${l.state} licence (${l.number}) EXPIRED on ${l.expires}. Consultations in ${l.state} are suspended until it is renewed.` });
        } else if (d <= 90) {
            out.push({ state: l.state, severity: "warning",
                message: `The ${l.state} licence (${l.number}) expires in ${d} days, on ${l.expires}.` });
        }
    }
    return out;
}

// ---------------------------------------------------------------------
// The deliverables
// ---------------------------------------------------------------------

export const DELIVERABLES = [
    {
        key: "timeline",
        name: "Symptom timeline",
        what: "Everything you have told us, in date order, on one page — when symptoms started, what changed, what you have already tried and what happened.",
        why: "Most visits start with the patient reconstructing years from memory under time pressure. This hands the doctor the history in thirty seconds.",
        educational: true,
    },
    {
        key: "questions",
        name: "Questions worth asking",
        what: "A list of questions drawn from your own history and the things you have said matter to you — written so you can hand the page over or read from it.",
        why: "People leave visits realising they forgot the thing they came for. A written list survives being nervous.",
        educational: true,
    },
    {
        key: "records_index",
        name: "Records index",
        what: "What imaging, labs and operative reports exist, when they were done, and which ones your doctor may not have seen.",
        why: "Records do not follow patients between systems. Knowing what exists is often the difference between a repeated scan and a decision.",
        educational: true,
    },
    {
        key: "glossary",
        name: "Plain-language glossary",
        what: "The words on your own reports, explained — adenomyosis, endometrioma, submucosal, hysteroscopy.",
        why: "You cannot ask about something you do not have a word for.",
        educational: true,
    },
    {
        key: "medication_list",
        name: "Current medication and treatment list",
        what: "What you are taking, what you have stopped, and why — including anything tried for pain or bleeding.",
        why: "Treatment history is what determines the next step, and it is the thing most often missing from a referral.",
        educational: true,
    },
    {
        key: "visit_summary",
        name: "After-visit capture",
        what: "A short form to record what was said and decided, folded back into your timeline for next time.",
        why: "The next visit starts where the last one ended instead of from scratch.",
        educational: true,
    },
];

// ---------------------------------------------------------------------
// Scope enforcement
// ---------------------------------------------------------------------

/**
 * Language that means the output crossed from ORGANISING into
 * PRACTISING. Deliberately broad — a false positive costs one regenerate;
 * a false negative is unlicensed medical advice sitting in a patient's
 * hands with his name on it.
 */
export const SCOPE_RULES = [
    // Two lookaheads carry a lot of weight here, and both were added
    // after the tests caught the failure they prevent:
    //
    //   "you have X" is a diagnosis; "you have TRIED X" is history. Without
    //   the first lookahead every legitimate treatment history is blocked
    //   and the tool is useless.
    //
    //   "this may be adenomyosis" is a diagnosis; "this appointment is with
    //   your own OB/GYN" is a sentence. The modal list keeps the first and
    //   the noun lookahead keeps the second.
    //
    // "you have X" is a diagnosis; "you have TRIED X" is history. The
    // negative lookahead is what keeps a symptom timeline legal — without
    // it every legitimate treatment history is blocked and the tool is
    // useless. The modal alternation catches the hedges ("could suggest"),
    // because a hedged diagnosis is still a diagnosis.
    { key: "diagnosis", re: /\b(?:you\s+(?:likely|probably|may|might|could|do)?\s*have\b(?!\s+(?:tried|had|been|seen|already|not|no\b|used|stopped|taken|reported|told|mentioned|noted|asked))|this\s+(?:may|might|could|likely|probably|possibly)?\s*(?:is|be|suggests?|indicates?|means|represents?)\b(?!\s+(?:a |an |your |the |not )?(?:preparation|tool|timeline|list|document|page|summary|guide|appointment|visit|form|glossary|index|question))|findings?\s+(?:are\s+)?consistent with|diagnos(?:is|ed|tic) of)/i,
      why: "states or implies a diagnosis" },
    { key: "recommendation", re: /\b(you should|I recommend|we recommend|it is recommended|the next step (is|should be)|you need (a|an|to))\b/i,
      why: "makes a clinical recommendation" },
    { key: "interpretation", re: /\b(your (scan|ultrasound|MRI|imaging|labs?|results?) (shows?|reveals?|demonstrates?|indicates?))\b/i,
      why: "interprets a diagnostic study" },
    { key: "prognosis", re: /\b(is likely to (worsen|progress|improve|resolve)|will (probably|likely) (need|require))\b/i,
      why: "offers a prognosis" },
    { key: "treatment", re: /\b(start(ing)? (on )?[a-z]+ (mg|milligrams)|increase your dose|stop taking|switch to)\b/i,
      why: "directs treatment" },
];

/**
 * Check generated text against the scope rules.
 * @returns {{ok, violations:[{key, why, sample}]}}
 */
export function checkScope(text) {
    const t = String(text || "");
    const violations = [];
    for (const rule of SCOPE_RULES) {
        const m = t.match(rule.re);
        if (m) violations.push({ key: rule.key, why: rule.why, sample: String(m[0]).slice(0, 80) });
    }
    return { ok: violations.length === 0, violations };
}

/** Every deliverable carries this, verbatim, wherever it is shown. */
export const PATIENT_DISCLAIMER =
    "This is a preparation tool, not medical advice. It organises the history you have given us so your own doctor has it in front of them. " +
    "It contains no diagnosis, no interpretation of your results, and no recommendation about your treatment — those are your doctor's to make, " +
    "with you, in the room. Dr. Mabini has not examined you and is not your treating physician for this visit.";

export function buildPrompt(kind, historyText, { specialty = "OB/GYN" } = {}) {
    const d = DELIVERABLES.find((x) => x.key === kind);
    return `You are preparing a patient for an appointment with THEIR OWN ${specialty}. You are not that doctor, and you are not treating this patient.

DELIVERABLE: ${d ? d.name : kind}
${d ? d.what : ""}

WHAT YOU ARE DOING: organising what the patient has already told us so their doctor can absorb it quickly.

WHAT YOU ARE ABSOLUTELY NOT DOING — and this is the whole constraint:
  * NO diagnosis. Not stated, not implied, not hedged. "This could suggest…" is a diagnosis.
  * NO interpretation of any imaging, laboratory or pathology result. You may state that a study exists and what it is called. You may not say what it means.
  * NO recommendation about tests, treatment, medication or surgery.
  * NO prognosis.
  * Never write "you should", "I recommend", "your scan shows", or "this is consistent with".

Questions are how you stay in scope. Instead of "you likely have adenomyosis", write "Ask whether adenomyosis has been considered, and what would distinguish it." A question hands the judgement to the doctor, which is where it belongs.

Use only what is in the history below. Add no clinical facts. Where something is missing, say it is missing rather than filling it in.

Write for an anxious adult reading on a phone. Short sentences. No jargon without the plain word beside it.

PATIENT HISTORY:
${historyText}

Return the deliverable as plain text with clear headings. No preamble.`;
}

/**
 * Generate one deliverable.
 *
 * Routes through ai_router, so with no API key it queues for the local
 * Claude CLI bridge rather than failing — and the bridge path is already
 * de-identified server-side (_lib/bridge_context.js).
 *
 * The scope check runs on the OUTPUT, not just in the prompt. A model
 * told not to diagnose will still occasionally diagnose, and the only
 * reliable defence is to read what came back.
 */
export async function generateDeliverable(env, { kind, historyText, specialty = "OB/GYN", patientId = null }) {
    const d = DELIVERABLES.find((x) => x.key === kind);
    if (!d) return { ok: false, error: `unknown deliverable: ${kind}` };
    if (!String(historyText || "").trim()) {
        return { ok: false, error: "no history to work from — the patient needs to complete their intake first" };
    }

    // ------------------------------------------------------------------
    // GROUND IT IN HIS LIBRARY, OR DO NOT WRITE IT.
    // ------------------------------------------------------------------
    // A Navigator member hands this to their own OB/GYN with his name on
    // it. That is the highest-consequence text this system produces: it
    // travels outside the practice, to another clinician, as his opinion.
    // Every clinical statement in it comes from his references or it is
    // not written.
    const kb = await groundClinical(env, {
        kind: "visit_prep",
        query: String(historyText).slice(0, 3000),
    });
    if (!kb.grounded) {
        return { ok: false, refused: true, reason: kb.reason, error: refusalMessage(kb) };
    }

    const route = routeFor(env, "visit_prep");
    if (route === "bridge") {
        const job = await enqueueAiJob(env, {
            kind: "visit_prep",
            payload: { deliverable: kind, specialty },
            patient_id: patientId,
        });
        return { ok: true, queued: true, job_id: job.id,
                 message: "Queued. Your preparation pack will appear here shortly." };
    }
    if (route === "blocked") return { ok: false, error: "No AI route is configured." };

    let text;
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
                max_tokens: 2500,
                messages: [{ role: "user", content: `${groundingInstruction(kb)}\n\n---\n\n${buildPrompt(kind, historyText, { specialty })}` }],
            }),
        });
        if (!res.ok) return { ok: false, error: `model call failed (HTTP ${res.status})` };
        const j = await res.json();
        text = (j.content || []).map((c) => c.text || "").join("");
    } catch (e) {
        return { ok: false, error: `model call failed: ${String(e).slice(0, 200)}` };
    }

    const scope = checkScope(text);
    if (!scope.ok) {
        // Reject, do not soften. A hedged diagnosis is still a diagnosis,
        // and this document goes out with his name on it.
        return {
            ok: false,
            scope_violation: true,
            violations: scope.violations,
            error: `The generated text crossed into clinical advice (${scope.violations.map((v) => v.why).join("; ")}) and was discarded rather than shown.`,
        };
    }

    // Scope and grounding are two different guarantees and both must hold.
    // checkScope asks "did it cross into giving advice"; this asks "is the
    // medicine in it his". A pack can stay perfectly within scope while
    // describing a condition from the model's training data, and that is
    // the version that reaches another clinician looking authoritative.
    const verdict = verifyGrounding(text, kb);
    if (verdict.blocked) {
        return {
            ok: false, refused: true, reason: "grounding_check_failed",
            error: `The pack was written but did not hold up against the practice library, so it was discarded rather than shown: ${verdict.summary}.`,
            grounding: {
                ok: false, summary: verdict.summary, citations: kb.citations,
                fabricated: verdict.fabricated, uncited: verdict.uncited,
                unsupported: verdict.unsupported,
            },
            rejected_text: text,
        };
    }

    return {
        ok: true,
        kind, name: d.name,
        text,
        grounding: {
            ok: verdict.ok,
            summary: verdict.summary,
            provenance: provenanceLine(kb, verdict),
            citations: kb.citations,
            kb_coverage: Math.round((kb.coverage || 0) * 100) / 100,
        },
        disclaimer: PATIENT_DISCLAIMER,
        version: VISIT_PREP_VERSION,
    };
}

/**
 * When the patient's situation has outgrown a preparation pack, say so
 * plainly and offer the thing that would actually help — a real
 * consultation, licensure permitting.
 */
export function escalation({ state = null, env = null, now = new Date() } = {}) {
    const states = licensedStates(env, now);
    const licensed = canConsult(state, env, now);
    return {
        offer: licensed ? "consultation" : "referral",
        headline: licensed
            ? "This may be worth a proper conversation."
            : "This may be worth a proper conversation — but not with him, yet.",
        body: licensed
            ? "A preparation pack organises your history. It cannot tell you what it means, and there is a point where that is the question you actually have. A consultation is a scheduled visit, billed to your insurance the same as any other — it is not part of your membership fee, and never will be."
            : `Dr. Mabini is licensed in ${states.join(" and ")}. He cannot give you a clinical opinion in your state, and would be breaking the law to try. Your preparation tools continue to work wherever you are.`,
        billable: licensed,
        // Stated explicitly because this is exactly the boundary the
        // membership structure depends on.
        note: "A second opinion is usually a covered service. Covered services are billed; they are never included in a membership fee.",
    };
}

export default {
    VISIT_PREP_VERSION, DELIVERABLES, SCOPE_RULES, checkScope,
    PATIENT_DISCLAIMER, buildPrompt, generateDeliverable,
    LICENSES, LICENSED_STATES, licensedStates, canConsult, escalation,
    daysUntilExpiry, licenceWarnings, nppesMismatch,
};
