// =====================================================================
// visit_summary.js — the after-visit summary, and the sign-off that gates it
// =====================================================================
// The portal advertises: "After each appointment, an AI-generated summary
// of what was discussed, the plan, the medications, and the next steps —
// reviewed and signed off by Dr. Mabini."
//
// The table for it has existed since schema 0003, complete with a
// `status` column running pending_clinician_review -> approved. Nothing
// ever wrote to it. Only the PHI key-rotation job knew it was there. The
// feature was advertised and not built.
//
// ---------------------------------------------------------------------
// "REVIEWED AND SIGNED OFF" IS A GATE, NOT A DESCRIPTION
// ---------------------------------------------------------------------
// A patient may only ever read a summary whose status is 'approved'. Not
// 'pending_clinician_review', not 'rejected', not one that was edited but
// never re-approved. That is enforced in the read path with a WHERE
// clause, not by remembering to filter — because the promise on the
// marketing page is a clinical safety claim, and an AI summary of a
// medical visit that reaches a patient unreviewed is the exact harm the
// sentence exists to prevent.
//
// TWO SUMMARIES, DIFFERENT AUDIENCES
//   patient_visible — plain language, second person, no jargon, no
//                     speculation, no new clinical facts. This is what
//                     the member reads in the portal.
//   clinician_full  — denser, keeps clinical terminology, flags what the
//                     model was unsure about. This is what he reads while
//                     deciding whether to approve.
//
// Both are envelope-encrypted into R2 like every other clinical body; D1
// holds keys and the denormalised bits the portal needs for a list view.
//
// PHI AND THE BRIDGE
// An encounter note is PHI. Routed to the local Claude CLI it would leave
// BAA-covered infrastructure, so `visit_summary` goes through the same
// server-side de-identify / verify / rehydrate path as message drafts
// (_lib/bridge_context.js). The model sees [NAME_1] and [DATE_2]; the
// physician reads a normal summary.
// =====================================================================

import { routeFor, enqueueAiJob } from "./ai_router.js";

export const VISIT_SUMMARY_PROMPT_VERSION = "visit-summary-v1-2026-08-13";

/** Only these statuses exist, and only one of them is readable by a patient. */
export const STATUS = {
    PENDING: "pending_clinician_review",
    APPROVED: "approved",
    REJECTED: "rejected",
    ARCHIVED: "archived",
};

/** THE gate. Exported so the read path and the tests use the same rule. */
export function patientMayRead(row) {
    return Boolean(row) && row.status === STATUS.APPROVED;
}

/**
 * Language that must never appear in a PATIENT-facing summary. This is a
 * different list from visit_prep's scope rules: here a diagnosis IS
 * appropriate — he made it, in the room. What is not appropriate is the
 * model inventing certainty, minimising, or promising an outcome.
 */
