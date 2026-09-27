#!/usr/bin/env python3
"""Fix a published brief from a confirmed list of findings — analysis, fix, review.

The owner's shape, after the pipeline was re-run brief by brief and each run
stopped at the next single problem: the analysis is done ONCE (two readers,
every finding quoted and located, the second reader upholding it), every
finding is fixed in one pass from the cited paper's abstract, and the fixed
brief is reviewed once against THE STANDARDS. Nothing is re-run to discover
the next problem.

  python3 scripts/fix_from_findings.py <post-id> [--findings=<confirmed.json>]

Writes <work>/fixed.html and <work>/fixed.review.json. Publishing is a
separate, explicit step (--publish) and happens only when the review passes.
"""
import json, os, re, sys, html as H
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import brief_pipeline as bp

FINDINGS = next((a.split("=", 1)[1] for a in sys.argv if a.startswith("--findings=")),
                "/tmp/claude-0/-home-user-MIGS/7a2758e6-6b6d-5fff-a789-a9193d8f2863/scratchpad/readers/confirmed.json")


def quotes_of(text: str) -> list:
    """The page text a finding quotes: runs between quote marks, longest first."""
    q = re.findall(r"[\"“‘']([^\"”’']{20,400})[\"”’']", text or "")
    return sorted(dict.fromkeys(x.strip() for x in q), key=len, reverse=True)


def container_of(f: dict) -> tuple:
    """(kind, pmid) when the finding sits in a card or a deep dive."""
    t = f"{f.get('where', '')} {f.get('evidence', '')}"
    m = re.search(r"(?:dialog|deep[- ]dive|dd-)\D{0,30}?(\d{7,9})", t, re.I)
    if m:
        return "dialog", m.group(1)
    m = re.search(r"(?:card|mz-cite-)\D{0,30}?(\d{7,9})", t, re.I)
    if m:
        return "card", m.group(1)
    # the PMID named BEFORE the container word ("PMID 24430001 (KEEPS-Cog) cite card")
    m = re.search(r"(\d{7,9})\D{0,40}?(?:deep[- ]dive|dialog)", t, re.I)
    if m:
        return "dialog", m.group(1)
    m = re.search(r"(\d{7,9})\D{0,40}?\bcard\b", t, re.I)
    if m:
        return "card", m.group(1)
    return None, None


# The classes a finding can belong to, decided before any fix is chosen.
# A reader's finding on an off-topic paper, a headline or a hover card has
# no sentence to rewrite; routed to the text repair it was skipped in silence
# (87 of 342 findings, 2026-09-27).
OFFTOPIC_RE = re.compile(r"off-topic|keyword collision|sits under|carded under|off the heading|nothing to do with|"
                         r"off the brief's subject|does not belong", re.I)
# a finding about a deep dive's framing or its literature panel is text to
# rewrite, not a paper to remove — judged on the finding's first clause
NOT_PLACEMENT_RE = re.compile(r"deep[- ]dive|dialog|\blens\b|panel|fram(?:ed|ing)|established literature|knowledge-base"
                              r"|carded twice|\bTOC\b|heading calls|in my experience|first-person", re.I)
HEADING_LABEL_RE = re.compile(r"heading (?:calls|says|names|mislabels)|heading ['\"‘“][^'\"’”]{4,120}['\"’”] contains no"
                              r"|mislabels its contents", re.I)
POPOVER_SUBJECT_RE = re.compile(r"^(?:the\s+)?(?:[\w'’\[\]#.-]+\s+){0,2}?(?:popovers?|hover cards?)\b|popover (?:says|states|gives|reads|lists|reports)", re.I)


def is_placement(w: str) -> bool:
    first = re.split(r"(?<=[;.])\s", w, 1)[0]
    return bool(OFFTOPIC_RE.search(first)) and not NOT_PLACEMENT_RE.search(first)


HEADLINE_RE = re.compile(r"\bheadline\b|\bh1\b|post title|page title|title metadata|title field", re.I)
DESIGN_RE = re.compile(r"design (?:chip|badge|label)s?|reference number label|citation number badge|card kicker", re.I)
# fixed by a deterministic step every brief goes through (final_assembly,
# conform_trend_brief) and verified by the gates after it — not by rewriting
# a sentence
STRUCTURAL_RE = re.compile(
    r"verdict gauge|gauge (?:svg|element)|framing label|two sides can meet|evidence[- ]pyramid|pyramid (?:counts|tallies)"
    r"|evidence-shape tally|shape of the evidence' tally|build (?:comments?|metadata)|spec-reference"
    r"|mz-jc-placeholder|mz-jc-empty|synthesis paragraph sits|TOC group|chip row|carded twice"
    r"|where it fits\W{1,3} anchor|(?:hero|counters|stat tiles|design chart|meta strip)\b[^.]{0,120}\b(?:\d+ papers|count)",
    re.I)


def container_by_name(f: dict, h: str, real: dict) -> tuple:
    """(kind, pmid) for a finding that names its container by a paper's first
    author or a title word ("Kashef card lens", "the Horrow dialog", "the
    SPLM deep dive", "Ginindza popover", "popover for Basile") rather than
    by PMID."""
    t = f"{f.get('what', '')} {f.get('where', '')} {f.get('evidence', '')}"
    carded = set(bp._carded_pmids(h))
    first = {}
    for q in carded:
        au = ((real.get(q) or {}).get("authors") or "").split(",")[0].strip().split(" ")[0].lower()
        if au:
            first.setdefault(au, []).append(q)
    name_ = r"([A-Z][\w'\u00c0-\u024f-]{2,})"
    kind_ = r"(card|deep[- ]dive|dialog|popover|hover card)"
    pairs = [(m.group(1), m.group(2)) for m in re.finditer(name_ + r"(?:'s)?\s+(?:[\w-]+\s+){0,2}?" + kind_, t)]
    pairs += [(m.group(2), m.group(1)) for m in re.finditer(kind_ + r" for (?:the )?" + name_, t, re.I)]
    for name0, kind0 in pairs:
        kind0 = kind0.lower()
        kind = "card" if kind0 == "card" else "popover" if kind0 in ("popover", "hover card") else "dialog"
        hits = first.get(name0.lower()) or [q for q in carded if re.search(r"\b%s\b" % re.escape(name0), (real.get(q) or {}).get("title") or "", re.I)]
        if len(hits) == 1:
            return kind, hits[0]
    return None, None


