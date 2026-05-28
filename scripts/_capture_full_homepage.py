#!/usr/bin/env python3
"""Emergency full-page capture of live mountzara.com homepage to verify
the user's §3.10 purple-regression report. Captures both desktop (1440x900)
and iPhone Pro Max (430x932) viewports, full-page, plus a runtime CSS
audit that checks getComputedStyle on hero / section headers / cards
to confirm whether purple tokens are actually rendering."""
import json, time
from pathlib import Path

OUTDIR = Path("/Users/beans/Documents/mz_regression_audit")
OUTDIR.mkdir(parents=True, exist_ok=True)
URL = "https://www.mountzara.com/"

def run(p, kind, viewport, device_kwargs, label):
    print(f"\n===== {label} =====")
    browser = p.chromium.launch(headless=True) if kind == "desktop" else p.webkit.launch(headless=True)
    ctx = browser.new_context(viewport=viewport, **device_kwargs)
    page = ctx.new_page()
    page.goto(f"{URL}?cb={int(time.time())}", wait_until="networkidle", timeout=60_000)
    time.sleep(3)  # allow CSS animations to settle

    # Capture full-page screenshot
    page.screenshot(path=str(OUTDIR / f"{label}_fullpage.png"), full_page=True)
    print(f"  full-page screenshot -> {label}_fullpage.png")

    # Runtime CSS audit — getComputedStyle for key §3.10 surfaces
    audit = page.evaluate("""() => {
        const probe = (sel, props) => {
            const el = document.querySelector(sel);
            if (!el) return { selector: sel, found: false };
            const cs = getComputedStyle(el);
            const out = { selector: sel, found: true };
            props.forEach(p => out[p] = cs.getPropertyValue(p));
            return out;
        };
        const all = (sel, props, max=3) => {
            const els = Array.from(document.querySelectorAll(sel)).slice(0, max);
            return els.map((el, i) => {
                const cs = getComputedStyle(el);
                const out = { selector: sel, idx: i };
                props.forEach(p => out[p] = cs.getPropertyValue(p));
                return out;
            });
        };
        return {
            // Hero region
            hero_h1: probe('h1', ['color', 'background-image']),
            // Section headers — gradients should be visible
            section_titles: all('.section-title', ['color', 'background-image', 'background-clip', '-webkit-background-clip', '-webkit-text-fill-color']),
            // Hub tile borders — should be purple-glass
            hub_tiles: all('.hub-tile', ['border-color', 'background-color', 'backdrop-filter', '-webkit-backdrop-filter']),
            // Domain cards
            domain_cards: all('.domain-card', ['border-color', 'background-color', 'backdrop-filter']),
            // Apps section cards
            app_cards: all('.app-card', ['border-color', 'background-color', 'backdrop-filter']),
            // Identity Map carousel cards
            identity_cards: all('.identity-card', ['border-color', 'background-color', 'backdrop-filter']),
            // CSS custom property values from :root
            root_purple: getComputedStyle(document.documentElement).getPropertyValue('--accent') || 'unset',
            root_glow:   getComputedStyle(document.documentElement).getPropertyValue('--glow-purple') || 'unset',
        };
    }""")

    audit_path = OUTDIR / f"{label}_audit.json"
    audit_path.write_text(json.dumps(audit, indent=2, default=str))
    print(f"  audit -> {label}_audit.json")
    print(json.dumps(audit, indent=2, default=str)[:1500])

    ctx.close()
    browser.close()

def main():
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        run(p, "desktop",
            {"width": 1440, "height": 900},
            {},
            "desktop")
        run(p, "iphone",
            {"width": 430, "height": 932},
            {"device_scale_factor": 3, "is_mobile": True, "has_touch": True,
             "user_agent": ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) "
                            "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1")},
            "iphone")

if __name__ == "__main__":
    main()
