#!/usr/bin/env python3
"""Static guard: no dark page/panel surfaces may re-enter the light site.

Cheap source-level companion to the rendered contrast gate. It exists
because the light conversion shipped three times looking finished while a
whole FAMILY of surface stayed dark, and each time the missed family was a
different syntax the previous regex had never matched:

  1. tokens           --bg-base / --fg-* / --border
  2. gradient stops   html { background: linear-gradient(..., #120f1b, ...) }
  3. dark neutrals    dialog { background:#1a1626 }, rgba(7,7,10,.96) panels
  4. Function HTML    pages built in functions/*.js, never in the static tree

So this checks by COLOUR, not by name: any background whose colour is dark
fails, wherever it is written and whatever syntax it uses.

Deliberately allowed:
  * brand violets used as button/badge grounds (#2e1065, #6d28d9, #7c3aed,
    #4c1d95) — their white text is correct;
  * scrims — `.modal-backdrop`, `.modal-overlay`, `::backdrop` — a dark
    scrim behind a modal is correct on a light theme;
  * the /about/ magazine cover, which is a photograph.

Usage: audit_dark_surfaces.py [--fix-list]
"""
import re, sys, os, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Brand violets and semantic tints used as button/badge grounds — their white
# text is correct. #3d1478 is the dark stop of the display-headline gradient,
# which is background-clip:text (a TEXT colour, not a ground) and so can never
# be a dark page surface however dark the stop is.
ALLOW_HEX = {"#2e1065", "#6d28d9", "#7c3aed", "#4c1d95", "#5b21b6", "#047857",
             "#166534", "#14532d", "#7c2d12", "#92400e", "#b91c1c", "#991b1b",
             "#3d1478"}
# Surfaces that are SUPPOSED to be dark on a light theme: scrims behind
# modals, and photographic treatments (the /about/ magazine cover is a
# photograph with a vignette blending its edges — not a themed panel).
SCRIM_HINT = re.compile(r'(backdrop|overlay|scrim|::backdrop|vignette|cover-|photo|darkener)', re.I)
DARK_MAX_LUM = 60          # below this a neutral ground is "dark"

# (?<![\w-]) so `colorBackground:` in a Stripe Elements appearance object is
# not read as a CSS background declaration — that produced a false positive
# pointing at the colorTEXT value sitting next to it.
BG = re.compile(r'(?<![\w-])background(?:-color)?\s*:\s*([^;{}]+)', re.I)
HEX = re.compile(r'#[0-9a-fA-F]{3,8}')
RGBA = re.compile(r'rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([0-9.]+)\s*)?\)')

def lum_hex(h):
    h = h.lstrip('#')
    if len(h) == 3: h = ''.join(c*2 for c in h)
    if len(h) < 6: return None
    return (int(h[0:2],16)*299 + int(h[2:4],16)*587 + int(h[4:6],16)*114) / 1000

def scan(path):
    out = []
    try: src = open(path, encoding='utf-8').read()
    except Exception: return out
    for m in BG.finditer(src):
        decl = m.group(1)
        line = src.count('\n', 0, m.start()) + 1
        ctx = src[max(0, m.start()-260):m.start()]
        if SCRIM_HINT.search(ctx): continue
        for h in HEX.findall(decl):
            if h.lower() in ALLOW_HEX: continue
            L = lum_hex(h)
            if L is not None and L < DARK_MAX_LUM:
                out.append((line, h, round(L), decl.strip()[:60]))
        for r, g, b, a in RGBA.findall(decl):
            r, g, b = int(r), int(g), int(b)
            alpha = float(a) if a else 1.0
            L = (r*299 + g*587 + b*114) / 1000
            if L < DARK_MAX_LUM and alpha >= 0.5:
                out.append((line, f"rgba({r},{g},{b},{alpha})", round(L), decl.strip()[:60]))
    return out

def main():
    targets = []
    for pat in ("**/*.html", "functions/**/*.js"):
        targets += glob.glob(os.path.join(ROOT, pat), recursive=True)
    targets = [t for t in targets if "node_modules" not in t and "/.git/" not in t
               and "/docs/" not in t and "/assets/brand/" not in t]
    bad, nfiles = 0, 0
    for t in sorted(targets):
        hits = scan(t)
        # the /about/ cover is a photograph, not a themed surface
        if hits and t.endswith("about/index.html"):
            hits = [h for h in hits if 'cover' not in h[3].lower()]
        if hits:
            nfiles += 1
            rel = os.path.relpath(t, ROOT)
            for line, col, L, decl in hits[:6]:
                print(f"  ✗ {rel}:{line}  {col} (lum {L})  {decl}")
            if len(hits) > 6:
                print(f"     … and {len(hits)-6} more in this file")
            bad += len(hits)
    if bad:
        print(f"\n🛑 DARK-SURFACE GATE FAILED — {bad} dark ground(s) in {nfiles} file(s).")
        print("   The site is light (SYSTEM_MAP §8.0.0). Convert the ground, or if it is")
        print("   a scrim, name it *backdrop/*overlay so the gate can tell.")
        return 1
    print(f"dark-surface gate: CLEAN — {len(targets)} file(s), no dark grounds outside brand violets and scrims")
    return 0

if __name__ == "__main__":
    sys.exit(main())
