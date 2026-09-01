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
        // Feature-level requirements. CRITICAL (2026-07-15): match real ELEMENTS
        // via `class="…<feature>…"`, NOT a bare substring — the inline <style>
        // block defines `.mz-topic-group`, `.mz-five-pick`, `.mz-post-narrative`
        // etc., so a bare-substring test passes on the CSS ALONE even when the
        // post carries ZERO such elements. That hole let W25/W28/W29 publish
        // with a flat card directory and NO per-topic synthesis groups (operator
        // report 2026-07-15: "no AI summaries of each topic, you just list the
        // articles"). Each feature below is satisfied by EITHER the W21-era
        // (mz-post-*) OR the W20-era vocabulary; matching on the class attribute
        // (element), not the selector text.
        // NOTE: Five Picks is NOT required — W20 (a gold-standard brief) has no
        // Five Picks feature at all; the original bare-substring gate only
        // "passed" W20 because the inline CSS defines `.mz-five-pick`. The true
        // common spine across W20/W21/W23/W24 is: an editorial narrative, real
        // per-topic groups each opened by a synthesis paragraph, and a
        // references list.
        const REQUIRED = [
            [/class="[^"]*\bmz-(?:post-)?narrative\b/, "an editorial narrative section"],
            [/class="[^"]*\b(?:mz-topic-group|topic-section)\b/, "per-topic synthesis groups"],
            [/class="[^"]*\bmz-references-list\b/, "the references list"],
        ];
        const missing = REQUIRED.filter(([re]) => !re.test(h)).map(([, label]) => label);
        // 2026-07-28 — the reader's TOC is part of the canonical roundup
        // format (W25/28/29 shipped with none; the deploy-side render gate
        // caught it, but the SCHEDULED pipeline publishes through THIS
        // audit, so it must enforce the TOC too): a nav.mz-toc with >=2
        // chips whose hrefs resolve to topic ids present in the body.
        const tocChips = [...h.matchAll(/class="mz-toc-chip"[^>]*href="#([^"]+)"|href="#([^"]+)"[^>]*class="mz-toc-chip"/g)]
            .map((m) => m[1] || m[2]).filter(Boolean);
        const chipHrefs = [...h.matchAll(/<a[^>]*class="[^"]*mz-toc-chip[^"]*"[^>]*href="#([^"]+)"/g)].map((m) => m[1]);
        const ids = new Set([...h.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
        if (!/class="[^"]*\bmz-toc\b/.test(h) || chipHrefs.length < 2) {
            missing.push("a jump-to-topic TOC nav (nav.mz-toc with >=2 chips)");
        } else if (chipHrefs.some((t) => !ids.has(t))) {
            missing.push("TOC chips that resolve to existing topic ids");
        }
        // The per-topic groups must carry actual SYNTHESIS PROSE, not just be
        // empty card containers — W20/W21/W23/W24 each open every topic group
        // with a synthesis paragraph. Require ≥2 groups AND ≥2 synthesis blocks.
        const topicGroupEls = (h.match(/class="[^"]*\b(?:mz-topic-group|topic-section)\b/g) || []).length;
        const synthEls = (h.match(/mz-toc-group-synthesis|mz-topic-group-synthesis|mz-group-synthesis|mz-section-intro/g) || []).length;
        if (topicGroupEls >= 1 && topicGroupEls < 2) missing.push("at least 2 per-topic synthesis groups");
        if (topicGroupEls >= 2 && synthEls < 2) missing.push("per-topic synthesis paragraphs (topic groups present but no synthesis prose)");
        if (missing.length) {
            problems.push(`body_html is missing the Monday-Mornings editorial architecture (${missing.join("; ")}) — every canonical brief (W20, W21) carries the full editorial spine (a per-topic synthesis paragraph above each topic's cards), not just a directory of cards. A stripped, cards-only post must not publish.`);
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
    const checks = [fmt, auditNumericFidelity(post), auditAbstractCompleteness(post), auditPopoverSummaries(post), auditSummaryDuplication(post), auditTemplateBoilerplate(post), auditModalPlaceholders(post), auditDarkGrounds(post)];
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
    return _auditSummaryDuplicationImpl(post);
}

