#!/usr/bin/env python3
"""audit_runtime_css.py — Playwright-driven runtime CSS audit.

Per MIGS/SYSTEM_MAP.md §1.1 reference incident: the §3.10 audit grep-
counts token byte-presence ("16 hits for blur(28px) saturate(180%)") but
cannot detect CSS that is BYTES-present-but-RUNTIME-absent. The
2026-05-26 corruption at index.html line 5703 silently scoped the
SITE-WIDE Apple-glass treatment + the Identity Map navigator + focus
rings + skip-link CSS inside `@media (prefers-reduced-motion: reduce)`,
breaking every named card class for an unknown number of prior deploys
— and the grep-only audit was blind to it.

This script closes that gap. It loads each surface via headless
Chromium (Playwright), then calls `getComputedStyle()` on key elements
and asserts the runtime values match the design intent. Any rule that's
bytes-present but runtime-absent fails this audit.

Surfaces audited (defaults to all):
  - Homepage (https://mountzara.com/) — Identity Map cards, glass on
    named card classes, hero opacity, active scroll-spy pip color
  - 12 education pages — purple tokens applied, AI disclaimer visible,
    no blue runtime colors on body text

Exit code 0 = all pass; 1 = any FAIL.

Usage:
    python3 scripts/audit_runtime_css.py                 # audit all surfaces
    python3 scripts/audit_runtime_css.py homepage         # one surface
    python3 scripts/audit_runtime_css.py education-endometriosis
    python3 scripts/audit_runtime_css.py --json /tmp/out  # JSON report
"""
from __future__ import annotations

import sys
import json
import time
import argparse
from pathlib import Path
from typing import Any

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sys.stderr.write(
        "ERROR: playwright not installed. Run:\n"
        "  /usr/bin/python3 -m pip install --user playwright\n"
        "  /usr/bin/python3 -m playwright install chromium\n"
    )
    sys.exit(2)

BASE = "https://mountzara.com"

EDUCATION_TOPICS = [
    "abnormal-uterine-bleeding", "adenomyosis", "chronic-pelvic-pain",
    "contraception", "dysmenorrhea", "endometriosis", "fibroids",
    "menopause", "ovarian-masses", "pcos", "postoperative-recovery",
    "pregnancy-loss",
]

# Blue tokens forbidden per §3.10. Match against rgb() / rgba() forms
# the browser returns from getComputedStyle.
BLUE_TOKEN_RGB = [
    "rgb(0, 102, 204)",      # #0066cc
    "rgb(10, 132, 255)",     # #0a84ff
    "rgb(59, 130, 246)",     # #3b82f6
    "rgb(37, 99, 235)",      # #2563eb
]


def make_check(name: str, ok: bool, detail: str = "") -> dict[str, Any]:
    return {"name": name, "pass": bool(ok), "detail": detail}