_PAGE_INDEX: dict = {}


def _page_index(h: str) -> tuple:
    """(marker number -> pmid, pmid -> hover-card text) for one page, built
    once per page: the marker pattern over an 800 KB brief takes seconds, and
    the classifier asked it once per finding."""
    key = hash(h)
    if key not in _PAGE_INDEX:
        num_to_pm = {}
        for m in bp.SUP_RE.finditer(h):
            a = re.search(r"<a\b[^>]*>([\s\S]*?)</a>", m.group(0))
            n = re.search(r"\d+", re.sub(r"<[^>]+>", " ", a.group(1))) if a else None
            pm = bp._pmid_of(m.group(0))
            if n and pm:
                num_to_pm.setdefault(n.group(0), pm)
        pops = {}
        for m in re.finditer(r'<span class="mz-ref-pop" id="ref-pop-(\d+)[^"]*"[^>]*>(.*?)</span></span>', h, re.S):
            pops.setdefault(m.group(1), re.sub(r"\s+", " ", H.unescape(re.sub(r"<[^>]+>", " ", m.group(2)))).lower())
        _PAGE_INDEX.clear()
        _PAGE_INDEX[key] = (num_to_pm, pops)
    return _PAGE_INDEX[key]


def popover_pmids(f: dict, h: str, real: dict, W: str = "") -> list:
    """The paper(s) whose hover card a finding is about: by the marker number
    it names ("Popover for [35]", "popover #44"), by the text it quotes from a
    hover card, or by the first author it names."""
    t = f"{f.get('what', '')} {f.get('evidence', '')} {f.get('where', '')}"
    num_to_pm, pops = _page_index(h)
    out = []
    for n in re.findall(r"(?:popover|hover card)\s*(?:for\s*)?(?:#|\[)\s*(\d{1,3})|\[(\d{1,3})\]\s*(?:popover|hover card)|(?:#|\[)(\d{1,3})\]?\s*(?:'s)?\s*(?:popover|hover card)", t, re.I):
        k = next(x for x in n if x)
        if num_to_pm.get(k) and num_to_pm[k] not in out:
            out.append(num_to_pm[k])
    for q in quotes_of(t):
        qn = re.sub(r"\s+", " ", q).strip().lower()[:40]
        for pm, text in pops.items():
            if qn and qn in text and pm not in out:
                out.append(pm)
    if not out:
        kind, pm = container_by_name(f, h, real)
        if pm:
            out.append(pm)
    if not out:
        kind, pm = container_of(f)
        if pm:
            out.append(pm)
    if not out and W and pops:
        # the finding names the hover card by its content only ("Popover states
        # arms in reverse order: the 25% and 7% figures…"): the model picks it
        listing = "\n".join(f"[{pm}] {txt[:400]}" for pm, txt in pops.items())
        v = bp._ask_cached(W, "locate", f"""A reviewer reported a defect in one hover card (the pop-up summary of a cited paper) of an evidence brief:
DEFECT: {json.dumps(t[:1500], ensure_ascii=False)}
Every hover card on the page, by PMID:
{listing[:60000]}
Which hover card(s) is the defect about? Reply with ONLY {{"pmids": ["...", ...]}}""", timeout_s=300)
        out = [str(q) for q in ((v or {}).get("pmids") or []) if str(q) in pops][:3]
    return out


def rewrite_labelled_heading(W: str, h: str, f: dict) -> tuple:
    """A section heading that mislabels what is under it ("papers on
    antihistamine therapy for endometriosis pain" above two surgery reviews)
    is written again from the section's own content. (h, changed)."""
    t = f"{f.get('what', '')} {f.get('evidence', '')}"
    qs = [q.strip() for q in re.findall(r"[\"“‘']([^\"”’']{6,160})[\"”’']", t) if len(q.strip()) >= 6]
    for m in re.finditer(r"(<h([23])\b[^>]*>)([\s\S]*?)(</h\2>)", h):
        plain = re.sub(r"\s+", " ", H.unescape(re.sub(r"<[^>]+>", " ", m.group(3)))).strip()
        if not plain or not any(q.lower()[:30] in plain.lower() for q in qs):
            continue
        nxt = re.search(r"<h[12]\b|</section>", h[m.end():])
        body = h[m.end():m.end() + (nxt.start() if nxt else 4000)]
        body = re.sub(r"\s+", " ", H.unescape(re.sub(r"<[^>]+>", " ", bp.SUP_RE.sub(" ", body))))[:3000]
        v = bp._ask_cached(W, "heading", f"""A reviewer found that this section heading of a clinician evidence brief misdescribes what sits under it:
HEADING: {json.dumps(plain)}
WHAT THE REVIEWER FOUND: {json.dumps(f.get('what', '')[:800], ensure_ascii=False)}
WHAT THE SECTION HOLDS: {json.dumps(body, ensure_ascii=False)}
Write the heading again: 3-12 words, saying exactly what the section holds — not a label it does not
earn, no "verdict"/"myth"/"debunk", no "never"/"always", "CBG/MIGS" if the practice is named. Keep a
trailing count in parentheses if the heading has one.
Reply with ONLY {{"heading": "<text>"}}""", timeout_s=300)
        new = re.sub(r"\s+", " ", str((v or {}).get("heading") or "")).strip().strip('"').rstrip(".")
        if 3 <= len(new) <= 120 and not bp._ABSOLUTE_WORD_RE.search(new) and not bp.SCORING_LANGUAGE_RE.search(new) and new != plain:
            print(f"  heading rewritten: {plain[:80]!r} -> {new[:80]!r}")
            return h[:m.start(3)] + H.escape(new, quote=False) + h[m.end(3):], 1
    return h, 0


