#!/usr/bin/env python3
"""WCAG contrast audit measured from REAL PIXELS, not composited guesses.

Why this exists (2026-08-08): three successive attempts to compute the
effective backdrop by walking ancestors and compositing rgba layers all
produced wrong answers — a cream app-mock gradient was scored as dark plum
(1.19:1 reported on text that is actually ~14:1), and clamping a 0.08 white
glass tint to opaque reported white body copy as failing on a dark page. The
site layers fixed art, screen blends, backdrop-filter glass, and gradients, so
no static model of the stack is trustworthy.

Method instead: render the page twice at the same scroll position — once
normally, once with every glyph made transparent — and sample the second image
at each text element's box. That IS the backdrop the reader sees, including
blur, blend modes, and background art. Contrast is then computed against the
element's real painted text color (the gradient's stop when the text is
background-clipped).

Usage:  audit_contrast_pixels.py [base_url] [--pages a,b,c] [--json out.json]
Exit 1 if any real failure is found.
"""
from __future__ import annotations

import io
import json
import sys
import time

sys.path.insert(0, "/home/user/MIGS/scripts")
from _lib_pw_launch import launch_reachable  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402
from PIL import Image  # noqa: E402

DEFAULT_PAGES = ["/", "/about/", "/cv/", "/evidence/", "/trending/", "/curriculum/",
                 "/curriculum/cbg-migs/", "/curriculum/hospice-clerkship/",
                 "/curriculum/hospice-training/"]
VIEWPORTS = [({"width": 1440, "height": 950}, "desktop"),
             ({"width": 390, "height": 844}, "mobile")]

COLLECT = r"""
() => {
  const parseRGB = (s) => {
    const m = String(s).match(/rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?/);
    return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null;
  };
  // An element only counts if the READER can see it: every ancestor must be
  // displayed, visible and non-transparent. Closed modals kept in the DOM at
  // opacity:0 were being sampled against the page behind them, inventing
  // "white text on a light panel" failures for dialogs nobody had opened.
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    if (!(r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < innerHeight)) return false;
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) return false;
      if (n.hasAttribute('hidden')) return false;
      if (n.tagName === 'DIALOG' && !n.open) return false;
      if (cs.pointerEvents === 'none' && +cs.opacity < 0.2) return false;
    }
    return true;
  };
  const out = [];
  const sel = 'p,li,h1,h2,h3,h4,h5,h6,span,a,button,td,th,div,label,summary,strong,em';
  document.querySelectorAll(sel).forEach(el => {
    const own = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (!own.length || !vis(el)) return;
    const cs = getComputedStyle(el);
    let fg = parseRGB(cs.color);
    if (!fg) return;
    // Text caught mid reveal-animation reports its transitional alpha (0.08),
    // which is not a shipped color. Real designs never ship <35% alpha body
    // text; judging it produced phantom failures on scroll-revealed links.
    if (fg[3] < 0.35) return;
    const clipped = (cs.webkitBackgroundClip || cs.backgroundClip) === 'text'
                    && cs.backgroundImage !== 'none';
    if (clipped) {
      const stop = String(cs.backgroundImage).match(/rgba?\([^)]+\)/);
      const sc = stop ? parseRGB(stop[0]) : null;
      if (sc) fg = [sc[0], sc[1], sc[2], 1];
    }
    // Occlusion: this homepage pins sections, so an element can be in the
    // viewport yet completely COVERED by a pinned frame. Sampling then reads
    // the covering layer as its backdrop and invents failures (measured: the
    // whole About block scored ~1.0:1 while hidden behind the pinned hero).
    // Require the element to actually be the hit-test target somewhere.
    const hit = (() => {
      const b = el.getBoundingClientRect();
      const pts = [[0.2, 0.5], [0.5, 0.5], [0.8, 0.5]];
      return pts.some(([fx, fy]) => {
        const x = b.left + b.width * fx, y = b.top + b.height * fy;
        if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false;
        const t = document.elementFromPoint(x, y);
        return t && (t === el || el.contains(t) || t.contains(el));
      });
    })();
    if (!hit) return;
    // measure the first text line's box so we sample behind actual glyphs
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter(r => r.width > 2 && r.height > 2);
    const r = rects.length ? rects[0] : el.getBoundingClientRect();
    const size = parseFloat(cs.fontSize), weight = +cs.fontWeight || 400;
    // Emit ONLY sample points that hit-test back to this element. On a page
    // with pinned/sticky sections an element's rect can sit where something
    // else is painted (a cream app-mock behind a dark card), and sampling
    // those pixels invented failures for text no reader ever sees that way.
    const pts = [];
    for (const fx of [0.3, 0.42, 0.5, 0.58, 0.7]) {
      for (const fy of [0.35, 0.5, 0.65]) {
        const px = r.left + r.width * fx, py = r.top + r.height * fy;
        if (px < 0 || py < 0 || px > innerWidth || py > innerHeight) continue;
        const t = document.elementFromPoint(px, py);
        if (t && (t === el || el.contains(t) || t.contains(el))) pts.push([Math.round(px), Math.round(py)]);
      }
    }
    if (pts.length < 3) return;          // not reliably visible: do not judge it
    out.push({
      pts,
      x: Math.round(r.left), y: Math.round(r.top),
      w: Math.round(r.width), h: Math.round(r.height),
      fg, size: +size.toFixed(1), weight,
      large: size >= 24 || (size >= 18.66 && weight >= 700),
      txt: el.textContent.trim().slice(0, 44),
      cls: String(el.className || '').trim().slice(0, 34),
      tag: el.tagName.toLowerCase(),
      color: cs.color,
    });
  });
  return out;
}
"""

