#!/usr/bin/env python3
"""Citation markers on the RENDERED page: numbered, hoverable, resolving.

Static HTML cannot tell you that a popover appears on hover — CSS, a stray
overflow rule, or a z-index can defeat it, and the pipeline's own check for a
touch handler was vacuous because the handler is injected moments before the
check looks for it. This opens the published route in a browser and, for a
sample of citations, asserts what a reader actually gets:

  * the visible marker is a number, never a PMID   (S2)
  * hovering it reveals a popover with a summary   (S3)
  * the popover carries a link to the study        (S3)
  * the marker resolves to a numbered reference    (S4)

Usage: audit_citation_popovers.py <base-url> --routes=/evidence/?id=x,/trending/?id=y
"""
import re
import sys

from playwright.sync_api import sync_playwright

from _lib_pw_launch import launch_reachable

BASE = next((a for a in sys.argv[1:] if not a.startswith("--")), "https://www.mountzara.com")
ROUTES = []
for a in sys.argv[1:]:
    if a.startswith("--routes="):
        ROUTES = [r for r in a.split("=", 1)[1].split(",") if r]
SAMPLE = 12


def audit(page, route):
    fails = []
    url = BASE.rstrip("/") + route + ("&" if "?" in route else "?") + "cb=pw"
    page.goto(url, wait_until="networkidle", timeout=90000)
    page.wait_for_timeout(2500)
    sups = page.locator("sup.mz-ref")
    n = sups.count()
    if n == 0:
        return [f"{route}: no inline citations on the rendered page"]
    step = max(1, n // SAMPLE)
    for i in range(0, n, step):
        sup = sups.nth(i)
        try:
            marker = (sup.locator("a.mz-ref-link").first.inner_text() or "").strip()
        except Exception:
            fails.append(f"{route}: citation {i} has no marker link")
            continue
        if not re.fullmatch(r"\d{1,4}", marker):
            fails.append(f"{route}: citation {i} shows {marker!r} — a marker is its number, not a PMID")
            continue
        href = sup.locator("a.mz-ref-link").first.get_attribute("href") or ""
        if href.startswith("#") and page.locator(href.replace("#", "#", 1)).count() == 0:
            fails.append(f"{route}: marker {marker} points at {href}, which is not on the page")
        try:
            sup.scroll_into_view_if_needed(timeout=15000)
            sup.hover(timeout=15000)
            page.wait_for_timeout(450)
        except Exception as e:
            fails.append(f"{route}: marker {marker} could not be hovered ({str(e)[:60]})")
            continue
        pop = sup.locator(".mz-ref-pop").first
        if not pop.is_visible():
            fails.append(f"{route}: hovering marker {marker} reveals no popover")
            continue
        txt = (pop.inner_text() or "").strip()
        if len(txt) < 120:
            fails.append(f"{route}: popover for marker {marker} has no real summary ({len(txt)} chars)")
        if pop.locator("a.mz-ref-pop-src").count() == 0:
            fails.append(f"{route}: popover for marker {marker} has no link to the study")
    return fails


def main():
    if not ROUTES:
        print("no routes given"); return 1
    all_fails = []
    probe = BASE.rstrip("/") + ROUTES[0]
    with sync_playwright() as pw:
        browser, engine, note = launch_reachable(pw, probe, headless=True)
        print(f"  engine: {engine}{(' — ' + note) if note else ''}")
        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        page = ctx.new_page()
        for route in ROUTES:
            f = audit(page, route)
            print(f"  {route}: {'OK' if not f else str(len(f)) + ' problem(s)'}")
            all_fails += f
        ctx.close()
        browser.close()
    for f in all_fails:
        print("  ✗ " + f)
    if all_fails:
        print(f"\n🛑 CITATION GATE FAILED — {len(all_fails)} problem(s)")
        return 1
    print("citations: numbered, hoverable, resolving, each with a summary and a link")
    return 0


sys.exit(main())
