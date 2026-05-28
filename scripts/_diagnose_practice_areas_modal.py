#!/usr/bin/env python3
"""§0.2.1 Visual VERIFY + diagnostic for the Seven Clinical Practice Areas
hub-tile modal. User report 2026-05-27: clicking the 7 tiles on the
homepage does nothing — no panel/modal opens.

This script:
  1. Loads https://www.mountzara.com/ in a desktop Chromium + iPhone Pro Max
     WebKit context.
  2. Scrolls to #surgical-hub.
  3. Captures the console log for the entire page load (to surface JS
     errors that may halt initSurgicalHub from running).
  4. Clicks the first hub-tile ("Endometriosis & DIE", data-category=
     "endometriosis").
  5. Waits 1 s.
  6. Captures DOM diagnostics: panel.hidden after click, panelInner
     innerHTML length, tile aria-selected, presence of .hub-content-source
     article with that data-category.
  7. Screenshots both contexts: before-click + after-click.

All output goes to /Users/beans/Documents/ per §13 of MIGS/SYSTEM_MAP.md
(NEVER ~/Desktop)."""

from pathlib import Path
import json, time, sys

OUTDIR = Path("/Users/beans/Documents/mz_diag_practice_areas")
OUTDIR.mkdir(parents=True, exist_ok=True)
print(f"Output dir: {OUTDIR}")

URL = "https://www.mountzara.com/"

# Cache-buster query string so we get the absolute latest deploy
CACHE_BUSTED = f"{URL}?cb={int(time.time())}"


def run_context(p, ctx_kwargs, label):
    print(f"\n===== {label} =====")
    browser = p.chromium.launch(headless=True) if ctx_kwargs.get("_kind") == "desktop" else None
    if browser is None:
        # iPhone Pro Max via WebKit
        browser = p.webkit.launch(headless=True)
    kwargs = {k: v for k, v in ctx_kwargs.items() if not k.startswith("_")}
    ctx = browser.new_context(**kwargs)
    page = ctx.new_page()

    console_msgs = []
    page_errors = []
    page.on("console", lambda msg: console_msgs.append(f"[{msg.type}] {msg.text}"))
    page.on("pageerror", lambda exc: page_errors.append(repr(exc)))

    print(f"  navigating to {CACHE_BUSTED}")
    page.goto(CACHE_BUSTED, wait_until="networkidle", timeout=60_000)
    time.sleep(2)

    # Scroll to #surgical-hub
    try:
        page.evaluate("document.getElementById('surgical-hub').scrollIntoView({block:'start'})")
    except Exception as e:
        print(f"  scrollIntoView failed: {e}")
    time.sleep(1.5)

    # Pre-click DOM diagnostics
    pre = page.evaluate("""() => {
        const hub = document.getElementById('surgical-hub');
        const tiles = hub ? Array.from(hub.querySelectorAll('.hub-tile[data-category]')) : [];
        const panel = hub ? hub.querySelector('.surgical-hub-panel') : null;
        const panelInner = panel ? panel.querySelector('.hub-panel-inner') : null;
        const source = document.querySelector('.hub-content-source');
        const sourceArticles = source ? Array.from(source.querySelectorAll('article[data-category]')).map(a => a.dataset.category) : [];
        return {
            hub_present: !!hub,
            tiles_count: tiles.length,
            tiles_categories: tiles.map(t => t.dataset.category),
            panel_present: !!panel,
            panel_hidden: panel ? panel.hidden : null,
            panelInner_present: !!panelInner,
            source_present: !!source,
            source_articles: sourceArticles,
            source_hidden: source ? source.hidden : null,
        };
    }""")
    print("  PRE-CLICK DOM:")
    print(json.dumps(pre, indent=4))

    # Screenshot pre-click
    page.screenshot(path=str(OUTDIR / f"{label}_01_preclick.png"), full_page=False)

    # Click the first hub-tile (Endometriosis)
    print("  clicking [data-category='endometriosis'] hub-tile...")
    try:
        page.click("button.hub-tile[data-category='endometriosis']", timeout=5000)
    except Exception as e:
        print(f"  CLICK FAILED: {e}")
    time.sleep(1.2)

    # Post-click DOM diagnostics
    post = page.evaluate("""() => {
        const hub = document.getElementById('surgical-hub');
        const tiles = hub ? Array.from(hub.querySelectorAll('.hub-tile[data-category]')) : [];
        const panel = hub ? hub.querySelector('.surgical-hub-panel') : null;
        const panelInner = panel ? panel.querySelector('.hub-panel-inner') : null;
        return {
            panel_hidden: panel ? panel.hidden : null,
            panelInner_html_length: panelInner ? panelInner.innerHTML.length : null,
            panelInner_first_200: panelInner ? panelInner.innerHTML.slice(0, 200) : null,
            active_tile: tiles.find(t => t.classList.contains('active'))?.dataset.category || null,
            tile_aria_selected: tiles.find(t => t.dataset.category === 'endometriosis')?.getAttribute('aria-selected') || null,
        };
    }""")
    print("  POST-CLICK DOM:")
    print(json.dumps(post, indent=4))

    page.screenshot(path=str(OUTDIR / f"{label}_02_postclick.png"), full_page=False)

    # Console + page-error report
    err_path = OUTDIR / f"{label}_03_console.txt"
    err_path.write_text(
        f"== console messages ==\n" + "\n".join(console_msgs) +
        f"\n\n== page errors ==\n" + "\n".join(page_errors)
    )
    print(f"  console: {len(console_msgs)} msgs, {len(page_errors)} errors -> {err_path}")
    if page_errors:
        print("  PAGE ERRORS:")
        for e in page_errors:
            print(f"    {e}")
    js_errors = [m for m in console_msgs if m.startswith("[error]")]
    if js_errors:
        print("  CONSOLE ERRORS:")
        for m in js_errors:
            print(f"    {m}")

    ctx.close()
    browser.close()
    return {"pre": pre, "post": post, "errors": page_errors, "console_errors": js_errors}


def main():
    from playwright.sync_api import sync_playwright
    results = {}
    with sync_playwright() as p:
        # Desktop Chromium
        desktop = {"_kind": "desktop",
                   "viewport": {"width": 1440, "height": 900}}
        results["desktop"] = run_context(p, desktop, "desktop")

        # iPhone Pro Max via WebKit
        iphone = {"_kind": "iphone",
                  "viewport": {"width": 430, "height": 932},
                  "device_scale_factor": 3,
                  "is_mobile": True,
                  "has_touch": True,
                  "user_agent": ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) "
                                 "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1")}
        results["iphone"] = run_context(p, iphone, "iphone")

    (OUTDIR / "00_results.json").write_text(json.dumps(results, indent=2, default=str))
    print(f"\nFinal diagnostic written to {OUTDIR}/00_results.json")
    print(f"Screenshots in {OUTDIR}/")


if __name__ == "__main__":
    main()
