#!/usr/bin/env python3
"""Voice sweep per education page — remove 'Dr. Mabini' / first-person references.

Per the user's directive: "stop referring to me as 'Dr. Mabini' - just speak in
intentional language in my voice, without having to say 'I' 'Me' etc."

This script processes ONE page at a time (§0.6-compliant — explicit per-file pattern
list, deterministic anchors, backup before write, audit log of every change).

Three exact-match deterministic patterns shared by every page:
  1. Nav menu link: "About Dr. Mabini" → "About"
  2. Q&A section heading: "Questions Dr. Mabini gets most often"
                         → "Most common patient questions"
  3. Opening lead-in: "how Dr.&nbsp;Mabini <verb>s" patterns — page-specific (defined
     in PAGE_PATTERNS below).

Body-content occurrences (page-specific phrases like "Dr. Mabini performs the
operation laparoscopically") get listed but NOT auto-edited — those need per-file
review and Edit tool calls.

Run:  python3 scripts/voice_sweep_edu.py <slug>          # one page
      python3 scripts/voice_sweep_edu.py --all           # all 12
      python3 scripts/voice_sweep_edu.py --dry <slug>    # preview only
"""
import argparse
import os
import re
import shutil
import sys
from datetime import datetime, timezone

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EDU = os.path.join(REPO, "education")
PORTAL = os.path.join(REPO, "portal", "education")

# Universal patterns — apply to every page, exact strings (no regex matching).
UNIVERSAL_SWAPS = [
    ("About Dr. Mabini", "About"),
    ("Questions Dr. Mabini gets most often", "Most common patient questions"),
]

# Page-specific opening-blurb swaps. Each entry is (old_substring, new_substring).
# These are matched with surrounding context to ensure uniqueness.
PAGE_PATTERNS = {
    "menopause": [
        ("how Dr.&nbsp;Mabini frames the conversation", "how the menopause conversation is framed"),
        ("The conversation Dr. Mabini has with each patient covers", "Every menopause visit covers"),
        ("The conversation Dr. Mabini has at every menopause visit covers", "Every menopause visit covers"),
    ],
    "fibroids": [
        ("how Dr.&nbsp;Mabini classifies fibroids", "how fibroids are classified"),
        ("Dr.&nbsp;Mabini&rsquo;s practice prioritizes uterus-preserving treatment options",
         "The practice prioritizes uterus-preserving treatment options"),
        ("Dr.&nbsp;Mabini performs the operation laparoscopically",
         "The operation is performed laparoscopically"),
    ],
    "dysmenorrhea": [
        ("how Dr.&nbsp;Mabini approaches both", "the approach to both"),
    ],
    "adenomyosis": [],
    "pcos": [
        ("how Dr.&nbsp;Mabini makes", "how the diagnosis is made"),
    ],
    "ovarian-masses": [],
    "postoperative-recovery": [
        ("per Dr. Mabini&rsquo;s specific recommendation at your post-op visit",
         "per the specific recommendation given at the post-op visit"),
    ],
    "contraception": [
        ("Many of Dr. Mabini&rsquo;s patients use this approach",
         "Many patients in this practice use this approach"),
    ],
    "pregnancy-loss": [
        ("how Dr.&nbsp;Mabini approaches early pregnancy loss with care",
         "how early pregnancy loss is approached with care"),
    ],
    # Also handle the 2 already-mostly-clean pages — still have the nav link + Q&A header
    "endometriosis": [],
    "chronic-pelvic-pain": [],
    "abnormal-uterine-bleeding": [],
}


def sweep_page(slug, dry=False, mirror=True):
    path = os.path.join(EDU, slug, "index.html")
    if not os.path.exists(path):
        print(f"  ❌ no file: {path}")
        return False
    txt = open(path).read()
    orig = txt
    changes = []

    # Universal swaps
    for old, new in UNIVERSAL_SWAPS:
        n = txt.count(old)
        if n:
            txt = txt.replace(old, new)
            changes.append(f"   universal: '{old[:50]}' → '{new[:50]}' x{n}")

    # Page-specific swaps
    for old, new in PAGE_PATTERNS.get(slug, []):
        n = txt.count(old)
        if n:
            txt = txt.replace(old, new)
            changes.append(f"   page: '{old[:60]}...' → '{new[:60]}...' x{n}")
        else:
            changes.append(f"   page MISS: '{old[:60]}...' (pattern not found)")

    # Report remaining Mabini occurrences for manual review
    remaining = [(m.start(), m.end()) for m in re.finditer(r'Mabini', txt)]
    if remaining:
        changes.append(f"   {len(remaining)} 'Mabini' hits still in file — review:")
        for s, e in remaining:
            ctx_start = max(0, s - 80)
            ctx_end = min(len(txt), e + 80)
            ctx = re.sub(r'<[^>]+>', '', txt[ctx_start:ctx_end].replace('\n', ' '))[:200]
            changes.append(f"     ...{ctx}...")

    print(f"\n=== {slug} ===")
    for c in changes:
        print(c)

    if txt == orig:
        print("  (no changes)")
        return True

    if dry:
        out = f"/tmp/{slug}_voice_preview.html"
        open(out, "w").write(txt)
        print(f"  DRY: wrote preview → {out}")
    else:
        backup = path + ".pre-voice-sweep.html"
        if not os.path.exists(backup):
            shutil.copy2(path, backup)
            print(f"  backed up → {backup}")
        open(path, "w").write(txt)
        print(f"  wrote: {path}")
        if mirror:
            portal_path = os.path.join(PORTAL, slug, "index.html")
            if os.path.exists(portal_path):
                open(portal_path, "w").write(txt)
                print(f"  mirrored → {portal_path}")
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("slug", nargs="?")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--no-mirror", action="store_true")
    args = ap.parse_args()
    if args.all:
        for slug in sorted(PAGE_PATTERNS.keys()):
            sweep_page(slug, dry=args.dry, mirror=not args.no_mirror)
    elif args.slug:
        sweep_page(args.slug, dry=args.dry, mirror=not args.no_mirror)
    else:
        ap.print_help()


if __name__ == "__main__":
    main()
