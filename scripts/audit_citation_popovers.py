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
  * the educational disclaimer is actually VISIBLE to a reader          (S8)
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


def disclaimer_visible(page, route):
    """The disclaimer is only a disclaimer if a reader can read it.

    The pipeline inserts it whenever it is absent and then checks it is
    present — a check that cannot fail. What matters is that it renders, with
    real text, on the page.
    """
    els = page.locator(".mz-eddisclaimer")
    n = els.count()
    if n == 0:
        return [f"{route}: no educational disclaimer on the rendered page"]
    # A brief carries more than one: the reader's copy in the body, and another
    # inside a deep-dive dialog, which is closed and therefore zero-height until
    # opened. Checking only the first found the closed one and called a page
    # with a perfectly visible disclaimer a failure. ANY visible one with real
    # text satisfies the standard.
    best = 0
    for i in range(n):
        el = els.nth(i)
        if el.is_visible():
            best = max(best, len((el.inner_text() or "").strip()))
    if best == 0:
        return [f"{route}: {n} educational disclaimer(s) on the page, none of them visible"]
    if best < 80:
        return [f"{route}: the educational disclaimer renders only {best} characters"]
    return []


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
    # Three attempts. On the touch pass the previous marker's popover stays
    # open (the site's tap handler toggles it) and can lie over the next
    # marker, so a click is intercepted and times out — W34 was unpublished
    # for exactly one such tap, on a page whose preview had passed. Every
    # attempt first closes any open popover and centres the marker.
    last = ""
    for attempt in range(3):
        try:
            page.evaluate("document.querySelectorAll('.mz-ref.mz-open').forEach(e => e.classList.remove('mz-open'))")
            sup.evaluate("el => el.scrollIntoView({block: 'center', inline: 'nearest'})")
            page.wait_for_timeout(250 if attempt == 0 else 700)
            if mode == "hover":
                sup.hover(timeout=15000)
            else:
                sup.click(timeout=15000, force=(attempt == 2))
            page.wait_for_timeout(350)
            last = ""
            break
        except Exception as e:
            last = str(e)[:60]
    if last:
        return fails + [f"{route}: marker {marker} could not be {mode}ed after 3 attempts ({last})"]
    pop = sup.locator(".mz-ref-pop").first
    if not pop.is_visible():
        return fails + [f"{route}: {mode} on marker {marker} reveals no popover"]
    txt = (pop.inner_text() or "").strip()
    if len(txt) < 120:
        fails.append(f"{route}: popover for marker {marker} has no real summary ({len(txt)} chars)")
    if pop.locator("a.mz-ref-pop-src").count() == 0:
        fails.append(f"{route}: popover for marker {marker} has no link to the study")
    if mode != "hover":
        # leave the page as the next marker needs it: nothing open over it
        page.evaluate("document.querySelectorAll('.mz-ref.mz-open').forEach(e => e.classList.remove('mz-open'))")
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
    fails += disclaimer_visible(page, route)
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
