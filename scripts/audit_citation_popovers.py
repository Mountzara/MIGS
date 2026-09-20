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
import concurrent.futures as cf
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
# Routes are independent pages in independent browsers, so they run at the
# same time. Every deploy re-checks every published brief, and that bill only
# grows as briefs accumulate: seventeen routes, each hovered AND tapped, was
# half an hour of a deploy spent waiting on one gate. Each worker is its own
# process with its own Playwright — the sync API is not thread-safe.
WORKERS = int(next((a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("--workers=")), "3"))


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


def marker_facts(page, route):
    """Everything a citation must be that can be read without touching it.

    The number, the reference it resolves to, and the summary and link inside
    its popover are all in the DOM before anyone hovers anything. Reading them
    for every marker in ONE pass costs a single round trip instead of five per
    marker; W21's 249 markers spent most of a 40-minute budget on round trips
    that never needed a browser. The browser is then only asked the one
    question it alone can answer: does the popover actually appear.
    """
    facts = page.evaluate("""() => {
        const out = [];
        for (const sup of document.querySelectorAll('sup.mz-ref')) {
            const a = sup.querySelector('a.mz-ref-link');
            const pop = sup.querySelector('.mz-ref-pop');
            const href = a ? (a.getAttribute('href') || '') : '';
            let target = true;
            if (href.startsWith('#')) {
                try { target = !!document.querySelector(href); } catch (e) { target = false; }
            }
            const txt = pop ? ((pop.innerText || pop.textContent || '').trim()) : '';
            out.push({
                marker: a ? (a.textContent || '').trim() : null,
                href: href,
                target: target,
                popLen: pop ? txt.length : -1,
                popLink: pop ? !!pop.querySelector('a.mz-ref-pop-src') : false,
            });
        }
        return out;
    }""")
    fails = []
    for i, f in enumerate(facts):
        m = f["marker"]
        if m is None:
            fails.append(f"{route}: citation {i} has no marker link")
            continue
        if not re.fullmatch(r"\d{1,4}", m):
            fails.append(f"{route}: citation {i} shows {m!r} — a marker is its number, not a PMID")
            continue
        if not f["target"]:
            fails.append(f"{route}: marker {m} points at {f['href']}, which is not on the page")
        if f["popLen"] < 0:
            fails.append(f"{route}: marker {m} carries no popover at all")
        elif f["popLen"] < 120:
            fails.append(f"{route}: popover for marker {m} has no real summary ({f['popLen']} chars)")
        if f["popLen"] >= 0 and not f["popLink"]:
            fails.append(f"{route}: popover for marker {m} has no link to the study")
    return facts, fails


# Attempt 0 is the fast path and must FAIL FAST: a marker covered by the
# previous popover fails Playwright's hit-target check and sits there until the
# timeout expires, so a 15-second first attempt turned a handful of stacked
# markers into tens of minutes. Short first, patient second, forced third.
HOVER_TIMEOUTS = (2500, 6000, 12000)
REVEAL_TIMEOUTS = (1500, 3000, 5000)