export const PATIENT_TONE_RULES = [
    { key: "prognosis_promise", re: /\b(you will be (fine|fully recovered)|guarantee[ds]?|complete cure|definitely (will|won't))\b/i,
      why: "promises an outcome" },
    { key: "minimising", re: /\b(nothing to worry about|no need to worry|it'?s? nothing|don'?t worry)\b/i,
      why: "minimises a concern the patient raised" },
    { key: "new_advice", re: /\b(I recommend you (start|stop|increase|decrease)|you should now (start|stop))\b/i,
      why: "introduces advice that may not have been given in the visit" },
    { key: "hedged_invention", re: /\b(may(be)? (also )?(have|be developing)|possibly indicates|could be a sign of)\b/i,
      why: "speculates beyond what was discussed" },
];

export function checkPatientTone(text) {
    const t = String(text || "");
    const violations = [];
    for (const r of PATIENT_TONE_RULES) {
        const m = t.match(r.re);
        if (m) violations.push({ key: r.key, why: r.why, sample: String(m[0]).slice(0, 70) });
    }
    return { ok: violations.length === 0, violations };
}

export function buildPrompt(noteText, { visitDate, visitType, chiefComplaint } = {}) {
    return `You are writing the after-visit summary for a patient of Dr. Christopher Mabini, DO — a fellowship-trained complex benign gynecologic surgeon. He will read it and decide whether to approve it before the patient ever sees it.

VISIT: ${visitType || "office visit"}${visitDate ? ` on ${visitDate}` : ""}
${chiefComplaint ? `REASON FOR VISIT: ${chiefComplaint}` : ""}

Produce TWO summaries, separated exactly by a line containing only ---CLINICIAN---

FIRST, the PATIENT-FACING summary:
  * Second person, plain language. Explain any medical word the first time it appears.
  * Short paragraphs under these headings: What we talked about · The plan · Your medicines · What happens next
  * Include ONLY what is in the note below. Add no clinical fact, no reassurance and no advice that is not there.
  * Do not promise an outcome. Do not minimise anything the patient raised. Do not speculate about what a symptom "could be".
  * Where the note records uncertainty, say so honestly — "we do not know yet" is a real and useful sentence.
  * If a follow-up, test or referral is in the note, state it with its timing.

THEN ---CLINICIAN--- and the CLINICIAN summary:
  * Dense, keeps clinical terminology, no explanations.
  * Assessment and plan as documented.
  * A final line beginning "UNCERTAIN:" listing anything in the note that was ambiguous, illegible or contradictory — this is what he needs to check before approving. If nothing, write "UNCERTAIN: none".

ENCOUNTER NOTE:
${noteText}`;
}

/** Split the model's output into its two halves. */
export function splitSummaries(raw) {
    const s = String(raw || "");
    const i = s.indexOf("---CLINICIAN---");
    if (i < 0) return { ok: false, error: "the model did not produce both summaries in the expected format" };
    const patient = s.slice(0, i).trim();
    const clinician = s.slice(i + "---CLINICIAN---".length).trim();
    if (!patient || !clinician) return { ok: false, error: "one of the two summaries came back empty" };
    return { ok: true, patient, clinician };
}

/** Pull the short denormalised fields the portal list view needs. */
export function extractDenormalised(patientText) {
    const t = String(patientText || "");
    const section = (heading) => {
        const re = new RegExp(`${heading}[^\\n]*\\n([\\s\\S]*?)(?=\\n\\s*(?:What we talked about|The plan|Your medicines|What happens next)\\b|$)`, "i");
        const m = t.match(re);
        return m ? m[1].trim() : "";
    };
    const plan = section("The plan").replace(/\s+/g, " ").slice(0, 200);
    const next = section("What happens next").replace(/\s+/g, " ").slice(0, 200);
    const meds = section("Your medicines")
        .split(/\n|;|·/)
        .map((x) => x.replace(/^[-*•\s]+/, "").trim())
        .filter((x) => x.length > 2 && x.length < 120);
    return { plan_summary: plan || null, next_step_summary: next || null, medications: meds.slice(0, 20) };
}

/**
 * Generate a summary from an encounter note.
 *
 * Returns { ok, queued? , patient, clinician, denormalised, tone } — and
 * NEVER writes anything. Persisting is the caller's job, so that the
 * status this lands in ('pending_clinician_review') is set in one place.
 */
export async function generateSummary(env, { noteText, visitDate, visitType, chiefComplaint, encounterId, patientId }) {
    if (!String(noteText || "").trim()) {
        return { ok: false, error: "the encounter has no note to summarise" };
    }

    const route = routeFor(env, "visit_summary");
    if (route === "bridge") {
        const job = await enqueueAiJob(env, {
            kind: "visit_summary",
            payload: { encounter_id: encounterId },
            patient_id: patientId,
        });
        return { ok: true, queued: true, job_id: job.id, route,
                 message: "Queued for your Claude CLI bridge. The note is de-identified before it leaves, and the real names and dates are restored here before you read it." };
    }
    if (route === "blocked") return { ok: false, error: "No AI route is configured for visit summaries." };

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
                max_tokens: 2500,
                messages: [{ role: "user", content: buildPrompt(noteText, { visitDate, visitType, chiefComplaint }) }],
            }),
        });
        if (!res.ok) return { ok: false, error: `model call failed (HTTP ${res.status})` };
        const j = await res.json();
        raw = (j.content || []).map((c) => c.text || "").join("");
    } catch (e) {
        return { ok: false, error: `model call failed: ${String(e).slice(0, 200)}` };
    }

    const split = splitSummaries(raw);
    if (!split.ok) return { ok: false, error: split.error };

    // Tone is checked but does NOT block: he is reviewing this anyway, and
    // a flagged phrase he can see and fix is more useful than a silent
    // regeneration that loses the rest of a good summary.
    const tone = checkPatientTone(split.patient);

    return {
        ok: true,
        route,
        patient: split.patient,
        clinician: split.clinician,
        denormalised: extractDenormalised(split.patient),
        tone,
        prompt_version: VISIT_SUMMARY_PROMPT_VERSION,
        model: env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
    };
}

/**
 * What the clinician is allowed to do with a pending summary, and what
 * each action means for the patient's view.
 */
export const REVIEW_ACTIONS = {
    approved_as_is: { to: STATUS.APPROVED, label: "Approve as written", patient_sees: true },
    edited_and_approved: { to: STATUS.APPROVED, label: "Approve with my edits", patient_sees: true },
    rejected: { to: STATUS.REJECTED, label: "Reject — do not show the patient", patient_sees: false },
};

export function applyReview(action) {
    const a = REVIEW_ACTIONS[String(action || "")];
    if (!a) return { ok: false, error: `unknown review action: ${action}` };
    return { ok: true, status: a.to, patient_sees: a.patient_sees };
}

export default {
    VISIT_SUMMARY_PROMPT_VERSION, STATUS, patientMayRead,
    PATIENT_TONE_RULES, checkPatientTone, buildPrompt, splitSummaries,
    extractDenormalised, generateSummary, REVIEW_ACTIONS, applyReview,
};
