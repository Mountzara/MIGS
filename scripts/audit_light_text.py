#!/usr/bin/env python3
"""Runtime guard: no near-white text on a light ground, anywhere, incl. modals.

Why this exists alongside audit_contrast_pixels.py: that gate is thorough but
slow (networkidle + a dozen scroll captures per page), so in practice it only
ever ran over nine routes. The light conversion broke text on eighty. This one
trades depth for coverage — one paint per page, computed styles, every route,
modals forced open — so "is any text invisible anywhere on the site" is a
question that can actually be answered on every deploy.

It resolves the ground the way the eye does: walk up the ancestors for the
first background that is actually painted (colour OR gradient), and only flag
text whose own colour is close to that ground. Text on a violet button, or on
the /about/ cover photograph, is left alone.

Usage: audit_light_text.py [base_url] [--routes=/a/,/b/]
"""
import sys, os, time, json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lib_pw_launch import launch_engine
from playwright.sync_api import sync_playwright

BASE = next((a for a in sys.argv[1:] if not a.startswith("--")), "https://mountzara.com")
ROUTES = None
for a in sys.argv[1:]:
    if a.startswith("--routes="):
        ROUTES = [r for r in a.split("=", 1)[1].split(",") if r]


def derive_routes():
    """Every route, derived from the filesystem — never from a list.

    This is the determinism rule this whole conversion finally taught: every
    surface family that was missed was missed because some check enumerated
    surfaces from a hand-maintained list (a default of nine routes, a memory
    of which pages exist) instead of from the system itself. The site-wide
    theme sweep ran over 92 routes exactly once, by hand, from a temp file;
    the gate then went back to sampling nine. A sample can only prove the
    sample.

    One glob, one rule: every index.html is a route, plus 404.html. A page
    added tomorrow is audited tomorrow, with nobody remembering anything.
    """
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    routes = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames
                       if d not in ("node_modules", ".git", "docs", "scripts",
                                    "functions", "assets", "schema", "cron-worker",
                                    "companion-app")]
        if "index.html" in filenames:
            rel = os.path.relpath(dirpath, root)
            routes.append("/" if rel == "." else "/" + rel.replace(os.sep, "/") + "/")
    if os.path.exists(os.path.join(root, "404.html")):
        routes.append("/404.html")
    return sorted(routes)


if ROUTES is None:
    ROUTES = derive_routes()
    n_files = len(ROUTES)
    print(f"  auditing every route derived from the tree: {n_files}")