def check_reveal(page, sup, route, i, mode, marker):
    """The one thing only a browser can answer: does the popover appear when a
    reader hovers it (CSS :hover) or taps it (a delegated click handler)?"""
    last = ""
    for attempt in range(3):
        try:
            # close any popover still open over this marker AND centre this one,
            # in a single round trip
            sup.evaluate("""el => {
                document.querySelectorAll('.mz-ref.mz-open').forEach(e => {
                    if (e !== el) e.classList.remove('mz-open');
                });
                el.scrollIntoView({block: 'center', inline: 'nearest'});
            }""")
            if mode == "hover":
                # markers stack in runs and the PREVIOUS marker's popover sits
                # over the next one: hovering there lands on the popover and the
                # next marker never opens (W20's markers 8 and 20). Park the
                # pointer away first so no popover is under it. The settle wait
                # only costs anything on the retries that actually needed it.
                page.mouse.move(1, 1)
                if attempt:
                    page.wait_for_timeout(200)
                sup.hover(timeout=HOVER_TIMEOUTS[attempt], force=(attempt == 2))
            else:
                if attempt:
                    page.wait_for_timeout(200)
                sup.click(timeout=HOVER_TIMEOUTS[attempt], force=(attempt == 2))
            # poll for the popover instead of sleeping a fixed 350 ms every
            # time: a page that reveals in 30 ms should cost 30 ms
            sup.locator(".mz-ref-pop").first.wait_for(
                state="visible", timeout=REVEAL_TIMEOUTS[attempt])
            return []
        except Exception as e:
            last = str(e).strip().splitlines()[0][:70] if str(e).strip() else repr(e)[:70]
    return [f"{route}: {mode} on marker {marker} reveals no popover after 3 attempts ({last})"]


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
    facts, static_fails = marker_facts(page, route)
    # the number, the anchor and the popover's contents are the same document in
    # both viewports — report them once so a defect is not counted twice
    if mode == "hover":
        fails += static_fails
    limit = min(n, MAX_CHECKED) if MAX_CHECKED else n
    for i in range(limit):
        m = facts[i]["marker"] if i < len(facts) else None
        if not m:
            continue  # already reported by the static pass
        fails += check_reveal(page, sups.nth(i), route, i, mode, m)
        if len(fails) > 40:
            fails.append(f"{route}: stopping after 40 problems ({limit - i - 1} marker(s) unchecked)")
            break
    print(f"    {route} [{mode}]: {limit} of {n} marker(s) checked")
    return fails


def audit_routes(routes):
    """One browser, both viewports, the routes given. Returns (printed, fails)."""
    out, fails = [], []
    probe = BASE.rstrip("/") + routes[0]
    with sync_playwright() as pw:
        browser, engine, note = launch_reachable(pw, probe, headless=True)
        out.append(f"  engine: {engine}{(' — ' + note) if note else ''}")
        # hover on a desktop viewport, then tap on a touch viewport: the
        # standard says hoverable AND tappable, and the touch path is a
        # different code path (a delegated click handler, not CSS :hover)
        for mode, ctx_args in (("hover", {"viewport": {"width": 1280, "height": 900}}),
                               ("tap", {"viewport": {"width": 390, "height": 844},
                                        "has_touch": True, "is_mobile": True})):
            ctx = browser.new_context(**ctx_args)
            page = ctx.new_page()
            for route in routes:
                f = audit(page, route, mode)
                out.append(f"  {route} [{mode}]: {'OK' if not f else str(len(f)) + ' problem(s)'}")
                fails += f
            ctx.close()
        browser.close()
    return "\n".join(out), fails


def _worker(routes):
    """Child process: its own Playwright, its own browser, its own slice."""
    try:
        return audit_routes(routes)
    except Exception as e:  # a crashed worker must fail the gate, not vanish
        return "", [f"{routes[0]}…: the citation gate crashed — {str(e).splitlines()[0][:160]}"]


def main():
    if not ROUTES:
        print("no routes given"); return 1
    n = max(1, min(WORKERS, len(ROUTES)))
    if n == 1:
        printed, all_fails = audit_routes(ROUTES)
        print(printed)
    else:
        # stripe the routes so one very long brief does not decide the wall clock
        chunks = [ROUTES[i::n] for i in range(n)]
        print(f"  {len(ROUTES)} route(s) across {n} browsers")
        all_fails = []
        with cf.ProcessPoolExecutor(max_workers=n) as ex:
            for printed, fails in ex.map(_worker, chunks):
                if printed:
                    print(printed)
                all_fails += fails
    for f in all_fails:
        print("  ✗ " + f)
    if all_fails:
        print(f"\n🛑 CITATION GATE FAILED — {len(all_fails)} problem(s)")
        return 1
    print("citations: numbered, hoverable, resolving, each with a summary and a link")
    return 0


if __name__ == "__main__":
    sys.exit(main())
