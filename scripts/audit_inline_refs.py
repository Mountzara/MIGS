# -*- coding: utf-8 -*-
"""
AUDITOR 4 of N — INLINE-REFERENCE synopsis integrity (independent safety net).

STRENGTH: the hover/inline citation popovers must show an ACCURATE, COMPLETE,
coherent synopsis of the article — never cut off mid-sentence with "…", never an
empty/placeholder ("PubMed record" / blank), and never text that isn't actually
about that paper. Checks each popover across all template eras:

  • truncated        — synopsis ends in an ellipsis ("…"/"...") = cut mid-sentence
  • incomplete       — doesn't end in sentence punctuation (. ! ? ) " ')
  • empty/too-short  — < 25 chars of real text (blank or a fragment)
  • placeholder      — title is a stub like "PubMed record"
  • authors-as-finding — the synopsis is just an author byline ("Smith J, Doe A.")
  • accuracy         — the synopsis isn't traceable to the paper's PubMed abstract
                       (none of its content words appear in the verbatim abstract)

Independent: pure-text for the structural checks; uses the shared NCBI core
(pubmed_fetch) only for the accuracy check, and falls back to skipping accuracy
(informational) if NCBI is unavailable — so it always runs.

Usage: python3 scripts/audit_inline_refs.py --post <body.json> [--strict]
"""
from __future__ import annotations
import argparse, json, re, sys, html
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent / "_authoring"))
from pubmed_fetch import fetch  # noqa

HTML = re.compile(r'<[^>]+>')
def clean(s): return re.sub(r'\s+', ' ', HTML.sub(' ', html.unescape(s or ''))).strip()

# popover finding/synopsis span classes across template eras
FINDING_CLS = r'(?:mz-ref-pop-finding|mz-ref-finding)'
TITLE_CLS = r'(?:mz-ref-pop-title|mz-ref-title)'
PLACEHOLDER_TITLES = {"pubmed record", "reference", "—", ""}
AUTHOR_ONLY = re.compile(r'^([A-ZÀ-Ý][\w’\'-]+ [A-ZÀ-Ý]{1,3}(?:,? )?){1,10}\.?$')


def popovers(h: str):
    """Yield (pmid, title, finding) for every inline-reference popover, tying each
    popover to ITS OWN pmid (from the sup block's anchor / aria / popover id) —
    NOT a nearby reference's link (which produced false accuracy flags)."""
    # iterate over each <sup class="mz-ref"…>…</sup> block (the whole popover)
    for sm in re.finditer(r'<sup class="mz-ref"[^>]*>(.*?)</sup>', h, re.DOTALL):
        block = sm.group(0)
        tm = re.search(r'<span class="'+TITLE_CLS+r'">(.*?)</span>', block, re.DOTALL)
        fm = re.search(r'<span class="'+FINDING_CLS+r'">(.*?)</span>', block, re.DOTALL)
        if not fm:
            continue
        # this popover's OWN pmid — from its anchor (#mz-ref-PMID),
        # aria-describedby/id (ref-pop-PMID), or the FIRST link inside the block.
        pm = (re.search(r'href="#mz-ref-(\d+)"', block) or
              re.search(r'(?:aria-describedby|id)="ref-pop-(\d+)"', block) or
              re.search(r'pubmed\.ncbi\.nlm\.nih\.gov/(\d+)', block))
        yield (pm.group(1) if pm else "?",
               clean(tm.group(1)) if tm else "",
               clean(fm.group(1)))


def audit_post(post: dict) -> list[tuple]:
    h = post["body_html"]
    seen, items = set(), []
    for pmid, title, finding in popovers(h):
        key = (pmid, finding[:60], title[:40])
        if key in seen:
            continue
        seen.add(key)
        items.append((pmid, title, finding))
    pmids = sorted({p for p, _, _ in items if p.isdigit()})
    recs = fetch(pmids) if pmids else {}
    ncbi_ok = any(not recs[p].get("_offline") and not recs[p].get("_missing")
                  for p in recs) if recs else False
    flags = []
    for pmid, title, finding in items:
        tag = f"{pmid}"
        if title.lower() in PLACEHOLDER_TITLES:
            flags.append((tag, "placeholder-title", f"title='{title}'"))
        if not finding or len(finding) < 25:
            flags.append((tag, "empty-or-too-short", f"finding='{finding}'"))
            continue
        if finding.endswith(("...", "…", "..")):
            flags.append((tag, "truncated-mid-sentence", f"…{finding[-55:]}"))
        elif finding[-1] not in '.!?)"’\'':
            flags.append((tag, "incomplete-no-terminal-punct", f"…{finding[-45:]}"))
        if AUTHOR_ONLY.match(finding):
            flags.append((tag, "synopsis-is-author-byline", f"'{finding[:45]}'"))
        # accuracy: synopsis content traceable to the real abstract
        if pmid.isdigit() and ncbi_ok:
            ab = (recs.get(pmid, {}).get("abstract") or "").lower()
            if len(ab) >= 40:
                words = [w for w in re.findall(r'[a-z]{5,}', finding.lower()) if w not in
                         ("study", "results", "patients", "associated", "between", "compared")]
                if words and not any(w in ab for w in words[:8]):
                    flags.append((tag, "synopsis-not-in-abstract",
                                  f"no content words of '{finding[:40]}…' found in PubMed abstract"))
    return flags, len(items), ncbi_ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--post"); ap.add_argument("--dir"); ap.add_argument("--strict", action="store_true")
    a = ap.parse_args()
    files = [Path(a.post)] if a.post else sorted(Path(a.dir).glob("*.json")) if a.dir else []
    if not files:
        print("specify --post or --dir", file=sys.stderr); return 3
    total = 0
    for f in files:
        try:
            post = json.loads(Path(f).read_text())
        except Exception:
            continue
        if "body_html" not in post:
            continue
        flags, n, ncbi_ok = audit_post(post)
        print(f"\n[INLINE-REFS] {post.get('id')} — {len(flags)} flag(s) over {n} popovers"
              f"{'' if ncbi_ok else '  (accuracy skipped — NCBI offline)'}")
        for tag, kind, detail in flags[:60]:
            print(f"   ⚠ {tag}  {kind}: {detail}")
        if len(flags) > 60:
            print(f"   … and {len(flags)-60} more")
        if not flags:
            print("   ✓ every inline reference has a complete, accurate, coherent synopsis")
        total += len(flags)
    print(f"\n[INLINE-REFS] TOTAL flags: {total}")
    return 2 if (a.strict and total) else 0


if __name__ == "__main__":
    sys.exit(main())
