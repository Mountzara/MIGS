#!/usr/bin/env python3
# =====================================================================
# bump_asset_versions.py — keep ?v= cache keys honest (2026-08-12)
# =====================================================================
# /assets/css/* and /assets/js/* are served immutable for a year, keyed
# by a ?v=<hash> query in the referencing HTML. On 2026-08-11 the hashes
# were written ONCE by hand and never maintained: home.css then changed
# (Ken Burns easing fix) but ?v= did not, so every repeat visitor —
# including the owner — kept running the OLD cached CSS while the server
# had the fix. From the owner's side that is indistinguishable from
# "the fix did nothing", and he reported exactly that.
#
# This script rewrites every /assets/(css|js)/<file>?v=<hash> reference
# in every deployable HTML file to the first 10 hex chars of the current
# file's sha256. Idempotent. deploy-prod.sh runs it before the gates on
# EVERY deploy, so a changed asset always gets a changed URL and an
# unchanged asset keeps its cache. --check exits 2 instead of rewriting
# (used as a gate to catch references to assets that don't exist).
import hashlib
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP_DIRS = {".git", ".github", ".wrangler", "node_modules", "docs", "scripts", "schema"}
REF = re.compile(r'(/assets/(?:css|js)/[A-Za-z0-9._-]+)\?v=([A-Za-z0-9]+)')

check_only = "--check" in sys.argv
hashes = {}


def sha10(rel):
    if rel not in hashes:
        p = os.path.join(REPO, rel.lstrip("/"))
        if not os.path.isfile(p):
            hashes[rel] = None
        else:
            with open(p, "rb") as f:
                hashes[rel] = hashlib.sha256(f.read()).hexdigest()[:10]
    return hashes[rel]


changed, stale, missing = 0, [], []
for root, dirs, fs in os.walk(REPO):
    dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
    for fn in fs:
        if not fn.endswith(".html"):
            continue
        path = os.path.join(root, fn)
        with open(path, encoding="utf-8") as f:
            body = f.read()

        def sub(m):
            rel, old = m.group(1), m.group(2)
            new = sha10(rel)
            if new is None:
                missing.append(f"{os.path.relpath(path, REPO)}: {rel} (file does not exist)")
                return m.group(0)
            if new != old:
                stale.append(f"{os.path.relpath(path, REPO)}: {rel} ?v={old} -> {new}")
            return f"{rel}?v={new}"

        out = REF.sub(sub, body)
        if out != body and not check_only:
            with open(path, "w", encoding="utf-8") as f:
                f.write(out)
            changed += 1

for line in stale:
    print(("  STALE " if check_only else "  bumped ") + line)
for line in missing:
    print("  ✗ MISSING ASSET " + line)

if missing:
    print("asset-version: FAIL — HTML references a versioned asset that does not exist")
    sys.exit(2)
if check_only and stale:
    print(f"asset-version: {len(stale)} stale ?v= reference(s) — run scripts/bump_asset_versions.py")
    sys.exit(2)
print(f"asset-version: OK — {len(stale)} bumped, {changed} file(s) rewritten" if not check_only
      else "asset-version: OK — all ?v= references match content hashes")