def audit_homepage(page) -> list[dict[str, Any]]:
    """Run runtime-CSS assertions on the homepage in iPhone Pro Max view."""
    page.goto(f"{BASE}/?cb={int(time.time())}",
              wait_until="domcontentloaded", timeout=30000)
    page.wait_for_timeout(4500)

    results: list[dict[str, Any]] = []

    # Identity Map: every card must have Apple-glass applied at runtime
    cards = page.evaluate("""() => {
        const out = [];
        document.querySelectorAll('.identity-card').forEach(c => {
            const cs = getComputedStyle(c);
            out.push({
                id: c.getAttribute('data-identity'),
                backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter,
                borderRadius: cs.borderRadius,
                minHeight: cs.minHeight,
                borderColor: cs.borderColor,
                display: cs.display,
            });
        });
        return out;
    }""")
    if not cards:
        results.append(make_check(
            "Identity Map: cards present", False, "0 .identity-card elements"
        ))
    else:
        # Every card MUST have backdrop-filter that contains 'blur('
        # — this is the runtime check that would have caught the §1.1
        # corruption.
        for c in cards:
            bf = c.get("backdropFilter") or ""
            ok = "blur(" in bf and "saturate" in bf
            results.append(make_check(
                f"Identity Map .identity-card[data-identity={c['id']}] "
                f"backdrop-filter active",
                ok,
                f"got: {bf!r}"
            ))
            # Border radius must be ≥ 20px (design intent: 22px)
            try:
                radius_px = float(c["borderRadius"].split()[0].rstrip("px"))
            except (ValueError, AttributeError):
                radius_px = 0
            results.append(make_check(
                f"Identity Map .identity-card[{c['id']}] border-radius ≥ 20px",
                radius_px >= 20,
                f"got: {c['borderRadius']}"
            ))
            # Min-height must be ≥ 250px (design intent: 280px)
            try:
                mh = float((c["minHeight"] or "0px").rstrip("px"))
            except ValueError:
                mh = 0
            results.append(make_check(
                f"Identity Map .identity-card[{c['id']}] min-height ≥ 250px",
                mh >= 250,
                f"got: {c['minHeight']}"
            ))

    # SITE-WIDE-APPLE-GLASS — every named card class that exists in
    # the DOM must have non-none backdrop-filter
    site_glass = page.evaluate("""() => {
        const targets = ['.surgical-card', '.app-card-v2', '.research-card',
                         '.evidence-card', '.bento-card', '.domain-card',
                         '.zero-card', '.curriculum-card', '.award-tile',
                         '.population-card'];
        const out = [];
        for (const sel of targets) {
            const els = document.querySelectorAll(sel);
            if (!els.length) {
                out.push({selector: sel, count: 0, backdropFilter: 'n/a'});
                continue;
            }
            // Sample the first element of each kind
            const cs = getComputedStyle(els[0]);
            out.push({
                selector: sel,
                count: els.length,
                backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter,
                background: cs.backgroundColor,
            });
        }
        return out;
    }""")
    for g in site_glass:
        if g["count"] == 0:
            continue  # selector not used on this page, OK
        bf = g.get("backdropFilter") or ""
        ok = "blur(" in bf
        results.append(make_check(
            f"site-wide-glass {g['selector']} runtime backdrop-filter active",
            ok,
            f"got: {bf!r} ({g['count']} elements)"
        ))

    # Hero must NOT be hidden
    hero = page.evaluate("""() => {
        const h = document.querySelector('.hero');
        if (!h) return null;
        const cs = getComputedStyle(h);
        return {display: cs.display, visibility: cs.visibility, opacity: cs.opacity};
    }""")
    if hero:
        ok = hero["display"] != "none" and hero["visibility"] != "hidden"
        results.append(make_check(
            "Hero element not hidden",
            ok,
            f"display={hero['display']} visibility={hero['visibility']} opacity={hero['opacity']}"
        ))

    # Identity Map: active pip must have purple background
    pip = page.evaluate("""() => {
        const p = document.querySelector('.identity-pip.active');
        if (!p) return null;
        return {background: getComputedStyle(p).backgroundColor};
    }""")
    if pip:
        bg = pip["background"]
        # Purple tokens — accept #6d28d9, #8b5cf6, or any rgba(167, 139, 250, ...)
        purple = (
            "139, 92, 246" in bg or "109, 40, 217" in bg
            or "167, 139, 250" in bg
        )
        results.append(make_check(
            "Identity Map active pip has purple background",
            purple,
            f"got: {bg}"
        ))

    # No blue tokens in computed colors on key elements
    bodybg = page.evaluate("""() => {
        const body = document.body;
        return getComputedStyle(body).backgroundColor;
    }""")
    blue_in_body = any(b in bodybg for b in BLUE_TOKEN_RGB)
    results.append(make_check(
        "No forbidden blue token in body background",
        not blue_in_body,
        f"got: {bodybg}"
    ))

    # Carousel grids (per Commit 3): each must be display=grid + overflow-x=auto on mobile
    carousels = page.evaluate("""() => {
        const out = [];
        document.querySelectorAll('[data-mobile-carousel]').forEach(g => {
            const cs = getComputedStyle(g);
            out.push({
                name: g.getAttribute('data-mobile-carousel'),
                display: cs.display,
                gridAutoFlow: cs.gridAutoFlow,
                overflowX: cs.overflowX,
                scrollSnapType: cs.scrollSnapType,
            });
        });
        return out;
    }""")
    for c in carousels:
        ok = (c["display"] == "grid"
              and c["gridAutoFlow"] == "column"
              and c["overflowX"] == "auto"
              and c["scrollSnapType"].startswith("x"))
        results.append(make_check(
            f"Carousel [data-mobile-carousel={c['name']}] runtime layout",
            ok,
            f"display={c['display']} flow={c['gridAutoFlow']} "
            f"overflow-x={c['overflowX']} snap={c['scrollSnapType']}"
        ))

    return results