JS = r"""() => {
  // force every modal-ish container visible: a modal only paints once opened,
  // which is how 25 inverted education modals shipped unnoticed
  const sels = ['dialog','[class*="modal"]','[class*="overlay"]','[class*="sheet"]',
                '[class*="drawer"]','[class*="lightbox"]','[class*="popover"]'];
  for (const s of sels) for (const el of document.querySelectorAll(s)) {
    try {
      if (el.tagName === 'DIALOG' && !el.open) el.show();
      el.classList.add('open','active','visible','is-open','show');
      el.removeAttribute('hidden');
      el.style.setProperty('display', el.tagName === 'DIALOG' ? 'block' : 'flex', 'important');
      el.style.setProperty('opacity','1','important');
      el.style.setProperty('visibility','visible','important');
    } catch (e) {}
  }
  const parse = s => { const m = (s||'').match(/[\d.]+/g); return m ? m.map(Number) : null; };
  const lum = c => (c[0]*299 + c[1]*587 + c[2]*114) / 1000;
  // Text laid over a PHOTOGRAPH has no CSS ground to read: the picture is a
  // sibling <img>, not an ancestor background. /about/'s magazine cover is
  // exactly that — white cover type over a dark headshot, which is correct.
  const photos = [...document.querySelectorAll('img, video')].map(m => {
    const r = m.getBoundingClientRect();
    return {l: r.left, t: r.top, r: r.right, b: r.bottom, area: r.width * r.height};
  }).filter(p => p.area > 40000);
  const overPhoto = el => {
    const r = el.getBoundingClientRect();
    return photos.some(p => r.left >= p.l - 4 && r.right <= p.r + 4 &&
                            r.top >= p.t - 4 && r.bottom <= p.b + 4);
  };
  // first ancestor that actually paints something
  const groundOf = el => {
    let n = el;
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      const bg = parse(cs.backgroundColor);
      if (bg && (bg.length < 4 || bg[3] > 0.55)) return {lum: lum(bg), src: 'color'};
      const img = cs.backgroundImage || 'none';
      if (img !== 'none') {
        const stops = img.match(/rgba?\([^)]*\)/g) || [];
        const solid = stops.map(parse).filter(c => c && (c.length < 4 || c[3] > 0.5));
        if (solid.length) return {lum: solid.reduce((a,c) => a + lum(c), 0) / solid.length, src: 'gradient'};
        if (/url\(/.test(img)) return {lum: null, src: 'image'};
      }
      n = n.parentElement;
    }
    return {lum: 250, src: 'root'};
  };
  const out = [], seen = new Set();
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while (node = w.nextNode()) {
    const t = (node.textContent || '').trim();
    if (t.length < 3) continue;
    const el = node.parentElement;
    if (!el) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (parseFloat(cs.opacity) < 0.2) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    const fillRaw = cs.webkitTextFillColor && cs.webkitTextFillColor !== 'currentcolor'
                    ? cs.webkitTextFillColor : cs.color;
    const fg = parse(fillRaw);
    if (!fg) continue;
    if (fg.length > 3 && fg[3] < 0.25) continue;   // transparent = gradient-clipped, judged elsewhere
    const fl = lum(fg);
    if (overPhoto(el)) continue;                   // white type over a photo is correct
    const g = groundOf(el);
    if (g.lum === null) continue;                  // sits on a photograph
    // flag only when the text is nearly the same brightness as its ground
    if (Math.abs(fl - g.lum) < 42 && g.lum > 150) {
      const key = (el.className || el.tagName) + '|' + Math.round(fl) + '|' + Math.round(g.lum);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({txt: t.slice(0, 44), cls: (el.className || '').toString().slice(0, 38) || el.tagName,
                fg: fillRaw, fgLum: Math.round(fl), bgLum: Math.round(g.lum), via: g.src});
    }
  }
  return out.slice(0, 14);
}"""

def main():
    total, pages = 0, 0
    with sync_playwright() as p:
        br, eng, note = launch_engine(p, "webkit")
        if note: print(f"  ({note})")
        ctx = br.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        page = ctx.new_page()
        page.on("dialog", lambda d: d.dismiss())
        for route in ROUTES:
            url = BASE.rstrip('/') + route + ("index.html" if "localhost" in BASE or "127.0.0.1" in BASE else "")
            try:
                page.goto(url + f"?cb={int(time.time()*1000)}", wait_until="domcontentloaded", timeout=40000)
                page.wait_for_timeout(2000)
                hits = page.evaluate(JS)
            except Exception as e:
                print(f"  ✗ {route} — could not load: {str(e)[:70]}")
                total += 1
                continue
            pages += 1
            if hits:
                total += len(hits)
                for h in hits:
                    print(f"  ✗ {route} .{h['cls']}  text {h['fgLum']} on ground {h['bgLum']} "
                          f"({h['via']})  {h['fg']}  {h['txt']!r}")
        ctx.close(); br.close()
    if total:
        print(f"\n🛑 LIGHT-TEXT GATE FAILED — {total} near-invisible text run(s) across {pages} route(s).")
        print("   Text must not match its own ground. See SYSTEM_MAP §8.0.0.")
        return 1
    print(f"light-text gate: CLEAN — {pages} route(s), no text matching its own ground")
    return 0

if __name__ == "__main__":
    sys.exit(main())
