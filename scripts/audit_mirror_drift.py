#!/usr/bin/env python3
"""audit_mirror_drift.py — flag drift between public + portal mirror pages.

Per MIGS/SYSTEM_MAP.md §14 known-gap: education/<slug>/index.html and
portal/education/<slug>/index.html are byte-similar copies. No automation
enforces the similarity. This script catches the drift before deploy.

What it checks:
* For each of the 12 education slugs:
  - both files exist
  - both carry §0.8.1 KB-anchor manifest
  - both carry §3.12 AI disclaimer
  - both carry §3.10 purple tokens
  - the CLINICAL CONTENT (everything between <main>...</main> excluding
    a small allow-list of expected divergences like nav and portal-only
    "back to dashboard" affordances) is byte-identical

Exit code:
  0 = no drift; safe to deploy
  1 = drift found; investigate

Wire into deploy-prod.sh as a soft gate (warn but don't block) so
operator sees the drift but can decide whether to ship.

Usage:
    python3 scripts/audit_mirror_drift.py             # audit all 12 topics
    python3 scripts/audit_mirror_drift.py endometriosis  # one topic
"""
from __future__ import annotations

import sys
import re
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
PUBLIC_DIR = REPO_ROOT / "education"
PORTAL_DIR = REPO_ROOT / "portal" / "education"

# 12 §0.8.1-anchored education topics — keep in sync with the actual
# directory listing. If you add a topic, add it here.
TOPICS = [
    "abnormal-uterine-bleeding",
    "adenomyosis",
    "chronic-pelvic-pain",
    "contraception",
    "dysmenorrhea",
    "endometriosis",
    "fibroids",
    "menopause",
    "ovarian-masses",
    "pcos",
    "postoperative-recovery",
    "pregnancy-loss",
]

# Expected per-surface differences that MUST exist between the two files
# (these are legitimate portal-vs-public variations, not drift):
#   * portal pages may include a "back to portal" / member-nav element
#   * portal pages may include the floating feedback button injection markers
#   * portal pages may include the wizard chip markers
# Strip these from both files before comparing the rest.
ALLOWLIST_PATTERNS = [
    # portal-only "back to dashboard" affordance (if present)
    re.compile(r"<a[^>]*class=\"[^\"]*portal-back[^\"]*\"[^>]*>.*?</a>", re.S | re.I),
    # member-portal nav row (whole element)
    re.compile(r"<nav[^>]*class=\"[^\"]*portal-nav[^\"]*\"[^>]*>.*?</nav>", re.S | re.I),
    # any element marked data-mirror-allow-divergence="true"
    re.compile(r"<[^>]+data-mirror-allow-divergence=\"true\"[^>]*>.*?</[^>]+>", re.S),
]


def strip_allowlisted(html: str) -> str:
    for pat in ALLOWLIST_PATTERNS:
        html = pat.sub("", html)
    return html


def extract_main(html: str) -> str | None:
    """Pull out the <main>...</main> region; if no <main>, fall back to
    <body>...</body>. Returns None if neither is present."""
    m = re.search(r"<main[^>]*>(.*?)</main>", html, re.S | re.I)
    if m:
        return m.group(1)
    m = re.search(r"<body[^>]*>(.*?)</body>", html, re.S | re.I)
    if m:
        return m.group(1)
    return None


