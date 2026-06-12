# -*- coding: utf-8 -*-
"""DEPLOY GATE — hard structural-integrity check on every PUBLISHED post.

This is the gate that SHOULD have blocked the W21 regressions (placeholder
modal titles, cross-contaminated header metadata, "n = —" headers, truncated /
empty / wrong-paper inline-reference popovers, and "Foundational reference"
placeholder entries in the per-paper reference lists). audit_live_post.py
covers the §1.2/§3.7-3.12 prose rules but NOT these structural defects, and the
accuracy/inline-ref auditors were never wired into deploy — so this class shipped.

It reuses the existing auditor logic (no duplicate rules to drift):
  • header integrity     ← audit_accuracy.audit_post   (header-* flags only)
  • inline-ref popovers  ← audit_inline_refs.audit_post (all flags are structural)
  • placeholder refs     ← local check for unfilled reference-list entries

Only UNAMBIGUOUS structural defects fail the deploy. Advisory judgment calls
(number-not-in-abstract derived sums, mechanism hedging, bottom-line phrasing)
are intentionally NOT gated here — a gate that cries wolf gets ignored, which is
how the real defects slipped through.

Usage:
  python3 scripts/audit_deploy_gate.py            # gate every published post
  python3 scripts/audit_deploy_gate.py --post f.json   # gate one local file
Exit 0 = clean, 2 = at least one hard structural defect (blocks deploy).
"""
from __future__ import annotations
import argparse, json, re, sys, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE / "_authoring"))

import audit_accuracy
import audit_inline_refs

API_LIST = "https://mountzara.com/api/posts/?status=published"
API_POST = "https://mountzara.com/api/posts/{}"

# a reference-list <li> still carrying the unfilled pipeline stub
PLACEHOLDER_REF = re.compile(
    r'<li id="dd-\d+-ref-\d+">\s*—\.\s*<em>\s*Foundational reference\s*</em>', re.I)
# any modal title or popover title left as a stub literal
STUB_LITERALS = ("foundational reference", "pubmed record")


def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "mz-deploy-gate"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def hard_flags(post: dict):
    """Return list of (pmid, kind, detail) for HARD structural defects only."""
    flags = []
    # 1) modal header integrity — keep only the structural header-* kinds
    try:
        acc = audit_accuracy.audit_post(post)
        acc = acc[0] if isinstance(acc, tuple) else acc
        for pmid, kind, detail in acc:
            if kind.startswith("header-"):
                flags.append((pmid, kind, detail))
    except Exception as e:  # never let the gate crash silently
        flags.append(("-", "accuracy-auditor-error", str(e)[:120]))
    # 2) inline-reference popovers — every flag here is a structural defect
    try:
        inl = audit_inline_refs.audit_post(post)
        inl = inl[0] if isinstance(inl, tuple) else inl
        for pmid, kind, detail in inl:
            flags.append((pmid, f"inline-ref:{kind}", detail))
    except Exception as e:
        flags.append(("-", "inline-ref-auditor-error", str(e)[:120]))
    # 3) placeholder reference-list entries + stray stub literals in titles
    h = post.get("body_html", "")
    n_ph = len(PLACEHOLDER_REF.findall(h))
    if n_ph:
        flags.append(("-", "placeholder-reference-entry",
                      f"{n_ph} reference-list entr{'y' if n_ph==1 else 'ies'} still 'Foundational reference'"))
    for lit in STUB_LITERALS:
        # a stub literal sitting inside a modal/popover TITLE span is a defect
        if re.search(r'class="(?:mz-jc-modal-title|mz-ref-pop-title|mz-ref-title)"[^>]*>\s*'
                     + re.escape(lit) + r'\s*<', h, re.I):
            flags.append(("-", "stub-literal-in-title", f"'{lit}' used as a title"))
    return flags


def gate_post(post: dict) -> int:
    pid = post.get("id", "?")
    if not post.get("body_html"):
        print(f"  ⏭  {pid}: no body_html (skipped)")
        return 0
    flags = hard_flags(post)
    if not flags:
        print(f"  ✓  {pid}: clean (headers, inline refs, reference lists)")
        return 0
    print(f"  🛑 {pid}: {len(flags)} HARD structural defect(s)")
    for pmid, kind, detail in flags[:40]:
        print(f"       ⚠ {pmid}  {kind}: {detail}")
    if len(flags) > 40:
        print(f"       … and {len(flags)-40} more")
    return len(flags)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--post")
    a = ap.parse_args()
    total = 0
    if a.post:
        total += gate_post(json.loads(Path(a.post).read_text()))
    else:
        try:
            data = fetch_json(API_LIST)
        except Exception as e:
            print(f"🛑 deploy-gate: cannot list published posts: {e}", file=sys.stderr)
            return 2
        posts = data if isinstance(data, list) else data.get("posts", data.get("results", []))
        ids = [p.get("id") for p in posts if isinstance(p, dict) and p.get("id")]
        print(f"deploy-gate: auditing {len(ids)} published post(s) for structural integrity")
        for pid in ids:
            try:
                post = fetch_json(API_POST.format(pid))
                post = post.get("post", post) if isinstance(post, dict) else post
            except Exception as e:
                print(f"  🛑 {pid}: fetch failed: {e}")
                total += 1
                continue
            total += gate_post(post)
    print("=" * 60)
    print("deploy-gate: CLEAN — no structural defects" if total == 0
          else f"deploy-gate: {total} HARD structural defect(s) — BLOCK DEPLOY")
    return 2 if total else 0


if __name__ == "__main__":
    sys.exit(main())