// ---------------------------------------------------------------------
// Template-boilerplate audit (2026-07-14). The duplication gate above only
// catches lens summaries that are BYTE-identical across cards. The regressed
// generator also emits a softer defect: one generic template with number-
// substitution — e.g. "…This week's signal is a sample of N with an OR of X …
// That's the gap I'm building tools to close." — reused across dozens of
// cards. Each copy is byte-UNIQUE (different N/OR), so the duplication gate
// passes it, yet it reads as robotic filler and is a regression from the W21
// gold standard, whose every card line is paper-specific. This catches it by
// SENTENCE reuse: strip each card's shared "Frame: …:" prefix, number-normalize
// the remaining sentences, and flag any substantive sentence (≥40 chars) that
// recurs across ≥3 different cards. W21 (unique lines) passes; the templated
// posts trip and are held for regeneration. Deterministic + offline.
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// Modal-placeholder audit (2026-07-14). The deep-dive modals carry all 13
// journal-club sections structurally, but the regressed generator leaves
// most of them as "Pending Dr. …'s review" author-placeholders — W25/W28/W29
// shipped with ~1000 such stubs each, while W20/W21/W23/W24 (authored) carry
// ~0. The structure audit passes (sections present) yet the CONTENT is unwritten.
// Flag any post whose body carries more than a trivial number of pending-review
// placeholders so a half-authored brief can never publish. Deterministic + offline.
// ---------------------------------------------------------------------
export function auditModalPlaceholders(post) {
    const problems = [];
    if (post.kind !== "blog" && post.kind !== "evidence") return { ok: true, problems };
    const h = typeof post.body_html === "string" ? post.body_html : "";
    const n = (h.match(/[Pp]ending\b[^<]{0,40}\breview\b/g) || []).length;
    if (n > 5) {
        problems.push(`body_html carries ${n} unfilled "Pending …review" deep-dive placeholders — the journal-club sections are author-stubs, not written analysis. Every canonical brief (W20/W21/W23/W24) has these authored. Author the deep dives before publishing.`);
    }
    return { ok: problems.length === 0, problems };
}

export function auditTemplateBoilerplate(post) {
    const problems = [];
    if (post.kind !== "blog" && post.kind !== "evidence") return { ok: true, problems };
    const h = typeof post.body_html === "string" ? post.body_html : "";
    const re = /<p class="mz-cite-fits"[^>]*>([\s\S]*?)<\/p>/g;
    const sentCards = new Map(); // normalized sentence -> Set of card indices
    let m, idx = 0;
    while ((m = re.exec(h)) !== null) {
        const full = visibleText(m[1]);
        // drop the shared "DO + CBG/MIGS lens — Frame: <frame>:" prefix so a
        // legitimately shared frame label isn't what trips this.
        const body = full.replace(/^.*?Frame:[^:]*:\s*/, "");
        const seen = new Set();
        for (let s of body.split(/(?<=[.!?])\s+/)) {
            s = s.replace(/\d[\d.,%–\-]*/g, "#").replace(/\s+/g, " ").trim().toLowerCase();
            if (s.length < 40 || seen.has(s)) continue;
            seen.add(s);
            if (!sentCards.has(s)) sentCards.set(s, new Set());
            sentCards.get(s).add(idx);
        }
        idx++;
    }
    for (const [s, cards] of sentCards) {
        // Threshold 10: the W21 gold standard's most-reused line (a generic
        // "see abstract for design + effect estimates" fallback) recurs in 7
        // cards, so ≤9 is tolerated as shared framing; the regressed template's
        // content-free filler ("That's the gap I'm building tools to close")
        // recurs across 16–44 cards. 10 cleanly separates them.
        if (cards.size >= 10) {
            problems.push(`a generic templated sentence is reused across ${cards.size} different card lens summaries — each paper needs its own specific wording, not a fill-in-the-number template (sentence: "${s.slice(0, 72)}…").`);
        }
    }
    return { ok: problems.length === 0, problems };
}

