# -*- coding: utf-8 -*-
"""
audit_claim_accuracy.py — independent accuracy cross-check for authored
deep-dive content against the VERBATIM PubMed abstract in the same post.

WHAT IT CATCHES (automatable, high-signal):
  • Numeric drift/fabrication — every multi-digit number asserted in the
    authored bottom/findings/methods/PICO that does NOT appear in the paper's
    verbatim abstract is flagged (e.g., a made-up sample size, a wrong AUC, a
    hazard ratio that isn't in the source).
  • Study-design mismatch — if the authored text calls a paper an "RCT" /
    "meta-analysis" / "case report" etc. but the abstract's own design language
    disagrees, it's flagged.

WHAT IT CANNOT DO (and must not be trusted to do):
  • Judge nuanced clinical INTERPRETATION — whether a caveat is correctly
    weighted, whether a mechanism is over-extended, whether the verdict is fair.
    That genuinely requires the clinician (CLAUDE.md §3.9). This tool RAISES
    FLAGS for human review; it does not certify correctness.

It deliberately reads the abstract that already lives in the post (the §3.7
verbatim "abstract" section / cite-card), so the check is against the same
source text the author read — catching transcription/interpretation drift even
without a network call. (A future mode can re-fetch from NCBI E-Utilities to
also confirm the stored abstract itself.)

Usage:
  python3 scripts/audit_claim_accuracy.py --post <body.json>        # one post
  python3 scripts/audit_claim_accuracy.py --tb-dir /tmp/tb          # all briefs
Exit: 0 always (advisory tool) unless --strict (exit 2 if any flags).
"""
from __future__ import annotations
import argparse, json, re, sys
from pathlib import Path

HTML = re.compile(r'<[^>]+>')
DESIGN_TERMS = {
    "randomized controlled trial": ["randomi", "rct", "double-blind", "placebo"],
    "meta-analysis": ["meta-analysis", "meta analysis"],
    "systematic review": ["systematic review"],
    "cohort": ["cohort"],
    "case report": ["case report", "we present a case", "a case of"],
    "case series": ["case series", "consecutive cases", "clinical series"],
    "case-control": ["case-control", "case control"],
    "cross-sectional": ["cross-sectional", "cross sectional"],
    "protocol": ["protocol", "study protocol"],
    "review": ["review"],
    "animal": ["mouse", "mice", "guinea pig", "rat ", "in vivo", "knockout"],
    "in vitro": ["in vitro", "cell line", "cells were", "fibroblast"],
    "consensus": ["consensus", "position statement"],
    "commentary": ["comment in", "commentary", "editorial"],
}


def strip(s: str) -> str:
    return re.sub(r'\s+', ' ', HTML.sub(' ', s or '')).strip()


def numbers(s: str) -> set[str]:
    """Multi-digit numeric tokens worth checking (skip 1-2 digit counts like
    'H1', '3 groups', and 4-digit years which are usually contextual)."""
    out = set()
    for n in re.findall(r'\b\d[\d,\.]*\b', s):
        c = n.replace(',', '')
        if len(c.replace('.', '')) < 3:      # too short to be a meaningful stat
            continue
        if re.fullmatch(r'(19|20)\d\d', c):  # a bare year — contextual, skip
            continue
        out.add(n)
    return out


def check_post(post: dict) -> list[tuple]:
    h = post["body_html"]
    # map pmid -> verbatim abstract text (from the modal abstract section OR card)
    abstracts: dict[str, str] = {}
    for m in re.finditer(r'id="dd-(\d+)-abstract"[^>]*>(.*?)</section>', h, re.DOTALL):
        abstracts[m.group(1)] = strip(m.group(2)).lower()
    flags = []
    for md in re.finditer(r'<dialog[^>]*id="dd-(\d+)"[^>]*>(.*?)</dialog>', h, re.DOTALL):
        pmid, body = md.group(1), md.group(2)
        ab = abstracts.get(pmid, "")
        if not ab or len(ab) < 40:
            flags.append((pmid, "no-abstract", "no verbatim abstract to check against"))
            continue
        ab_nocomma = ab.replace(",", "")
        # Gather authored interpretive text, but DROP each section's template
        # intro boilerplate (<p class="mz-jc-section-intro">…) and the <h3>
        # header — those contain generic phrases like "mechanism papers, case
        # reports" that are NOT the author's claim and must not be scanned.
        parts, design_text = [], ""
        for sec in ("bottom", "findings", "methods", "pico"):
            sm = re.search(r'id="dd-'+pmid+'-'+sec+r'"[^>]*>(.*?)</section>', body, re.DOTALL)
            if not sm:
                continue
            seg = sm.group(1)
            seg = re.sub(r'<h3\b.*?</h3>', ' ', seg, flags=re.DOTALL)
            seg = re.sub(r'<p[^>]*class="[^"]*mz-jc-section-intro[^"]*"[^>]*>.*?</p>', ' ', seg, flags=re.DOTALL)
            txt = strip(seg)
            parts.append(txt)
            # the design label the author asserts lives in the PICO "Design" row
            if sec == "pico":
                dm = re.search(r'design</dt>\s*<dd>(.*?)</dd>', seg, re.IGNORECASE | re.DOTALL)
                if dm:
                    design_text = strip(dm.group(1)).lower()
        text = " ".join(parts)
        # 1) numeric drift — every multi-digit stat must appear in the abstract
        for n in numbers(text):
            if n in ab or n.replace(",", "") in ab_nocomma:
                continue
            flags.append((pmid, "number-not-in-abstract", n))
        # 2) design mismatch — only on the asserted PICO Design value, and only
        #    for hard designs whose absence from the abstract is meaningful.
        for claimed, cues in DESIGN_TERMS.items():
            if claimed in design_text and claimed in (
                    "randomized controlled trial", "meta-analysis", "case report",
                    "case-control", "protocol", "phase 3", "phase-3"):
                if not any(c in ab for c in cues):
                    flags.append((pmid, "design-label-not-in-abstract", claimed))
    return flags


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--post")
    ap.add_argument("--tb-dir")
    ap.add_argument("--strict", action="store_true")
    a = ap.parse_args()
    posts = []
    if a.post:
        posts = [json.load(open(a.post))]
    elif a.tb_dir:
        for p in sorted(Path(a.tb_dir).glob("*.json")):
            if p.name.endswith(".applied.json") or "_src" in p.name:
                continue
            try:
                d = json.load(open(p))
                if "body_html" in d:
                    posts.append(d)
            except Exception:
                pass
    else:
        print("specify --post or --tb-dir", file=sys.stderr); return 3

    total = 0
    for post in posts:
        flags = check_post(post)
        real = [f for f in flags if f[1] != "no-abstract"]
        print(f"\n=== {post.get('id')} : {len(real)} flag(s) for human review ===")
        for pmid, kind, detail in flags:
            mark = "•" if kind == "no-abstract" else "⚠"
            print(f"   {mark} {pmid}  {kind}: {detail}")
        if not flags:
            print("   ✓ no numeric/design discrepancies vs the verbatim abstracts")
        total += len(real)
    print(f"\nTOTAL flags across {len(posts)} post(s): {total}")
    print("NOTE: flags are for human review, not proof of error; this tool does")
    print("NOT verify clinical interpretation — that remains the clinician's job.")
    return 2 if (a.strict and total) else 0


if __name__ == "__main__":
    sys.exit(main())
