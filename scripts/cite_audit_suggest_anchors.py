#!/usr/bin/env python3
"""
Auto-suggest per-page anchor mappings by matching each existing inline <sup data-r="ref-N">
tooltip label to the best paper in that page's verified KB pool.

For each page, walks the inline tooltips, scores each candidate verified-pool paper against
the tooltip's label by:
  - title token overlap (after stripping HTML and stopwords)
  - first-author surname match
  - year proximity
  - PMID identity (if existing PMID happens to be correct, big bonus)

Outputs a draft page_anchors.json that I can hand-tune before running cite_audit_apply.py.
"""
import json
import os
import re
import sys
from collections import OrderedDict

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CITE_DIR = os.path.join(REPO_ROOT, "cite_audit")
EDU_DIR = os.path.join(REPO_ROOT, "education")
OUT = os.path.join(CITE_DIR, "page_anchors_suggested.json")

VERIFIED = json.load(open(os.path.join(CITE_DIR, "verified_pmids.json")))
POOLS = json.load(open(os.path.join(CITE_DIR, "per_page_kb_pmid_pools.json")))
EXISTING = json.load(open(os.path.join(CITE_DIR, "page_anchors.json"))) if os.path.exists(os.path.join(CITE_DIR, "page_anchors.json")) else {}

STOPWORDS = {
    "the", "and", "for", "with", "from", "this", "that", "into", "after", "during",
    "review", "systematic", "meta", "analysis", "study", "trial", "clinical", "guideline",
    "practice", "bulletin", "committee", "opinion", "international", "association",
    "journal", "report", "paper", "article", "doi", "pmid", "evidence", "based",
    "international", "federation", "obstetricians", "gynecologists",
    "vol", "no", "et", "al", "vs", "versus",
}

# Inline cite extractor: capture ref-N + tooltip-label + current-pmid
INLINE_RE = re.compile(
    r'<sup class="mz-ref" data-r="(ref-\d+)"[^>]*>'
    r'<a href="#\1">\[\d+\]</a>'
    r'<span class="mz-ref-pop"[^>]*>([^<]+?)\s*&middot;\s*PMID\s*(\d+)</span>',
    re.DOTALL,
)

def tokens(text):
    text = re.sub(r'<[^>]+>', '', text or '')
    text = re.sub(r'[^A-Za-z0-9 ]', ' ', text)
    return [t.lower() for t in text.split() if len(t) >= 4 and t.lower() not in STOPWORDS]


def first_author_surname(authors):
    if not authors:
        return ""
    name = authors[0].strip()
    parts = name.split()
    if len(parts) >= 2 and re.fullmatch(r"[A-Z]+", parts[-1]):
        return " ".join(parts[:-1]).lower()
    return name.lower()


def score(label, pool_pmids):
    """Return list of (pmid, score, meta) sorted desc by score."""
    label_tokens = set(tokens(label))
    # Find first-author surname pattern from label (token right before "et al" or first comma)
    m = re.match(r'^\s*([A-Z][a-zA-Z\-]+(?:\s+[A-Z][a-zA-Z\-]+)?)\b', label)
    label_surname = (m.group(1).lower().split()[-1] if m else "")
    # Year
    ym = re.search(r'\b(19|20|21)\d{2}\b', label)
    label_year = int(ym.group(0)) if ym else None

    results = []
    for pmid in pool_pmids:
        meta = VERIFIED.get(pmid)
        if not meta or not meta.get("abstract"):
            continue
        title_tokens = set(tokens(meta.get("title", "")))
        overlap = len(label_tokens & title_tokens)
        s = overlap
        surname = first_author_surname(meta.get("authors", []))
        if label_surname and label_surname in surname:
            s += 5
        try:
            yr = int(meta.get("year") or "0")
        except ValueError:
            yr = 0
        if label_year and yr:
            diff = abs(label_year - yr)
            if diff == 0:
                s += 4
            elif diff <= 1:
                s += 2
            elif diff <= 3:
                s += 1
        results.append((pmid, s, meta))
    results.sort(key=lambda x: -x[1])
    return results


def build_for(slug):
    page_path = os.path.join(EDU_DIR, slug, "index.html")
    if not os.path.exists(page_path):
        return None
    html = open(page_path).read()
    cites = INLINE_RE.findall(html)
    if not cites:
        return None
    # Dedupe by ref_id (each ref-N appears many times inline)
    by_refid = OrderedDict()
    for ref_id, label, current_pmid in cites:
        if ref_id not in by_refid:
            by_refid[ref_id] = (label.strip(), current_pmid)

    pool_pmids = [p["pmid"] for p in POOLS.get(slug, [])]
    anchors = []
    for ref_id, (label, current_pmid) in by_refid.items():
        ranked = score(label, pool_pmids)
        # If current PMID is in verified+abstract, treat it as a strong candidate
        if current_pmid in VERIFIED and VERIFIED[current_pmid].get("abstract"):
            current_meta = VERIFIED[current_pmid]
            current_title_tokens = set(tokens(current_meta.get("title", "")))
            label_tokens = set(tokens(label))
            current_overlap = len(label_tokens & current_title_tokens)
            # Big bonus if existing PMID's title matches the label well — keep it as anchor
            if current_overlap >= 3:
                top = (current_pmid, 100, current_meta)
            else:
                top = ranked[0] if ranked else (None, 0, None)
        else:
            top = ranked[0] if ranked else (None, 0, None)
        pmid, sc, meta = top
        anchors.append({
            "ref_id": ref_id,
            "pmid": pmid,
            "current_pmid": current_pmid,
            "current_label": label,
            "claim": "",  # to be filled in manually
            "score": sc,
            "suggested_label": (meta.get("title", "")[:90] if meta else None),
            "suggested_first_author": ((meta.get("authors") or [""])[0] if meta else None),
            "suggested_year": (meta.get("year") if meta else None),
        })
    return anchors


def main():
    slugs = sys.argv[1:] if len(sys.argv) > 1 else list(POOLS.keys())
    suggestions = {}
    for slug in slugs:
        s = build_for(slug)
        if s is None:
            print(f"  {slug}: no cites or page missing")
            continue
        suggestions[slug] = {"anchors": s, "keywords": EXISTING.get(slug, {}).get("keywords", [])}
        print(f"  {slug}: {len(s)} unique ref-N positions found")
        for a in s:
            mark = "✓" if a["pmid"] == a["current_pmid"] and a["score"] >= 100 else "*" if a["score"] >= 4 else "?"
            print(f"    {a['ref_id']:>7} {mark} score={a['score']:>3}  current PMID {a['current_pmid']} → suggest PMID {a['pmid']}")
            print(f"      claim: {a['current_label'][:90]}")
            if a.get("suggested_label"):
                print(f"      pick:  {a.get('suggested_first_author','?')[:25]} — {a['suggested_label']} ({a.get('suggested_year')})")
        print()

    with open(OUT, "w") as f:
        json.dump(suggestions, f, indent=2)
    print(f"\nWrote suggestions → {OUT}")


if __name__ == "__main__":
    main()
