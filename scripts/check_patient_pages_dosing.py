#!/usr/bin/env python3
"""No dosing on the patient-facing pages.

Owner, 2026-09-16: "these briefs can have dosing — the patient facing home page
and educational materials should not." The clinician-facing journal-club briefs
carry a study's doses as legitimate clinical detail; a patient reading the home
page or an education article must not be handed an amount to take.

Scans the patient-facing HTML in the repo and fails the deploy on any dose.
A collapsed verbatim abstract (details.abstract-toggle / div.abstract-body), a
pull quote or a cite card is exempt: there the study is speaking, and a patient
who opens "Read the full abstract" is reading the trial's own methods. What the
rule forbids is the PAGE handing a patient an amount to take.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PATIENT_PAGES = ["index.html", "about/index.html", "education", "membership", "services"]
NUM_WORDS = r"(?:one|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty|fifty|hundred)"
DOSE = re.compile(
    r"\b(?:\d[\d,.–—-]*|" + NUM_WORDS + r")[\s-]*"
    r"(?:mg|mcg|µg|μg|IU|milligrams?|micrograms?|international units?)\b"
    r"(?!\s*/\s*(?:L|dL|mL|l|dl|ml))", re.I)
# Where the PAPER is speaking: a collapsed verbatim abstract, a pull quote, a
# cite card. A patient who opens "Read the full abstract" is reading the trial's
# own methods section; the rule is about the page telling them what to take.
QUOTED = re.compile(
    r"<details[^>]*class=\"[^\"]*abstract-toggle[^\"]*\"[\s\S]*?</details>"
    r"|<div[^>]*class=\"[^\"]*abstract-body[^\"]*\"[\s\S]*?</div>"
    r"|<blockquote[\s\S]*?</blockquote>"
    r"|<article[^>]*class=\"[^\"]*mz-cite-card[^\"]*\"[\s\S]*?</article>", re.I)


def files():
    for entry in PATIENT_PAGES:
        path = ROOT / entry
        if path.is_dir():
            yield from sorted(path.rglob("*.html"))
        elif path.exists():
            yield path


def main():
    bad = []
    n = 0
    for f in files():
        n += 1
        html = f.read_text(encoding="utf-8", errors="ignore")
        html = re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>|<!--[\s\S]*?-->", " ", html)
        html = QUOTED.sub(" ", html)
        text = re.sub(r"<[^>]+>", " ", html)
        for m in DOSE.finditer(text):
            ctx = re.sub(r"\s+", " ", text[max(0, m.start() - 60):m.end() + 40]).strip()
            bad.append(f"{f.relative_to(ROOT)}: {m.group(0)!r} — …{ctx}…")
    print(f"patient-page dosing gate: {n} page(s) scanned")
    if bad:
        print(f"\n🛑 DOSING ON A PATIENT-FACING PAGE — {len(bad)} occurrence(s):")
        for b in bad[:20]:
            print("  ✗ " + b[:200])
        return 1
    print("  no dosing on any patient-facing page")
    return 0


sys.exit(main())
