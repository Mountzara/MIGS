#!/usr/bin/env python3
# =====================================================================
# scripts/audit_route_render.py — hard gate for rendered page routes
# =====================================================================
# Converts the visual-VERIFY discipline into a machine check
# (SYSTEM_MAP.md §13.5). Two enforcement layers:
#
#   1. RENDER AUDIT — loads every route in scripts/route_render_manifest
#      .json on LIVE production in headless Chromium (admin Basic Auth
#      header so the preview gate + admin middleware pass) and asserts:
#        * the rendered <title> contains the route's title_contains;
#        * the title is NOT the marketing-homepage title (the
#          _redirects/Functions fallthrough class that left the R4
#          launch interstitial unreachable for 13 days);
#        * the route's `selector` (when set) appears in the DOM ≤15s
#          (catches JS that silently fails to build the page).
#
#   2. DISCOVERY CONTRACT — walks the repo for static SPA routes and
#      FAILS if any exists that is neither in `routes` nor consciously
#      listed in `unaudited`. A new page route physically cannot ship
#      without a diff to the manifest in the same commit.
#
# Wired into scripts/deploy-prod.sh as a post-deploy gate (skip with
# DEPLOY_SKIP_ROUTE_RENDER_AUDIT=1 — dangerous, document why).
#
# Usage:
#   /usr/bin/python3 scripts/audit_route_render.py [--base https://mountzara.com]
#
# Exit 0 = all pass. Exit 1 = any failure (deploy MUST block).
# =====================================================================

import argparse
import base64
import json
import os
import subprocess
import sys
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(REPO, "scripts", "route_render_manifest.json")
ADMIN_USER = "chris.mabini@gmail.com"  # §10.3.1 canonical — NEVER "admin"


def log(msg):
    print(f"{time.strftime('%H:%M:%S')} route-audit | {msg}", flush=True)


def admin_pass():
    p = os.environ.get("ADMIN_PASS") or os.environ.get("MZ_ADMIN_PASS")
    if p:
        return p
    try:
        out = subprocess.run(
            ["security", "find-generic-password", "-s", "mountzara-admin-password", "-w"],
            capture_output=True, text=True, timeout=10)
        if out.returncode == 0 and out.stdout.strip():
            return out.stdout.strip()
    except Exception as e:
        log(f"keychain lookup failed: {e}")
    return None


def discover_routes():
    """Static SPA routes derivable from the repo tree."""
    found = set()
    for top in ("portal", "admin"):
        base = os.path.join(REPO, top)
        if not os.path.isdir(base):
            continue
        for d in sorted(os.listdir(base)):
            if d.startswith(("_", ".")):
                continue
            if os.path.isfile(os.path.join(base, d, "index.html")):
                found.add(f"/{top}/{d}/")
    for top in ("about", "evidence", "trending", "cv", "curriculum"):
        if os.path.isfile(os.path.join(REPO, top, "index.html")):
            found.add(f"/{top}/")
    for parent in ("curriculum", "education", os.path.join("portal", "education")):
        base = os.path.join(REPO, parent)
        if not os.path.isdir(base):
            continue
        for d in sorted(os.listdir(base)):
            if d.startswith(("_", ".")):
                continue
            if os.path.isfile(os.path.join(base, d, "index.html")):
                found.add("/" + parent.replace(os.sep, "/") + f"/{d}/")
    return found


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="https://mountzara.com")
    args = ap.parse_args()

    with open(MANIFEST) as f:
        m = json.load(f)
    audited = {r["path"] for r in m["routes"]}
    unaudited = set(m["unaudited"])
    homepage_title = m["homepage_title"]

    failures = []

    # ---- Layer 2: discovery contract ----
    log("discovery: walking repo for static SPA routes…")
    discovered = discover_routes()
    orphans = sorted(discovered - audited - unaudited)
    if orphans:
        for o in orphans:
            failures.append(f"DISCOVERY: route {o} exists in the repo but has NO manifest entry "
                            f"(add real assertions to `routes`, or a conscious `unaudited` row, "
                            f"in the SAME commit as the new page)")
    log(f"discovery: {len(discovered)} routes found, {len(orphans)} orphan(s)")

    # ---- Layer 1: render audit ----
    pw = admin_pass()
    if not pw:
        log("FATAL: admin password unavailable (env ADMIN_PASS / Keychain)")
        print("ROUTE-RENDER AUDIT: FAIL (no admin credentials)")
        return 1
    auth = base64.b64encode(f"{ADMIN_USER}:{pw}".encode()).decode()

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        log("FATAL: playwright not importable for this interpreter")
        print("ROUTE-RENDER AUDIT: FAIL (playwright missing)")
        return 1

    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(
            viewport={"width": 1280, "height": 1200},
            extra_http_headers={"Authorization": f"Basic {auth}"})
        page = ctx.new_page()
        for r in m["routes"]:
            path = r["path"]
            url = args.base.rstrip("/") + path
            label = f"{path}"
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=30000)
                page.wait_for_timeout(700)
                title = page.title() or ""
                if r.get("title_contains") and r["title_contains"] not in title:
                    failures.append(f"RENDER {label}: title '{title}' missing '{r['title_contains']}'")
                    log(f"✗ {label} — bad title: {title!r}")
                    continue
                if title.strip() == homepage_title and not r.get("allow_homepage_title"):
                    failures.append(f"RENDER {label}: served the MARKETING HOMEPAGE (route fallthrough)")
                    log(f"✗ {label} — homepage fallthrough")
                    continue
                sel = r.get("selector")
                if sel:
                    try:
                        page.wait_for_selector(sel, timeout=15000, state="attached")
                    except Exception:
                        failures.append(f"RENDER {label}: selector '{sel}' never appeared (page JS broken?)")
                        log(f"✗ {label} — selector missing: {sel}")
                        continue
                log(f"✓ {label} — title ok{' · selector ok' if sel else ''}")
            except Exception as e:
                failures.append(f"RENDER {label}: load failed — {str(e)[:160]}")
                log(f"✗ {label} — load error: {str(e)[:160]}")
        browser.close()

    print()
    if failures:
        print(f"ROUTE-RENDER AUDIT: FAIL — {len(failures)} issue(s)")
        for f_ in failures:
            print(f"  ✗ {f_}")
        return 1
    print(f"ROUTE-RENDER AUDIT: PASS — {len(m['routes'])} routes rendered + "
          f"{len(discovered)} discovered routes all accounted for")
    return 0


if __name__ == "__main__":
    sys.exit(main())
