#!/usr/bin/env python3
"""Every citation popover, on every surface, carries what it is required to.

The requirement (owner, standing): a reader hovering an inline citation gets
the paper's title, its PMID, and the curated plain-language summary of what
the paper shows — on the education guides, the evidence briefs, the trending
posts, and inside every modal those surfaces open. The education pages
shipped 826 popovers with none of that structure and nobody noticed for
months, because no gate looked.

Two classes, treated differently:

  BLOCKING — a popover missing its STRUCTURE (no title element), or missing
  its finding while the curated text EXISTS on the same surface (the page's
  .ref-what, the post's cite-card lens). That is plumbing broken between two
  things we already have, and it must never ship again.

  ADVISORY — a citation whose curated summary does not exist anywhere on the
  surface. Writing "what a paper shows" is clinical content; a gate must
  surface that gap to the clinician, not fail the build until someone types
  something to silence it.

Surfaces are DERIVED, never listed (SYSTEM_MAP §8.0.0): education pages from
the tree, posts from the API — failing LOUD if the posts cannot be fetched.
"""
import re, sys, os, glob, json, subprocess

def strip(t): return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", t or "")).strip()

POP_RE = re.compile(r'<span class="mz-ref-pop"[^>]*>[\s\S]*?</span>(?=</sup>)')
SUP_RE = re.compile(r'<sup class="mz-ref"[^>]*>[\s\S]*?</sup>')

def audit_surface(name, html_, curated):
    """curated: dict key -> bool(curated lens text exists). Key is ref id or pmid."""
    blocking, advisory = [], []
    for sm in SUP_RE.finditer(html_):
        sup = sm.group(0)
        pm = re.search(r'data-r="(ref-\d+)"|pubmed\.ncbi\.nlm\.nih\.gov/(\d{5,9})|id="ref-pop-(\d{5,9})"', sup)
        key = next((g for g in (pm.groups() if pm else ()) if g), None)
        pop = POP_RE.search(sup)
        if not pop:
            blocking.append((key, "no popover at all")); continue
        p = pop.group(0)
        if "mz-ref-pop-title" not in p:
            blocking.append((key, "unstructured popover (no title element)")); continue
        has_finding = bool(re.search(r'mz-ref-pop-finding[^>]*>\s*\S[\s\S]{18,}?<', p))
        if has_finding: continue
        if key and curated.get(key):
            blocking.append((key, "finding missing though curated text exists on this surface"))
        else:
            advisory.append(key or "?")
    return blocking, advisory

def education_curated(html_):
    out = {}
    for m in re.finditer(r'<li id="(ref-\d+)">([\s\S]*?)</li>', html_):
        w = strip((re.search(r'<div class="ref-what">([\s\S]*?)</div>', m.group(2)) or [None, ""])[1])
        out[m.group(1)] = len(w) >= 30
    return out

def post_curated(body):
    # the pipeline's own sourcing rules decide whether a card's lens is usable
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import importlib.util
    spec = importlib.util.spec_from_file_location("air", os.path.join(os.path.dirname(os.path.abspath(__file__)), "apply_inline_refs.py"))
    air = importlib.util.module_from_spec(spec); spec.loader.exec_module(air)
    return {pmid: bool(v.get("finding")) for pmid, v in air.card_index(body).items()}

def fetch(path):
    out = subprocess.run(["curl", "-sS", "--fail-with-body",
                          "-H", "User-Agent: mz-operator-tools/1.0 (ref-popover-gate)",
                          "https://mountzara.com" + path], capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError(out.stderr.strip()[:120])
    return json.loads(out.stdout)

def main():
    total_block, total_adv, surfaces = 0, 0, 0
    for f in sorted(glob.glob("education/*/index.html") + glob.glob("portal/education/*/index.html")):
        if "_template" in f: continue
        h = open(f, encoding="utf-8").read()
        b, a = audit_surface(f, h, education_curated(h))
        surfaces += 1; total_block += len(b); total_adv += len(a)
        for key, why in b: print(f"  ✗ {f} {key}: {why}")
    try:
        ids = []
        for kind in ("evidence", "blog"):
            for p in (fetch(f"/api/posts?kind={kind}&status=published").get("posts") or []):
                if p["id"] not in ids: ids.append(p["id"])
        for pid in ids:
            doc = fetch(f"/api/posts/{pid}")
            post = doc.get("post") or doc
            body = post.get("body_html") or post.get("body") or ""
            b, a = audit_surface(pid, body, post_curated(body))
            surfaces += 1; total_block += len(b); total_adv += len(a)
            for key, why in b: print(f"  ✗ post {pid} {key}: {why}")
    except Exception as e:
        print(f"\n🛑 REF-POPOVER GATE FAILED — published posts could not be scanned: {e}")
        print("   A scan that covered zero posts would report clean; that is not a pass.")
        return 1
    print(f"ref-popover gate: {surfaces} surface(s); "
          f"{total_adv} citation(s) awaiting a curated summary (advisory, for the clinician)")
    if total_block:
        print(f"\n🛑 REF-POPOVER GATE FAILED — {total_block} popover(s) broken while their curated text exists.")
        return 1
    print("ref-popover gate: CLEAN — every popover structured; every curated summary surfaced")
    return 0

sys.exit(main())