def remove_offtopic(W: str, h: str, fs: list, real: dict, fmt: str, post: dict) -> tuple:
    """The papers the readers found off-topic, judged by the curator against
    the owner's topic-fit rule — first pass, independent second pass — and
    removed (or moved to the heading they belong under) only when it agrees.
    The readers are not the rule: the owner's menopause heading is broad
    ("a yoga trial in climacteric women … all belong there"), and a reader
    calling a menopause-exercise paper off-topic under it is wrong. The
    prose that argued from a removed paper is rewritten. (h, notes)."""
    carded = list(dict.fromkeys(bp._carded_pmids(h)))
    named = []
    for f in fs:
        t = f"{f.get('what', '')} {f.get('evidence', '')} {f.get('where', '')}"
        pms = [q for q in dict.fromkeys(re.findall(r"\b(\d{7,9})\b", t)) if q in carded]
        if not pms:
            _k, pm = container_of(f)
            if pm in carded:
                pms = [pm]
        if not pms:
            _k, pm = container_by_name(f, h, real)
            if pm:
                pms = [pm]
        if not pms:
            listing = [{"pmid": q, "title": (real.get(q) or {}).get("title", "")} for q in carded]
            v = bp._ask_cached(W, "offtopic_locate", f"""A reader of a clinician evidence brief reported that one or more of its papers are off-topic:
FINDING: {json.dumps(t[:1800], ensure_ascii=False)}
THE BRIEF'S PAPERS: {json.dumps(listing, ensure_ascii=False)[:30000]}
Which of these papers does the finding name or describe as off-topic? List only those.
Reply with ONLY {{"pmids": ["...", ...]}}""", timeout_s=300)
            pms = [str(q) for q in ((v or {}).get("pmids") or []) if str(q) in carded]
        named += [q for q in pms if q not in named]
    notes = []
    if not named:
        return h, ["off-topic finding(s) named no paper the brief holds"]
    papers_ctx = {q: {"title": (real.get(q) or {}).get("title", ""), "abstract": (real.get(q) or {}).get("abstract", "")} for q in carded}
    gone = []
    if fmt == "trend":
        title = H.unescape(re.sub(r"<[^>]+>", "", (re.search(r'<h1[^>]*class="[^"]*mz-post-title[^"]*"[^>]*>([\s\S]*?)</h1>', h) or [None, ""])[1])).strip()
        title = title.strip("“”\"") or str(post.get("title") or "")
        h, removed = bp.curate_flat(h, title, papers_ctx, W, only=set(named))
        gone = [q for q, _ in removed]
        notes += [f"removed {q}: {why[:120]}" for q, why in removed]
    else:
        topics = {}
        for tsec in bp._topic_sections(h):
            seg = tsec.group(1)
            tt = re.search(r"<h[23][^>]*>(.*?)</h[23]>", seg, re.S)
            pm_here = list(dict.fromkeys(re.findall(bp.CARD_ID_RE, seg) + re.findall(r"openDeepDive\('dd-(\d+)'", seg)))
            if pm_here:
                ttl = H.unescape(re.sub(r"<[^>]+>", "", tt.group(1))).strip() if tt else tsec.tid
                topics[tsec.tid] = {"title": re.sub(r"\s*(?:\d+ papers?|\(\d+\))\s*$", "", ttl)[:90], "pmids": pm_here}
        h, removed, moved, emptied = bp.curate_live(h, topics, papers_ctx, W, only=set(named))
        notes += [f"removed {pm} from {topics[tid]['title']!r}: {why[:110]}" for tid, pm, why in removed]
        notes += [f"moved {pm} from {topics[f_]['title']!r} to {topics[to]['title']!r}" for f_, to, pm, _ in moved]
        notes += [f"heading left empty and removed: {x}" for x in emptied]
        if removed or moved:
            h, n = bp.rewrite_affected_syntheses(W, h, topics, removed, moved, real)
            n and notes.append(f"{n} synthesis paragraph(s) rewritten for what the section now holds")
        gone = [pm for pm in dict.fromkeys(pm for _, pm, _ in removed) if not bp._has_card(h, pm)]
    kept = [q for q in named if q not in gone]
    kept and notes.append(f"kept after the curator's two judgements: {kept}")
    if gone:
        h, n = bp.rewrite_narrative_for_removed(W, h, gone, real, surviving=[q for q in carded if q not in gone])
        n and notes.append(f"{n} narrative paragraph(s) rewritten so nothing argues from a removed paper")
    return h, notes


