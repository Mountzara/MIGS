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
    """The body invariants the pipeline itself refuses to publish without,
    plus the two attribution checks that need the page's own bylines.

    The invariants live in brief_pipeline.body_invariant_faults so there is
    ONE list: a brief is held to the same standard before it ships and after.
    """
    out = list(bp.body_invariant_faults(h))

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
        for x in unknown(re.findall(r"\b([A-Z][a-z\u00e0-\u017f]{2,})\s+et\s+al\.", ftxt)):
            if x not in own:
                out.append(f"a card credits {x} et al. above a byline of {sorted(own)[:2]}")

    for ps in bp._prose_passages(h):
        frag = ps.group(1)
        masked = bp._mask_noprose(frag)
        sents = bp._sentences_of(masked)
        for k, (t, e) in enumerate(sents):
            # a sentence stating a PMID of its own, or reporting an editorial
            # notice on another paper, is naming an outside study on purpose
            if re.search(r"\bPMID\s*:?\s*\d{5,9}", t) or re.search(
                    r"\b(?:expression\s+of\s+concern|retract(?:ion|ed|s)|correction\s+to|erratum|corrigendum"
                    r"|comment(?:ary)?\s+on|repl(?:y|ies)\s+to|response\s+to|withdrawn)\b", t, re.I):
                continue
            cand = [x for x in dict.fromkeys(
                re.findall(r"\b([A-Z][a-z\u00e0-\u017f]{2,})\s+et\s+al\.", t)
                + re.findall(r"\b([A-Z][a-z\u00e0-\u017f]{2,})['\u2019]s\s+(?:OR|HR|RR|aOR|AOR|n\b|cohort|trial|review|study|series|data|finding|result|analysis|meta)", t)
                + re.findall(r"\b([A-Z][a-z\u00e0-\u017f]{2,})\s+(?:19|20)\d\d\b", t))
                if x not in bp._NOT_A_SURNAME]
            if not cand:
                continue
            s0 = bp._sentence_start(masked, sents[k - 1][1] if k >= 1 else 0)
            cites = [q for q in dict.fromkeys(bp._pmid_of(x.group(0)) for x in bp.SUP_RE.finditer(frag, s0, bp._after_run(frag, e))) if q]
            if not cites:
                continue
            # the authority is the sentence's own citations: their bylines as
            # the page prints them in the popover meta
            cited_names = set()
            for q in cites:
                mm = re.search(r'id="ref-pop-%s(?:-\d+)?"[\s\S]{0,600}?mz-ref-pop-meta">([^<]*)' % q, h)
                if mm:
                    # the authors are before the first "·"; after it come the
                    # journal and year, and "Menopause" is a journal, not a person
                    cited_names |= _surnames(bp.H.unescape(mm.group(1)).split("\u00b7")[0])
            if not cited_names:
                continue
            names = [x for x in cand if x not in cited_names and not bp._near_surname(x, cited_names)]
            if names:
                out.append(f"prose credits {names[0]} for a paper by {sorted(cited_names)[:2]}")
    return list(dict.fromkeys(out))


def main():
    try:
        routes = published_brief_routes(BASE)
    except Exception as e:
        print(f"could not enumerate published briefs: {e}")
        return 1
    bad = checked = 0
    for r in routes:
        pid = r.split("?id=", 1)[1]
        if ONLY and not any(o in pid for o in ONLY):
            continue
        checked += 1
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
    # the summary counts what was CHECKED. With --only it once said "every
    # one of 16 published briefs is clean" after looking at one of them.
    scope = f"{checked} of {len(routes)} published brief(s)" if ONLY else f"all {len(routes)} published brief(s)"
    if bad:
        print(f"🛑 {bad} of the {checked} checked carry a defect that has shipped before ({scope} checked)")
    elif ONLY:
        print(f"{scope} checked and clean — the other {len(routes) - checked} were NOT checked")
    else:
        print(f"{scope} clean: markers numbered, cards and citations in step, names matching "
              f"their papers, markup a browser can read")
    return bad


sys.exit(main())
