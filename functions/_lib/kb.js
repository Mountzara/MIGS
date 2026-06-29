// =====================================================================
// functions/_lib/kb.js — reusable KB grounding seam (RAG, D1 full-text)
// =====================================================================
// Any backend Claude process grounds itself in one call:
//
//   import { retrieveKB } from "../_lib/kb.js";
//   const { context, citations } = await retrieveKB(env, { query: topicText });
//   // prepend `context` to the Claude system/user prompt; cite `citations`.
//
// Backed by the `kb_docs` FTS5 table in the mountzara-clinical D1 (see
// schema/0026_kb_fts.sql + scripts/kb_load_d1.py — 823 OB/GYN reference docs
// from ACOG / FMIGS / UpToDate / AAGL). Reference knowledge, NOT PHI.
//
// Storage-agnostic by design: the retrieveKB() signature is the seam. To move
// to semantic search later (Cloudflare Vectorize), swap the body of
// `searchKB()` only — every caller stays unchanged.
// =====================================================================

const STOP = new Set([
    "the","and","for","with","that","this","from","are","was","you","your","not",
    "but","has","have","get","make","into","about","what","when","which","while",
    "their","there","other","than","then","them","these","those","over","under",
    "patient","patients","clinical","clearer","summary","title","please","content",
]);

/// Convert free text into a safe FTS5 MATCH expression (OR of significant terms).
export function toFtsQuery(text, maxTerms = 14) {
    const seen = new Set();
    const terms = [];
    for (const raw of String(text || "").toLowerCase().split(/[^a-z0-9]+/)) {
        if (raw.length < 3 || STOP.has(raw) || seen.has(raw)) continue;
        seen.add(raw);
        terms.push(`"${raw}"`);
        if (terms.length >= maxTerms) break;
    }
    return terms.join(" OR ");
}

/// Low-level search → ordered hits. Swap this body for Vectorize later.
async function searchKB(env, query, topK) {
    const match = toFtsQuery(query);
    if (!match || !env.DB) return [];
    try {
        const res = await env.DB.prepare(
            `SELECT doc_id, source, title,
                    snippet(kb_docs, 3, '', '', ' … ', 38) AS excerpt
               FROM kb_docs
              WHERE kb_docs MATCH ?
              ORDER BY rank
              LIMIT ?`
        ).bind(match, topK).all();
        return res?.results || [];
    } catch (e) {
        console.error("kb.searchKB failed", { module: "_lib/kb", error: String(e?.message || e) });
        return [];
    }
}

/**
 * Retrieve KB context for grounding a Claude prompt.
 * @returns {Promise<{chunks: Array, context: string, citations: Array}>}
 *   - context: a capped, citation-tagged block ready to paste into a prompt
 *   - citations: [{ doc_id, source, title }] for surfacing provenance
 * Always resolves (never throws) — grounding is best-effort.
 */
export async function retrieveKB(env, { query, topK = 6, maxChars = 4000 } = {}) {
    const hits = await searchKB(env, query, topK);
    const chunks = hits.map(h => ({
        doc_id: h.doc_id,
        source: h.source || "KB",
        title: h.title || "",
        excerpt: (h.excerpt || "").trim(),
    }));

    let context = "";
    const citations = [];
    for (const c of chunks) {
        if (!c.excerpt) continue;
        const cite = `[${c.source}${c.title ? " — " + c.title : ""}]`;
        const block = `${cite}\n${c.excerpt}\n\n`;
        if (context.length + block.length > maxChars) break;
        context += block;
        citations.push({ doc_id: c.doc_id, source: c.source, title: c.title });
    }
    return { chunks, context: context.trim(), citations };
}