def headline_fields(W: str, h: str, post: dict, fmt: str, fs: list) -> tuple:
    """The headline, the post title and the listing summary say what the
    brief holds. A trend brief's headline is the claim as it circulates —
    quoted, not asserted — with the punctuation of its title. A weekly
    brief's three fields are checked by one model call against the brief's
    own topics and papers, and the counts in its summary are the page's.
    Returns (h, {field: new}, notes)."""
    fields, notes = {}, []
    m = re.search(r'(<h1[^>]*class="[^"]*mz-post-title[^"]*"[^>]*>)([\s\S]*?)(</h1>)', h)
    if not m:
        return h, fields, notes
    h1 = m.group(2).strip()
    if fmt == "trend":
        new = h1
        words = re.findall(r"[\w'-]+,?", str(post.get("title") or ""))
        for i, wd in enumerate(words[:-1]):
            if wd.endswith(","):
                a, b = wd[:-1], words[i + 1].rstrip(",")
                new = re.sub(r"\b%s (?=%s\b)" % (re.escape(a), re.escape(b)), a + ", ", new)
        if not new.startswith(("“", "&ldquo;", '"')):
            new = "“" + new.rstrip(". ") + "”"
        if new != h1:
            h = h[:m.start(2)] + new + h[m.end(2):]
            notes.append(f"headline set as the claim, quoted: {H.unescape(new)[:120]}")
        return h, fields, notes
    carded = list(dict.fromkeys(bp._carded_pmids(h)))
    tops = []
    for tsec in bp._topic_sections(h):
        seg = tsec.group(1)
        tt = re.search(r"<h[23][^>]*>(.*?)</h[23]>", seg, re.S)
        pm_here = list(dict.fromkeys(re.findall(bp.CARD_ID_RE, seg) + re.findall(r"openDeepDive\('dd-(\d+)'", seg)))
        titles = [H.unescape(re.sub(r"<[^>]+>", "", t)).strip()[:160] for t in re.findall(r'<p class="mz-cite-title">([\s\S]*?)</p>', seg)]
        if pm_here:
            tops.append({"heading": re.sub(r"\s*(?:\d+ papers?|\(\d+\))\s*$", "", H.unescape(re.sub(r"<[^>]+>", "", tt.group(1))).strip() if tt else tsec.tid),
                         "papers": list(dict.fromkeys(titles))})
    n_papers, n_topics = len(carded), len(tops)
    summary = str(post.get("summary") or "")
    s2 = re.sub(r"^\s*\d+ peer-reviewed papers across \d+ ", f"{n_papers} peer-reviewed papers across {n_topics} ", summary)
    if s2 != summary:
        fields["summary"] = s2
        notes.append(f"summary counts set to the page's: {n_papers} papers, {n_topics} topics")
    nm = re.search(r'<section class="[^"]*mz-(?:post-)?narrative\b[^"]*"[^>]*>([\s\S]*?)</section>', h)
    narrative = re.sub(r"\s+", " ", H.unescape(re.sub(r"<[^>]+>", " ", bp.SUP_RE.sub(" ", nm.group(1))))).strip()[:1500] if nm else ""
    cur = {"title": str(post.get("title") or ""), "h1": H.unescape(re.sub(r"<[^>]+>", "", h1)).strip(), "summary": fields.get("summary", summary)}
    reported = "\n".join(f"- {f.get('what', '')[:400]}" for f in fs) or "(nothing reported)"
    v = bp._ask_cached(W, "headline", f"""You check the three headline fields of a weekly evidence brief for clinicians ("CBG/MIGS Monday Mornings")
against what the brief actually holds.
THE BRIEF HOLDS these topic sections and papers: {json.dumps(tops, ensure_ascii=False)[:40000]}
ITS OPENING NARRATIVE BEGINS: {json.dumps(narrative, ensure_ascii=False)}
THE FIELDS NOW: {json.dumps(cur, ensure_ascii=False)}
A READER REPORTED: {reported}
RULES. Every subject a field names is the subject of a paper the brief holds (by the titles above) — a
headline that promises a subject no paper covers is wrong. The title keeps its prefix exactly as it is
(e.g. "CBG/MIGS Monday Mornings — W21: "). The h1 is one sentence, with no full stop required. The
summary keeps its form and its counts exactly ("{n_papers} peer-reviewed papers across {n_topics} …").
Topic names are written as names ("MHT", "C-section scar", "PCOS"), never as lowercase slugs; no typos.
"CBG/MIGS", never bare "MIGS". No "never"/"always", no verdict or scoreboard words, no dosing.
If all three already meet every rule, reply {{"ok": true}}. Otherwise reply with all three fields, each
unchanged field copied exactly: {{"ok": false, "title": "...", "h1": "...", "summary": "...", "why": "<one clause>"}}
Reply with ONLY the JSON.""", timeout_s=600)
    if isinstance(v, dict) and v.get("ok") is False:
        for k in ("title", "h1", "summary"):
            val = re.sub(r"\s+", " ", str(v.get(k) or "")).strip()
            if not val or val == cur[k]:
                continue
            if bp._ABSOLUTE_WORD_RE.search(val) or bp.SCORING_LANGUAGE_RE.search(val):
                notes.append(f"{k} rewrite refused (absolute or scoring word): {val[:100]}")
                continue
            if k == "title" and not val.startswith(cur["title"].split(":")[0]):
                notes.append(f"title rewrite refused (prefix changed): {val[:100]}")
                continue
            if k == "h1":
                h = h[:m.start(2)] + H.escape(val, quote=False) + h[m.end(2):]
            else:
                fields[k] = val
            notes.append(f"{k}: {val[:140]} ({str(v.get('why', ''))[:100]})")
    return h, fields, notes


def write_empty_headings(W: str, h: str) -> tuple:
    """A section heading with no text (legacy MHT had two) gets one written
    from its own section's content: a clear, specific signpost, not a
    scoreboard. One model call per empty heading, cached."""
    n = 0
    for m in list(re.finditer(r'<h2 class="mz-section-title">(\s*)</h2>', h))[::-1]:
        end = h.find("</section>", m.end())
        body = re.sub(r"\s+", " ", H.unescape(re.sub(r"<[^>]+>", " ", bp.SUP_RE.sub(" ", h[m.end():end if end > 0 else m.end() + 3000]))))[:2500]
        if len(body.strip()) < 40:
            continue
        v = bp._ask_cached(W, "heading", f"""Write the heading for this section of a clinician-facing evidence brief: 3-9 words, a clear,
specific signpost a reader can navigate by — not a label, not a scoreboard, no "verdict"/"myth"/"debunk", no
"never"/"always", "CBG/MIGS" if the practice is named. It must describe what the section says.
SECTION TEXT: {json.dumps(body, ensure_ascii=False)}
Reply with ONLY {{"heading": "<text>"}}""", timeout_s=300)
        t = re.sub(r"\s+", " ", str((v or {}).get("heading") or "")).strip().strip('"').rstrip(".")
        if 3 <= len(t) <= 90 and not bp._ABSOLUTE_WORD_RE.search(t) and not bp.SCORING_LANGUAGE_RE.search(t):
            h = h[:m.start(1)] + H.escape(t, quote=False) + h[m.end(1):]
            n += 1
    return h, n


def structural_faults(h: str, fmt: str) -> list:
    """The structural classes the readers found, as deterministic checks run
    on every fixed page: a link to nothing, a trend brief without its S13
    parts, a gauge element, a placeholder style on written text, tooling
    words, a build timestamp, a lowercase topic slug in the headline."""
    out = []
    ids = set(re.findall(r'\bid="([^"]+)"', h))
    dang = sorted({x for x in re.findall(r'href="#([^"]+)"', h) if x not in ids})
    if dang:
        out.append(f"link(s) to no element on the page: {dang[:5]}")
    if fmt == "trend":
        out += [x for x in bp.trend_format_faults(h)]
        if re.search(r'<(?:div|figure|svg)\b[^>]*class="[^"]*mz-verdict-gauge', h):
            out.append("a verdict gauge element is still on the page")
    body = re.sub(r"<(style|script)\b[\s\S]*?</\1>", "", h)
    n_ph = sum(1 for m in re.finditer(r'<p\b[^>]*class="[^"]*mz-jc-(?:placeholder|empty)[^"]*"[^>]*>([\s\S]*?)</p>', body)
               if len(re.sub(r"<[^>]+>|\s", "", m.group(1))) >= 20)
    if n_ph:
        out.append(f"{n_ph} written paragraph(s) still styled as placeholders")
    code = "".join(re.findall(r"<style\b[^>]*>([\s\S]*?)</style>", h))
    scripts = "".join(re.findall(r"<script\b[^>]*>([\s\S]*?)</script>", h))
    if re.search(r"/\*[\s\S]*?\*/", code) or re.search(r"(?m)^[ \t]*//", scripts):
        out.append("a CSS or JavaScript comment is still in the page source")
    hm = re.search(r'<h1[^>]*class="[^"]*mz-post-title[^"]*"[^>]*>([\s\S]*?)</h1>', h)
    if hm and re.search(r"(?<![\w/-])(?:mht|pcos|csection|icg)(?![\w/-])", hm.group(1)):
        out.append(f"a lowercase topic slug in the headline: {hm.group(1)[:100]}")
    return out


