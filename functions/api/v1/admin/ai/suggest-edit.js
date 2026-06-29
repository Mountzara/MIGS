// =====================================================================
// /api/v1/admin/ai/suggest-edit  (POST) — Claude-powered content copy edit
// =====================================================================
// Proposes a clearer TITLE + SUMMARY for a content item, grounded in the
// item's own body. The model is explicitly forbidden from adding, removing,
// or altering any clinical fact — it only improves clarity/concision of the
// editorial copy. It does NOT apply the change; the operator confirms in the
// app and the edit lands via the existing PATCH endpoint.
//
// PHI: this only ever sends the operator's own published-content surfaces
// (education materials, etc.) to the model — never patient data. Anthropic
// has no BAA (see _lib/anthropic.js), so PHI must never reach here.
//
// Body: { kind: "education", slug: string, instruction?: string }
// Returns: { ok, proposal: { proposedTitle, proposedSummary, rationale },
//            current: { title, summary }, model, usage }
// =====================================================================

import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../../_lib/admin_api.js";
import { callClaude, AnthropicError } from "../../../../_lib/anthropic.js";
import { retrieveKB } from "../../../../_lib/kb.js";
import { logAudit } from "../../../../_lib/audit.js";

// Use the same model the shared wrapper is built around: claude-sonnet-4-6.
// The wrapper always sends `temperature`, which claude-opus-4-8 rejects with a
// 400 (sampling params are removed on the Opus 4.7/4.8 family). Sonnet 4.6 is
// also more than capable for short copy edits and cheaper. To move this to an
// Opus model later, extend _lib/anthropic.js to omit temperature for it.
const EDIT_MODEL = "claude-sonnet-4-6";

const SYSTEM = `You are a senior copy editor for a women's health practice's patient-education library. \
Your only job is to improve the clarity, concision, and patient-friendliness of a material's TITLE and SUMMARY. \

ABSOLUTE RULES — these are non-negotiable:
- NEVER add, remove, or change any clinical fact, claim, dose, drug, lab value, threshold, timeframe, or recommendation.
- Stay strictly faithful to the provided body. Do not introduce anything not supported by it.
- Do not invent statistics, citations, or guideline references.
- Keep a warm, plain-language, patient-facing tone. Title <= 80 characters; summary <= 280 characters.

Reply with ONLY a single JSON object and nothing else, of exactly this shape:
{"proposedTitle": "string", "proposedSummary": "string", "rationale": "one short sentence on what you improved"}`;

function extractJsonObject(text) {
    if (!text) return null;
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

export async function onRequestPost(ctx) {
    return adminRoute(ctx, async ({ env, request, admin }) => {
        if (!env.DB) return jsonError("server_error", 500, { reason: "DB not bound" });

        const body = await readJsonBody(request);
        if (!body) return jsonError("invalid_json_body", 400);

        const kind = String(body.kind || "education").toLowerCase();
        if (kind !== "education") {
            return jsonError("unsupported_kind", 400, { supported: ["education"] });
        }
        const slug = String(body.slug || "").trim();
        if (!slug) return jsonError("missing_slug", 400);
        const instruction = String(body.instruction || "Make the title and summary clearer and more concise for patients, without changing any clinical meaning.").slice(0, 500);

        const row = await env.DB.prepare(
            `SELECT slug, title, summary, body_md FROM education_materials WHERE slug = ?`
        ).bind(slug).first();
        if (!row) return jsonError("material_not_found", 404);

        // Ground the edit in the OB/GYN KB (best-effort; empty if not yet loaded).
        const { context: kbContext, citations } = await retrieveKB(env, {
            query: `${row.title || ""} ${row.summary || ""}`,
            topK: 5,
            maxChars: 2800,
        });

        const user = `Instruction: ${instruction}

Current title: ${row.title || "(none)"}
Current summary: ${row.summary || "(none)"}

Body (for grounding only — do NOT change it; use it to keep the title/summary accurate):
${String(row.body_md || "(no body on file)").slice(0, 6000)}`
            + (kbContext
                ? `\n\nRelevant clinical reference from the practice's knowledge base (use ONLY to keep the title/summary clinically accurate — never copy verbatim, never add new claims):\n${kbContext}`
                : "");

        let result;
        try {
            result = await callClaude(env, {
                model: EDIT_MODEL,
                system: SYSTEM,
                messages: [{ role: "user", content: user }],
                max_tokens: 700,
                temperature: 0.3,
            });
        } catch (e) {
            const status = e instanceof AnthropicError ? (e.status || 502) : 502;
            console.error("suggest-edit callClaude failed", { slug, error: String(e?.message || e), status });
            return jsonError("ai_unavailable", 502, { detail: String(e?.message || e) });
        }

        const parsed = extractJsonObject(result.text);
        if (!parsed || typeof parsed.proposedTitle !== "string") {
            return jsonError("ai_parse_failed", 502, { raw: (result.text || "").slice(0, 400) });
        }

        const proposal = {
            proposedTitle: String(parsed.proposedTitle || "").trim().slice(0, 200),
            proposedSummary: String(parsed.proposedSummary || "").trim().slice(0, 280),
            rationale: String(parsed.rationale || "").trim().slice(0, 400),
        };

        ctx.waitUntil(logAudit(env, {
            user_id: admin.user, user_role: admin.role,
            action: "education_ai_suggest",
            record_type: "education_material",
            record_id: slug,
            ip: request.headers.get("CF-Connecting-IP") || "",
            user_agent: (request.headers.get("User-Agent") || "").slice(0, 400),
            success: true,
            details: { instruction, model: result.raw?.model || EDIT_MODEL },
        }, ctx));

        return jsonResponse({
            ok: true,
            proposal,
            current: { title: row.title, summary: row.summary },
            kb_citations: citations,
            kb_grounded: citations.length > 0,
            model: result.raw?.model || EDIT_MODEL,
            usage: result.usage || {},
        });
    });
}
