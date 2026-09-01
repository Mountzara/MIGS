#!/usr/bin/env python3
"""Rebuild every education-page citation popover to the full spec.

The spec (scripts/apply_inline_refs.py, used by the posts) is a structured
popover: title, meta, and a FINDING — the one-line "what it shows" summary a
reader gets on hover without leaving the sentence. The education pages
shipped a bare "Title, Journal Year · PMID" line instead: 424 popovers
across the 12 guides and their portal mirrors, not one carrying the summary
— even though 85 of the 100 reference blocks on those same pages already
hold exactly that text, curated, in their .ref-what field.

So this is plumbing, not authorship: each popover is rebuilt from ITS OWN
PAGE's reference list. Where a reference has no curated .ref-what, the
popover gets title+meta only and the gap is REPORTED — writing "what a
paper shows" is clinical content, and this repo's rule is that clinical
content comes from the curated KB or the owner, never generated in a fixup.

  python3 scripts/fix_ref_popovers.py            # dry run
  python3 scripts/fix_ref_popovers.py --apply
"""
import re, sys, glob, html

APPLY = "--apply" in sys.argv

POP_CSS = """
/* Structured citation popovers (2026-09-01) — title / meta / finding, the
   same anatomy the journal-club posts use. The finding is the page's own
   curated "what it shows" line, surfaced at the citation instead of only
   at the bottom of the page. */
.mz-ref-pop { text-align: left; }
.mz-ref-pop-title { display: block; font-weight: 600; color: #1A1726; line-height: 1.35; }
.mz-ref-pop-meta { display: block; font-size: 11px; color: #6E6A7C; margin-top: 3px; letter-spacing: 0.02em; }
.mz-ref-pop-finding { display: block; margin-top: 7px; padding-top: 7px; border-top: 1px solid #E9E5EE;
    font-size: 12px; line-height: 1.5; color: #4A4658; }
"""

def strip(t): return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", t or "")).strip()

def refs_of(page):
    out = {}
    for m in re.finditer(r'<li id="(ref-\d+)">([\s\S]*?)</li>', page):
        body = m.group(2)
        label = strip((re.search(r'<div class="ref-label">([\s\S]*?)</div>', body) or [None, ""])[1])
        what = strip((re.search(r'<div class="ref-what">([\s\S]*?)</div>', body) or [None, ""])[1])
        pmid = (re.search(r'pubmed\.ncbi\.nlm\.nih\.gov/(\d{5,9})', body) or [None, ""])[1]
        out[m.group(1)] = {"label": label, "what": what, "pmid": pmid}
    return out

def build_pop(ref):
    # label reads "Author et al., Title, Journal Year" — first comma splits
    # attribution from the rest; the popover leads with the whole label as
    # its title line (it is exactly what the reader needs to recognise the
    # paper) and carries the PMID in the meta line.
    title = html.escape(ref["label"], quote=False)
    meta = ("PMID " + ref["pmid"]) if ref["pmid"] else ""
    parts = [f'<span class="mz-ref-pop-title">{title}</span>']
    if meta:
        parts.append(f'<span class="mz-ref-pop-meta">{meta}</span>')
    if len(ref["what"]) >= 30:
        parts.append(f'<span class="mz-ref-pop-finding">{html.escape(ref["what"], quote=False)}</span>')
    return '<span class="mz-ref-pop" role="tooltip">' + "".join(parts) + "</span>"

def fix_page(path):
    s = open(path, encoding="utf-8").read()
    refs = refs_of(s)
    if not refs: return None
    rebuilt = [0]; gaps = []
    def sub(m):
        rid = m.group(1)
        ref = refs.get(rid)
        if not ref or not ref["label"]: return m.group(0)
        rebuilt[0] += 1
        if len(ref["what"]) < 30: gaps.append((rid, ref["label"][:70]))
        return m.group(0).split('<span class="mz-ref-pop"')[0] + build_pop(ref) + "</sup>"
    out = re.sub(r'<sup class="mz-ref" data-r="(ref-\d+)"[^>]*>[\s\S]*?</sup>', sub, s)
    if "mz-ref-pop-finding {" not in out:
        out = out.replace("</style>", POP_CSS + "</style>", 1)
    if out == s: return None
    if APPLY:
        open(path, "w", encoding="utf-8").write(out)
    return rebuilt[0], gaps

def main():
    files = sorted(glob.glob("education/*/index.html") + glob.glob("portal/education/*/index.html"))
    files = [f for f in files if "_template" not in f]
    total = 0; all_gaps = {}
    for f in files:
        r = fix_page(f)
        if not r: continue
        n, gaps = r
        total += n
        print(f"  {f:<56} {n:3d} popover(s) rebuilt" + (f", {len(gaps)} without curated summary" if gaps else ""))
        for rid, lab in gaps:
            all_gaps.setdefault((rid, lab), []).append(f)
    print(f"\n{total} popover(s) rebuilt {''if APPLY else '(dry run — pass --apply)'}")
    if all_gaps:
        print(f"\n{len(all_gaps)} reference(s) have NO curated 'what it shows' — the popover carries")
        print("title+meta only until a clinician writes one (fill .ref-what on the page):")
        for (rid, lab), fs in sorted(all_gaps.items()):
            print(f"  {rid}  {lab}")
    return 0

sys.exit(main())