def main():
    pid = sys.argv[1]
    W = os.path.join(bp.SCRATCH, "renumber", pid) + "/"
    post = bp.curl_json(f"{bp.BASE}/api/posts/{pid}"); post = post.get("post", post)
    h = post["body_html"]
    fmt = "trend" if post.get("kind") == "blog" else "weekly"
    findings = json.load(open(FINDINGS)).get(pid) or []
    pmids = sorted(set(bp._carded_pmids(h)) | {bp._pmid_of(m.group(0)) for m in bp.SUP_RE.finditer(h)} - {None})
    real = bp.real_from_work(W, pmids)
    missing = [q for q in pmids if q not in real]
    if missing:
        fetched = bp.fetch_pubmed(missing)
        os.makedirs(W + "papers", exist_ok=True)
        for q, r in fetched.items():
            json.dump(bp._paper_record(q, r), open(W + f"papers/{q}.json", "w"), ensure_ascii=False)
        real = bp.real_from_work(W, pmids)
    print(f"{pid}: {len(findings)} confirmed finding(s), {len(real)} paper(s) with abstracts")

    resume = "--resume" in sys.argv and os.path.exists(W + "fixed.html")
    if not resume and os.path.exists(W + "fixed.html") and "--fresh" not in sys.argv:
        # pick up where the last run left off: its repairs are on this page
        h = open(W + "fixed.html", encoding="utf-8").read()
        print("  continuing from the saved fixed page (its repairs are kept)")
    if resume:
        # the fixes already made (and paid for) are on disk: continue from them
        h = open(W + "fixed.html", encoding="utf-8").read()
        print("  resuming from the saved fixed page")
        # the review's own findings are this round's fix list (one round)
        rv = json.load(open(W + "fixed.review.json")) if os.path.exists(W + "fixed.review.json") else {}
        findings = [{"standard": (re.match(r"(S\d+|OWNER)", str(x)) or [None, ""])[1], "what": str(x), "evidence": str(x), "where": ""}
                    for x in (rv.get("unmet") or [])]
        findings and print(f"  {len(findings)} review finding(s) to fix")
    # a section heading an earlier repair emptied comes back from the live page
    # (the repair once took an <h2> for a sentence and removed its text)
    live_heads = re.findall(r'<h2 class="mz-section-title">([\s\S]*?)</h2>', post["body_html"])
    mine = list(re.finditer(r'<h2 class="mz-section-title">([\s\S]*?)</h2>', h))
    if len(mine) == len(live_heads):
        for m, old in sorted(zip(mine, live_heads), key=lambda x: -x[0].start()):
            if not re.sub(r"<[^>]+>|\s", "", m.group(1)) and re.sub(r"<[^>]+>|\s", "", old):
                h = h[:m.start(1)] + old + h[m.end(1):]
                print("  an emptied section heading restored from the live page")
    h, n_hd = write_empty_headings(W, h)
    n_hd and print(f"  {n_hd} empty section heading(s) written from their sections' content")
    # the mechanical fixes, in code
    h = bp.normalize_legacy_markup(h)
    # a card's design badge is the design alone, on every card ("[2] · RCT ·
    # ELITE" on five of eight cards read as an artifact beside the other three)
    h = re.sub(r'(<span class="mz-cite-design">)\s*\[\d+\]\s*·\s*', r"\1", h)
    # every deep dive's abstract rebuilt from PubMed's record, labels whole
    # ("METHODS AND RESULTS" had been torn into a section holding "AND")
    h, _reps, n_ab = bp.write_abstracts(W, {"pmids": bp._carded_pmids(h), "format": fmt, "topics": []}, h, [], strict=False)
    n_ab and print(f"  {n_ab} deep-dive abstract(s) rebuilt from PubMed's record")
    h, n = bp.canonical_practice_name(h); n and print(f"  {n} practice name(s) written as CBG/MIGS")
    h, n = bp.drop_bracket_pseudo_citations(h); n and print(f"  {n} bracketed pseudo-citation(s) removed")
    if fmt == "trend" and not resume:
        h, n = bp.retire_verdict_gauge(h); n and print("  verdict gauge retired")
        h, n = bp.rebuild_pyramid_from_papers(h); n and print("  evidence pyramid rebuilt from the brief's papers")
        h, notes = bp.conform_trend_brief(W, h, real)
        for x in notes:
            print(f"  trend: {x[:150]}")

    # a finding about a section in EVERY deep dive (templated, truncated, a
    # pipeline dump) re-authors that section in all of them from the abstract
    names = {k: re.sub(r"&[a-z#0-9]+;", " ", v).split("—")[0].split("  ")[0].strip().lower() for k, v in bp.HEAD.items()}
    names.update({"findings": "key findings", "rob": "risk of bias", "methods": "methodology", "kb": "established literature",
                  "monday": "monday clinic", "equity": "equity", "strengths": "strengths", "applicability": "applicability",
                  "bottom": "bottom line", "prompts": "discussion prompts", "question": "clinical question"})
    systemic, rest = set(), []
    for f in findings:
        t = f"{f.get('what', '')} {f.get('where', '')}"
        if re.search(r"\b(?:every|all|each|most|majority|many)\b[^.]{0,40}(?:deep[- ]?dives?|dialogs?)|(?:six|five|four|three|seven|eight|\d+) (?:of \d+ )?deep[- ]dives?|every dialog|across (?:the )?(?:\w+ )?(?:of )?(?:the )?deep[- ]dives", t, re.I):
            keys = {k for k, nm in names.items() if nm and nm in t.lower() and k not in bp.NOT_AUTHORABLE}
            if not keys:
                # the finding quotes phrases, not a section: the sections that
                # hold those phrases are the ones to re-author
                for q in quotes_of(f.get("evidence", "") + " " + f.get("what", "")):
                    qn = re.sub(r"\s+", " ", q).strip().lower()[:30]
                    for key, body in re.findall(r'<section\b[^>]*\bid="dd-\d+-([a-z_]+)"[^>]*>([\s\S]*?)</section>', h):
                        if key not in bp.NOT_AUTHORABLE and qn and qn in re.sub(r"\s+", " ", H.unescape(re.sub(r"<[^>]+>", " ", body))).lower():
                            keys.add(key)
            if keys:
                systemic |= keys
                continue
        rest.append(f)
    if systemic:
        print(f"  re-authoring in every deep dive: {sorted(systemic)}")
        h, n_sys = bp.author_stub_sections(W, h, real, force_keys=tuple(sorted(systemic)))
        print(f"  {n_sys} deep-dive section(s) written again from their abstracts")
    findings = rest

    # every other confirmed finding, routed by what it is BEFORE a fix is
    # chosen: an off-topic paper, a headline, a hover card and a design label
    # each have their own fix; a structural fault is fixed by the steps every
    # brief goes through and verified by the gates after them
    offtopic, headline, popover, design, text, labels = [], [], [], [], [], []
    for f in findings:
        w = f.get("what", "")
        if HEADING_LABEL_RE.search(w):
            labels.append(f)
            continue
        if is_placement(w):
            offtopic.append(f)
            continue
        if STRUCTURAL_RE.search(w):
            continue
        if HEADLINE_RE.search(w):
            headline.append(f)
            if not re.search(r"narrative|synthesis|prose|dialog|deep[- ]dive|card|popover", w, re.I):
                continue          # the headline fields only: nothing in the body's prose to locate
        if DESIGN_RE.search(w):
            design.append(f)
        if POPOVER_SUBJECT_RE.search(w[:120]) or re.search(r"popover (?:says|states|gives|reads|lists|reports)", w, re.I):
            popover.append(f)
            has_text = container_of(f)[0] or container_by_name(f, h, real)[0] in ("card", "dialog") \
                or re.search(r"\bprose\b|synthesis|narrative|\bsentence", w, re.I)
            if not has_text:
                continue          # the hover card is the finding's whole subject
        text.append(f)
    if offtopic:
        h, notes = remove_offtopic(W, h, offtopic, real, fmt, post)
        for x in notes:
            print(f"  off-topic: {x[:200]}")
    h, fields, notes = headline_fields(W, h, post, fmt, headline)
    for x in notes:
        print(f"  headline: {x[:200]}")
    json.dump(fields, open(W + "fields.json", "w"), ensure_ascii=False, indent=1)
    for f in labels:
        h, _n = rewrite_labelled_heading(W, h, f)
        _n or print(f"  no heading on the page matches: {f.get('what', '')[:120]}")
    if popover:
        pf = []
        for f in popover:
            for pm in popover_pmids(f, h, real, W):
                pf.append(f"[popover:{pm}] {f.get('what', '')[:600]}")
        if pf:
            h, n_pop = bp.fix_popover_findings(W, h, pf, real)
            print(f"  {n_pop} hover card(s) written again from the abstract")
    if design:
        h, n_des = bp.verify_design_tags(W, h, real)
        print(f"  {n_des} design badge(s) corrected from the abstract")

    prose, attributed = [], []
    for f in text:
        what = f"{f.get('standard', '')}: {f.get('what', '')}"
        ev = f.get("evidence") or ""
        kind, pm = container_of(f)
        if not kind:
            kind, pm = container_by_name(f, h, real)
            kind = None if kind == "popover" else kind
        if kind:
            cont_text = " ".join(bp.container_pieces(h, kind, pm)).lower()
            qs = [q for q in quotes_of(ev + " " + f.get("what", "")) if re.sub(r"\s+", " ", q).strip().lower()[:40] in re.sub(r"\s+", " ", cont_text)]
            if not qs:
                # the finding paraphrases: the pieces it is about, located
                qs = bp.locate_in_container(W, h, kind, pm, f"{what}\nEVIDENCE: {ev}")
                qs and print(f"  {kind} {pm}: {len(qs)} piece(s) located for a finding that quotes nothing on the page")
            for q in qs[:4]:
                attributed.append(f'[{kind}:{pm}] {what[:200]}: "{q}" ({f.get("what", "")[:300]})')
            if not qs:
                print(f"  {kind} {pm}: nothing in it carries the finding — {f.get('what', '')[:120]}")
        else:
            prose.append({"what": what, "evidence": ev})
    n_att = n_pro = n_cite = 0
    if attributed:
        h, n_att = bp.fix_attributed_text(W, h, attributed, real)
    # a prose finding whose quotes are not on the page (paraphrased, or quoting
    # across an ellipsis) gets its sentences located by the model first
    located = []
    for x in prose:
        if bp._quoted_sites(h, x["evidence"]) or bp._quoted_sites(h, x["what"]):
            located.append(x)
            continue
        more = bp.all_instances(W, h, f"{x['what']}\nEVIDENCE: {x['evidence']}")
        if more:
            print(f"  {len(more)} sentence(s) located for a finding that quotes nothing on the page")
            located += [{"what": x["what"], "evidence": f'"{q}"'} for q in more]
        else:
            print(f"  no sentence of the prose carries: {x['what'][:140]}")
    prose = located
    uncited = [x for x in prose if re.search(r"no (?:inline )?citation|uncited|without a citation|carries no", x["what"], re.I)]
    for x in list(uncited):
        # "…repeated near-verbatim in Closing thoughts": the other places too
        if re.search(r"\be\.g\.|for example|such as|repeat", x["what"], re.I):
            more = bp.all_instances(W, h, x["what"])
            uncited += [{"what": x["what"], "evidence": f'"{q}"'} for q in more if q not in x["evidence"]]
    if uncited:
        faults_u = [f'[prose] claim without a citation: "{q}" ({x["what"][:160]})' for x in uncited for q in (quotes_of(x["evidence"]) or [x["evidence"].strip('"')])[:2]]
        h, n_cite = bp.fix_placement(W, h, faults_u, real)
        prose = [x for x in prose if x not in uncited]
    expanded = []
    for x in prose:
        expanded.append(x)
        if re.search(r"\be\.g\.|for example|such as|none of (?:the|those|these)|not grounded in any|no cited abstract|repeated", x["what"], re.I):
            more = bp.all_instances(W, h, x["what"])
            if more:
                print(f"  {len(more)} instance(s) of one finding located across the page")
            expanded += [{"what": x["what"], "evidence": f'"{q}"'} for q in more]
    prose = expanded
    if prose:
        h, n_pro = bp.repair_from_defects(W, h, prose, drop_unsupported=True)
    h, n_exp = bp.fix_invented_experience(W, h)
    n_exp and print(f"  {n_exp} sentence(s) claiming the clinician's own experience rewritten from the paper")
    h, n_abs = bp.fix_absolute_words(W, h, real)
    h, n_st = bp.author_stub_sections(W, h, real)
    h, _b = bp.cite_uncited_cards(W, h, real)
    h, n_tot = bp.fix_document_totals(W, h, real)      # prose totals ("72 papers across 9 topics")
    n_tot and print(f"  {n_tot} total(s) in the prose rebuilt from what the page holds")
    # every deterministic finishing step, from the ONE list the pipeline keeps
    h = bp.final_assembly(W, h, real, fmt)
    print(f"  fixed: {n_att} card/deep-dive text(s), {n_pro} prose sentence(s), {n_cite} citation(s) placed, {n_abs} never/always, {n_st} empty section(s)")

    # deterministic gates before the review is paid for — the deploy's own
    # leakage checks included, on the source and on the rendered text
    faults = bp.reader_prose_faults(h)
    import audit_no_internal_leakage as leak
    for label, pat in leak.BANNED:
        hits = leak.spec_hits(h, pat) if label == "internal spec reference" else pat.findall(h)
        if hits:
            faults.append(f"deploy leakage gate: {label} ({hits[:2]})")
    faults += [f"deploy leakage gate: {x}" for x in leak.rendered_hits(h)]
    faults += structural_faults(h, fmt)
    open(W + "fixed.html", "w", encoding="utf-8").write(h)
    if faults:
        print("  GATE FAULTS (not reviewed):")
        for x in faults[:12]:
            print("   ", x[:200])
        sys.exit(1)

    # the exhaustive sentence-level pass before the sampling review
    h, g = grounding_pass(W, pid, h, {"pmids": bp._carded_pmids(h), "format": fmt, "topics": []})
    open(W + "fixed.html", "w", encoding="utf-8").write(h)
    if g:
        print(f"  GROUNDING: {len(g)} sentence(s) still failing after repair — not reviewed")
        for x in g[:12]:
            print("   ", x[:220])
        sys.exit(3)
    print("  grounding: every sentence supported by its cited abstract")
    # the review: one reader, THE STANDARDS, the fixed page
    post["body_html"] = h
    open(W + "body.applied.html", "w", encoding="utf-8").write(h)
    json.dump(post, open(W + f"{pid}.applied.json", "w"), ensure_ascii=False)
    json.dump({"pmids": bp._carded_pmids(h), "format": fmt, "topics": []}, open(W + "manifest.json", "w"))
    os.makedirs(W + ".ledger", exist_ok=True)
    unmet = bp.standards_audit(W, pid, fatal=False)
    json.dump({"unmet": unmet}, open(W + "fixed.review.json", "w"), ensure_ascii=False, indent=1)
    if unmet:
        print(f"  REVIEW: {len(unmet)} standard(s) unmet")
        for x in unmet:
            print("   ", str(x)[:300])
        sys.exit(2)
    print("  REVIEW: every applicable standard met — ready to publish")


