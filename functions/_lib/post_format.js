// =====================================================================
// functions/_lib/post_format.js — canonical post-format audit + AUTO-HEAL
// =====================================================================
// The single source of truth for "what is a canonical post" and for the
// server-side repair of the stale "paper-card" auto-draft format.
//
// WHY THIS EXISTS (2026-07-02): the MountZaraResearchDigest pipeline
// regressed on 2026-05-26 and began emitting weekly posts in a stripped
// paper-card scaffold. That stale format reached the public site TWICE
// (W23/W24) because nothing server-side ever inspected body_html, and a
// third post (W25) sat unnoticed as a draft. The format gate alone only
// BLOCKS stale posts — they pile up unpublishable. This module goes the
// last mile: any stale-format post is CONVERTED to canonical at the
// ingestion choke point, so every post that lands is publishable in the
// same format as W20/W21, with zero dependence on the Mac generator
// being fixed or a human noticing.
//
// SAFETY MODEL — the heal must be provably lossless or it does not
// apply. After conversion we verify, per post:
//   * canonical markers   (mz-cite-card > 0, paper-card == 0)
//   * every deep-dive modal id (dd-<PMID>) preserved exactly
//   * every PMID (PubMed links + openDeepDive triggers) preserved
//   * output is not implausibly small vs input
// If ANY check fails, the original body is kept, the format audit fails,
// and the /approve gate blocks publication exactly as before. The system
// can therefore never be made WORSE by the healer — it either provably
// succeeds or degrades to the block-and-warn behavior.
//
// The canonical <style> + openDeepDive <script> are taken verbatim from
// a known-good reference post read from R2 at heal time (default
// blog-2026-W21, override with env.CANONICAL_REFERENCE_POST).
// =====================================================================

// ---------------------------------------------------------------------
// Format audit — the rule is derived from the live corpus, not taste:
// canonical (W20, W21, every published evidence brief) = mz-cite-card>0
// AND paper-card==0; stale (W23/W24/W25 as shipped) = the exact inverse.
// ---------------------------------------------------------------------
export function auditPostFormat(post) {
    const problems = [];
    if (post.kind !== "blog" && post.kind !== "evidence") {
        return { canonical: true, problems, checked_at: new Date().toISOString() };
    }
    const h = typeof post.body_html === "string" ? post.body_html : "";
    const paperCards = (h.match(/paper-card/g) || []).length;
    const citeCards = (h.match(/mz-cite-card/g) || []).length;
    if (paperCards > 0) {
        problems.push(`body_html uses the stripped "paper-card" auto-draft format (${paperCards} occurrence(s)) — the canonical renderer emits mz-cite-card. Re-render with the cite-card path before publishing.`);
    }
    if (citeCards === 0 && h.length > 0) {
        problems.push(`body_html contains no mz-cite-card markup — every canonical post (W20, W21, all published evidence briefs) carries mz-cite-card cards.`);
    }
    if (h.length === 0) {
        problems.push("body_html is empty.");
    }
    return { canonical: problems.length === 0, problems, checked_at: new Date().toISOString() };
}