def check_topic(slug: str) -> dict[str, Any]:
    """Audit one topic. Returns a result dict with status + findings."""
    result: dict[str, Any] = {
        "topic": slug,
        "public_path": str(PUBLIC_DIR / slug / "index.html"),
        "portal_path": str(PORTAL_DIR / slug / "index.html"),
        "checks": [],
        "drift": False,
    }

    pub_file = PUBLIC_DIR / slug / "index.html"
    por_file = PORTAL_DIR / slug / "index.html"

    if not pub_file.exists():
        result["checks"].append({"name": "public file exists", "pass": False,
                                  "detail": str(pub_file)})
        result["drift"] = True
        return result
    if not por_file.exists():
        result["checks"].append({"name": "portal file exists", "pass": False,
                                  "detail": str(por_file)})
        result["drift"] = True
        return result

    pub = pub_file.read_text(errors="replace")
    por = por_file.read_text(errors="replace")

    # §0.8.1 KB-anchor manifest present in BOTH
    for label, html in (("public", pub), ("portal", por)):
        has_manifest = "§0.8 KB-anchor manifest" in html or "kb_documents_loaded" in html
        result["checks"].append({
            "name": f"{label} carries §0.8.1 manifest",
            "pass": has_manifest,
            "detail": "found" if has_manifest else "MISSING",
        })
        if not has_manifest:
            result["drift"] = True

    # §3.12 disclosure present in BOTH.
    # 2026-08-11 — the aside was renamed mz-ai-disclaimer -> mz-page-note when
    # the owner had the AI-provenance sentence removed ("remove those AI
    # indicators"). Accept either class so the gate keeps enforcing that the
    # disclosure EXISTS on both mirrors, which is what §3.12 is actually for;
    # matching only the old name would have passed a page that quietly lost it.
    for label, html in (("public", pub), ("portal", por)):
        has_disc = "mz-page-note" in html or "mz-ai-disclaimer" in html
        result["checks"].append({
            "name": f"{label} carries §3.12 disclaimer",
            "pass": has_disc,
            "detail": "found" if has_disc else "MISSING",
        })
        if not has_disc:
            result["drift"] = True

    # §3.10 purple token present in BOTH (#6d28d9 or --glow-purple)
    for label, html in (("public", pub), ("portal", por)):
        purple = "#6d28d9" in html or "--glow-purple" in html or "rgba(167, 139, 250" in html
        result["checks"].append({
            "name": f"{label} carries §3.10 purple tokens",
            "pass": purple,
            "detail": "found" if purple else "MISSING",
        })
        if not purple:
            result["drift"] = True

    # Clinical-content drift: compare <main> region after stripping allowlist
    pub_main = extract_main(pub)
    por_main = extract_main(por)
    if pub_main is None or por_main is None:
        result["checks"].append({
            "name": "main region extractable",
            "pass": False,
            "detail": f"public_main={bool(pub_main)} portal_main={bool(por_main)}",
        })
        result["drift"] = True
    else:
        pub_clean = strip_allowlisted(pub_main).strip()
        por_clean = strip_allowlisted(por_main).strip()
        identical = pub_clean == por_clean
        if identical:
            result["checks"].append({
                "name": "clinical content byte-identical",
                "pass": True,
                "detail": f"{len(pub_clean):,} chars match",
            })
        else:
            # Surface first divergence point (approximate) for the operator
            diff_at = next((i for i in range(min(len(pub_clean), len(por_clean)))
                            if pub_clean[i] != por_clean[i]), min(len(pub_clean), len(por_clean)))
            sample_pub = pub_clean[max(0, diff_at - 30):diff_at + 60]
            sample_por = por_clean[max(0, diff_at - 30):diff_at + 60]
            result["checks"].append({
                "name": "clinical content byte-identical",
                "pass": False,
                "detail": (
                    f"DRIFT — public={len(pub_clean):,}c portal={len(por_clean):,}c · "
                    f"first divergence at char {diff_at} · "
                    f"public='{sample_pub!r}' portal='{sample_por!r}'"
                ),
            })
            result["drift"] = True

    return result


def main() -> int:
    topics = sys.argv[1:] if len(sys.argv) > 1 else TOPICS
    print(f"=== MIRROR DRIFT AUDIT — {len(topics)} topic(s) ===\n")
    any_drift = False
    for slug in topics:
        if slug not in TOPICS:
            print(f"⚠️  Unknown topic '{slug}' — skipping")
            continue
        r = check_topic(slug)
        flag = "❌ DRIFT" if r["drift"] else "✅ OK   "
        print(f"{flag}  {slug}")
        for c in r["checks"]:
            mark = "✓" if c["pass"] else "✗"
            print(f"          [{mark}] {c['name']}: {c['detail']}")
        if r["drift"]:
            any_drift = True
        print()

    print("=" * 60)
    if any_drift:
        print("RESULT: DRIFT FOUND — review and reconcile before deploy")
        return 1
    print("RESULT: no drift across all topics")
    return 0


if __name__ == "__main__":
    sys.exit(main())