def grounding_pass(W: str, pid: str, h: str, man: dict) -> tuple:
    """Every sentence of every card, deep dive and paragraph judged against its
    cited abstract, and every finding repaired and re-judged: the exhaustive
    check. The standards review samples; this does not. (h, remaining)."""
    real = bp.real_from_work(W, sorted(set(bp._carded_pmids(h)) | {bp._pmid_of(m.group(0)) for m in bp.SUP_RE.finditer(h)} - {None}))
    g = bp.grounding_audit(W, h, man)
    # five rounds while each is still repairing: an element faulted a third
    # time is removed by fix_attributed_text, and with three rounds that third
    # fault was only ever seen by the final audit, which refused the brief for
    # one sentence the next round would have taken out (mast-cell, 2026-09-27).
    # Unchanged sentences replay from the grounding cache.
    for _round in range(5):
        if not g:
            break
        att = [f for f in g if bp._ATTRIBUTED_FAULT_RE.match(f)]
        pro = [f for f in g if bp._PROSE_FAULT_RE.match(f)]
        pop = [f for f in g if bp._POPOVER_FAULT_RE.match(f)]
        n_a = n_p = n_o = 0
        if att:
            h, n_a = bp.fix_attributed_text(W, h, att, real)
        if pro:
            h, n_p = bp.repair_prose_findings(W, h, pro, real)
        if pop:
            h, n_o = bp.fix_popover_findings(W, h, pop, real)
        print(f"  grounding round {_round + 1}: {len(g)} finding(s); repaired {n_a} card/deep-dive, {n_p} prose, {n_o} hover card(s)")
        if not (n_a or n_p or n_o):
            break
        h = bp.final_assembly(W, h, real, man.get("format", "weekly"))
        faults = bp.reader_prose_faults(h)
        if faults:
            return h, [f"a grounding repair broke a gate: {x}" for x in faults[:3]]
        open(W + "fixed.html", "w", encoding="utf-8").write(h)
        g = bp.grounding_audit(W, h, man)
    return h, g