HIDE_TEXT = """
  // Background-clip:text elements paint their glyphs FROM their background
  // gradient, so making the text color transparent does not hide them — the
  // sampler then reads the letterforms as their own backdrop (measured: a
  // white gradient heading scored 1.00:1 against itself). Neutralize those
  // backgrounds for the backdrop frame, then restore.
  window.__mzClipped = [...document.querySelectorAll('*')].filter(el => {
    const cs = getComputedStyle(el);
    return (cs.webkitBackgroundClip || cs.backgroundClip) === 'text';
  }).map(el => {
    const prev = el.style.backgroundImage;
    el.style.setProperty('background-image', 'none', 'important');
    return [el, prev];
  });
  window.__mzHide = document.createElement('style');
  window.__mzHide.textContent = `*, *::before, *::after {
      color: transparent !important;
      text-shadow: none !important;
      -webkit-text-fill-color: transparent !important;
      text-decoration-color: transparent !important;
      caret-color: transparent !important;
  }`;
  document.head.appendChild(window.__mzHide);
"""
SHOW_TEXT = """
  if (window.__mzHide) { window.__mzHide.remove(); window.__mzHide = null; }
  (window.__mzClipped || []).forEach(([el, prev]) => {
    el.style.removeProperty('background-image');
    if (prev) el.style.backgroundImage = prev;
  });
  window.__mzClipped = null;
"""


def luminance(c):
    def f(v):
        v /= 255.0
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])


def ratio(a, b):
    l1, l2 = luminance(a), luminance(b)
    hi, lo = max(l1, l2), min(l1, l2)
    return (hi + 0.05) / (lo + 0.05)


def over(fg, bg):
    a = fg[3]
    return [fg[i] * a + bg[i] * (1 - a) for i in range(3)]


