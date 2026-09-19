// =====================================================================
// /api/v1/admin/messages/<thread_id>/draft  (POST)
// AI-drafted reply in Dr. Mabini's voice — for review, never for sending
// =====================================================================
// WHY THIS EXISTS
// The owner runs this practice alone: "I will have no one to do this for
// me... AI should automatically be used to draft a response in my voice
// that I can simply review or make minor edits as needed... I literally
// only need to see the patient, review the AI notes and coding and
// billing and approve".
//
// So messaging must be REVIEW-AND-APPROVE, not compose-from-scratch. This
// endpoint reads the thread and returns a proposed reply. It deliberately
// does NOT send: the existing POST /api/v1/admin/messages/<thread_id> is
// still the only way a message reaches a patient, and a human must press
// it. An AI that could message patients unsupervised is not a time-saver,
// it is an unlicensed clinician.
//
// PHI: an Anthropic BAA is EXECUTED (see _lib/anthropic.js §11.4 ledger),
// so thread content may flow to the Messages API. Data minimization still
// applies — we send the thread text and the patient's FIRST NAME only
// (needed to address them), never DOB, address, MRN, insurance ids, or
// any other identifier.
//
// Body:    { instruction?: string }   optional steer, e.g. "offer Tuesday"
// Returns: { ok, draft, cautions[], escalate, model, usage }
// =====================================================================

import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../../../_lib/admin_api.js";
import { callClaude, AnthropicError, extractJson } from "../../../../../_lib/anthropic.js";
import { groundClinical, groundingInstruction, verifyGrounding, refusalMessage, provenanceLine }
    from "../../../../../_lib/clinical_grounding.js";
import { loadThreadMessages } from "../../../../../_lib/messaging.js";
import { logAudit } from "../../../../../_lib/audit.js";

const DRAFT_MODEL = "claude-sonnet-4-6";

// His voice, derived from how he actually writes on the site and in his CV:
// precise, quantitative, warm but unsentimental, plain-language for patients,
// no marketing register, no hedging into uselessness.
const SYSTEM = `You draft patient-portal replies for Dr. Christopher Mabini, DO, MSAEd —
a fellowship-trained complex benign gynecology / minimally invasive gynecologic
surgeon (CBG/MIGS) in the Chicago area, who also practices osteopathic
manipulative treatment.

YOU ARE DRAFTING FOR HIS REVIEW. He reads, edits, and sends. You are never the
final word and must never imply the message has already been reviewed.

HIS VOICE
- Warm but direct. Plain language a patient understands; expand any term the
  first time it appears.
- Specific over vague. If a fact is known from the thread, state it.
- Short paragraphs. No bullet lists unless enumerating concrete steps.
- No marketing language, no "we're excited", no exclamation marks.
- Never "I hope this email finds you well". Start with the answer.
- Signs off as "Dr. Mabini" unless the thread already established otherwise.

HARD CLINICAL RULES
- Do NOT diagnose, prescribe, change a dose, or promise an outcome.
- Do NOT state a new clinical finding that is not already in the thread.
- If the patient describes anything that could be an emergency (heavy bleeding
  soaking a pad an hour, chest pain, shortness of breath, fever with severe
  pain, syncope, suicidal ideation, pregnancy with severe abdominal pain), the
  draft must tell them to seek emergency care now, and you must set
  escalate=true.
- If answering properly needs information not in the thread, the draft should
  ASK for it rather than assume.
- Scheduling, billing and administrative questions may be answered directly.
- Never quote a price or coverage determination unless it appears in the thread.

OUTPUT — strict JSON, no prose outside it:
{
  "draft": "the reply text, ready to review",
  "cautions": ["anything he should verify before sending"],
  "escalate": false,
  "needsInfo": ["facts missing that would change the answer"]
}`;

