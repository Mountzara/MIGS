// =====================================================================
// functions/_lib/anthropic.js — thin Anthropic Messages API wrapper
// =====================================================================
// Per CLAUDE.md §3.6 (Validated-API-Only). Centralizes:
//   * the api.anthropic.com endpoint
//   * the anthropic-version header (pinned)
//   * env.ANTHROPIC_API_KEY read
//   * structured logging of request URL + status + duration
//
// PHI safety (§4.2 + §11.4 BAA-ledger): Anthropic does NOT offer a BAA.
// Callers MUST de-identify any patient data before passing it as
// messages. This wrapper does not enforce that — it is the caller's
// responsibility. See functions/_lib/intake_triage.js for the canonical
// de-identification path used by AI triage.
// =====================================================================

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
// Pinned model — Claude Sonnet 4.6 is the production triage model. Bump
// only after re-benchmarking the triage prompt against a held-out intake
// set. Model string per Anthropic's published list: `claude-sonnet-4-6`.
const DEFAULT_MODEL = "claude-sonnet-4-6";

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
    const body = {
        model: args.model || DEFAULT_MODEL,
        max_tokens: args.max_tokens || 1024,
        temperature: args.temperature ?? 0,
        system: args.system || "",
        messages: args.messages || [],
    };
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

export const ANTHROPIC = {
    ENDPOINT: ANTHROPIC_ENDPOINT,
    VERSION: ANTHROPIC_VERSION,
    DEFAULT_MODEL,
};