def publish():
    """Publish the reviewed page. The server accepts a body only with a receipt
    recording BOTH a passed standards audit and a passed sentence-level
    grounding audit for that exact body — so the grounding audit runs here on
    the fixed page, and the receipt records only what actually ran."""
    import datetime, hashlib, subprocess
    pid = sys.argv[1]
    W = os.path.join(bp.SCRATCH, "renumber", pid) + "/"
    review = json.load(open(W + "fixed.review.json")) if os.path.exists(W + "fixed.review.json") else {"unmet": ["no review on record"]}
    if review.get("unmet"):
        sys.exit(f"{pid}: the review has unmet standards — not publishing: {review['unmet'][:2]}")
    h = open(W + "fixed.html", encoding="utf-8").read()
    post = bp.curl_json(f"{bp.BASE}/api/posts/{pid}"); post = post.get("post", post)
    fmt = "trend" if post.get("kind") == "blog" else "weekly"
    man = {"pmids": bp._carded_pmids(h), "format": fmt, "topics": []}
    h, g = grounding_pass(W, pid, h, man)
    if g:
        print(f"  GROUNDING: {len(g)} sentence(s) still failing — not publishing")
        for x in g[:15]:
            print("   ", x[:220])
        sys.exit(3)
    print("  grounding audit: every sentence supported by its cited abstract")
    post["body_html"] = h
    # the headline fields the fix wrote (title, summary) travel with the body
    own = json.load(open(W + "fields.json")) if os.path.exists(W + "fields.json") else {}
    post.update({k: v for k, v in own.items() if k in ("title", "summary") and isinstance(v, str) and v})
    fields, _n = bp.canonical_post_fields(post)
    fields.update({k: post[k] for k in own if k in ("title", "summary") and post.get(k)})
    post.update(fields)
    if bp.post_field_faults(post):
        sys.exit(f"{pid}: {bp.post_field_faults(post)}")
    json.dump(post, open(W + f"{pid}.applied.json", "w"), ensure_ascii=False)
    aud = subprocess.run(["node", "-e",
        "import('%s/functions/_lib/post_format.js').then(m=>{const p=JSON.parse(require('fs').readFileSync('%s','utf8'));"
        "const a=m.auditPublishable(p);console.log(JSON.stringify({publishable:a.publishable,problems:a.problems}))})"
        % (bp.ROOT, W + f"{pid}.applied.json")], capture_output=True, text=True, cwd=bp.ROOT)
    verdict = json.loads((aud.stdout.strip() or "{}").splitlines()[-1]) if aud.stdout.strip() else {}
    if not verdict.get("publishable"):
        sys.exit(f"{pid}: the site's publish audit refused it: {json.dumps(verdict.get('problems'))[:400]}")
    receipt = {"body_sha256": hashlib.sha256(h.encode("utf-8")).hexdigest(),
               "standards_passed": True, "grounding_passed": True,
               "pipeline_digest": bp._sha_file(bp.__file__),
               "scope": ("published brief fixed from the confirmed findings of two independent readers; every finding "
                         "repaired from its paper's PubMed abstract; reviewed against THE STANDARDS and audited sentence "
                         "by sentence against the cited abstracts before publishing"),
               "checked_at": datetime.datetime.utcnow().isoformat() + "Z"}
    json.dump({"body_html": h, "pipeline_receipt": receipt, **fields}, open(W + "_put.json", "w"), ensure_ascii=False)
    print("PUT:", json.dumps(bp.curl_json(f"{bp.BASE}/api/posts/{pid}", "PUT", auth=True, data_file=W + "_put.json"))[:200])
    json.dump({}, open(W + "_approve.json", "w"))
    print("APPROVE:", json.dumps(bp.curl_json(f"{bp.BASE}/api/posts/{pid}/approve", "POST", auth=True, data_file=W + "_approve.json"))[:200])
    bp.verify_rendered(bp._route_for(pid, post.get("kind")), pid)
    print(f"{pid}: published and verified on its live route")


