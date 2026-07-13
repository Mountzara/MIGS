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
    // The deep-dive modals have their OWN canonical grammar. W23/W24 shipped
    // modals in a `deepdive-modal`/`dd-*` grammar (dd-section, dd-body, dd-h3,
    // dd-title, glass-card) that the post's own inline <style> does NOT style
    // — it only styles the mz-jc-* grammar W20/W21 use. Result: the cards look
    // fine but every OPENED deep dive renders as unstyled raw HTML (the "garbage"
    // the operator reported 2026-07-05). Detect the stale modal grammar
    // independently of the card grammar — a post can have canonical cards and
    // still-broken modals.
    const ddSections = (h.match(/class="dd-(?:section|body|h3|title|eyebrow|citation)\b/g) || []).length;
    if (paperCards > 0) {
        problems.push(`body_html uses the stripped "paper-card" auto-draft format (${paperCards} occurrence(s)) — the canonical renderer emits mz-cite-card. Re-render with the cite-card path before publishing.`);
    }
    if (citeCards === 0 && h.length > 0) {
        problems.push(`body_html contains no mz-cite-card markup — every canonical post (W20, W21, all published evidence briefs) carries mz-cite-card cards.`);
    }
    if (ddSections > 0) {
        problems.push(`deep-dive modals use the unstyled "dd-*"/deepdive-modal grammar (${ddSections} occurrence(s)) — the post's inline CSS only styles the mz-jc-* modal grammar (W20/W21), so these modals render UNSTYLED when opened. Convert with healDeepDiveModals before publishing.`);
    }
    // EDITORIAL ARCHITECTURE (2026-07-05): W20/W21 are full "Monday Mornings"
    // editorial briefs — a hero lede, a cross-topic narrative, a bottom-line-
    // up-front, a "what's established" section, a Five Picks feature, a DO+CBG/
    // MIGS lens essay, a gaps section, a closing, a TOC, a shape-of-evidence
    // chart, per-topic synthesis paragraphs, and a references list. W23/W24
    // shipped as a BARE card directory (hero + counters + topic grids only) —
    // none of the editorial writing that defines the format. The cards being
    // "canonical" masked that the POST was a stripped shell. Require the
    // editorial spine so a directory-only post can never publish again. Only
    // enforced on non-trivial briefs (a post with cards); a would-be brief with
    // zero cards already fails above. Only enforced on the WEEKLY ROUNDUP
    // briefs (CBG/MIGS Monday Mornings), NOT the single-topic trend briefs
    // (evidence-2026-05-19-*), which are a different, legitimately simpler
    // format. A roundup is identified by carrying multiple topic sections
    // (>= 2 mz-topic-group OR topic-section blocks) or the Monday-Mornings
    // masthead — the exact things a single-topic trend brief never has.
    const topicSections = (h.match(/class="(?:mz-topic-group|topic-section)\b/g) || []).length;
    const isWeeklyRoundup = topicSections >= 2 || /Monday Mornings/.test(h);
    if (citeCards > 0 && isWeeklyRoundup) {
        // Feature-level requirements, each satisfied by EITHER the W21-era
        // (mz-post-*) OR the W20-era vocabulary — both are "proper" briefs
        // with different section class names. The four features below are the
        // common denominator present in every proper roundup (W20, W21, and
        // the rebuilt W23/W24) and ABSENT from the stripped cards-only briefs
        // (which had only a hero + counters + topic-section grids). Matching on
        // features, not exact W21 class names, avoids false-flagging W20.
        const REQUIRED = [
            [/mz-(?:post-)?narrative/, "an editorial narrative section"],
            [/mz-five-pick/, "the Five Picks feature"],
            [/mz-topic-group/, "per-topic synthesis groups (mz-topic-group)"],
            [/mz-references-list/, "the references list"],
        ];
        const missing = REQUIRED.filter(([re]) => !re.test(h)).map(([, label]) => label);
        if (missing.length) {
            problems.push(`body_html is missing the Monday-Mornings editorial architecture (${missing.join("; ")}) — every canonical brief (W20, W21) carries the full editorial spine, not just a directory of cards. A stripped, cards-only post must not publish.`);
        }
    }
    if (h.length === 0) {
        problems.push("body_html is empty.");
    }
    return { canonical: problems.length === 0, problems, checked_at: new Date().toISOString() };
}

// ---------------------------------------------------------------------
// Numeric-fidelity audit (2026-07-06). Every decimal EFFECT ESTIMATE
// (single-digit d.dd — the shape of an OR / RR / HR / AUC / CI bound)
// presented inside a modal's Key-Findings / effects section MUST be
// traceable to that same modal's own EMBEDDED verbatim PubMed abstract
// (`mz-jc-abstract-body`): either a literal match, or within a 2-decimal
// rounding tolerance (|abstract − value| ≤ 0.006, so the abstract's 3-decimal
// 1.885 legitimately renders as 1.89). This catches a generator misextraction
// or an authored fabrication BEFORE it publishes — the failure mode surfaced
// during the 2026-07-05 trust audit — while tolerating faithful rounding.
//
// Deterministic + fully offline: the verbatim abstract lives in the modal, so
// no PubMed call is needed at gate time. Scope = decimals of the form \d\.\d\d
// (values < 10, which excludes DOIs like 10.3389 and integer years) inside the
// findings/effects sections only. A modal with no embedded abstract is skipped
// (nothing to check against) rather than failed.
// ---------------------------------------------------------------------
export function auditNumericFidelity(post) {
    const problems = [];
    if (post.kind !== "blog" && post.kind !== "evidence") return { ok: true, problems };
    const h = typeof post.body_html === "string" ? post.body_html : "";
    const dialogRe = /<dialog[^>]*\bid="dd-(\d+)"[^>]*>([\s\S]*?)<\/dialog>/g;
    let m;
    while ((m = dialogRe.exec(h)) !== null) {
        const pmid = m[1], modal = m[2];
        const abM = modal.match(/<div class="mz-jc-abstract-body">([\s\S]*?)<\/div>/);
        if (!abM) continue; // no embedded abstract — cannot verify, skip
        const abNums = (visibleText(abM[1]).match(/\d+\.\d+/g) || []).map(Number);
        const secRe = /<section[^>]*\bid="dd-\d+-(?:findings|effects)"[^>]*>([\s\S]*?)<\/section>/g;
        let s;
        while ((s = secRe.exec(modal)) !== null) {
            const decs = new Set(visibleText(s[1]).match(/\b\d\.\d{2}\b/g) || []);
            for (const d of decs) {
                const dv = Number(d);
                if (!abNums.some((a) => Math.abs(a - dv) <= 0.006)) {
                    problems.push(`modal dd-${pmid}: effect estimate "${d}" in the Key-Findings section is not traceable to the modal's own verbatim abstract (no literal or rounded match) — an unverifiable effect number must not be presented as a finding.`);
                }
            }
        }
    }
    return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------
// Abstract-completeness audit (2026-07-06). Each modal embeds a "verbatim
// from PubMed" abstract (mz-jc-abstract-body). The generator sometimes kept
// only a TRAILING AbstractText block of a STRUCTURED abstract — dropping the
// opening sections (Background / Objective / Introduction / Methods / Patient
// Concerns / Rationale) — so the modal presented a truncated abstract as
// verbatim (surfaced by the 2026-07-06 corpus audit: 4 W21 case-report /
// structured abstracts). Deterministic OFFLINE signal: the FIRST
// mz-jc-abstract-label inside a modal must be an opening label (or the generic
// "Abstract") — never a mid-structure section, which can only appear first if
// the sections before it were dropped.
// ---------------------------------------------------------------------
const MID_STRUCTURE_LABEL = /^(interventions?|outcomes?|results?|conclusions?|lessons?|discussion|main results|findings|key ?messages)$/i;
export function auditAbstractCompleteness(post) {
    const problems = [];
    if (post.kind !== "blog" && post.kind !== "evidence") return { ok: true, problems };
    const h = typeof post.body_html === "string" ? post.body_html : "";
    const dialogRe = /<dialog[^>]*\bid="dd-(\d+)"[^>]*>([\s\S]*?)<\/dialog>/g;
    let m;
    while ((m = dialogRe.exec(h)) !== null) {
        const pmid = m[1], modal = m[2];
        const first = (modal.match(/<h5 class="mz-jc-abstract-label">([^<]*)<\/h5>/) || [])[1];
        if (first && MID_STRUCTURE_LABEL.test(first.trim())) {
            problems.push(`modal dd-${pmid}: the "verbatim" abstract starts with the mid-structure label "${first.trim()}" — its opening sections (Background/Objective/Methods/Patient Concerns) were truncated. Re-embed the COMPLETE PubMed abstract.`);
        }
    }
    return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------
// AUTHORITATIVE PUBLISH GATE (2026-07-06). The single "may this post go live"
// check — combines the STRUCTURAL canonical audit with the three content-
// fidelity audits (effect-estimate accuracy, verbatim-abstract completeness,
// adequate citation-popover summaries). Every code path that flips a post to
// `published` — the pipeline "publish immediately" flag, the /approve gate,
// and the stale→canonical format-heal re-publish — routes through this, so a
// scheduled auto-post that fails ANY criterion is held as a draft and can
// never reach the public. `.canonical` is still exposed for the auto-heal
// decision (its contract is structure only). Deterministic + offline.
// ---------------------------------------------------------------------
export function auditPublishable(post) {
    const fmt = auditPostFormat(post);
    const checks = [fmt, auditNumericFidelity(post), auditAbstractCompleteness(post), auditPopoverSummaries(post), auditSummaryDuplication(post)];
    const problems = checks.flatMap((c) => c.problems);
    return { publishable: problems.length === 0, canonical: fmt.canonical, problems, checked_at: new Date().toISOString() };
}

// ---------------------------------------------------------------------
// Summary-duplication audit (2026-07-06). Each study card carries a
// `mz-cite-fits` "DO + CBG/MIGS lens" line. In W20/W21 (the standard) these
// are paper-specific; the regressed W23/W24 pipeline stamped ONE canned,
// essay-length per-topic paragraph verbatim onto up to 13 different papers —
// so a reader saw the identical "Infertility is rarely just an organ failing…"
// block on every infertility paper. That reads as fake per-paper insight.
// Rule (calibrated against the live corpus: W20/W21 = 0, W23 = 13, W24 = 4):
// an essay-length lens line (≥ 200 chars) must not appear on more than one
// card. Short honest category tags (W21's "Where it fits: Evidence on X — see
// abstract", ≤ 141 chars) legitimately repeat and are below the threshold, so
// they never trip this. The auto-heal cannot synthesize grounded per-paper
// prose, so a tripping post is held as a non-publishable draft for
// regeneration. Deterministic + offline.
// ---------------------------------------------------------------------
export function auditSummaryDuplication(post) {
    const problems = [];
    if (post.kind !== "blog" && post.kind !== "evidence") return { ok: true, problems };
    const h = typeof post.body_html === "string" ? post.body_html : "";
    const counts = new Map();
    const re = /<p class="mz-cite-fits"[^>]*>([\s\S]*?)<\/p>/g;
    let m;
    while ((m = re.exec(h)) !== null) {
        const text = visibleText(m[1]);
        if (text.length < 200) continue; // only essay-length lens summaries; short category tags may repeat
        counts.set(text, (counts.get(text) || 0) + 1);
    }
    for (const [text, n] of counts) {
        if (n >= 2) {
            problems.push(`the ${text.length}-char card lens summary is copy-pasted verbatim across ${n} different papers — each paper needs its own grounded summary (starts: "${text.slice(0, 70)}…").`);
        }
    }
    return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------
// Popover-summary audit (2026-07-06). Each inline citation carries a hover
// popover whose `mz-ref-pop-finding` field must be an ADEQUATE plain-language
// summary of the paper's finding (the W20/W21 standard), NOT a raw dump of the
// abstract's opening sentence. The 2026-07-06 audit found ~106 W23/W24
// popovers whose finding field was the truncated abstract opening — it starts
// with a structured-abstract section label (RATIONALE:/INTRODUCTION:/…), which
// a real summary never does. Each was replaced with the paper's own modal
// Bottom-line (already grounded + numeric-gated). Deterministic + offline:
// flag any finding that (a) starts with a structured-abstract label or (b) is
// too short to be a real summary (< 60 chars).
// ---------------------------------------------------------------------
const RAW_ABSTRACT_LABEL = /^\s*(rationale|background|objectives?|introduction|methods?|materials?|purpose|aims?|importance|context|setting|design|participants)\b\s*[:\-–]/i;
export function auditPopoverSummaries(post) {
    const problems = [];
    if (post.kind !== "blog" && post.kind !== "evidence") return { ok: true, problems };
    const h = typeof post.body_html === "string" ? post.body_html : "";
    const re = /id="ref-pop-(\d+)"[\s\S]*?<span class="mz-ref-pop-finding">([^<]*)<\/span>/g;
    let m;
    const seen = new Set();
    while ((m = re.exec(h)) !== null) {
        const pmid = m[1];
        if (seen.has(pmid)) continue; // one report per paper
        const finding = decodeEntities(m[2]).trim();
        if (RAW_ABSTRACT_LABEL.test(finding)) {
            seen.add(pmid);
            problems.push(`popover ref-pop-${pmid}: the citation summary is a raw abstract dump (starts "${finding.slice(0, 24)}…") — replace with an adequate plain-language finding (the paper's modal Bottom-line).`);
        } else if (finding.length > 0 && finding.length < 25) {
            // Empty/near-empty only. The floor sits BELOW the W20/W21
            // reference-standard minimum (53 chars) so a legitimately concise
            // foundational-citation descriptor is never flagged — the real
            // defect this gate targets is the raw-abstract-dump above.
            seen.add(pmid);
            problems.push(`popover ref-pop-${pmid}: the citation summary is only ${finding.length} chars — effectively empty.`);
        }
    }
    return { ok: problems.length === 0, problems };
}
function decodeEntities(s) {
    return String(s || "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
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

// ---------------------------------------------------------------------
// Deep-dive modal heal — convert the unstyled `deepdive-modal`/`dd-*`
// grammar (W23/W24) to the `mz-jc-*` grammar the post's own inline CSS
// styles. Unlike the card heal this needs NO reference post: every target
// class is already present in the post's <style> (the W23/W24 stylesheets
// carry the full mz-jc-* modal CSS — the markup just never used it). The
// transform is a deterministic class-rename + a flat dd-body unwrap
// (verified: no dd-body ever nests a <div>). Lossless post-conditions
// mirror the card heal: no dd-* left, PMID multiset + modal-id set + each
// modal's visible-text word-multiset preserved, or the heal REFUSES.
// ---------------------------------------------------------------------
function convertDeepDiveModal(modal) {
    let s = modal;
    s = s.replace('<div class="glass-card">', '<div class="mz-jc-modal-inner">');
    s = s.replace('class="modal-close"', 'class="mz-jc-close"');
    // header: eyebrow + title + citation → mz-jc-modal-header (dd-eyebrow /
    // dd-citation carry no nested tags/divs, so non-greedy .*? is safe)
    s = s.replace(/<div class="dd-eyebrow">([\s\S]*?)<\/div>/,
        '<header class="mz-jc-modal-header"><p class="mz-jc-modal-eyebrow">$1</p>');
    s = s.replace('<h2 class="dd-title"', '<h2 class="mz-jc-modal-title"');
    s = s.replace(/<div class="dd-citation">([\s\S]*?)<\/div>/,
        '<p class="mz-jc-modal-meta">$1</p></header>');
    // verbatim abstract → mz-jc-abstract-body (do BEFORE the generic unwrap)
    s = s.replace(/<div class="dd-body"><p class="dd-verbatim-abstract">([\s\S]*?)<\/p><\/div>/,
        '<div class="mz-jc-abstract-body"><h5 class="mz-jc-abstract-label">Abstract</h5>' +
        '<p>$1</p></div><p class="mz-jc-abstract-note">Reproduced verbatim from PubMed.</p>');
    // sections + headings
    s = s.replace(/<section class="dd-section[^"]*"/g, '<section class="mz-jc-section"');
    s = s.replace(/<h3 class="dd-h3">/g, "<h3>");
    // unwrap remaining flat dd-body wrappers
    s = s.replace(/<div class="dd-body">([\s\S]*?)<\/div>/g, "$1");
    // minor inline classes
    s = s.replace(/<span class="dd-pill[^"]*">/g, '<span class="mz-jc-pending-tag">');
    s = s.replace(/ class="dd-link"/g, "");
    return s;
}

function wordCounts(text) {
    const m = {};
    for (const w of String(text || "").match(/\w+/g) || []) m[w] = (m[w] || 0) + 1;
    return m;
}

/**
 * Heal deep-dive modals from the dd- / deepdive-modal grammar to mz-jc-*.
 * @returns {{ok:boolean, healed:string|null, problems:string[]}}
 */
export function healDeepDiveModals(bodyHtml) {
    const src = String(bodyHtml || "");
    const problems = [];
    const dialogRe = /<dialog\b[^>]*\bdeepdive-modal\b[^>]*>[\s\S]*?<\/dialog>/g;
    const matches = src.match(dialogRe);
    if (!matches || matches.length === 0) {
        return { ok: false, healed: null, problems: ["no deepdive-modal modals to heal"] };
    }
    // Guard the flat-unwrap assumption: no dd-body may contain a nested <div>.
    for (const dlg of matches) {
        const bodies = dlg.match(/<div class="dd-body">([\s\S]*?)<\/div>/g) || [];
        if (bodies.some((b) => b.slice('<div class="dd-body">'.length).includes("<div"))) {
            return { ok: false, healed: null, problems: ["a dd-body wraps a nested <div> — flat unwrap unsafe, refusing heal"] };
        }
    }
    const h = src.replace(dialogRe, (m) => convertDeepDiveModal(m));

    // ---- POST-CONDITIONS: provably lossless, or refuse ----
    if (/class="dd-(?:section|body|h3|title|eyebrow|citation)\b/.test(h)) {
        problems.push("healed output still contains dd-* modal classes");
    }
    // PMID multiset preserved
    const pmA = (src.match(/pubmed\.ncbi\.nlm\.nih\.gov\/\d+/g) || []).sort();
    const pmB = (h.match(/pubmed\.ncbi\.nlm\.nih\.gov\/\d+/g) || []).sort();
    if (pmA.length !== pmB.length || pmA.some((v, i) => v !== pmB[i])) {
        problems.push(`PMID multiset changed during modal heal (${pmA.length}→${pmB.length})`);
    }
    // modal id set preserved
    if (!setEq(modalIds(src), modalIds(h))) problems.push("deep-dive modal ids changed during modal heal");
    // per-modal visible-text word-multiset preserved (tolerate the injected
    // "Abstract" label + verbatim note we add to the abstract section)
    {
        const grab = (html) => {
            const map = {};
            const re = /<dialog[^>]*id="(dd-\d+)"[^>]*>([\s\S]*?)<\/dialog>/g;
            let mm;
            while ((mm = re.exec(html)) !== null) map[mm[1]] = visibleText(mm[2]);
            return map;
        };
        const A = grab(src), B = grab(h);
        for (const id of Object.keys(A)) {
            const ca = wordCounts(A[id]);
            const cb = wordCounts(B[id] || "");
            let dropped = null;
            for (const w of Object.keys(ca)) {
                if ((cb[w] || 0) < ca[w]) { dropped = w; break; }
            }
            if (dropped) { problems.push(`modal ${id}: word "${dropped}" lost during heal`); break; }
        }
    }
    if (h.length < src.length * 0.7) problems.push("modal-healed output implausibly small vs input");
    if (problems.length) return { ok: false, healed: null, problems };
    return { ok: true, healed: h, problems: [] };
}

/**
 * Orchestrate every heal a post may need, in order. Card heal (needs the
 * reference post's <style>/<script>) then modal heal (self-contained).
 * Returns the combined result; refuses (ok:false) if any needed heal
 * refuses, so a partially-healed body is never emitted.
 * @returns {{ok:boolean, healed:string|null, problems:string[], steps:string[]}}
 */
export function healPost(bodyHtml, refBodyHtml) {
    let h = String(bodyHtml || "");
    const steps = [];
    if (/paper-card/.test(h)) {
        const r = healPaperCardPost(h, refBodyHtml);
        if (!r.ok) return { ok: false, healed: null, problems: r.problems, steps };
        h = r.healed; steps.push("paper-card");
    }
    if (/\bdeepdive-modal\b/.test(h) && /class="dd-(?:section|body|h3)\b/.test(h)) {
        const r = healDeepDiveModals(h);
        if (!r.ok) return { ok: false, healed: null, problems: r.problems, steps };
        h = r.healed; steps.push("deepdive-modal");
    }
    if (!steps.length) return { ok: false, healed: null, problems: ["nothing to heal"], steps };
    return { ok: true, healed: h, problems: [], steps };
}

// =====================================================================
// CONTENT-FIDELITY AUTO-REPAIR (2026-07-06) — make a substandard auto-post
// PUBLISHABLE where a ground truth exists. Two repairs, both provably
// grounded (no fabricated clinical content):
//   * healPopoverSummaries — replace a raw-abstract-dump citation summary with
//     the paper's OWN modal Bottom-line (already in the post + numeric-gated).
//     Fully offline.
//   * healAbstractCompleteness — replace a truncated "verbatim" abstract with
//     the COMPLETE English abstract from PubMed (ground truth = PubMed). Needs
//     an injected async `fetchAbstract(pmid) -> [{label,text}]`.
// Neither invents a number: an untraceable effect estimate that survives (i.e.
// isn't in even the completed abstract) is left for the publish gate to hold
// as a draft — repairing what we can verify, refusing to guess where we can't.
// =====================================================================
function escapeHtml(s) {
    return String(s == null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function titleCase(s) {
    return String(s || "").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
function cleanBottomLine(t) {
    let s = decodeEntities(String(t || ""));
    s = s.replace(/^\s*Bottom line\s*/i, "");
    s = s.replace(/^[\s—\-–:]*(?:the\s+)?author'?s? own interpretation\s*/i, "");
    s = s.replace(/^[\s—\-–:]+/, "");
    return s.replace(/\s+/g, " ").trim();
}
function wordSet(s) { return new Set((String(s || "").toLowerCase().match(/[a-z0-9]+/g)) || []); }

/**
 * Offline. Replace every raw-abstract-dump citation popover summary with the
 * paper's own (cleaned) modal Bottom-line. @returns {ok, healed, changed, problems}
 */
export function healPopoverSummaries(bodyHtml) {
    let h = String(bodyHtml || "");
    const problems = [];
    const bl = {};
    const dRe = /<dialog[^>]*\bid="dd-(\d+)"[^>]*>([\s\S]*?)<\/dialog>/g;
    let dm;
    while ((dm = dRe.exec(h)) !== null) {
        const s = dm[2].match(/id="dd-\d+-bottom"[^>]*>([\s\S]*?)<\/section>/);
        if (!s) continue;
        const c = cleanBottomLine(visibleText(s[1]));
        if (c.length >= 80 && !RAW_ABSTRACT_LABEL.test(c)) bl[dm[1]] = c;
    }
    let changed = 0;
    h = h.replace(/(<span class="mz-ref-pop" id="ref-pop-(\d+)"[\s\S]*?<span class="mz-ref-pop-finding">)([^<]*)(<\/span>)/g,
        (full, pre, pmid, finding, post) => {
            if (!RAW_ABSTRACT_LABEL.test(decodeEntities(finding).trim())) return full;
            if (!bl[pmid]) { problems.push(`ref-pop-${pmid}: no adequate modal Bottom-line to source a summary — left for review`); return full; }
            changed++;
            return pre + escapeHtml(bl[pmid]) + post;
        });
    return { ok: true, healed: h, changed, problems };
}

/**
 * Network (fetcher injected). Replace a truncated "verbatim" abstract (first
 * label is mid-structure) with the COMPLETE English abstract from PubMed.
 * Lossless: the completed text must cover >=85% of the truncated text's words,
 * else the modal is left untouched. @returns {ok, healed, changed, fetched, problems}
 */
export async function healAbstractCompleteness(bodyHtml, fetchAbstract, opts = {}) {
    const maxFetch = opts.maxFetch || 30;
    let h = String(bodyHtml || "");
    const problems = [];
    let changed = 0, fetched = 0;
    const dialogs = [];
    const dRe = /<dialog[^>]*\bid="dd-(\d+)"[^>]*>[\s\S]*?<\/dialog>/g;
    let dm;
    while ((dm = dRe.exec(h)) !== null) dialogs.push({ pmid: dm[1], modal: dm[0] });
    for (const { pmid, modal } of dialogs) {
        const abM = modal.match(/<div class="mz-jc-abstract-body">([\s\S]*?)<\/div>/);
        if (!abM) continue;
        const first = (abM[1].match(/<h5 class="mz-jc-abstract-label">([^<]*)<\/h5>/) || [])[1];
        if (!first || !MID_STRUCTURE_LABEL.test(first.trim())) continue; // not truncated
        if (fetched >= maxFetch) { problems.push(`dd-${pmid}: abstract-completion fetch cap (${maxFetch}) reached`); continue; }
        fetched++;
        let blocks;
        try { blocks = await fetchAbstract(pmid); } catch (e) { problems.push(`dd-${pmid}: PubMed fetch failed (${String(e && e.message || e)})`); continue; }
        if (!blocks || !blocks.length) { problems.push(`dd-${pmid}: PubMed returned no abstract`); continue; }
        const full = blocks.map((b) => (b.label ? `<strong>${escapeHtml(titleCase(b.label))}:</strong> ` : "") + escapeHtml(b.text)).join(" ");
        // Coverage on VISIBLE text only — tokenizing raw HTML would count tag /
        // attribute words (h5, class, mz-jc-abstract-label) and wrongly depress it.
        const newSet = wordSet(visibleText(full));
        const oldWords = [...wordSet(visibleText(abM[1]))];
        const cov = oldWords.length ? oldWords.filter((w) => newSet.has(w)).length / oldWords.length : 1;
        if (cov < 0.85) { problems.push(`dd-${pmid}: fetched abstract covers only ${Math.round(cov * 100)}% of the embedded text — skipped (not lossless)`); continue; }
        const newBody = `<div class="mz-jc-abstract-body"><h5 class="mz-jc-abstract-label">Abstract</h5><p>${full}</p></div>`;
        const newModal = modal.replace(/<div class="mz-jc-abstract-body">[\s\S]*?<\/div>/, newBody);
        // guard: nothing outside the abstract-body block changed
        const strip = (x) => x.replace(/<div class="mz-jc-abstract-body">[\s\S]*?<\/div>/, "");
        if (strip(modal) !== strip(newModal)) { problems.push(`dd-${pmid}: non-abstract content would change — skipped`); continue; }
        h = h.replace(modal, newModal);
        changed++;
    }
    return { ok: true, healed: h, changed, fetched, problems };
}

export default { auditPostFormat, auditPublishable, auditNumericFidelity, auditAbstractCompleteness, auditPopoverSummaries, auditSummaryDuplication, healPaperCardPost, healDeepDiveModals, healPost, healPopoverSummaries, healAbstractCompleteness, extractStyleScript };
