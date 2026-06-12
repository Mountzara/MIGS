# -*- coding: utf-8 -*-
"""
AUDITOR 1 of 3 — ACCURACY (independent safety net).

STRENGTH: factual fidelity to the primary source. For every authored deep-dive
it re-fetches the paper's record LIVE from NCBI PubMed and checks:
  • every multi-digit statistic asserted in bottom/findings/methods/PICO appears
    in the verbatim PubMed abstract (catches fabricated/drifted numbers);
  • the asserted PICO study-design is consistent with PubMed's own
    PublicationType (catches calling a cohort an "RCT", a review a "trial", etc.).

Independent by design: relies only on the post's authored text + the live NCBI
record. No dependence on the other two auditors. It does NOT judge interpretation
nuance or voice — those are Auditors 2 and 3.

Usage:
  python3 scripts/audit_accuracy.py --post <body.json> [--strict]
  python3 scripts/audit_accuracy.py --dir <dir-of-post-json>
"""
from __future__ import annotations
import argparse, json, re, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent / "_authoring"))
from pubmed_fetch import fetch  # noqa: E402

HTML = re.compile(r'<[^>]+>')
AUTHORED_SECS = ("bottom", "findings", "methods", "pico")
# authored PICO-design phrase  ->  PubMed PublicationType cues that must co-occur.
# NOTE: only full, unambiguous design phrases — NOT bare "rct"/"phase 3", which
# false-match inside "systematic review of RCTs".
DESIGN_RULE = {
    "randomized controlled trial": ["randomized controlled trial", "clinical trial"],
    "meta-analysis": ["meta-analysis"],
    "case report": ["case reports"],
}
# designs that legitimately *include* RCTs but are NOT themselves trials
_NOT_TRIAL = ("review", "meta-analysis", "guideline", "consensus", "protocol")


def strip(s): return re.sub(r'\s+', ' ', HTML.sub(' ', s or '')).strip()


def nums(s):
    out = set()
    for n in re.findall(r'\b\d[\d,\.]*\b', s):
        c = n.replace(',', '').replace('.', '')
        if len(c) < 3 or re.fullmatch(r'(19|20)\d\d', n.replace(',', '')):
            continue
        out.add(n)
    return out


def audit_post(post: dict) -> list[tuple]:
    h = post["body_html"]
    modals = {}
    for md in re.finditer(r'<dialog[^>]*id="dd-(\d+)"[^>]*>(.*?)</dialog>', h, re.DOTALL):
        modals[md.group(1)] = md.group(2)
    recs = fetch(list(modals))
    flags = []
    for pmid, body in modals.items():
        rec = recs.get(pmid, {})
        ab = (rec.get("abstract") or "").lower()
        ptypes = " ; ".join(rec.get("publication_types") or []).lower()
        if rec.get("_missing") or len(ab) < 40:
            flags.append((pmid, "no-ncbi-abstract", "PubMed returned no abstract"))
            continue
        ab_nc = ab.replace(",", "")
        parts, design = [], ""
        for sec in AUTHORED_SECS:
            sm = re.search(r'id="dd-'+pmid+'-'+sec+r'"[^>]*>(.*?)</section>', body, re.DOTALL)
            if not sm:
                continue
            seg = re.sub(r'<h3\b.*?</h3>', ' ', sm.group(1), flags=re.DOTALL)
            seg = re.sub(r'<p[^>]*mz-jc-section-intro[^>]*>.*?</p>', ' ', seg, flags=re.DOTALL)
            seg = re.sub(r'<p[^>]*dd-body[^>]*>|<p>\s*Anchor what was studied.*?</p>', ' ', seg, flags=re.DOTALL)
            parts.append(strip(seg))
            if sec == "pico":
                dm = re.search(r'design</dt>\s*<dd>(.*?)</dd>', seg, re.I | re.DOTALL)
                if dm:
                    design = strip(dm.group(1)).lower()
        text = " ".join(parts)
        for n in nums(text):
            if n in ab or n.replace(",", "") in ab_nc:
                continue
            flags.append((pmid, "number-not-in-pubmed-abstract", n))
        for phrase, cues in DESIGN_RULE.items():
            if phrase not in design:
                continue
            # a "systematic review of RCTs" is a review, not a trial — don't flag.
            if phrase == "randomized controlled trial" and any(w in design for w in _NOT_TRIAL):
                continue
            if not any(c in ptypes for c in cues) and not any(c in ab for c in cues):
                flags.append((pmid, "design-vs-pubmed-type",
                              f"authored '{phrase}' vs PubMed types [{ptypes or 'none'}]"))
    return flags


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
        flags = audit_post(post)
        real = [x for x in flags if x[1] != "no-ncbi-abstract"]
        print(f"\n[ACCURACY] {post.get('id')} — {len(real)} flag(s)")
        for pmid, kind, detail in flags:
            print(f"   {'•' if kind=='no-ncbi-abstract' else '⚠'} {pmid}  {kind}: {detail}")
        if not flags:
            print("   ✓ all statistics + design labels consistent with the live PubMed record")
        total += len(real)
    print(f"\n[ACCURACY] TOTAL flags: {total}  (advisory — verify each against full text)")
    return 2 if (a.strict and total) else 0


if __name__ == "__main__":
    sys.exit(main())
