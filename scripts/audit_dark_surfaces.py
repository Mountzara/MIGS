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



# =====================================================================
# TWO MORE FAMILIES, both found only after the grounds were already light
# =====================================================================
# 5. White TEXT left behind on a ground that is now paper. A rule that
#    paints text white and declares no dark ground of its own inherits
#    whatever is behind it — which is now paper.
# 6. White GRADIENTS CLIPPED TO TEXT (background: linear-gradient(#fff…)
#    + -webkit-text-fill-color: transparent). Neither of the checks above
#    sees these: the ground check reads it as a background, the colour
#    check finds no `color:` at all. On the CV this left the page's
#    largest headline — the owner's own name — invisible on paper.
RULE = re.compile(r'([^{}]{1,160}?)(\{[^{}]{0,500}\})', re.S)
WHITE_TXT = re.compile(r'color\s*:\s*(#fff\b|#ffffff\b|var\(--white\)|rgba\(255,\s*255,\s*255,\s*0?\.[89]\d*\))', re.I)
HAS_DARK_BG = re.compile(r'background[^;]*(#2e1065|#6d28d9|#7c3aed|#4c1d95|#5b21b6|#047857|#3d1478|linear-gradient|rgba\(var\(--glow-purple\)|#0[0-9a-f]{5}|#1[0-9a-f]{5})', re.I)
CLIP_TXT = re.compile(r'-webkit-text-fill-color:\s*transparent', re.I)
LIGHT_STOP = re.compile(r'linear-gradient\([^;]*(#fff\b|#ffffff\b|rgba\(255,\s*255,\s*255)', re.I)
SKIP_SEL = ('button', '.btn', '.cta', 'badge', 'pill', 'chip', '::selection',
            ':hover', 'tag', 'cover-', 'credit-', 'mz-asn', 'backdrop', 'overlay')

def scan_text(path):
    out = []
    try: src = open(path, encoding='utf-8').read()
    except Exception: return out
    # `var(--white)` is only a finding if THIS file still defines --white as a
    # light colour. Several pages redefined it to ink during the conversion —
    # the token now means "strongest ink", and flagging it would be noise.
    m = re.search(r'--white:\s*(#[0-9a-fA-F]{3,6})', src)
    white_is_light = True
    if m:
        L = lum_hex(m.group(1))
        white_is_light = L is None or L > 150
    for m in RULE.finditer(src):
        sel, body = m.group(1).split('\n')[-1].strip(), m.group(2)
        if any(k in sel.lower() for k in SKIP_SEL): continue
        line = src.count('\n', 0, m.start()) + 1
        hit = WHITE_TXT.search(body)
        if hit and 'var(--white)' in hit.group(0) and not white_is_light:
            hit = None
        if hit and not HAS_DARK_BG.search(body):
            out.append((line, sel[:46], "white text, no dark ground of its own"))
        elif CLIP_TXT.search(body) and LIGHT_STOP.search(body):
            out.append((line, sel[:46], "white gradient clipped to text — invisible on paper"))
    return out


def scan_published_posts():
    """The ninth family: posts in the mountzara-content R2 bucket carry their
    own embedded stylesheets, and no file sweep touches them — which is how
    the site went light in June while every brief's journal-club modal stayed
    black. Pull each published post and run the same colour scan over its CSS.

    Fails LOUD if the posts cannot be fetched: a scan that silently covered
    zero posts would report clean, and clean-because-blind is this gate's
    founding failure mode."""
    import subprocess, json as _json, tempfile
    ids, bodies = [], {}
    for kind in ("evidence", "blog"):
        out = subprocess.run(["curl", "-sS", "--fail-with-body",
                              "-H", "User-Agent: mz-operator-tools/1.0 (dark-surface-gate)",
                              f"https://mountzara.com/api/posts?kind={kind}&status=published"],
                             capture_output=True, text=True)
        if out.returncode != 0:
            print(f"  ✗ POSTS UNREACHABLE (kind={kind}): {out.stderr.strip()[:90]}")
            return None
        for p_ in (_json.loads(out.stdout).get("posts") or []):
            if p_["id"] not in ids:
                ids.append(p_["id"])
    findings = 0
    for pid in ids:
        out = subprocess.run(["curl", "-sS", "--fail-with-body",
                              "-H", "User-Agent: mz-operator-tools/1.0 (dark-surface-gate)",
                              f"https://mountzara.com/api/posts/{pid}"],
                             capture_output=True, text=True)
        if out.returncode != 0:
            print(f"  ✗ POST UNREACHABLE: {pid}")
            return None
        doc = _json.loads(out.stdout)
        post = doc.get("post") or doc
        body = post.get("body_html") or post.get("body") or ""
        css = " ".join(re.findall(r"<style[^>]*>([\s\S]*?)</style>", body)) + \
              " ".join(re.findall(r'style="([^"]*)"', body))
        with tempfile.NamedTemporaryFile("w", suffix=".css", delete=False) as t:
            t.write(css); tmp = t.name
        hits = scan(tmp)
        os.unlink(tmp)
        hits = [h for h in hits if "backdrop" not in h[3].lower()]
        if hits:
            findings += len(hits)
            for line, col, L, decl in hits[:4]:
                print(f"  ✗ post {pid}: {col} (lum {L})  {decl[:60]}")
    print(f"  posts scanned: {len(ids)}, dark grounds: {findings}")
    return findings


def main():
    targets = []
    # ALL js, not just functions/: shared components inject their own CSS.
    # admin/_nav.js paints the admin toolbar and was missed by a
    # functions-only sweep, leaving a near-black bar on every light admin page.
    for pat in ("**/*.html", "**/*.js"):
        targets += glob.glob(os.path.join(ROOT, pat), recursive=True)
    targets = [t for t in targets if "node_modules" not in t and "/.git/" not in t
               and "/docs/" not in t and "/assets/brand/" not in t
               and "/scripts/" not in t and "/cron-worker/" not in t]
    bad, nfiles = 0, 0
    for t in sorted(targets):
        hits = scan(t)
        # the /about/ cover is a photograph, not a themed surface
        if hits and t.endswith("about/index.html"):
            hits = [h for h in hits if 'cover' not in h[3].lower()]
        hits += [(l, c, 0, why) for l, c, why in scan_text(t)]
        if hits:
            nfiles += 1
            rel = os.path.relpath(t, ROOT)
            for line, col, L, decl in hits[:6]:
                print(f"  ✗ {rel}:{line}  {col} (lum {L})  {decl}")
            if len(hits) > 6:
                print(f"     … and {len(hits)-6} more in this file")
            bad += len(hits)
    post_bad = scan_published_posts()
    if post_bad is None:
        print("\n🛑 DARK-SURFACE GATE FAILED — published posts could not be scanned.")
        print("   A scan that covers zero posts would report clean; that is not a pass.")
        return 1
    bad += post_bad
    if bad:
        print(f"\n🛑 DARK-SURFACE GATE FAILED — {bad} dark ground(s) in {nfiles} file(s).")
        print("   The site is light (SYSTEM_MAP §8.0.0). Convert the ground, or if it is")
        print("   a scrim, name it *backdrop/*overlay so the gate can tell.")
        return 1
    print(f"dark-surface gate: CLEAN — {len(targets)} file(s), no dark grounds outside brand violets and scrims")
    return 0

if __name__ == "__main__":
    sys.exit(main())
