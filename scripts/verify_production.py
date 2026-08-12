#!/usr/bin/env python3
"""
verify_production.py — canary: is mountzara.com serving the CURRENT build?

2026-08-12. Production was silently overwritten by a second working copy
deploying an out-of-date tree (see the STALE-TREE GATE in deploy-prod.sh).
The live homepage reverted to a pre-CSS-split 649KB monolith missing ~684
commits. Nothing alerted; it surfaced days later as "why is the mobile
version the old website" — mobile had simply fetched fresh while desktop
browsers were still serving the good version from cache.

This checks production against markers that ONLY the current build has, and
against markers that ONLY a reverted build has. It is deliberately about
published FACTS and architecture, not cosmetics, so it cannot false-alarm on
a routine content edit.

  exit 0  production is current
  exit 2  production has REGRESSED — a stale tree overwrote it
  exit 1  could not determine (network/tooling)

Usage:
  scripts/verify_production.py                 # check https://mountzara.com
  scripts/verify_production.py --host https://www.mountzara.com
  scripts/verify_production.py --json
"""
import argparse
import json
import subprocess
import sys
import time

# (label, needle, must_be_present)
CHECKS = [
    # Owner-corrected facts. Their ABSENCE means an old tree is live.
    ("same-day discharge is the canonical 90.4%", "90.4", True),
    ("Preclinical Fellowship line present", "Preclinical Fellowship", True),
    # Their PRESENCE means an old tree is live.
    ("stale '>95%' same-day claim", "&gt;95%", False),
    ("stale present-tense fellowship", "completing his", False),
    ("removed PRACTICE / hospital block", 'meta-label">Practice<', False),
    # Architecture: the homepage has loaded external CSS/JS since 2026-08-08.
    # A monolith means a pre-split tree is live.
    ("external home.css (post-split architecture)", "/assets/css/home.css", True),
]

# A reverted monolith is ~650KB; the current split build is ~150KB.
MAX_BYTES = 400_000


def fetch(url):
    r = subprocess.run(["curl", "-s", "--max-time", "45", url], capture_output=True)
    return r.stdout.decode("utf-8", "replace")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="https://mountzara.com")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    url = f"{a.host.rstrip('/')}/?cb={int(time.time())}"
    body = fetch(url)
    if not body:
        print(f"verify-production: could not fetch {url}")
        return 1

    failures = []
    for label, needle, want in CHECKS:
        present = needle in body
        if present != want:
            failures.append(
                f"{label}: expected {'present' if want else 'ABSENT'}, "
                f"found {'present' if present else 'absent'}"
            )
    if len(body) > MAX_BYTES:
        failures.append(
            f"homepage is {len(body):,} bytes (> {MAX_BYTES:,}) — looks like the "
            f"pre-split monolith, i.e. a stale tree is live"
        )

    if a.json:
        print(json.dumps({"host": a.host, "bytes": len(body),
                          "ok": not failures, "failures": failures}, indent=1))
    else:
        print(f"verify-production: {a.host}  ({len(body):,} bytes)")
        for f in failures:
            print(f"  ✗ {f}")
        if not failures:
            print("  ✅ production is serving the current build")

    if failures:
        print("")
        print("🛑 PRODUCTION HAS REGRESSED — a stale tree overwrote the live site.")
        print("   Restore from an up-to-date working copy:")
        print("     git pull --ff-only origin main && ./scripts/deploy-prod.sh 'restore'")
        print("   Every past deployment is retained at "
              "https://<short_id>.mountzara.pages.dev — nothing is lost.")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
