# -*- coding: utf-8 -*-
"""
AUDITOR 2 of 3 — VALIDATION / evidence-logic (independent safety net).

STRENGTH: internal consistency between the strength of the evidence and the
strength of the claim. Independently of the numbers (Auditor 1) and the voice
(Auditor 3), it checks that the interpretation doesn't over- or under-reach:

  • OVER-CLAIM: a paper whose PubMed PublicationType / PICO design is weak for
    efficacy (review, case report, animal/in-vitro, cross-sectional, protocol,
    mechanism) must NOT assert proof of treatment effect ("proves", "shows X
    treats/cures Y", "is effective", "demonstrates efficacy") without a hedge.
  • MISSING HEDGE: a mechanism/animal/bench paper must carry an explicit
    limitation cue ("not yet", "in people/humans", "pre-clinical", "mechanism",
    "association", "not proven", "outside a trial").
  • VERDICT COHERENCE: the brief's own verdict word (supported / partially
    supported / insufficient / contested) should be reflected by the deep-dives
    (e.g., an "insufficient"/"partially supported" brief shouldn't read as if
    the claim is settled).

It re-fetches PublicationType from NCBI (shared core) so its design judgment is
source-anchored, but its LOGIC checks are entirely separate from Auditor 1's
numeric checks — overlapping coverage, different failure modes.

Usage: python3 scripts/audit_validation.py --post <body.json> [--strict]
"""
from __future__ import annotations
import argparse, json, re, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent / "_authoring"))
from pubmed_fetch import fetch  # noqa

HTML = re.compile(r'<[^>]+>')
def strip(s): return re.sub(r'\s+', ' ', HTML.sub(' ', s or '')).strip().lower()

WEAK_TYPES = ["review", "case reports", "comment", "editorial", "observational"]
WEAK_DESIGN = ["review", "case report", "case series", "animal", "mouse", "mice",
               "in vitro", "pre-clinical", "preclinical", "mechanistic", "cross-sectional",
               "protocol", "bench", "guinea pig", "narrative"]
OVERCLAIM = [r"\bproves?\b", r"\bproven to (?:treat|cure|prevent)\b", r"\bcures?\b",
             r"\bdemonstrates? efficacy\b", r"\bestablishes? that .{0,30}(?:treat|cure)",
             r"\bconfirms? .{0,20}(?:treats|cures|works)\b", r"\bis effective for\b"]
HEDGE = ["not yet", "in people", "in humans", "pre-clinical", "preclinical", "mechanism",
         "mechanistic", "association", "not proven", "outside a trial", "hypothesis",
         "doesn't (?:measure|show)", "isn't evidence", "not a (?:treatment|trial)",
         "no (?:study|evidence|trial)", "plausib", "rationale", "future trials", "uncertain",
         # explicitly labelling the work as lab/bench-stage IS the not-yet-in-people
         # qualifier (e.g. "In-vitro bioengineering … still bench-stage; a
         # translational step toward …")
         "bench-stage", "bench", "in vitro", "in-vitro", "translational",
         "proof of concept", "proof-of-concept", "experimental", "ex vivo", "ex-vivo"]
VERDICT_WORDS = ["supported", "partially supported", "insufficient", "contested",
                 "mechanism-plausible", "unproven", "payer-rejected"]


def audit_post(post: dict) -> list[tuple]:
    h = post["body_html"]
    verdict = strip(post.get("verdict") or "")
    modals = {m.group(1): m.group(2) for m in
              re.finditer(r'<dialog[^>]*id="dd-(\d+)"[^>]*>(.*?)</dialog>', h, re.DOTALL)}
    recs = fetch(list(modals))
    flags = []
    verdict_is_soft = any(w in verdict for w in
                          ["insufficient", "partially", "unproven", "contested", "plausible"])
    for pmid, body in modals.items():
        rec = recs.get(pmid, {})
        ptypes = " ".join(rec.get("publication_types") or []).lower()
        # author-stated design — the SELF-CONTAINED signal this auditor relies on,
        # so its logic still runs when NCBI publication-types are unavailable.
        dm = re.search(r'design</dt>\s*<dd>(.*?)</dd>', body, re.I | re.DOTALL)
        design = strip(dm.group(1)) if dm else ""
        if (rec.get("_offline") or rec.get("_missing")) and not ptypes:
            flags.append((pmid, "info-offline-fallback",
                          "NCBI types unavailable — evidence-logic judged from the authored design label"))
        # interpretive text = bottom + applicability + monday + findings
        txt = ""
        for sec in ("bottom", "applicability", "monday", "findings"):
            sm = re.search(r'id="dd-'+pmid+'-'+sec+r'"[^>]*>(.*?)</section>', body, re.DOTALL)
            if sm:
                seg = re.sub(r'<p[^>]*mz-jc-section-intro[^>]*>.*?</p>', ' ', sm.group(1), flags=re.DOTALL)
                txt += " " + strip(seg)
        weak = any(w in ptypes for w in WEAK_TYPES) or any(w in design for w in WEAK_DESIGN)
        # 1) over-claim on weak evidence — but NOT when the verb is negated
        #    ("isn't a cure", "not proven", "doesn't cure", "not a permanent cure").
        if weak:
            for pat in OVERCLAIM:
                m = re.search(pat, txt)
                if not m:
                    continue
                pre = txt[max(0, m.start() - 24):m.start()]
                if re.search(r"\b(?:not|isn't|aren't|doesn't|don't|never|no|nor|without|rather than|"
                             r"won't|cannot|can't)\b[\w\s,'-]*$", pre):
                    continue  # negated — the opposite of an over-claim
                flags.append((pmid, "overclaim-on-weak-evidence",
                              f"'{m.group(0)}' with design [{design or ptypes}]"))
                break
            # 2) missing hedge on mechanism/animal/bench
            mechy = any(w in (design + " " + ptypes) for w in
                        ["animal", "mouse", "mice", "in vitro", "mechanistic", "pre-clinical",
                         "preclinical", "bench", "guinea pig"])
            if mechy and not any(re.search(hh, txt) for hh in HEDGE):
                flags.append((pmid, "missing-hedge-on-mechanism",
                              "mechanism/animal paper without an explicit 'not-yet-in-people' qualifier"))
        # 3) verdict coherence — soft verdict but deep-dive reads settled
        if verdict_is_soft and re.search(r"\b(?:is (?:effective|proven)|clearly works|established treatment for)\b", txt):
            flags.append((pmid, "verdict-incoherence",
                          f"brief verdict is soft ('{verdict[:40]}') but deep-dive reads as settled"))
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
        real = [x for x in flags if x[1] != "info-offline-fallback"]
        print(f"\n[VALIDATION] {post.get('id')} — {len(real)} flag(s)")
        for pmid, kind, detail in flags:
            print(f"   {'•' if kind=='info-offline-fallback' else '⚠'} {pmid}  {kind}: {detail}")
        if not real:
            print("   ✓ claim strength matches evidence level; hedging + verdict coherent")
        total += len(real)
    print(f"\n[VALIDATION] TOTAL flags: {total}  (advisory — judgment calls for clinician review)")
    return 2 if (a.strict and total) else 0


if __name__ == "__main__":
    sys.exit(main())
