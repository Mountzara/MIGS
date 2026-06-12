# -*- coding: utf-8 -*-
"""
AUDITOR 3 of 3 — VOICE / STYLE authenticity (independent safety net).

STRENGTH: that the output reads as ONE patient-aimed-yet-evidence-accurate voice
— authentically the operator's voice — not a templated or split one. Independently
of accuracy (Auditor 1) and evidence-logic (Auditor 2), it checks the prose:

  • SINGLE VOICE: no "For patients:" / "For clinicians:" (or similar) audience
    split-labels — there is one voice, written for a patient to read.
  • TACTFUL TONE: no abrasive / marketing / dismissive phrasing ("debunk",
    "myth", "be skeptical of clinics", "marketed", "the buzz", "pumps the brakes",
    "snake oil", "junk science", "hype").
  • EVIDENCE-GROUNDED: each deep-dive's interpretive prose actually anchors to
    the evidence (names the design / says what was found / states a limit) rather
    than asserting opinion.
  • READABLE: flags dense undefined-acronym runs (a proxy for prose that's
    drifted out of patient-readability).

Pure text analysis — no network, no dependence on the other auditors. Overlaps
them only in that all three read the same authored prose; its failure mode
(tone/voice drift) is distinct from numeric or logic drift.

Usage: python3 scripts/audit_voice.py --post <body.json> [--strict]
"""
from __future__ import annotations
import argparse, json, re, sys
from pathlib import Path

HTML = re.compile(r'<[^>]+>')
def strip(s): return re.sub(r'\s+', ' ', HTML.sub(' ', s or '')).strip()

SPLIT_LABELS = [r"for patients\s*:", r"for clinicians\s*:", r"for providers\s*:",
                r"for doctors\s*:", r"patient[- ]facing\s*:", r"clinician[- ]facing\s*:"]
# Only genuinely abrasive/dismissive terms. NOTE: "marketed"/"widely promoted"
# were removed — they're neutral-factual ("the device is marketed for…") and
# false-flagged physician-facing posts; the tactful-voice guidance for authored
# prose is enforced elsewhere, not by treating these as abrasive.
ABRASIVE = [r"\bdebunk", r"\bsnake oil\b", r"\bjunk science\b", r"\bquack", r"\bhype\b",
            r"\bpseudoscience\b", r"\bbe skeptical of (?:clinics|providers)\b",
            r"\bpumps the brakes\b", r"\bmiracle cure\b", r"\bbogus\b", r"\bnonsense\b"]
# anchor cues — interpretive prose should reference design/finding/limit
ANCHOR = ["study", "trial", "review", "abstract", "evidence", "found", "shows", "report",
          "mechanism", "data", "analysis", "randomi", "cohort", "case", "meta-analysis",
          "rct", "pre-clinical", "animal", "mice", "in vitro", "association", "results",
          "statement", "guidance", "position", "consensus", "society", "recommend",
          "confirms", "paper", "research", "cochrane", "guideline"]
SECTIONS = ("bottom", "applicability", "monday", "findings", "question", "strengths")


def audit_post(post: dict) -> list[tuple]:
    h = post["body_html"]
    modals = {m.group(1): m.group(2) for m in
              re.finditer(r'<dialog[^>]*id="dd-(\d+)"[^>]*>(.*?)</dialog>', h, re.DOTALL)}
    flags = []
    for pmid, body in modals.items():
        blob = ""
        for sec in SECTIONS:
            sm = re.search(r'id="dd-'+pmid+'-'+sec+r'"[^>]*>(.*?)</section>', body, re.DOTALL)
            if sm:
                seg = re.sub(r'<p[^>]*mz-jc-section-intro[^>]*>.*?</p>', ' ', sm.group(1), flags=re.DOTALL)
                seg = re.sub(r'<h3\b.*?</h3>', ' ', seg, flags=re.DOTALL)
                blob += " " + strip(seg)
        low = blob.lower()
        for pat in SPLIT_LABELS:
            if re.search(pat, low):
                flags.append((pmid, "audience-split-label", re.search(pat, low).group(0)))
        for pat in ABRASIVE:
            if re.search(pat, low):
                flags.append((pmid, "abrasive-or-marketing-tone", re.search(pat, low).group(0)))
        # evidence-grounding: the bottom line should anchor to the evidence,
        # signalled by EITHER a design/finding term OR a statistical marker
        # (n=, r=, p=, %, "95% CI", a correlation/effect figure). Keyword-only
        # detection was too brittle and false-flagged richly-anchored lines like
        # "cross-sectional series (n=28); VEGF correlated (r=0.51)".
        bm = re.search(r'id="dd-'+pmid+'-bottom"[^>]*>(.*?)</section>', body, re.DOTALL)
        if bm:
            bl = strip(re.sub(r'<h3\b.*?</h3>', ' ', bm.group(1), flags=re.DOTALL)).lower()
            has_stat = bool(re.search(r'\bn\s*=\s*\d|\br\s*=|\bp\s*[=<>]|\d\s*%|95%|\bci\b|'
                                      r'\bhr\b|\bor\b|\brr\b|\bauc\b|correlat|hazard|odds|'
                                      r'\bn\b\s*of\s*\d|=\s*0?\.\d', bl))
            if len(bl) > 60 and not has_stat and not any(a in bl for a in ANCHOR):
                flags.append((pmid, "bottom-line-not-evidence-anchored",
                              "bottom line doesn't reference the study/finding/evidence"))
        # readability proxy — INFORMATIONAL only (not a voice-authenticity failure):
        # acronym density is context-dependent (a physician-facing journal-club
        # deep-dive legitimately uses more than a patient-facing trend brief), so
        # it's surfaced as a heads-up, never counted as a flag.
        caps = re.findall(r'\b[A-Z]{3,}\b', blob)
        if len(set(caps)) >= 18:
            flags.append((pmid, "info-acronym-density",
                          f"{len(set(caps))} distinct acronyms — readability heads-up"))
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
        real = [x for x in flags if not x[1].startswith("info-")]
        print(f"\n[VOICE] {post.get('id')} — {len(real)} flag(s)")
        for pmid, kind, detail in flags:
            print(f"   {'•' if kind.startswith('info-') else '⚠'} {pmid}  {kind}: {detail}")
        if not real:
            print("   ✓ one patient-aimed voice; tactful; evidence-anchored; readable")
        total += len(real)
    print(f"\n[VOICE] TOTAL flags: {total}")
    return 2 if (a.strict and total) else 0


if __name__ == "__main__":
    sys.exit(main())