def preflight():
    """No model calls: the brief's saved fixed page (else its live page) through
    final_assembly, then every deterministic gate — the pipeline's reader and
    body invariants, the deploy's leakage checks, the trend format checks and
    the site's own publish audit. Run over every brief before any model step
    is paid for, so a class of defect is found across all of them at once."""
    import subprocess
    pid = sys.argv[1]
    W = os.path.join(bp.SCRATCH, "renumber", pid) + "/"
    post = bp.curl_json(f"{bp.BASE}/api/posts/{pid}"); post = post.get("post", post)
    fmt = "trend" if post.get("kind") == "blog" else "weekly"
    h = open(W + "fixed.html", encoding="utf-8").read() if os.path.exists(W + "fixed.html") else post["body_html"]
    pmids = sorted(set(bp._carded_pmids(h)) | {bp._pmid_of(m.group(0)) for m in bp.SUP_RE.finditer(h)} - {None})
    real = bp.real_from_work(W, pmids)
    h = bp.final_assembly(W, h, real, fmt)
    faults = list(bp.reader_prose_faults(h))
    man = {"pmids": bp._carded_pmids(h), "format": fmt, "topics": [t.tid for t in bp._topic_sections(h)] if fmt != "trend" else []}
    try:
        faults += [f for f in bp.prose_faults(W, h, man) if f not in faults]
    except SystemExit:
        pass
    if fmt == "trend":
        faults += bp.trend_format_faults(h)
    import audit_no_internal_leakage as leak
    for label, pat in leak.BANNED:
        hits = leak.spec_hits(h, pat) if label == "internal spec reference" else pat.findall(h)
        if hits:
            faults.append(f"deploy leakage gate: {label} ({hits[:2]})")
    faults += [f"deploy leakage gate: {x}" for x in leak.rendered_hits(h)]
    faults += [x for x in structural_faults(h, fmt) if x not in faults]
    post["body_html"] = h
    json.dump(post, open(W + f"{pid}.preflight.json", "w"), ensure_ascii=False)
    aud = subprocess.run(["node", "-e",
        "import('%s/functions/_lib/post_format.js').then(m=>{const p=JSON.parse(require('fs').readFileSync('%s','utf8'));"
        "const a=m.auditPublishable(p);console.log(JSON.stringify({publishable:a.publishable,problems:a.problems}))})"
        % (bp.ROOT, W + f"{pid}.preflight.json")], capture_output=True, text=True, cwd=bp.ROOT)
    v = json.loads((aud.stdout.strip() or "{}").splitlines()[-1]) if aud.stdout.strip() else {}
    if not v.get("publishable"):
        faults += [f"site publish audit: {x}" for x in (v.get("problems") or ["refused"])]
    json.dump(faults, open(W + "preflight.json", "w"), ensure_ascii=False, indent=1)
    print(f"{pid}: {len(faults)} deterministic fault(s)")
    for x in faults[:25]:
        print("   ", str(x)[:200])


if __name__ == "__main__":
    publish() if "--publish" in sys.argv else preflight() if "--preflight" in sys.argv else main()
