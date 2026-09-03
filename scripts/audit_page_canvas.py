#!/usr/bin/env python3
"""Every route's rendered ground must be the approved paper — never transparent.

Runtime companion to fix_page_canvas.py. The 2026-09-01 regression: most
pages left html/body transparent after the light conversion, so the ground
became the visitor's browser canvas — grey in dark-mode Safari. A static
check can't prove the rendered result (a later `background:` shorthand
resets the color), so this drives a real browser over EVERY route (derived
from the tree, same rule as audit_light_text.py) and asserts the effective
document ground by RENDERED PIXELS: three corner samples per route must
all be light (paper or the design's violet tint washes) — never the
grey/dark canvas a transparent document exposes in dark-mode browsers.

  python3 scripts/audit_page_canvas.py https://mountzara.com
  python3 scripts/audit_page_canvas.py http://127.0.0.1:8099
"""
import os, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lib_pw_launch import launch_engine  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

BASE = (sys.argv[1] if len(sys.argv) > 1 else "https://mountzara.com").rstrip("/")

def derive_routes():
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

def corner_means(page):
    """Mean RGB of three rendered ground samples — pixels are the truth.

    A computed-style check false-positives on pages whose ground is an
    OPAQUE background-image gradient (backgroundColor stays transparent
    while the render is solid paper), so the gate measures what a visitor
    actually sees: an 8x8 clip at the top-left corner, the top-right
    corner, and mid-left. All three must be LIGHT — paper or the design's
    own violet tint washes (lum >= 200). What this catches is the actual
    regression class: a transparent document over the visitor's browser
    canvas, which renders grey/near-black in dark-mode browsers.
    """
    from io import BytesIO
    from PIL import Image
    vw, vh = 1280, 900
    out = []
    for (x, y) in ((0, 0), (vw - 8, 0), (0, vh // 2)):
        png = page.screenshot(clip={"x": x, "y": y, "width": 8, "height": 8})
        img = Image.open(BytesIO(png)).convert("RGB")
        px = list(img.getdata())
        n = len(px)
        out.append(tuple(sum(c[i] for c in px) / n for i in range(3)))
    return out

def main():
    routes = derive_routes()
    print(f"  auditing the rendered ground on every route derived from the tree: {len(routes)}")
    failures = []
    with sync_playwright() as p:
        browser, engine, note = launch_engine(p, "webkit")
        if note:
            print("NOTE:", note)
        # DARK color-scheme emulation is the point: a transparent document
        # renders on the engine's canvas, which is WHITE in the default lab
        # and would false-pass. Dark emulation makes the canvas dark, so a
        # route that lost its opaque paper ground fails here the same way
        # it fails a dark-mode Safari visitor. (Shipped one deploy AFTER the
        # guards, deliberately — pre-guard live routes would have deadlocked
        # the deploy that carried the fix.)
        ctx = browser.new_context(viewport={"width": 1280, "height": 900},
                                  color_scheme="dark")
        page = ctx.new_page()
        for route in routes:
            try:
                page.goto(f"{BASE}{route}?cb={int(time.time())}", wait_until="domcontentloaded", timeout=45000)
                page.wait_for_timeout(600)
                page.evaluate("document.querySelectorAll('video').forEach(v=>{try{v.pause()}catch(e){}})")
                samples = corner_means(page)
            except Exception as e:
                failures.append((route, f"could not measure: {str(e)[:80]}"))
                continue
            bad = []
            for (r_, g_, b_) in samples:
                lum = (r_ * 299 + g_ * 587 + b_ * 114) / 1000
                if lum < 200:
                    bad.append(f"rgb({round(r_)},{round(g_)},{round(b_)}) lum {round(lum)}")
            if bad:
                failures.append((route, f"rendered ground is not paper-family: {', '.join(bad)}"))
        browser.close()
    if failures:
        for route, why in failures:
            print(f"  ✗ {route}: {why}")
        print(f"\n🛑 PAGE-CANVAS GATE FAILED — {len(failures)} route(s) without an opaque paper ground.")
        return 1
    print(f"page-canvas gate: CLEAN — {len(routes)} route(s), every document ground opaque paper")
    return 0

sys.exit(main())