function _auditSummaryDuplicationImpl(post) {
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
// Popover-summary audit (2026-07-06; STRUCTURE + SOURCING added 2026-09-01).
// Each inline citation carries a hover popover whose `mz-ref-pop-finding`
// field must be an ADEQUATE plain-language summary of the paper's finding
// (the W20/W21 standard), NOT a raw dump of the abstract's opening sentence.
// The 2026-07-06 audit found ~106 W23/W24 popovers whose finding field was
// the truncated abstract opening — it starts with a structured-abstract
// section label (RATIONALE:/INTRODUCTION:/…), which a real summary never
// does. Each was replaced with the paper's own modal Bottom-line (already
// grounded + numeric-gated).
//
// 2026-09-01: the original audit ONLY inspected popovers that already had a
// `mz-ref-pop-finding` span in the current schema. A popover with NO finding
// span at all, or one authored in the earlier W20-era class schema
// (mz-ref-title/-meta/-finding, no -pop- infix), was invisible to it — which
// is exactly how a published brief shipped 24 hovers a reader learns nothing
// from. Now every mz-ref-pop span is audited:
//   * no mz-ref-pop-title           → unstructured, always a problem
//   * no finding, but this post carries the paper's grounded summary
//     (modal Bottom-line, or the cite card's lens line)  → a problem
//   * no finding and NO grounded source in the post      → NOT a problem
//     here (writing "what a paper shows" is clinical content; the deploy-
//     side ref-popover gate reports these to the clinician as advisory)
// Deterministic + offline.
// ---------------------------------------------------------------------
const RAW_ABSTRACT_LABEL = /^\s*(rationale|background|objectives?|introduction|methods?|materials?|purpose|aims?|importance|context|setting|design|participants)\b\s*[:\-–]/i;
const SUP_SPAN_RE = /<sup class="mz-ref"[^>]*>[\s\S]*?<\/sup>/g;

function supPmid(sup) {
    const m = sup.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d{5,9})/)
        || sup.match(/id="ref-pop-(\d{5,9})"/)
        || sup.match(/#mz-ref-(\d{5,9})/);
    return m ? m[1] : null;
}