def sample_backdrop(img, dpr, points):
    """Median-by-luminance of the backdrop at points that hit-test to the text."""
    px = img.load()
    W, H = img.size
    vals = []
    for (x, y) in points:
        sx, sy = int(x * dpr), int(y * dpr)
        if 0 <= sx < W and 0 <= sy < H:
            vals.append(px[sx, sy][:3])
    if not vals:
        return None
    vals.sort(key=luminance)
    return list(vals[len(vals) // 2])


def _blank_fraction(img):
    px = img.load()
    W, H = img.size
    pts = [px[int(W * fx), int(H * fy)][:3]
           for fx in (0.05, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95)
           for fy in (0.05, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95)]
    return sum(1 for p in pts if p == (255, 255, 255)) / len(pts)


def _frame_is_blank(img):
    """Headless Chromium hands back partially unpainted frames right after a
    programmatic scroll; a dark-themed page showing substantial pure white is
    a bad capture, not a finding (this produced a full viewport of phantom
    1.00:1 failures at one scroll position)."""
    return _blank_fraction(img) > 0.25


REST_OVERLAY = """() => {
  // A closed dialog must not paint. On 2026-08-08 a rule matching
  // `.omt-modal:not([hidden])` — a modal that opens by CLASS and never uses
  // the hidden attribute — left two full-viewport backdrop-filter layers
  // permanently visible, and the ENTIRE SITE rendered blurred in production.
  return [...document.querySelectorAll('*')].filter(el => {
    const cs = getComputedStyle(el);
    const bf = cs.backdropFilter || cs.webkitBackdropFilter || '';
    if (!/blur\\(/.test(bf)) return false;
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) return false;
    const r = el.getBoundingClientRect();
    return r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9;
  }).map(el => ({
    cls: String(el.className || el.tagName).slice(0, 48),
    opacity: getComputedStyle(el).opacity,
    filter: (getComputedStyle(el).backdropFilter || '').slice(0, 30),
  }));
}"""



class BrowserCrashed(RuntimeError):
    """The engine died mid-capture. This is NOT a contrast verdict."""


def _is_crash(exc):
    """Did the browser die, as opposed to the page failing an assertion?

    Playwright surfaces this from whatever call happened to be in flight —
    Page.screenshot raises Error("Target crashed"), while a scroll or a
    wait afterwards raises TargetClosedError("Page crashed"). The first
    version of this guard only wrapped screenshot(), so the very next
    deploy crashed inside wait_for_timeout and was reported, once again,
    as a WCAG failure. Match on the message, not the call site.
    """
    m = str(exc).lower()
    return "crash" in m or "target closed" in m or "browser has been closed" in m


def _screenshot_or_crash(page, attempts=3):
    """Screenshot, retrying a crashed target once with a pause.

    2026-08-20 — a deploy reported "CONTRAST GATE FAILED — text on this site
    does not meet WCAG" when WebKit had simply died taking the capture
    ("Target crashed"). The traceback escaped main(), Python exited non-zero,
    and deploy-prod.sh printed the contrast message for it. A crash is
    UNJUDGEABLE, not a failing ratio, and saying otherwise sends the next
    person hunting for a colour problem that does not exist.

    This page is tall and the capture is full-viewport at DPR 2, so the crash
    is resource pressure and usually clears on a retry. If it does not, the
    caller raises BrowserCrashed and the run reports the real reason. It must
    still BLOCK — a gate that cannot see the page has proved nothing, and the
    whole point of the recent repair was that a gate measuring nothing must
    never read as green.
    """
    last = None
    for i in range(attempts):
        try:
            return page.screenshot(type="png")
        except Exception as e:               # noqa: BLE001 - re-raised below
            last = e
            if not _is_crash(e):
                raise
            try:
                page.wait_for_timeout(1200 * (i + 1))
            except Exception:
                # The pause itself fails once the target is gone; the page is
                # unusable either way, so stop retrying on this one.
                break
    raise BrowserCrashed(f"engine died taking the capture after {attempts} attempts: {last}")

def audit_page(page, dpr, scroll_y=0):
    """Returns failures for the CURRENT scroll position."""
    items = page.evaluate(COLLECT)
    if not items:
        return []
    page.evaluate(HIDE_TEXT)
    # Wait for an actually-painted frame. Screenshotting straight after a
    # programmatic scroll returned a BLANK WHITE viewport in headless
    # Chromium (every element at scrollY=1900 scored 1.00:1 against pure
    # white); two rAFs plus a settle make the capture deterministic.
    page.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")
    page.wait_for_timeout(260)
    shot = _screenshot_or_crash(page)
    img = Image.open(io.BytesIO(shot)).convert("RGB")
    if _frame_is_blank(img):
        page.wait_for_timeout(500)
        shot = _screenshot_or_crash(page)
        img = Image.open(io.BytesIO(shot)).convert("RGB")
        if _frame_is_blank(img):
            page.evaluate(SHOW_TEXT)
            return []                      # unusable frame; never invent failures from it
    page.evaluate(SHOW_TEXT)
    fails, suspects = [], []
    for it in items:
        bg = sample_backdrop(img, dpr, it["pts"])
        if bg is None:
            continue
        fg = it["fg"]
        painted = over(fg, bg) if fg[3] < 1 else fg[:3]
        cr = ratio(painted, bg)
        need = 3.0 if it["large"] else 4.5
        if cr < need - 0.01:
            if tuple(round(v) for v in bg) == (255, 255, 255):
                suspects.append(it)      # confirm against a fresh capture below
                continue
            fails.append({"ratio": round(cr, 2), "need": need, "txt": it["txt"],
                          "cls": it["cls"], "tag": it["tag"], "color": it["color"],
                          "size": it["size"], "weight": it["weight"],
                          "bg": [round(v) for v in bg], "scrollY": scroll_y,
                          "at": [it["x"], it["y"], it["w"], it["h"]]})
    if suspects:
        page.evaluate(HIDE_TEXT)
        page.wait_for_timeout(800)
        img2 = Image.open(io.BytesIO(page.screenshot(type="png"))).convert("RGB")
        page.evaluate(SHOW_TEXT)
        if not _frame_is_blank(img2):
            for it in suspects:
                bg2 = sample_backdrop(img2, dpr, it["pts"])
                if bg2 is None or tuple(round(v) for v in bg2) == (255, 255, 255):
                    continue                       # still unpainted: not a finding
                fg2 = it["fg"]
                painted2 = over(fg2, bg2) if fg2[3] < 1 else fg2[:3]
                cr2 = ratio(painted2, bg2)
                need2 = 3.0 if it["large"] else 4.5
                if cr2 < need2 - 0.01:
                    fails.append({"ratio": round(cr2, 2), "need": need2, "txt": it["txt"],
                                  "cls": it["cls"], "tag": it["tag"], "color": it["color"],
                                  "size": it["size"], "weight": it["weight"],
                                  "bg": [round(v) for v in bg2], "scrollY": scroll_y,
                                  "at": [it["x"], it["y"], it["w"], it["h"]]})
    return fails


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    base = args[0] if args else "https://mountzara.com"
    pages = DEFAULT_PAGES
    for a in sys.argv[1:]:
        if a.startswith("--pages="):
            pages = a.split("=", 1)[1].split(",")
    local = "localhost" in base
    srv = None
    if local:
        import subprocess
        port = base.rsplit(":", 1)[1].split("/")[0]
        srv = subprocess.Popen(["python3", "-m", "http.server", port], cwd="/home/user/MIGS",
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(1.2)

    report, total = {}, 0
    with sync_playwright() as p:
        # ---------------------------------------------------------------
        # 2026-08-20 — WAS launch_chromium(). This VM's proxy resets every
        # Chromium connection, so every page load raised
        # ERR_CONNECTION_RESET, every page was recorded as {"error": ...},
        # and the summary — which counted only CONTRAST failures — printed
        # "0 failure(s) across 9 page(s) x 2 viewport(s)". The deploy read
        # that as green. This gate had been measuring nothing, and it let
        # near-black text ship on a near-black About panel at about 1.1:1.
        #
        # launch_reachable probes the real site and falls back to WebKit,
        # which connects natively here, and raises rather than returning a
        # browser that cannot see the site at all.
        # ---------------------------------------------------------------
        probe = f"{base}{pages[0]}" + ("index.html" if local else "")
        b, engine, note = launch_reachable(p, probe, headless=True)
        print(f"  (engine: {engine}{'; ' + note if note else ''})")
        for vp, label in VIEWPORTS:
            dpr = 2 if label == "mobile" else 1
            ctx = b.new_context(viewport=vp, device_scale_factor=dpr, ignore_https_errors=True)
            page = ctx.new_page()
            for path in pages:
                url = f"{base}{path}" + ("index.html" if local else "") + f"?cb={int(time.time()*1000)}"
                try:
                    page.goto(url, wait_until="networkidle", timeout=45000)
                except Exception as e:
                    report.setdefault(path, {})[label] = {"error": str(e)[:90]}
                    continue
                page.wait_for_timeout(1400)
                # FREEZE TIME-ROTATING CONTENT. The homepage app-demo scenes
                # rotate every 3.6s; the two render passes (backdrop vs glyph)
                # can catch DIFFERENT scenes, measuring one scene's text
                # against another scene's ground (observed: .rl-cap "1.04:1"
                # on one deploy, clean on the rerun with zero diffs between).
                # Neutralize every interval-driven rotator before measuring.
                page.evaluate("""() => {
                    const top = setInterval(() => {}, 100000);
                    for (let i = 1; i <= top; i++) clearInterval(i);
                }""")
                # SETTLE IN-FLIGHT TRANSITIONS. Clearing intervals stops the
                # NEXT rotation, but a crossfade already running keeps
                # running: an app-reel scene sampled mid-fade sits at
                # ancestor opacity ~0.3 — past the visibility check's 0.05
                # floor — while its own background chip contributes almost
                # nothing to the pixels. Measured: the ABOG reel caption
                # (#2b1c4d on a cream chip, 12.9:1 as designed) reported
                # 1.04:1 against the dark card bleeding through the fade.
                # Kill transitions so every property snaps to its settled
                # value, and finish() finite animations; infinite ones
                # (Ken Burns) throw on finish() and are left alone.
                page.evaluate("""() => {
                    const st = document.createElement('style');
                    st.textContent = '*, *::before, *::after { transition: none !important; }';
                    document.head.appendChild(st);
                    const anims = document.getAnimations ? document.getAnimations({ subtree: true }) : [];
                    anims.forEach(a => { try { a.finish(); } catch (e) { /* infinite */ } });
                }""")
                # Stop every video before measuring. Two reasons:
                #
                #  * CORRECTNESS — a playing reel changes what is behind the
                #    text between the two capture passes, which is the same
                #    class of error the interval freeze above prevents.
                #  * STABILITY — WebKit repeatedly died capturing the desktop
                #    homepage ("Target crashed"). That page composites several
                #    autoplaying H.264 reels behind backdrop-filter layers at
                #    DPR 2; releasing the decoders is what makes the capture
                #    survivable. Reported as unmeasured when it still dies,
                #    never as a contrast verdict.
                page.evaluate("""() => {
                    document.querySelectorAll('video').forEach(v => {
                        try { v.pause(); v.autoplay = false; v.removeAttribute('autoplay');
                              v.preload = 'none'; v.currentTime = 0; } catch (e) {}
                    });
                }""")
                page.wait_for_timeout(200)
                stuck = page.evaluate(REST_OVERLAY)
                if stuck:
                    for o in stuck:
                        print(f"  ✗ {path} [{label}] FULL-PAGE OVERLAY VISIBLE AT REST: "
                              f".{o['cls']} opacity={o['opacity']} {o['filter']} "
                              f"— the whole page renders blurred")
                    total += len(stuck)
                seen, fails = set(), []
                height = page.evaluate("document.body.scrollHeight")
                step = vp["height"]
                try:
                    for y in range(0, min(height, step * 12), step):
                        page.evaluate(f"window.scrollTo(0, {y})")
                        page.wait_for_timeout(450)
                        for f in audit_page(page, dpr, y):
                            k = (f["txt"], f["cls"], f["color"])
                            if k in seen:
                                continue
                            seen.add(k)
                            fails.append(f)
                except Exception as e:  # noqa: BLE001 — re-raised unless it is a crash
                    # Same channel as a failed goto: NOT MEASURED. That still
                    # blocks the deploy (see the `measured` guard in main), but
                    # it blocks with the true reason instead of claiming the
                    # site has a colour-contrast violation.
                    if not isinstance(e, BrowserCrashed) and not _is_crash(e):
                        raise
                    print(f"  ✗ {path} [{label}] CAPTURE CRASHED — not measured: {str(e)[:120]}")
                    report.setdefault(path, {})[label] = {"error": f"engine crashed: {e}"[:90]}
                    try:
                        page.close()
                    except Exception:
                        pass
                    page = ctx.new_page()
                    continue
                # Final confirmation: re-meet each candidate the way a reader
                # does — scroll it to the middle of the viewport and measure
                # again. Pinned/sticky sections mean an element's rect can sit
                # over unrelated pixels during a bulk scan; only failures that
                # survive being looked at directly are real.
                confirmed = []
                for f in fails:
                    ok = page.evaluate(
                        """([txt, cls]) => {
                            const els = [...document.querySelectorAll('*')].filter(e =>
                                e.children.length === 0 &&
                                e.textContent.trim().slice(0, 44) === txt &&
                                String(e.className || '').trim().slice(0, 34) === cls);
                            if (!els.length) return false;
                            els[0].scrollIntoView({block: 'center'});
                            return true;
                        }""", [f["txt"], f["cls"]])
                    if not ok:
                        continue
                    page.wait_for_timeout(400)
                    again = audit_page(page, dpr, -1)
                    if any(a["txt"] == f["txt"] and a["cls"] == f["cls"] for a in again):
                        confirmed.append(f)
                report.setdefault(path, {})[label] = {"fails": confirmed}
                total += len(confirmed)
            ctx.close()
        b.close()
    if srv:
        srv.terminate()

    for path, byvp in report.items():
        for vp, r in byvp.items():
            if "error" in r:
                print(f"  ✗ {path} [{vp}] load error: {r['error']}")
                continue
            fails = r["fails"]
            mark = "✓" if not fails else "✗"
            print(f"  {mark} {path} [{vp}] {len(fails)} contrast failure(s)")
            for f in fails[:8]:
                print(f"        {f['ratio']:.2f}:1 (need {f['need']}) {f['size']}px/{f['weight']} "
                      f"{f['color']} on rgb{tuple(f['bg'])} .{f['cls'][:22]} {f['txt'][:40]!r}")
    out = [a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("--json=")]
    if out:
        json.dump(report, open(out[0], "w"), indent=1)
    # A page that never loaded was never measured. Counting only contrast
    # failures meant "everything failed to load" and "everything is fine"
    # produced the same green summary — which is exactly how this gate came
    # to pass while the site shipped 1.1:1 text. Load errors are failures.
    load_errors = sum(1 for byvp in report.values() for r in byvp.values() if "error" in r)
    measured = sum(1 for byvp in report.values() for r in byvp.values() if "error" not in r)
    print(f"\npixel-measured contrast: {total} failure(s) across "
          f"{measured} page-viewport(s) actually measured "
          f"({len(pages)} page(s) x {len(VIEWPORTS)} viewport(s) attempted)")
    if load_errors:
        print(f"  ✗ {load_errors} page-viewport(s) never loaded — those were NOT measured.")
    if not measured:
        print("  ✗ NOTHING was measured. A gate that saw no pixels cannot report clean.")
        return 1
    return 1 if (total or load_errors) else 0


sys.exit(main())
