#!/usr/bin/env python3
"""Inject the standard medico-legal disclaimer on every educational surface.

Owner directive (2026-09-01, standing): "I always need this to be
medico-legally sound with CLEAR disclaimers that I am not OFFERING MEDICAL
ADVICE, this is just an educational platform."

ONE canonical block (marker class mz-eddisclaimer), injected on:
  * every education page + portal education page (before </main>, else
    before </body>)
  * the /evidence/ and /trending/ shells (covers every post they render)
The homepage condition modals get the same block from ONE place in
assets/js/domain-modals.js (this script verifies it is present there and
reports if not — JS injection is done in that file directly, not here).

Idempotent (marker-checked). scripts/audit_disclaimers.py is the deploy
gate that keeps this true forever.

  python3 scripts/fix_disclaimers.py            # dry run
  python3 scripts/fix_disclaimers.py --apply
"""
import glob, os, sys

APPLY = "--apply" in sys.argv
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

BLOCK = (
    '<div class="mz-eddisclaimer" role="note" '
    'style="max-width:72ch;margin:40px auto 24px;padding:16px 20px;'
    'background:#F4F0FB;border:1px solid #E9E5EE;border-radius:12px;'
    'color:#4A4658;font-size:14px;line-height:1.6;">'
    '<strong style="color:#1A1726;">Educational information — not medical advice.</strong> '
    'Everything on this page is general education. It is not a diagnosis, a '
    'treatment recommendation, or a substitute for care from your own '
    'clinician, and reading it does not create a physician–patient '
    'relationship. Decisions about testing, medications, or surgery belong '
    'in a private conversation between you and your doctor.'
    "</div>"
)

def surfaces():
    out = sorted(glob.glob(os.path.join(ROOT, "education", "*", "index.html"))
                 + glob.glob(os.path.join(ROOT, "portal", "education", "*", "index.html")))
    for shell in ("evidence/index.html", "trending/index.html"):
        p = os.path.join(ROOT, shell)
        if os.path.exists(p):
            out.append(p)
    return out

def main():
    added, present = 0, 0
    for f in surfaces():
        src = open(f, encoding="utf-8").read()
        if "mz-eddisclaimer" in src:
            present += 1
            continue
        if "</main>" in src:
            out = src.replace("</main>", BLOCK + "\n</main>", 1)
        elif "</body>" in src:
            out = src.replace("</body>", BLOCK + "\n</body>", 1)
        else:
            out = src.rstrip() + "\n" + BLOCK + "\n"
        added += 1
        print(f"  + {os.path.relpath(f, ROOT)}")
        if APPLY:
            open(f, "w", encoding="utf-8").write(out)
    hj = open(os.path.join(ROOT, "assets", "js", "home.js"), encoding="utf-8").read()
    print("  modal renderer (home.js) appends the disclaimer:", "YES" if "mz-eddisclaimer" in hj else "NO — add it to the domainModalBody renderer")
    print(f"\n{added} surface(s) injected, {present} already present"
          + ("" if APPLY else " (dry run — pass --apply)"))

main()
