#!/usr/bin/env python3
"""Citation markers on the RENDERED page: numbered, hoverable, resolving.

Static HTML cannot tell you that a popover appears on hover — CSS, a stray
overflow rule, or a z-index can defeat it, and the pipeline's own check for a
touch handler was vacuous because the handler is injected moments before the
check looks for it. This opens the published route in a browser and, for a
sample of citations, asserts what a reader actually gets:

  * the visible marker is a number, never a PMID   (S2)
  * hovering it (desktop) and tapping it (touch) reveals a popover with a
    summary — two different code paths, CSS :hover and a click handler  (S3)
  * the popover carries a link to the study        (S3)
  * the marker resolves to a numbered reference    (S4)
  * no element id is duplicated on the assembled page — the body's ids plus
    the shell's, which is the only place a collision can actually happen (S14)

Every marker is checked, not a sample. --max=N caps it for a spot check.

Usage: audit_citation_popovers.py <base-url> --routes=/evidence/?id=x,/trending/?id=y [--max=N]
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
# Every marker, not a sample: the standard says every citation is hoverable and
# tappable, and a sample is exactly how a defect survives on the markers nobody
# looked at. A brief with 200 citations takes longer; that is the right trade.
MAX_CHECKED = int(next((a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("--max=")), "0")) or None


def duplicate_ids(page, route):
    """Ids as the browser sees them: the injected body PLUS the shell's chrome.

    A brief's ids are unique within its own body and can still collide with the
    page that injects it; the reader's browser resolves an anchor to whichever
    came first. Only the rendered document can answer this.
    """
    dupes = page.evaluate("""() => {
        const seen = new Map();
        for (const el of document.querySelectorAll('[id]')) {
            seen.set(el.id, (seen.get(el.id) || 0) + 1);
        }
        return [...seen.entries()].filter(([, n]) => n > 1).map(([id, n]) => id + ' x' + n);
    }""")
    return [f"{route}: duplicate element id on the rendered page: {d}" for d in dupes[:10]]


def check_marker(page, sup, route, i, mode):
    """One citation, as a reader meets it: number, reveal, summary, link."""
    fails = []
    try:
        marker = (sup.locator("a.mz-ref-link").first.inner_text() or "").strip()
    except Exception:
        return [f"{route}: citation {i} has no marker link"]
    if not re.fullmatch(r"\d{1,4}", marker):
        return [f"{route}: citation {i} shows {marker!r} — a marker is its number, not a PMID"]
    href = sup.locator("a.mz-ref-link").first.get_attribute("href") or ""
    if href.startswith("#") and page.locator(href).count() == 0:
        fails.append(f"{route}: marker {marker} points at {href}, which is not on the page")
    try:
        sup.scroll_into_view_if_needed(timeout=15000)
        if mode == "hover":
            sup.hover(timeout=15000)
        else:
            sup.click(timeout=15000)
        page.wait_for_timeout(350)
    except Exception as e:
        return fails + [f"{route}: marker {marker} could not be {mode}ed ({str(e)[:60]})"]
    pop = sup.locator(".mz-ref-pop").first
    if not pop.is_visible():
        return fails + [f"{route}: {mode} on marker {marker} reveals no popover"]
    txt = (pop.inner_text() or "").strip()
    if len(txt) < 120:
        fails.append(f"{route}: popover for marker {marker} has no real summary ({len(txt)} chars)")
    if pop.locator("a.mz-ref-pop-src").count() == 0:
        fails.append(f"{route}: popover for marker {marker} has no link to the study")
    return fails


def audit(page, route, mode="hover"):
    fails = []
    url = BASE.rstrip("/") + route + ("&" if "?" in route else "?") + "cb=pw"
    page.goto(url, wait_until="networkidle", timeout=90000)
    page.wait_for_timeout(2500)
    sups = page.locator("sup.mz-ref")
    n = sups.count()
    if n == 0:
        return [f"{route}: no inline citations on the rendered page"]
    fails += duplicate_ids(page, route)
    limit = min(n, MAX_CHECKED) if MAX_CHECKED else n
    for i in range(limit):
        fails += check_marker(page, sups.nth(i), route, i, mode)
        if len(fails) > 40:
            fails.append(f"{route}: stopping after 40 problems ({limit - i - 1} marker(s) unchecked)")
            break
    print(f"    {route} [{mode}]: {limit} of {n} marker(s) checked")
    return fails


def main():
    if not ROUTES:
        print("no routes given"); return 1
    all_fails = []
    probe = BASE.rstrip("/") + ROUTES[0]
    with sync_playwright() as pw:
        browser, engine, note = launch_reachable(pw, probe, headless=True)
        print(f"  engine: {engine}{(' — ' + note) if note else ''}")
        # hover on a desktop viewport, then tap on a touch viewport: the
        # standard says hoverable AND tappable, and the touch path is a
        # different code path (a delegated click handler, not CSS :hover)
        for mode, ctx_args in (("hover", {"viewport": {"width": 1280, "height": 900}}),
                               ("tap", {"viewport": {"width": 390, "height": 844},
                                        "has_touch": True, "is_mobile": True})):
            ctx = browser.new_context(**ctx_args)
            page = ctx.new_page()
            for route in ROUTES:
                f = audit(page, route, mode)
                print(f"  {route} [{mode}]: {'OK' if not f else str(len(f)) + ' problem(s)'}")
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
