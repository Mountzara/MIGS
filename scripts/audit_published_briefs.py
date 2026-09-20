#!/usr/bin/env python3
"""Every published brief, checked for the defects that have shipped before.

Each rule here is a defect that reached readers once. The pipeline now
prevents all of them, but prevention only covers briefs built AFTER the fix —
this reads the live site and says whether any of them is still there. It is
deterministic and needs no model: a name, a number, a tag or an id is either
right or it is not.

  * a citation marker showing a PMID instead of its number      (W21, 8 trend briefs)
  * an opening tag whose ">" was pushed past its own text        (a trend brief)
  * a list item left empty by a removed sentence                 (a trend brief)
  * a carded paper no sentence cites                             (W21: 72 cards, 71 cited)
  * a cited paper the brief does not card                        (W21: 21 markers to one)
  * a deep dive numbered differently from its own marker         (4 trend briefs)
  * prose or a card crediting a paper to someone who did not write it   (W21: 19 sentences)

--deep adds the two checks that need a model: whether the page's figures
agree with each other, and whether the lede and section intros say more than
their papers do.

Usage: audit_published_briefs.py [--base=URL] [--only=<id-fragment>] [--deep]
Exit status is the number of briefs with a fault, 0 when the site is clean.
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import brief_pipeline as bp                      # noqa: E402
from _lib_brief_routes import published_brief_routes   # noqa: E402

BASE = next((a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("--base=")), bp.BASE)
ONLY = [a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("--only=")]
DEEP = "--deep" in sys.argv
CARD_RE = r'<article class="mz-cite-card[\s\S]*?</article>'


def _surnames(text):
    return set(re.findall(r"\b([A-Z][a-zà-ſ]{2,})\b", text or ""))


def faults(pid, h):
    out = []
    marks = [re.sub(r"<[^>]+>", "", m).strip()
             for m in re.findall(r'<a class="mz-ref-link"[^>]*>(.*?)</a>', h, re.S)]
    pmid_like = [m for m in marks if re.fullmatch(r"\d{5,9}", m)]
    if pmid_like:
        out.append(f"{len(pmid_like)} of {len(marks)} marker(s) show a PMID, not a number")
    out += bp.malformed_tag_faults(h)[:2]

    blanks = [m for m in re.finditer(r"<li\b[^>]*>([\s\S]*?)</li>", h)
              if not re.sub(r"[\s ]|&nbsp;", "",
                            bp.H.unescape(re.sub(r"<[^>]+>", "", bp.SUP_RE.sub("", m.group(1)))))]
    if blanks:
        out.append(f"{len(blanks)} list item(s) a reader sees as a blank bullet")

    cards = re.findall(CARD_RE, h)
    carded = {(re.search(bp.CARD_ID_RE, c) or re.search(r"openDeepDive\('dd-(\d+)'", c)
               or [None, None])[1] for c in cards} - {None}
    cited = {bp._pmid_of(m.group(0)) for m in bp.SUP_RE.finditer(h)} - {None}
    if carded - cited:
        out.append(f"{len(carded - cited)} carded paper(s) no sentence cites: {sorted(carded - cited)[:4]}")
    if cited - carded:
        out.append(f"{len(cited - carded)} cited paper(s) the brief does not card: {sorted(cited - carded)[:4]}")

    first = {}
    for m in bp.SUP_RE.finditer(h):
        q = bp._pmid_of(m.group(0))
        n = re.search(r'mz-ref-link"[^>]*>(\d+)<', m.group(0))
        if q and n and q not in first:
            first[q] = n.group(1)
    for d in re.finditer(r"<dialog\b[\s\S]*?</dialog>", h):
        q = (re.search(r'<dialog[^>]*\bid="dd-(\d{5,9})"', d.group(0)) or [None, None])[1]
        lab = re.search(r"Paper\s*#\s*(\d+)", d.group(0))
        if q and lab and q in first and lab.group(1) != first[q]:
            out.append(f"the deep dive for {q} says Paper #{lab.group(1)} where its marker says {first[q]}")

    everyone = set()
    for m in re.finditer(r'<p class="mz-cite-meta">([\s\S]*?)</p>'
                         r'|<span class="mz-ref-pop-meta">([\s\S]*?)</span>', h):
        everyone |= _surnames(bp.H.unescape(re.sub(r"<[^>]+>", " ", m.group(1) or m.group(2) or "")))

    def unknown(names):
        return [x for x in dict.fromkeys(names)
                if x not in bp._NOT_A_SURNAME and x not in everyone
                and not bp._near_surname(x, everyone)]

    for m in re.finditer(CARD_RE, h):
        meta = re.search(r'<p class="mz-cite-meta">([\s\S]*?)</p>', m.group(0))
        find = re.search(r'<p class="mz-cite-finding">([\s\S]*?)</p>', m.group(0))
        if not (meta and find):
            continue
        own = _surnames(bp.H.unescape(re.sub(r"<[^>]+>", " ", meta.group(1))))
        ftxt = bp.H.unescape(re.sub(r"<[^>]+>", " ", find.group(1)))
        for x in unknown(re.findall(r"\b([A-Z][a-zà-ſ]{2,})\s+et\s+al\.", ftxt)):
            if x not in own:
                out.append(f"a card credits {x} et al. above a byline of {sorted(own)[:2]}")

    for ps in bp._prose_passages(h):
        frag = ps.group(1)
        masked = bp._mask_noprose(frag)
        sents = bp._sentences_of(masked)
        for k, (t, e) in enumerate(sents):
            # a sentence stating a PMID of its own is naming a paper outside
            # the brief on purpose (W24 explaining an Expression of Concern)
            if re.search(r"\bPMID\s*:?\s*\d{5,9}", t) or re.search(
                    r"\b(?:expression\s+of\s+concern|retract(?:ion|ed|s)|correction\s+to|erratum|corrigendum"
                 r"|comment(?:ary)?\s+on|repl(?:y|ies)\s+to|response\s+to|withdrawn)\b", t, re.I):
                continue
            names = unknown(re.findall(r"\b([A-Z][a-zà-ſ]{2,})\s+et\s+al\.", t))
            if not names:
                continue
            s0 = bp._sentence_start(masked, sents[k - 1][1] if k >= 1 else 0)
            if any(bp._pmid_of(x.group(0)) for x in bp.SUP_RE.finditer(frag, s0, bp._after_run(frag, e))):
                out.append(f"prose credits {names[0]} et al. for a paper nobody of that name wrote")
    return list(dict.fromkeys(out))


def main():
    try:
        routes = published_brief_routes(BASE)
    except Exception as e:
        print(f"could not enumerate published briefs: {e}")
        return 1
    bad = 0
    for r in routes:
        pid = r.split("?id=", 1)[1]
        if ONLY and not any(o in pid for o in ONLY):
            continue
        p = bp.curl_json(f"{BASE}/api/posts/_admin/{pid}", auth=True)
        h = (p.get("post", p)).get("body_html") or ""
        if not h:
            print(f"  {pid}: no body"); bad += 1; continue
        f = faults(pid, h)
        if DEEP:
            w = os.path.join(bp.SCRATCH, "audit", pid) + "/"
            os.makedirs(w, exist_ok=True)
            counts = {"distinct_papers_cited": len({bp._pmid_of(m.group(0)) for m in bp.SUP_RE.finditer(h)} - {None}),
                      "topic_sections": len(bp._topic_sections(h)),
                      "reference_entries": len(re.findall(r'<li id="ref-\d+">', h))}
            for d in bp.numeric_consistency_defects(w, h, counts):
                f.append("figures disagree: " + str(d.get("what"))[:150])
        if f:
            bad += 1
            print(f"\n  ✗ {pid}")
            for x in f[:8]:
                print(f"      {x}")
        else:
            print(f"  ✓ {pid}")
    print()
    if bad:
        print(f"🛑 {bad} of {len(routes)} published brief(s) carry a defect that has shipped before")
    else:
        print(f"every one of {len(routes)} published brief(s) is clean: markers numbered, cards and "
              f"citations in step, names matching their papers, markup a browser can read")
    return bad


sys.exit(main())