// An author list is not a finding (three W20 popovers shipped
// "Kizildemir YZ, İncebıyık M." as their synopsis). A real synopsis is
// prose and contains lowercase content words; an author list is capitalised
// surnames plus initials. Unicode-aware — the string that shipped was
// Turkish. Mirrors is_author_list in scripts/apply_inline_refs.py.
function isAuthorList(t) {
    t = String(t || "").trim();
    if (!t || t.length > 140) return false;
    let core = t.replace(/\b(?:et\s+al|and|&)\b/gi, " ");
    core = core.replace(/[^\p{L}\p{N}\s'-]/gu, " ");
    return !core.split(/\s+/).some((w) => w.length >= 4 && /^\p{Ll}/u.test(w));
}

// pmid -> the paper's modal Bottom-line (cleaned; only when adequate).
function modalBottomLines(h) {
    const bl = {};
    const dRe = /<dialog[^>]*\bid="dd-(\d+)"[^>]*>([\s\S]*?)<\/dialog>/g;
    let dm;
    while ((dm = dRe.exec(h)) !== null) {
        const s = dm[2].match(/id="dd-\d+-bottom"[^>]*>([\s\S]*?)<\/section>/);
        if (!s) continue;
        const c = cleanBottomLine(visibleText(s[1]));
        if (c.length >= 80 && !RAW_ABSTRACT_LABEL.test(c)) bl[dm[1]] = c;
    }
    return bl;
}

// pmid -> the cite card's lens line ("DO + CBG/MIGS lens — …:" / "Read
// through the lens of the claim:" preambles stripped), only when it is a
// usable finding by the pipeline's own rules (not an abstract dump, not an
// author list, not trivially short). Mirrors card_index in
// scripts/apply_inline_refs.py.
function citeCardLenses(h) {
    const out = {};
    const cardRe = /<article class="mz-cite-card"[^>]*>[\s\S]*?<\/article>/g;
    let m;
    while ((m = cardRe.exec(h)) !== null) {
        const blob = m[0];
        const pmid = (blob.match(/id="mz-cite-(\d+)"/) || blob.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/) || [])[1];
        if (!pmid || out[pmid]) continue;
        const f = blob.match(/<p class="mz-cite-(?:fits|finding)"[^>]*>([\s\S]*?)<\/p>/);
        if (!f) continue;
        let txt = decodeEntities(visibleText(f[1]));
        if (/^Read through the lens/.test(txt)) {
            txt = txt.slice(txt.indexOf(":") + 1).trim();
        } else if (txt.includes(" lens") && txt.includes(":")) {
            const i1 = txt.indexOf(":"), i2 = txt.indexOf(":", i1 + 1);
            txt = (i2 >= 0 ? txt.slice(i2 + 1) : txt.slice(i1 + 1)).trim();
        }
        if (txt.length >= 30 && !RAW_ABSTRACT_LABEL.test(txt) && !isAuthorList(txt)) out[pmid] = txt;
    }
    return out;
}

// pmid -> the visible text of the paper's embedded verbatim abstract
// (mz-jc-abstract-body inside its deep-dive modal). Used for the
// verbatim-dump check: a "summary" that is a contiguous copy of the
// abstract is not a summary.
function embeddedAbstracts(h) {
    const out = {};
    const dRe = /<dialog[^>]*\bid="dd-(\d+)"[^>]*>([\s\S]*?)<\/dialog>/g;
    let dm;
    while ((dm = dRe.exec(h)) !== null) {
        const abM = dm[2].match(/<div class="mz-jc-abstract-body">([\s\S]*?)<\/div>/);
        if (abM) out[dm[1]] = visibleText(abM[1]);
    }
    return out;
}

// Aggressive text normalisation for verbatim-containment and title-equality
// checks: entities decoded, case folded, everything but letters/digits
// collapsed to single spaces. Two texts that differ only in punctuation,
// ellipses or whitespace normalise identically.
function normText(s) {
    return decodeEntities(String(s || "")).toLowerCase().replace(/[^a-z0-9]+/gi, " ").trim();
}

/**
 * THE canonical popover audit — one rulebook for EVERY surface (owner
 * directive 2026-09-01: the rules must live in ONE place so an update
 * applies to the entire site). Consumed by:
 *   * auditPopoverSummaries below (the worker publish gate, every
 *     POST/PUT/approve through /api/posts),
 *   * scripts/audit_ref_popovers.mjs (the deploy gate, walking the
 *     education pages and the published posts).
 * Change a rule HERE and both gates change together; never fork a copy
 * of these rules into a per-surface script.
 *
 * @param html      the surface's HTML
 * @param opts.curated    (pmidOrKey) -> truthy when a grounded/curated
 *                        summary EXISTS on this surface for that citation
 * @param opts.abstracts  pmid -> abstract text (a committed corpus); the
 *                        surface's own embedded modal abstracts are always
 *                        consulted as well
 * @param opts.meta       pmid -> {title, journal, journal_abbrev, year}
 *                        from PubMed, enabling the metadata checks (the
 *                        worker has no corpus, so these run deploy-side)
 * @returns {problems: [{key, code, msg}], advisories: [{key, code, msg}]}
 *   codes — problems: unstructured | missing-sourced | raw-dump |
 *           verbatim-dump | near-empty | bad-title | bad-year | bad-journal
 *           advisories: missing-unsourced
 */
export function auditPopoverSurface(html, opts = {}) {
    const problems = [], advisories = [];
    const h = String(html || "");
    const curated = opts.curated || (() => false);
    const corpusAbs = opts.abstracts || {};
    const meta = opts.meta || {};
    const emb = embeddedAbstracts(h);
    const seen = new Set();
    const push = (arr, key, code, msg) => { seen.add(key); arr.push({ key, code, msg }); };
    let sm;
    SUP_SPAN_RE.lastIndex = 0;
    while ((sm = SUP_SPAN_RE.exec(h)) !== null) {
        const sup = sm[0];
        const pop = sup.match(/<span class="mz-ref-pop"[^>]*>[\s\S]*?<\/span>(?=<\/sup>)/);
        if (!pop) continue;
        const pmid = supPmid(sup);
        const refKey = (sup.match(/data-r="(ref-\d+)"/) || [])[1] || null;
        const key = pmid || refKey || `@${sm.index}`;
        if (seen.has(key)) continue; // one report per paper
        const label = pmid ? "ref-pop-" + pmid : (refKey || "at offset " + sm.index);
        const p = pop[0];
        if (!p.includes("mz-ref-pop-title")) {
            push(problems, key, "unstructured", `popover ${label}: unstructured — no mz-ref-pop-title element. Every citation popover carries the paper's title, its meta line, and the plain-language finding.`);
            continue;
        }
        const popTitle = decodeEntities(((p.match(/<span class="mz-ref-pop-title">([\s\S]*?)<\/span>/) || [])[1] || "").replace(/<[^>]*>/g, "")).trim();
        const popMeta = decodeEntities(((p.match(/<span class="mz-ref-pop-meta">([\s\S]*?)<\/span>/) || [])[1] || "").replace(/<[^>]*>/g, "")).trim();
        // ---- metadata checks (need a PubMed record for this citation) ----
        // Education sups carry no PMID themselves — the ref list does — so a
        // caller may key meta/abstracts by the surface ref id (ref-N) instead.
        const lookup = pmid || refKey;
        const pm = lookup ? (meta[pmid] || meta[refKey] || null) : null;
        if (pm && pm.title && popTitle) {
            const a = normText(popTitle), b = normText(pm.title);
            if (a && b && a !== b && !a.includes(b) && !b.includes(a)) {
                push(problems, key, "bad-title", `popover ${label}: title does not match the paper's PubMed title — popover says "${popTitle.slice(0, 60)}…", PubMed says "${pm.title.slice(0, 60)}…".`);
                continue;
            }
        }
        if (pm && (pm.year || (pm.years && pm.years.length)) && popMeta) {
            // A paper legitimately carries several years (epub vs print issue)
            // and a meta line can carry a year that is not the paper's date at
            // all (the journal "Rev Assoc Med Bras (1992)"), so the meta is
            // wrong only when it names at least one year and NONE of them is
            // a PubMed date for this paper.
            const okYears = (pm.years && pm.years.length ? pm.years : [pm.year]).map(String);
            const metaYears = popMeta.match(/\b(?:19|20)\d{2}\b/g) || [];
            if (metaYears.length && !metaYears.some((y) => okYears.includes(String(y)))) {
                push(problems, key, "bad-year", `popover ${label}: meta line says ${metaYears.join("/")} but PubMed dates this paper ${okYears.join("/")} ("${popMeta.slice(0, 50)}").`);
                continue;
            }
        }
        if (pm && popMeta && (pm.journal || pm.journal_abbrev)) {
            const j = normText(popMeta.split("·")[0]);
            const j1 = normText(pm.journal || ""), j2 = normText(pm.journal_abbrev || "");
            const jOk = !j || (j1 && (j1.includes(j) || j.includes(j1))) || (j2 && (j2.includes(j) || j.includes(j2)));
            if (!jOk) {
                push(problems, key, "bad-journal", `popover ${label}: meta line names "${popMeta.split("·")[0].trim()}" but PubMed publishes this paper in "${pm.journal_abbrev || pm.journal}".`);
                continue;
            }
        }
        // ---- finding checks ----
        const fm = p.match(/<span class="mz-ref-pop-finding">([^<]*)<\/span>/);
        if (!fm) {
            if (curated(key) || (pmid && curated(pmid))) {
                push(problems, key, "missing-sourced", `popover ${label}: the citation summary is missing even though this surface carries the paper's grounded summary — wire it through.`);
            } else {
                push(advisories, key, "missing-unsourced", `popover ${label}: no curated summary exists yet for this citation`);
            }
            continue;
        }
        const finding = decodeEntities(fm[1]).trim();
        if (RAW_ABSTRACT_LABEL.test(finding)) {
            push(problems, key, "raw-dump", `popover ${label}: the citation summary is a raw abstract dump (starts "${finding.slice(0, 24)}…") — replace with an adequate plain-language finding.`);
            continue;
        }
        // Verbatim dump: the "summary" is a contiguous copy of the paper's
        // abstract. A curated plain-language summary in the clinician's own
        // words is essentially never a verbatim abstract substring; a
        // copy-paste always is. The paper's title is exempt (a concise
        // title-as-descriptor is the W21 standard and titles are quoted in
        // abstracts often enough to collide).
        const nf = normText(finding);
        const abs = (lookup && (corpusAbs[pmid] || corpusAbs[refKey] || (pmid && emb[pmid]))) || "";
        if (nf.length >= 60 && abs && normText(abs).includes(nf) && !(pm && normText(pm.title) === nf) && normText(popTitle) !== nf) {
            push(problems, key, "verbatim-dump", `popover ${label}: the citation summary is a verbatim copy of the paper's abstract text ("${finding.slice(0, 50)}…") — a summary must be plain-language, not a paste.`);
            continue;
        }
        if (finding.length > 0 && finding.length < 25) {
            // Empty/near-empty only. The floor sits BELOW the W20/W21
            // reference-standard minimum (53 chars) so a legitimately concise
            // foundational-citation descriptor is never flagged — the real
            // defect this gate targets is the dumps above.
            push(problems, key, "near-empty", `popover ${label}: the citation summary is only ${finding.length} chars — effectively empty.`);
        }
    }
    return { problems, advisories };
}

export function auditPopoverSummaries(post) {
    if (post.kind !== "blog" && post.kind !== "evidence") return { ok: true, problems: [] };
    const h = typeof post.body_html === "string" ? post.body_html : "";
    const src = groundedSummarySources(h);
    const r = auditPopoverSurface(h, { curated: (pmid) => !!src[pmid] });
    const problems = r.problems.map((p) => p.msg);
    return { ok: problems.length === 0, problems };
}

/**
 * pmid -> the grounded summary text a post itself carries for that paper
 * (modal Bottom-line preferred, cite-card lens line second). This is the
 * ONLY sourcing pool any popover tooling may draw from — exported so the
 * deploy-side walker and repair scripts use the same pool as the worker
 * heal, never a private re-implementation.
 */
export function groundedSummarySources(html) {
    const h = String(html || "");
    const bl = modalBottomLines(h);
    const lens = citeCardLenses(h);
    const out = { ...lens, ...bl }; // bottom-lines win
    return out;
}

// ---------------------------------------------------------------------
// Dark-ground audit (2026-09-01). The site is ONE light theme (SYSTEM_MAP
// §8.0.0), and posts embed their own ~25KB stylesheet — so a generator that
// still emits the old dark palette would publish a dark page. The deploy-side
// dark-surface gate scans the published corpus, but only AT DEPLOY TIME; a
// scheduled pipeline publish between deploys would ship dark and sit live
// until the next deploy. This closes that window at the publish choke point.
// Same rules as scripts/audit_dark_surfaces.py: a background/background-color
// declaration (gradient stops included) whose colour is darker than the
// neutral threshold, outside the brand-violet/semantic-tint allowlist and not
// in a scrim/backdrop/photo context, must not publish. Deterministic+offline.
// ---------------------------------------------------------------------
const THEME_ALLOW_HEX = new Set(["#2e1065", "#6d28d9", "#7c3aed", "#4c1d95", "#5b21b6", "#047857",
    "#166534", "#14532d", "#7c2d12", "#92400e", "#b91c1c", "#991b1b", "#3d1478"]);
const THEME_SCRIM_HINT = /(backdrop|overlay|scrim|::backdrop|vignette|cover-|photo|darkener)/i;
const THEME_DARK_MAX_LUM = 60;
function hexLum(hx) {
    let s = hx.replace(/^#/, "");
    if (s.length === 3) s = s.split("").map((c) => c + c).join("");
    if (s.length < 6) return null;
    return (parseInt(s.slice(0, 2), 16) * 299 + parseInt(s.slice(2, 4), 16) * 587 + parseInt(s.slice(4, 6), 16) * 114) / 1000;
}
export function auditDarkGrounds(post) {
    const problems = [];
    if (post.kind !== "blog" && post.kind !== "evidence") return { ok: true, problems };
    const h = typeof post.body_html === "string" ? post.body_html : "";
    const bgRe = /(?<![\w-])background(?:-color)?\s*:\s*([^;{}]+)/gi;
    let m;
    while ((m = bgRe.exec(h)) !== null) {
        const decl = m[1];
        const ctx = h.slice(Math.max(0, m.index - 260), m.index);
        if (THEME_SCRIM_HINT.test(ctx)) continue;
        for (const hx of decl.match(/#[0-9a-fA-F]{3,8}/g) || []) {
            if (THEME_ALLOW_HEX.has(hx.toLowerCase())) continue;
            const L = hexLum(hx);
            if (L !== null && L < THEME_DARK_MAX_LUM) {
                problems.push(`dark ground ${hx} (lum ${Math.round(L)}) in "${decl.trim().slice(0, 60)}" — the site is one LIGHT theme; a post must not embed a dark stylesheet.`);
            }
        }
        let rm;
        const rgbaRe = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([0-9.]+)\s*)?\)/g;
        while ((rm = rgbaRe.exec(decl)) !== null) {
            const L = (Number(rm[1]) * 299 + Number(rm[2]) * 587 + Number(rm[3]) * 114) / 1000;
            const alpha = rm[4] !== undefined ? Number(rm[4]) : 1.0;
            if (L < THEME_DARK_MAX_LUM && alpha >= 0.5) {
                problems.push(`dark ground rgba(${rm[1]},${rm[2]},${rm[3]},${alpha}) (lum ${Math.round(L)}) in "${decl.trim().slice(0, 60)}" — the site is one LIGHT theme; a post must not embed a dark stylesheet.`);
            }
        }
        if (problems.length >= 12) { problems.push("…further dark grounds elided — the stylesheet is dark-themed; regenerate on the light palette."); break; }
    }
    return { ok: problems.length === 0, problems };
}
function decodeEntities(s) {
    return String(s || "")
        .replace(/&#(\d+);/g, (m, n) => { try { return String.fromCodePoint(Number(n)); } catch { return m; } })
        .replace(/&#x([0-9a-fA-F]+);/g, (m, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return m; } })
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
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
 * Offline. Three grounded popover repairs, all sourced from the post itself
 * (no clinical content is ever invented):
 *   1. an old-schema popover (W20-era mz-ref-title/-meta/-finding classes)
 *      is renamed to the spec mz-ref-pop-* schema — a pure attribute rename,
 *      zero text changes;
 *   2. a raw-abstract-dump finding is replaced with the paper's own
 *      (cleaned) modal Bottom-line;
 *   3. a structured popover MISSING its finding span gets one, sourced from
 *      the paper's modal Bottom-line or, failing that, its cite card's lens
 *      line (the pipeline's own sourcing rules — abstract dumps and author
 *      lists are rejected, exactly as in scripts/apply_inline_refs.py).
 * A citation with no grounded source in the post is left alone: the deploy-
 * side ref-popover gate reports it to the clinician as advisory.
 * @returns {ok, healed, changed, problems}
 */
export function healPopoverSummaries(bodyHtml) {
    let h = String(bodyHtml || "");
    const problems = [];
    const bl = modalBottomLines(h);
    const lens = citeCardLenses(h);
    const emb = embeddedAbstracts(h);
    let changed = 0;
    h = h.replace(SUP_SPAN_RE, (sup) =>
        sup.replace(/(<span class="mz-ref-pop"[^>]*>)([\s\S]*?)(<\/span>)(?=<\/sup>)/, (full, pre, inner, post) => {
            let out = inner;
            const pmid = supPmid(sup);
            // 1) schema normalisation (rename only — text is untouched)
            if (out.includes('class="mz-ref-title"') && !out.includes("mz-ref-pop-title")) {
                out = out
                    .replace(/class="mz-ref-title"/g, 'class="mz-ref-pop-title"')
                    .replace(/class="mz-ref-meta"/g, 'class="mz-ref-pop-meta"')
                    .replace(/class="mz-ref-finding"/g, 'class="mz-ref-pop-finding"');
            }
            // 2) a dump finding → the paper's own modal Bottom-line. Two dump
            //    shapes: a labelled abstract opening ("BACKGROUND: …") and a
            //    verbatim paste of the abstract body (same guards as the
            //    audit: ≥60 normalised chars, and never the paper's title
            //    used as a concise descriptor).
            out = out.replace(/(<span class="mz-ref-pop-finding">)([^<]*)(<\/span>)/, (f, fp, txt, fs) => {
                const t = decodeEntities(txt).trim();
                const isRaw = RAW_ABSTRACT_LABEL.test(t);
                const nf = normText(t);
                const popTitle = normText(((inner.match(/<span class="mz-ref-pop-title">([\s\S]*?)<\/span>/) || [])[1] || "").replace(/<[^>]*>/g, ""));
                const isPaste = !isRaw && pmid && emb[pmid] && nf.length >= 60 && nf !== popTitle && normText(emb[pmid]).includes(nf);
                if (!isRaw && !isPaste) return f;
                if (!pmid || !bl[pmid]) { problems.push(`ref-pop-${pmid || "?"}: no adequate modal Bottom-line to source a summary — left for review`); return f; }
                return fp + escapeHtml(bl[pmid]) + fs;
            });
            // 3) structured but finding-less → fill from the grounded source
            if (out.includes("mz-ref-pop-title") && !out.includes("mz-ref-pop-finding") && pmid) {
                const src = bl[pmid] || lens[pmid];
                if (src) out += `<span class="mz-ref-pop-finding">${escapeHtml(src)}</span>`;
            }
            if (out !== inner) changed++;
            return pre + out + post;
        }));
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

export default { auditPostFormat, auditPublishable, auditNumericFidelity, auditAbstractCompleteness, auditPopoverSummaries, auditPopoverSurface, auditSummaryDuplication, auditTemplateBoilerplate, auditModalPlaceholders, auditDarkGrounds, groundedSummarySources, healPaperCardPost, healDeepDiveModals, healPost, healPopoverSummaries, healAbstractCompleteness, extractStyleScript };