export async function onRequestPost(ctx) {
  return adminRoute(ctx, async ({ env, request, admin }) => {
    // adminRoute(ctx, handler) — matches every other admin endpoint; params
    // come off the outer ctx, and the handler receives env/request/admin.
    const thread_id = String(ctx.params?.thread_id || ctx.params?.id || "");
    if (!thread_id) return jsonError("bad_params", 400);

    const thread = await env.DB.prepare(
        `SELECT t.id, t.patient_id, t.subject, t.status, t.urgency,
                p.first_name
           FROM message_threads t
           LEFT JOIN patients p ON p.id = t.patient_id
          WHERE t.id = ? LIMIT 1`
    ).bind(thread_id).first();
    if (!thread) return jsonError("thread not found", 404);

    const messages = await loadThreadMessages(env, thread_id);
    const list = Array.isArray(messages) ? messages : (messages?.messages || []);
    if (!list.length) return jsonError("thread has no messages to reply to", 400);

    // Data minimization: role + text + timestamp only. No identifiers beyond
    // the first name, which the reply needs in order to address the patient.
    const transcript = list.map((m) => {
        const who = m.from_role === "patient" ? "PATIENT" : "CLINIC";
        const when = String(m.created_at || "").slice(0, 16).replace("T", " ");
        const body = String(m.body || m.body_text || "").slice(0, 4000);
        return `[${when}] ${who}: ${body}`;
    }).join("\n\n");

    const body = await readJsonBody(request).catch(() => ({}));
    const steer = String(body?.instruction || "").slice(0, 500);

    // ------------------------------------------------------------------
    // GROUND IT IN HIS LIBRARY, OR DO NOT WRITE IT.
    // ------------------------------------------------------------------
    // A reply drafted here becomes clinical advice in a patient's inbox
    // under his name. Until now this prompt carried no reference material
    // at all, so every clinical sentence in it came from the model's
    // general training — the precise thing the practice KB exists to
    // prevent. The search text is the patient's own words plus the
    // subject, because that is what the answer has to address.
    const kbQuery = [thread.subject || "", steer,
                     list.filter((m) => m.from_role === "patient")
                         .map((m) => String(m.body || m.body_text || "")).join(" ")]
                    .join(" ").slice(0, 2000);
    const kb = await groundClinical(env, { kind: "message_draft", query: kbQuery });
    if (!kb.grounded) {
        return jsonResponse({
            ok: false, refused: true, reason: kb.reason,
            message: refusalMessage(kb),
        }, 200);
    }

    let parsed;
    try {
        const res = await callClaude(env, {
            model: DRAFT_MODEL,
            max_tokens: 1200,
            system: SYSTEM,
            messages: [{
                role: "user",
                content:
                    `${groundingInstruction(kb)}\n\n` +
                    `---\n\n` +
                    `Patient first name: ${thread.first_name || "(unknown)"}\n` +
                    `Thread subject: ${thread.subject || "(none)"}\n` +
                    `Urgency: ${thread.urgency || "routine"}\n\n` +
                    `THREAD SO FAR (oldest first):\n${transcript}\n\n` +
                    (steer ? `Dr. Mabini's steer for this reply: ${steer}\n\n` : "") +
                    `Draft the next CLINIC reply. Cite [KB:<doc_id>] after every clinical statement, ` +
                    `using only the ids listed above. If the references do not cover something the ` +
                    `patient asked, say so in the draft rather than answering it from general knowledge.`,
            }],
        });
        const text = res?.content?.[0]?.text || res?.text || "";
        parsed = extractJson(text);
        if (!parsed || typeof parsed.draft !== "string") {
            return jsonError("model did not return a usable draft", 502);
        }

        // THE ENFORCEMENT POINT. A fabricated citation, a citation that
        // does not support its claim, or any uncited clinical statement
        // means this never reaches him as a ready-to-send draft.
        const verdict = verifyGrounding(parsed.draft, kb);
        parsed.grounding = {
            ok: verdict.ok,
            summary: verdict.summary,
            provenance: provenanceLine(kb, verdict),
            citations: kb.citations,
            fabricated: verdict.fabricated,
            uncited: verdict.uncited,
            unsupported: verdict.unsupported,
            kb_coverage: Math.round((kb.coverage || 0) * 100) / 100,
        };
        if (verdict.blocked) {
            return jsonResponse({
                ok: false, refused: true, reason: "grounding_check_failed",
                message: `The draft was written but did not hold up against the practice library, so it is not being offered as a reply: ${verdict.summary}. Write this one yourself.`,
                grounding: parsed.grounding,
                rejected_draft: parsed.draft,
            }, 200);
        }
        // Audit that a draft was generated — traceability for a PHI-bearing
        // model call. The draft text itself is not logged.
        try {
            await logAudit(env, {
                action: "message_draft_generated",
                patient_id: thread.patient_id,
                detail: JSON.stringify({ thread_id, escalate: !!parsed.escalate }),
            }, ctx);
        } catch { /* auditing must not break the draft */ }

        return jsonResponse({
            ok: true,
            draft: parsed.draft,
            cautions: Array.isArray(parsed.cautions) ? parsed.cautions : [],
            needsInfo: Array.isArray(parsed.needsInfo) ? parsed.needsInfo : [],
            escalate: Boolean(parsed.escalate),
            model: DRAFT_MODEL,
            usage: res?.usage || null,
            // Explicit so no UI can mistake this for a sent message.
            sent: false,
            notice: "Draft only — review, edit if needed, then send with POST /api/v1/admin/messages/<thread_id>.",
        });
    } catch (e) {
        if (e instanceof AnthropicError) {
            return jsonError(`draft unavailable: ${e.message}`, e.status || 502);
        }
        console.error("message draft failed", String(e).slice(0, 300));
        return jsonError("draft failed", 500);
    }
  });
}
