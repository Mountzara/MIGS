#!/usr/bin/env python3
"""Paint the approved paper ground under every route — no transparent canvases.

The 2026-08-25 light conversion removed the dark grounds but on most pages
left html/body TRANSPARENT with only decorative violet tint-gradients on
top. Nothing painted the approved paper (#FBFAF8), so the page's ground
became whatever the visitor's browser paints behind a transparent document
— white in a light-mode lab, GREY in dark-mode Safari, which is exactly
what the owner saw ("you turned my website into an ugly grey (not the
approved off-white color)"). Only the homepage declared its ground.

Fix: append a guard style at the end of each route document —
  <style id="mz-canvas-guard">html{background-color:#FBFAF8}</style>
Last-in-document wins the cascade tie against any earlier equal-specificity
declaration; background-image tints layer above the color unchanged.
Idempotent (marker-checked). Routes are DERIVED exactly as
audit_light_text.py derives them; scripts/audit_page_canvas.py verifies
the RENDERED result on every route at deploy time.

  python3 scripts/fix_page_canvas.py            # dry run
  python3 scripts/fix_page_canvas.py --apply
"""
import os, re, sys

APPLY = "--apply" in sys.argv
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GUARD = '<style id="mz-canvas-guard">html{background-color:#FBFAF8}</style>'

def route_files():
    files = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames
                       if d not in ("node_modules", ".git", "docs", "scripts",
                                    "functions", "assets", "schema", "cron-worker",
                                    "companion-app")]
        if "index.html" in filenames:
            files.append(os.path.join(dirpath, "index.html"))
    p404 = os.path.join(ROOT, "404.html")
    if os.path.exists(p404):
        files.append(p404)
    return sorted(files)

def main():
    added, present = 0, 0
    for f in route_files():
        src = open(f, encoding="utf-8").read()
        if "mz-canvas-guard" in src:
            present += 1
            continue
        if "</body>" in src:
            out = src.replace("</body>", GUARD + "\n</body>", 1)
        else:
            out = src.rstrip() + "\n" + GUARD + "\n"
        added += 1
        rel = os.path.relpath(f, ROOT)
        print(f"  + {rel}")
        if APPLY:
            open(f, "w", encoding="utf-8").write(out)
    print(f"\n{added} route(s) guarded, {present} already guarded"
          + ("" if APPLY else " (dry run — pass --apply)"))

main()