def audit_education_page(page, slug: str) -> list[dict[str, Any]]:
    """Run runtime-CSS assertions on one education page."""
    page.goto(f"{BASE}/education/{slug}/?cb={int(time.time())}",
              wait_until="domcontentloaded", timeout=30000)
    page.wait_for_timeout(3000)

    results: list[dict[str, Any]] = []

    # AI disclaimer must be visible
    disc = page.evaluate("""() => {
        const d = document.querySelector('.mz-ai-disclaimer');
        if (!d) return null;
        const cs = getComputedStyle(d);
        return {display: cs.display, visibility: cs.visibility, opacity: cs.opacity};
    }""")
    if disc is None:
        results.append(make_check(
            "§3.12 AI disclaimer element present", False,
            "no .mz-ai-disclaimer found"
        ))
    else:
        ok = disc["display"] != "none" and disc["visibility"] != "hidden"
        results.append(make_check(
            "§3.12 AI disclaimer visible",
            ok,
            f"display={disc['display']} visibility={disc['visibility']} opacity={disc['opacity']}"
        ))

    # Body background should NOT be a forbidden blue
    bg = page.evaluate("getComputedStyle(document.body).backgroundColor")
    blue = any(b in bg for b in BLUE_TOKEN_RGB)
    results.append(make_check(
        "No forbidden blue token in body background",
        not blue,
        f"got: {bg}"
    ))

    # If purple accent token exists in CSS-vars on :root, runtime should
    # have non-empty --glow-purple value
    glow = page.evaluate("""() => {
        return getComputedStyle(document.documentElement)
               .getPropertyValue('--glow-purple').trim();
    }""")
    results.append(make_check(
        "§3.10 --glow-purple CSS variable defined at runtime",
        bool(glow),
        f"got: '{glow}'"
    ))

    return results


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("surface", nargs="?", default="all",
                    help="'all' | 'homepage' | 'education-<slug>'")
    p.add_argument("--json", metavar="PATH",
                    help="Write structured JSON report to this path")
    p.add_argument("--desktop", action="store_true",
                    help="Use desktop viewport instead of iPhone Pro Max")
    args = p.parse_args()

    surfaces_to_run: list[tuple[str, Any]] = []
    if args.surface in ("all", "homepage"):
        surfaces_to_run.append(("homepage", None))
    if args.surface == "all":
        for slug in EDUCATION_TOPICS:
            surfaces_to_run.append(("education", slug))
    elif args.surface.startswith("education-"):
        slug = args.surface[len("education-"):]
        if slug not in EDUCATION_TOPICS:
            print(f"unknown education slug: {slug}", file=sys.stderr)
            return 2
        surfaces_to_run.append(("education", slug))

    if not surfaces_to_run:
        print(f"unknown surface: {args.surface}", file=sys.stderr)
        return 2

    print(f"=== RUNTIME CSS AUDIT — {len(surfaces_to_run)} surface(s) ===\n")

    report: dict[str, Any] = {"surfaces": []}
    any_fail = False

    with sync_playwright() as p_ctx:
        if args.desktop:
            browser = p_ctx.chromium.launch(headless=True)
            ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        else:
            iphone = p_ctx.devices["iPhone 14 Pro Max"]
            browser = p_ctx.webkit.launch(headless=True)
            ctx = browser.new_context(**iphone, bypass_csp=True)
        page = ctx.new_page()

        for kind, arg in surfaces_to_run:
            if kind == "homepage":
                label = f"{BASE}/"
                checks = audit_homepage(page)
            else:
                label = f"{BASE}/education/{arg}/"
                checks = audit_education_page(page, arg)

            fails = [c for c in checks if not c["pass"]]
            mark = "❌ FAIL" if fails else "✅ PASS"
            print(f"{mark}  {label}")
            for c in checks:
                tick = "✓" if c["pass"] else "✗"
                print(f"          [{tick}] {c['name']}: {c['detail']}")
            print()

            report["surfaces"].append({
                "url": label, "checks": checks,
                "fail_count": len(fails),
            })
            if fails:
                any_fail = True

        ctx.close()
        browser.close()

    if args.json:
        Path(args.json).write_text(json.dumps(report, indent=2))
        print(f"JSON report written to {args.json}")

    print("=" * 60)
    if any_fail:
        total_fails = sum(s["fail_count"] for s in report["surfaces"])
        print(f"RESULT: {total_fails} FAIL(s) across "
              f"{len(report['surfaces'])} surface(s) — fix before deploy")
        return 1
    print(f"RESULT: all {len(report['surfaces'])} surface(s) pass runtime-CSS audit")
    return 0


if __name__ == "__main__":
    sys.exit(main())
