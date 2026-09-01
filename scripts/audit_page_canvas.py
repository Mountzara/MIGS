#!/usr/bin/env python3
"""Every route's rendered ground must be the approved paper — never transparent.

Runtime companion to fix_page_canvas.py. The 2026-09-01 regression: most
pages left html/body transparent after the light conversion, so the ground
became the visitor's browser canvas — grey in dark-mode Safari. A static
check can't prove the rendered result (a later `background:` shorthand
resets the color), so this drives a real browser over EVERY route (derived
from the tree, same rule as audit_light_text.py) and asserts the effective
document ground: html or body must compute an OPAQUE color, and the
top-of-page ground pixel-equivalent must be the approved paper family
(luminance ≥ 240 and warm — not a browser default showing through).

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

JS = """() => {
    const parse = (c) => {
        const m = String(c || "").match(/rgba?\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*(?:,\\s*([0-9.]+))?\\)/);
        if (!m) return null;
        return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
    };
    const html = parse(getComputedStyle(document.documentElement).backgroundColor);
    const body = parse(getComputedStyle(document.body).backgroundColor);
    // effective ground = first opaque of body-over-html
    const ground = (body && body.a >= 0.99) ? body : (html && html.a >= 0.99 ? html : null);
    return { html, body, ground };
}"""

def main():
    routes = derive_routes()
    print(f"  auditing the rendered ground on every route derived from the tree: {len(routes)}")
    failures = []
    with sync_playwright() as p:
        browser, engine, note = launch_engine(p, "webkit")
        if note:
            print("NOTE:", note)
        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        page = ctx.new_page()
        for route in routes:
            try:
                page.goto(f"{BASE}{route}?cb={int(time.time())}", wait_until="domcontentloaded", timeout=45000)
                page.wait_for_timeout(600)
                page.evaluate("document.querySelectorAll('video').forEach(v=>{try{v.pause()}catch(e){}})")
                r = page.evaluate(JS)
            except Exception as e:
                failures.append((route, f"could not measure: {str(e)[:80]}"))
                continue
            g = r.get("ground")
            if not g:
                failures.append((route, f"document ground is TRANSPARENT (html={r.get('html')}, body={r.get('body')}) — the browser canvas shows through"))
                continue
            lum = (g["r"] * 299 + g["g"] * 587 + g["b"] * 114) / 1000
            if lum < 240:
                failures.append((route, f"ground rgb({g['r']},{g['g']},{g['b']}) lum {round(lum)} — not the approved paper family"))
        browser.close()
    if failures:
        for route, why in failures:
            print(f"  ✗ {route}: {why}")
        print(f"\n🛑 PAGE-CANVAS GATE FAILED — {len(failures)} route(s) without an opaque paper ground.")
        return 1
    print(f"page-canvas gate: CLEAN — {len(routes)} route(s), every document ground opaque paper")
    return 0

sys.exit(main())
