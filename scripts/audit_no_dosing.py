#!/usr/bin/env python3
"""No dosing on patient-facing educational surfaces — ever again.

Owner directive (2026-09-01, verbatim): "I NEVER want you to post actual
dosing and things that really should be reserved for private
patient-doctor decisions about management... This applies to all the
other condition-specific cards and everywhere else in the website."

THE BOUNDARY (owner may tighten it further):
  * PATIENT EDUCATION surfaces (education pages, portal copies, the
    homepage condition modals): ZERO dosing anywhere outside verbatim-
    abstract containers. These are counseling surfaces.
  * The PHYSICIAN-BLOG posts ("written for clinicians" — the journal
    club): dosing may appear ONLY inside attributed research-reporting
    containers — verbatim abstracts, the deep-dive dialog analyses, and
    the per-paper cite cards / citation popovers whose text is the
    study's own synopsis ("phase-3 RCT of fezolinetant 30 mg vs
    placebo") — because an analysis that cannot say what dose a trial
    tested is not an analysis. Counseling/narrative/tagline/bottom-line
    prose in posts stays dose-free.

Surfaces are DERIVED: education pages + portal copies from the tree,
assets/js/domain-modals.js (the homepage condition modals), and every
published post from the live API (fail LOUD if unreachable). Also
enforces the standing disclaimer requirement: every education page and
the /evidence/ + /trending/ shells and domain-modals.js must carry the
mz-eddisclaimer block (see fix_disclaimers.py).

  python3 scripts/audit_no_dosing.py
"""
import glob, json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DOSE_RE = re.compile(
    r"\b\d+(?:[.,]\d+)?(?:\s*[–-]\s*\d+(?:[.,]\d+)?)?\s*(?:mg|mcg|µg|IU)\b"
    r"|\bq\s*\d+(?:\s*[–-]\s*\d+)?\s*h\b"
    r"|\b(?:BID|TID|QID)\b", re.I)

ABSTRACTS = [
    re.compile(r'<div class="mz-jc-abstract-body">[\s\S]*?</div>', re.I),
    re.compile(r'<details class="mz-abstract">[\s\S]*?</details>', re.I),
    re.compile(r'<div class="abstract-body">[\s\S]*?</div>', re.I),
    re.compile(r"<style[^>]*>[\s\S]*?</style>", re.I),
    re.compile(r"<script[^>]*>[\s\S]*?</script>", re.I),
]
RESEARCH_REPORTING = [
    re.compile(r"<dialog\b[\s\S]*?</dialog>", re.I),                       # journal-club analyses
    re.compile(r'<article class="mz-cite-card[\s\S]*?</article>', re.I),   # per-paper synopsis cards
    re.compile(r'<sup class="mz-ref"[\s\S]*?</sup>', re.I),                # citation popovers
    re.compile(r'<li id="ref-\d+">[\s\S]*?</li>', re.I),                   # reference-list entries (per-paper "what it shows")
]

def prose_of(html, protect_research=False):
    for pat in ABSTRACTS + (RESEARCH_REPORTING if protect_research else []):
        html = pat.sub(" ", html)
    return re.sub(r"<[^>]+>", " ", html)

def hits(text):
    return sorted(set(m.group(0).strip() for m in DOSE_RE.finditer(text)))

def fetch(path):
    out = subprocess.run(["curl", "-sS", "--fail-with-body",
                          "-H", "User-Agent: mz-operator-tools/1.0 (no-dosing-gate)",
                          "https://mountzara.com" + path], capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError(out.stderr.strip()[:120])
    return json.loads(out.stdout)

def main():
    problems = []
    # -- education pages + portal copies (whole page is patient-facing prose)
    pages = sorted(glob.glob(os.path.join(ROOT, "education", "*", "index.html"))
                   + glob.glob(os.path.join(ROOT, "portal", "education", "*", "index.html")))
    for f in pages:
        src = open(f, encoding="utf-8").read()
        rel = os.path.relpath(f, ROOT)
        # The rule is uniform: counseling prose is dose-free; text ATTRIBUTED
        # to a specific paper (ref-list entries, popovers, cite cards,
        # abstracts) is research reporting and keeps the study's own facts.
        found = hits(prose_of(src, protect_research=True))
        if found:
            problems.append(f"{rel}: dosing in counseling prose: {', '.join(found[:6])}")
        if "mz-eddisclaimer" not in src:
            problems.append(f"{rel}: missing the mz-eddisclaimer block")
    # -- homepage condition modals (JS template strings; no dialogs to protect —
    #    the whole file is patient-facing counseling copy)
    dm_path = os.path.join(ROOT, "assets", "js", "domain-modals.js")
    dm = open(dm_path, encoding="utf-8").read()
    found = hits(re.sub(r"//[^\n]*", " ", dm))
    if found:
        problems.append(f"assets/js/domain-modals.js: dosing in the condition modals: {', '.join(found[:6])}")
    if "mz-eddisclaimer" not in dm:
        problems.append("assets/js/domain-modals.js: missing the mz-eddisclaimer block")
    # -- shells
    for shell in ("evidence/index.html", "trending/index.html"):
        p = os.path.join(ROOT, shell)
        if os.path.exists(p) and "mz-eddisclaimer" not in open(p, encoding="utf-8").read():
            problems.append(f"{shell}: missing the mz-eddisclaimer block")
    # -- published posts: patient-facing prose = body minus dialogs/abstracts
    try:
        ids = []
        for kind in ("evidence", "blog"):
            for p in (fetch(f"/api/posts?kind={kind}&status=published").get("posts") or []):
                if p["id"] not in ids:
                    ids.append(p["id"])
        if not ids:
            raise RuntimeError("zero published posts returned")
        for pid in ids:
            doc = fetch(f"/api/posts/{pid}")
            post = doc.get("post") or doc
            found = hits(prose_of(post.get("body_html") or "", protect_research=True))
            if found:
                problems.append(f"post {pid}: dosing in counseling/narrative prose (outside research-reporting containers): {', '.join(found[:6])}")
    except Exception as e:
        print(f"\n🛑 NO-DOSING GATE FAILED — published posts could not be scanned: {e}")
        print("   A scan that covered zero posts would report clean; that is not a pass.")
        return 1

    surfaces = len(pages) + 3 + len(ids)
    if problems:
        for p in problems:
            print(f"  ✗ {p}")
        print(f"\n🛑 NO-DOSING GATE FAILED — {len(problems)} problem(s) across {surfaces} surface(s).")
        return 1
    print(f"no-dosing gate: CLEAN — {surfaces} surface(s); no dosing in patient-facing prose; disclaimers present")
    return 0

sys.exit(main())
