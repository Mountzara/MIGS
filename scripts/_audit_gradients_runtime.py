#!/usr/bin/env python3
"""Runtime audit — for every gradient-bearing selector found in the local
HTML source, query getComputedStyle on the live site and report:
  - whether the element exists
  - what its computed background-image / -webkit-text-fill-color / color
    actually resolves to at runtime
  - whether it matches the design intent (gradient or solid)"""
import json, time, sys
from pathlib import Path

OUTDIR = Path("/Users/beans/Documents/mz_regression_audit")
OUTDIR.mkdir(parents=True, exist_ok=True)
URL = "https://www.mountzara.com/"

# Selectors that SHOULD carry the purple gradient per design intent
GRADIENT_SELECTORS = [
    "h1.hero-title",
    ".hero-title",
    ".section-headline.gradient",
    ".section-headline",
    ".section-eyebrow",
    ".surgical-hub-eyebrow",
    ".app-modal-section-eyebrow",
    ".app-modal-section-title",
    ".identity-card-title",
    ".identity-card",
    ".hub-tile h3",
    ".hub-tile",
    ".dm-stat-num",
    ".stat-num",
    ".video-card-title",
    ".research-card-title",
    ".app-card-title",
    ".app-card",
    ".curriculum-card-title",
    ".curriculum-card",
    ".domain-card-title",
    ".domain-card",
    ".evidence-section-head",
    ".evidence-section-headline",
]

def main():
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        page.goto(f"{URL}?cb={int(time.time())}", wait_until="networkidle", timeout=60_000)
        time.sleep(3)

        report = {}
        for sel in GRADIENT_SELECTORS:
            data = page.evaluate("""(sel) => {
                const els = Array.from(document.querySelectorAll(sel));
                if (els.length === 0) return { found: false, count: 0 };
                const sample = els.slice(0, 2).map(el => {
                    const cs = getComputedStyle(el);
                    return {
                        background_image: cs.backgroundImage,
                        background_color: cs.backgroundColor,
                        webkit_text_fill_color: cs.webkitTextFillColor,
                        color: cs.color,
                        border_color: cs.borderTopColor,
                        backdrop_filter: cs.backdropFilter || cs.webkitBackdropFilter,
                        innerText_snippet: (el.innerText || '').slice(0, 50),
                    };
                });
                return { found: true, count: els.length, sample };
            }""", sel)
            report[sel] = data

        # Also probe :root for CSS custom properties
        roots = page.evaluate("""() => {
            const cs = getComputedStyle(document.documentElement);
            const out = {};
            for (const name of ['--accent','--accent-deep','--accent-soft','--glow-purple',
                                '--brand-purple','--brand-cyan','--text','--text-dim','--bg','--black']) {
                out[name] = cs.getPropertyValue(name).trim();
            }
            return out;
        }""")
        report["__root_custom_props__"] = roots

        (OUTDIR / "gradients_runtime.json").write_text(json.dumps(report, indent=2))

        # Print one-line summary
        print("\n===== GRADIENT RUNTIME AUDIT =====")
        for sel, data in report.items():
            if sel.startswith("__"):
                print(f"  :root custom props: {data}")
                continue
            if not data.get("found"):
                print(f"  [NOT FOUND]  {sel}")
            else:
                s0 = data["sample"][0]
                bgimg = s0["background_image"]
                fill = s0["webkit_text_fill_color"]
                col = s0["color"]
                purple_in = ("139, 92, 246" in bgimg or "167, 139, 250" in bgimg or
                             "6d28d9" in bgimg.lower() or "a78bfa" in bgimg.lower() or
                             "8b5cf6" in bgimg.lower())
                gradient_active = "linear-gradient" in bgimg and "transparent" in fill
                status = "GRAD-OK" if (gradient_active and purple_in) else (
                         "GRAD-NO-PURPLE" if gradient_active else
                         "SOLID-COLOR")
                print(f"  [{status:14s}]  {sel:40s}  bgimg={bgimg[:60]}  fill={fill[:30]}  color={col[:25]}")

        ctx.close()
        browser.close()

if __name__ == "__main__":
    main()
