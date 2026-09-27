#!/usr/bin/env python3
"""The document's own theme must be light — root cause of a recurring bug.

The owner reported unreadable black backgrounds on the evidence briefs
repeatedly. Every earlier fix recoloured individual elements, which is why it
kept coming back: the fault was at the DOCUMENT level, in two declarations.

  1. <meta name="color-scheme" content="dark"> on nine pages. That tells the
     browser the whole document is dark, so the User-Agent default text turns
     white and the default canvas turns black. Any element that does not set
     its own background paints over black — exactly the brief detail view.

  2. body { color: var(--text-on-dark) } — i.e. #ffffff — on the evidence,
     trending and admin/content pages. Their backgrounds had been migrated to
     the light gradient while the BASE TEXT COLOUR was left on the dark-theme
     token, so anything that did not set its own ink inherited white.

This gate fails the deploy if either returns on a deployable route.
Run: python3 scripts/audit_document_theme.py
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP_DIRS = {".git", "node_modules", "docs", "cite_audit", "scripts", ".wrangler"}

META_DARK = re.compile(r'<meta[^>]+name=["\']color-scheme["\'][^>]+content=["\']\s*dark\s*["\']', re.I)
BODY_RULE = re.compile(r'(?:^|\})\s*(?:html\s*,\s*)?body\s*\{([^}]*)\}', re.S | re.M)
DARK_TEXT = re.compile(r'color\s*:\s*(var\(\s*--text-on-dark\s*\)|#fff\b|#ffffff\b|white\b|rgb\(\s*255\s*,\s*255\s*,\s*255)', re.I)


def deployable_html():
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
        for fn in filenames:
            if fn.endswith(".html"):
                yield os.path.join(dirpath, fn)


def main():
    problems = []
    scanned = 0
    for path in deployable_html():
        rel = os.path.relpath(path, ROOT)
        try:
            src = open(path, encoding="utf-8").read()
        except (UnicodeDecodeError, OSError):
            continue
        scanned += 1
        if META_DARK.search(src):
            problems.append(f'{rel}: declares <meta name="color-scheme" content="dark"> — '
                            "the UA canvas goes black behind anything without its own background")
        for m in BODY_RULE.finditer(src):
            if DARK_TEXT.search(m.group(1)):
                problems.append(f"{rel}: body sets white/dark-theme base text colour — "
                                "anything that does not set its own ink inherits white on the paper ground")
                break
    if problems:
        print("\n\U0001f6d1 DOCUMENT-THEME GATE FAILED — a page declares itself dark:")
        for p in problems:
            print(f"  ✗ {p}")
        return 1
    print(f"document-theme gate: CLEAN — {scanned} page(s); none declares a dark "
          "color-scheme, none inherits white base text")
    return 0


if __name__ == "__main__":
    sys.exit(main())
