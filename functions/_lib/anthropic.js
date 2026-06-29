// =====================================================================
// functions/_lib/anthropic.js — thin Anthropic Messages API wrapper
// =====================================================================
// Per CLAUDE.md §3.6 (Validated-API-Only). Centralizes:
//   * the api.anthropic.com endpoint
//   * the anthropic-version header (pinned)
//   * env.ANTHROPIC_API_KEY read
//   * structured logging of request URL + status + duration
//
// PHI safety (§4.2 + §11.4 BAA-ledger): an Anthropic BAA is now EXECUTED
// (confirmed 2026-06-29), so PHI MAY flow to the Messages API where a
// feature genuinely requires it — e.g. payer appeal letters need the
// patient name / member id / DOB to be valid. The standing rule is still
// DATA MINIMIZATION: send only the fields a feature needs, never more.
// Non-clinical/finance features (billing advisor) and de-identifiable
// ones (triage) should continue to minimize. See
// functions/_lib/intake_triage.js for the canonical de-identification
// path; callers that DO send PHI must audit-log the event.
// =====================================================================

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
// Pinned model — Claude Sonnet 4.6 is the production triage model. Bump
// only after re-benchmarking the triage prompt against a held-out intake
// set. Model string per Anthropic's published list: `claude-sonnet-4-6`.
const DEFAULT_MODEL = "claude-sonnet-4-6";

/**
 * Whether a model rejects sampling parameters (temperature/top_p/top_k).
 * The Opus 4.7/4.8/4.9… family returns a 400 when any are sent. Matches
 * claude-opus-4-7 and up (and future two-digit minors), not opus-4-6 or
 * earlier, and never Sonnet/Haiku.
 */
export function modelRejectsSamplingParams(model) {
    return /claude-opus-4-(?:[789]|1\d|2\d)\b/.test(String(model || ""));
}

export class AnthropicError extends Error {
    constructor(message, status, body) {
        super(message);
        this.name = "AnthropicError";
        this.status = status;
        this.body = body;
    }
}

/**
 * Call the Anthropic Messages API.
 *
 * @param {object} env - Pages Function env (must carry ANTHROPIC_API_KEY).
 * @param {object} args
 * @param {string} args.system - System prompt (de-identified).
 * @param {Array<{role: 'user'|'assistant', content: string}>} args.messages
 * @param {number=} args.max_tokens - default 1024.
 * @param {number=} args.temperature - default 0 (deterministic for triage).
 * @param {string=} args.model - override default model.
 * @returns {Promise<{text: string, raw: object, usage: object, latency_ms: number}>}
 *
 * Throws AnthropicError on non-2xx response or if ANTHROPIC_API_KEY missing.
 */
export async function callClaude(env, args) {
    if (!env || !env.ANTHROPIC_API_KEY) {
        throw new AnthropicError(
            "ANTHROPIC_API_KEY env secret not configured",
            500,
            null
        );
    }
    const model = args.model || DEFAULT_MODEL;
    const body = {
        model,
        max_tokens: args.max_tokens || 1024,
        system: args.system || "",
        messages: args.messages || [],
    };
    // The Opus 4.7/4.8 family REJECTS sampling parameters (temperature/top_p/
    // top_k) with a 400. Only attach them for models that accept them, so a
    // caller can pin BILLING_AI_MODEL=claude-opus-4-8 (or any Opus 4.x) and
    // every call still succeeds. Non-Opus models keep deterministic temp 0
    // (or the caller's override) exactly as before.
    if (!modelRejectsSamplingParams(model)) {
        body.temperature = args.temperature ?? 0;
        if (args.top_p != null) body.top_p = args.top_p;
        if (args.top_k != null) body.top_k = args.top_k;
    }
    const t0 = Date.now();
    let res;
    try {
        res = await fetch(ANTHROPIC_ENDPOINT, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-api-key": env.ANTHROPIC_API_KEY,
                "anthropic-version": ANTHROPIC_VERSION,
            },
            body: JSON.stringify(body),
        });
    } catch (e) {
        const latency_ms = Date.now() - t0;
        console.error("anthropic.callClaude fetch threw", {
            module: "_lib/anthropic",
            op: "callClaude",
            error: String(e && e.message ? e.message : e),
            latency_ms,
        });
        throw new AnthropicError("network_error", 0, null);
    }
    const latency_ms = Date.now() - t0;
    const rawText = await res.text();
    let parsed;
    try { parsed = JSON.parse(rawText); } catch { parsed = null; }

    // Log every request per §3.6 + §4.4. Never log the API key.
    console.log("anthropic.callClaude", {
        url: ANTHROPIC_ENDPOINT,
        model: body.model,
        status: res.status,
        latency_ms,
        input_tokens: parsed?.usage?.input_tokens || null,
        output_tokens: parsed?.usage?.output_tokens || null,
        stop_reason: parsed?.stop_reason || null,
    });

    if (!res.ok) {
        throw new AnthropicError(
            `anthropic_${res.status}`,
            res.status,
            parsed || rawText
        );
    }

    // Concatenate text content blocks; ignore other block types (tool_use, etc.)
    const text = (parsed?.content || [])
        .filter(c => c?.type === "text")
        .map(c => c.text || "")
        .join("");

    return {
        text,
        raw: parsed,
        usage: parsed?.usage || {},
        latency_ms,
    };
}

/**
 * Extract the first balanced JSON object/array from a model response.
 * Claude is instructed to emit raw JSON, but defensively strips ```json
 * fences and any prose preamble/suffix so a stray sentence can't break
 * JSON.parse. Returns the parsed value, or null if nothing parseable.
 *
 * Shared by every JSON-shape-enforced AI feature (advisor, pre-flight
 * reviewer, appeal drafter) so they parse identically.
 */
export function extractJson(text) {
    if (!text || typeof text !== "string") return null;
    let s = text.trim();
    // strip ```json … ``` or ``` … ``` fences if present
    const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fence) s = fence[1].trim();
    // fast path
    try { return JSON.parse(s); } catch {}
    // find the first { or [ and scan to its balanced close (string-aware)
    const start = s.search(/[\[{]/);
    if (start < 0) return null;
    const open = s[start], close = open === "{" ? "}" : "]";
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < s.length; i++) {
        const ch = s[i];
        if (inStr) {
            if (esc) esc = false;
            else if (ch === "\\") esc = true;
            else if (ch === '"') inStr = false;
            continue;
        }
        if (ch === '"') inStr = true;
        else if (ch === open) depth++;
        else if (ch === close) {
            depth--;
            if (depth === 0) {
                try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; }
            }
        }
    }
    return null;
}

export const ANTHROPIC = {
    ENDPOINT: ANTHROPIC_ENDPOINT,
    VERSION: ANTHROPIC_VERSION,
    DEFAULT_MODEL,
};