// ---------------------------------------------------------------------
// Lossless-ness fingerprints
// ---------------------------------------------------------------------
function modalIds(h) {
    const s = new Set();
    let m; const re = /<dialog[^>]*\bid="(dd-\d+)"/g;
    while ((m = re.exec(h)) !== null) s.add(m[1]);
    return s;
}
function pmids(h) {
    const s = new Set();
    let m;
    const re1 = /pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/g;
    while ((m = re1.exec(h)) !== null) s.add(m[1]);
    const re2 = /openDeepDive\('dd-(\d+)'/g;
    while ((m = re2.exec(h)) !== null) s.add(m[1]);
    return s;
}
function setEq(a, b) {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
}
function setSubset(a, b) {
    for (const v of a) if (!b.has(v)) return false;
    return true;
}

// Visible-text normalization for the content-preservation post-condition:
// strip tags, collapse whitespace. Entities are left as-is — fields are
// re-emitted verbatim, so both sides carry identical encoding.
function visibleText(html) {
    return String(html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------
// Reference extraction — the canonical <style> and <script> blocks.
// ---------------------------------------------------------------------
export function extractStyleScript(refBodyHtml) {
    const h = String(refBodyHtml || "");
    const s0 = h.indexOf("<style>"), s1 = h.indexOf("</style>");
    const c0 = h.lastIndexOf("<script>"), c1 = h.lastIndexOf("</script>");
    if (s0 < 0 || s1 < 0 || c0 < 0 || c1 < 0) return null;
    const style = h.slice(s0, s1 + "</style>".length);
    const script = h.slice(c0, c1 + "</script>".length);
    if (!script.includes("openDeepDive")) return null;
    return { style, script };
}

// ---------------------------------------------------------------------
// Stale card grammar → canonical mz-cite-card.
// The stale HTML is machine-generated and uniform; each field below is
// extracted against that exact grammar. Anything unextractable simply
// isn't emitted — and the lossless post-conditions decide acceptance.
// ---------------------------------------------------------------------
function esc(sv) { return String(sv); } // fields are re-emitted verbatim (already HTML)

function convertCard(cardHtml) {
    const pick = (re) => { const m = cardHtml.match(re); return m ? m[1].trim() : null; };
    const pmid = pick(/openDeepDive\('dd-(\d+)'/) || pick(/PMID\s+(\d{6,})/);
    const title = pick(/<h3 class="title">([\s\S]*?)<\/h3>/);
    const citation = pick(/<div class="citation">([\s\S]*?)<\/div>/);
    const lens = pick(/<p class="lens-text">([\s\S]*?)<\/p>/);
    const principle = pick(/<span class="[^"]*\blens-principle\b[^"]*">([\s\S]*?)<\/span>/);
    // Design line — carry EVERY badge's text (design/type AND sample-size),
    // joined, so no visible badge text is dropped (content-preservation).
    const badges = [];
    const badgeRe = /<span class="badge[^"]*">([\s\S]*?)<\/span>/g;
    let bm;
    while ((bm = badgeRe.exec(cardHtml)) !== null) {
        const t = bm[1].replace(/<[^>]*>/g, "").trim();
        if (t) badges.push(t);
    }
    const design = badges.length ? badges.join(" · ") : "Peer-reviewed study";
    // abstract blocks (h4 + p only inside — no nested divs in the grammar)
    const abs = [];
    const absRe = /<div class="abstract-block">([\s\S]*?)<\/div>/g;
    let am;
    while ((am = absRe.exec(cardHtml)) !== null) abs.push(am[1]);
    // forest-plot: a self-contained <div class="forest-plot">…<svg>…</svg></div>
    // carrying real effect-estimate data (AOR/CI). Carried VERBATIM; its CSS
    // is appended to the canonical <style> in healPaperCardPost so it renders.
    const forest = (cardHtml.match(/<div class="forest-plot">[\s\S]*?<\/svg>\s*<\/div>/) || [])[0] || null;

    let out = `<article class="mz-cite-card"${pmid ? ` id="mz-cite-${pmid}"` : ""}>`;
    out += `<div class="mz-cite-head"><span class="mz-cite-design">${esc(design)}</span></div>`;
    if (title) out += `<h3 class="mz-cite-title">${title}</h3>`;
    if (citation) out += `<p class="mz-cite-meta">${citation}</p>`;
    if (lens || principle) out += `<p class="mz-cite-fits"><strong>DO + CBG/MIGS lens${principle ? ` — ${principle}` : ""}: </strong>${lens || ""}</p>`;
    if (abs.length) out += `<details class="mz-abstract"><summary>Read the full abstract</summary>${abs.join("")}</details>`;
    if (forest) out += forest;
    out += `<div class="mz-cite-actions">`;
    if (pmid) {
        out += `<a class="mz-cite-pmid" href="https://pubmed.ncbi.nlm.nih.gov/${pmid}/" target="_blank" rel="noopener noreferrer">PubMed · PMID ${pmid} ↗</a>`;
        out += `<button class="mz-deepdive-trigger" type="button" onclick="openDeepDive('dd-${pmid}')" aria-haspopup="dialog" aria-controls="dd-${pmid}">Open deep dive · journal-club analysis</button>`;
    }
    out += `</div></article>`;
    return out;
}

// Remove a balanced <tag ...>…</tag> block starting at `start`. Returns
// the string with the block removed, or null if balance can't be found
// (caller then leaves the input untouched — post-conditions still guard).
function removeBalanced(h, start, tag) {
    const openRe = new RegExp(`<${tag}\\b`, "g");
    const closeRe = new RegExp(`</${tag}>`, "g");
    openRe.lastIndex = start + 1;
    closeRe.lastIndex = start + 1;
    let depth = 1, idx = start + 1;
    while (depth > 0) {
        const o = openRe.exec(h), c = closeRe.exec(h);
        if (!c) return null;
        if (o && o.index < c.index) { depth++; idx = o.index + 1; openRe.lastIndex = idx; closeRe.lastIndex = c.index; }
        else { depth--; idx = c.index + `</${tag}>`.length; openRe.lastIndex = idx; closeRe.lastIndex = idx; }
    }
    return h.slice(0, start) + h.slice(idx);
}

/**
 * Heal a stale paper-card body into canonical format.
 * @returns {{ok:boolean, healed:string|null, problems:string[]}}
 */
export function healPaperCardPost(bodyHtml, refBodyHtml) {
    const problems = [];
    const src = String(bodyHtml || "");
    const ref = extractStyleScript(refBodyHtml);
    if (!ref) return { ok: false, healed: null, problems: ["reference post missing a canonical <style>/<script> — cannot heal"] };
    if (!/paper-card/.test(src)) return { ok: false, healed: null, problems: ["body has no paper-card markup — nothing to heal"] };

    // 1) swap <style> — but PRESERVE the stale rules for the visualization
    //    classes that the canonical style doesn't cover (forest plots, the
    //    per-section counters/design-chart), so carried SVGs still render.
    //    These selectors are stale-specific and absent from canonical, so
    //    appending them cannot override any canonical rule.
    const VIZ_SELECTORS = ["forest-plot", "tick", "tick-line", "ref-line", "ci-line", "ci-cap",
        ".point", "row-label", "value-label", "axis-label", "counter", "design-chart"];
    const VIZ_CONTAINERS = ".forest-plot, .counters, .design-chart";
    let vizCss = "";
    {
        const st0 = src.indexOf("<style>"), st1 = src.indexOf("</style>");
        const staleStyle = st0 >= 0 && st1 > st0 ? src.slice(st0 + 7, st1) : "";
        // naive top-level rule split (selector { … }); good enough for the
        // machine-generated stylesheet (no nested @media around viz rules).
        const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
        let rm, rootVars = "";
        while ((rm = ruleRe.exec(staleStyle)) !== null) {
            const sel = rm[1].trim();
            if (/(^|,)\s*:root\s*$/.test(sel)) rootVars = rm[2];   // capture the stale palette vars
            else if (VIZ_SELECTORS.some((v) => sel.includes(v))) vizCss += `${sel}{${rm[2]}}\n`;
        }
        // The carried viz rules reference stale palette variables (--gray-4,
        // --accent-strong, --text-on-dark, …) that the canonical :root does
        // NOT define — without this, SVG fills fall back to black and vanish
        // on the dark bg (caught by headless render verification 2026-07-02).
        // Re-declare the stale vars SCOPED to the viz containers only, so they
        // resolve for descendants without overriding any canonical global.
        if (rootVars.trim() && vizCss) vizCss = `${VIZ_CONTAINERS} {${rootVars}}\n` + vizCss;
    }
    let h = src;
    const s0 = h.indexOf("<style>"), s1 = h.indexOf("</style>");
    const styleBlock = vizCss
        ? ref.style.replace("</style>", `\n/* carried viz CSS (forest plots / counters) */\n${vizCss}</style>`)
        : ref.style;
    if (s0 >= 0 && s1 > s0) h = h.slice(0, s0) + styleBlock + h.slice(s1 + "</style>".length);
    else h = styleBlock + h;

    // 2) drop redundant fixed scaffold if present (nav / cinematic intro)
    for (const [tag, marker] of [["nav", 'class="main-nav"'], ["div", 'class="cinematic-intro"'], ["div", 'class="progress-bar"']]) {
        let i;
        while ((i = h.indexOf(marker)) >= 0) {
            const start = h.lastIndexOf("<", i);
            const removed = removeBalanced(h, start, tag);
            if (removed === null) break;   // unbalanced — stop; post-conditions decide
            h = removed;
        }
    }

    // 3) convert every paper-card article
    h = h.replace(/<article class="paper-card">([\s\S]*?)<\/article>/g, (m) => convertCard(m));

    // 4) topic sections adopt the canonical section class
    h = h.replace(/<section class="topic-section([^"]*)"/g, '<section class="topic-section$1 mz-post-section"');

    // 5) wrap the content run (after </style>, before the first <dialog>)
    //    in the canonical .mz-post-wrap. NOTE: must test for the ELEMENT —
    //    the canonical <style> swapped in at step 1 contains the literal
    //    ".mz-post-wrap {" selector text, so a substring test is always
    //    true and would silently skip the wrap (caught by headless render
    //    verification 2026-07-02).
    const hasWrapEl = /<(div|main|article|section)\b[^>]*class="[^"]*\bmz-post-wrap\b/.test(h);
    if (!hasWrapEl) {
        const styleEnd = h.indexOf("</style>") + "</style>".length;
        let firstDialog = h.indexOf("<dialog");
        if (firstDialog < 0) firstDialog = h.length;
        h = h.slice(0, styleEnd)
            + '<div class="mz-post-wrap">' + h.slice(styleEnd, firstDialog) + "</div>"
            + h.slice(firstDialog);
    }

    // 6) replace all scripts with the canonical openDeepDive script
    h = h.replace(/<script>[\s\S]*?<\/script>/g, "");
    h = h + ref.script;

    // ---- POST-CONDITIONS: provably lossless & canonical, or refuse ----
    if ((h.match(/paper-card/g) || []).length !== 0) problems.push("healed output still contains paper-card markup");
    if ((h.match(/mz-cite-card/g) || []).length === 0) problems.push("healed output contains no mz-cite-card");
    if (!setEq(modalIds(src), modalIds(h))) problems.push("deep-dive modal ids changed during heal");
    if (!setSubset(pmids(src), pmids(h))) problems.push("PMIDs were lost during heal");
    if (h.length < src.length * 0.5) problems.push("healed output is implausibly small vs input");
    if (!h.includes("openDeepDive")) problems.push("healed output lost the deep-dive script");
    // CONTENT PRESERVATION (adversarial-review fix 2026-07-02): the modal-id
    // and PMID fingerprints alone would pass even if a card's VISIBLE prose
    // was silently dropped by a grammar variance in the field extractors.
    // This check is INDEPENDENT of the extractor grammar (so it can't share
    // their blind spots) and TEXT-NODE level (so the conversion's legitimate
    // REORDERING of fields doesn't matter — each node is checked on its own):
    // split each source card on tag boundaries, drop only the handful of
    // label strings the conversion intentionally rewrites (PubMed link, deep-
    // dive button, lens-badge caption), and require every remaining
    // substantive text node to appear verbatim in the healed output. Any
    // genuine drop fails the lookup and REFUSES the heal — degrading safely
    // to block-and-warn rather than ever silently losing clinical text.
    {
        // Scope: the visible text of ALL healed CARD bodies concatenated —
        // NOT the whole document. Excluding the deep-dive <dialog> modals
        // means a per-card field loss can't be masked by the same text
        // surviving in the (verbatim-preserved) modal. Using the union of
        // cards (rather than a 1:1 PMID→card map) tolerates the real case of
        // one paper cited under two topic sections (duplicate mz-cite ids).
        let healedCardsText = "";
        const hcRe = /<article class="mz-cite-card"[^>]*>([\s\S]*?)<\/article>/g;
        let hc;
        while ((hc = hcRe.exec(h)) !== null) healedCardsText += " " + visibleText(hc[1]);
        // Substrings identifying the nodes the conversion rewrites/removes.
        const REWRITTEN = ["view on pubmed", "open deep dive", "reading from a do", "read the abstract", "read the full abstract"];
        const cardRe = /<article class="paper-card">([\s\S]*?)<\/article>/g;
        let cm, cardNo = 0;
        while ((cm = cardRe.exec(src)) !== null) {
            cardNo++;
            const cardPmid = (cm[0].match(/openDeepDive\('dd-(\d+)'/) || cm[0].match(/PMID\s+(\d{6,})/) || [])[1];
            const nodes = cm[0].split(/<[^>]*>/).map((t) => t.replace(/\s+/g, " ").trim());
            for (const node of nodes) {
                if (node.length < 20) continue;                    // skip labels/badges/tiny bits
                const low = node.toLowerCase();
                if (REWRITTEN.some((r) => low.includes(r))) continue; // intentionally rewritten scaffold
                if (!healedCardsText.includes(node)) {
                    problems.push(`card ${cardNo}${cardPmid ? " (PMID " + cardPmid + ")" : ""}: visible text missing from healed cards: "${node.slice(0, 80)}…"`);
                    break;   // one problem per card is enough to refuse
                }
            }
        }
    }
    if (problems.length) return { ok: false, healed: null, problems };
    return { ok: true, healed: h, problems: [] };
}

export default { auditPostFormat, healPaperCardPost, extractStyleScript };
