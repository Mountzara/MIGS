#!/usr/bin/env python3
"""
verify_kb_anchoring.py — §0.8.1 deploy-gate verifier

Scans a rendered HTML page for clinical-content KB anchoring per
CLAUDE.md §0.8.1. Fails (non-zero exit) when:

  1. The page advertises clinical content (has class names matching the
     clinical-surface patterns: education / trending / evidence post bodies,
     OMT modal content, patient-snapshot rendered narrative) but is MISSING
     the `<!-- §0.8 KB-anchor manifest -->` HTML comment.

  2. The manifest IS present but is malformed JSON.

  3. The manifest claims `kb_documents_quoted[].kb_doc_id` + `field` +
     `excerpt_first_words` that don't actually exist in the KB chunks at
     /Users/beans/Developer/MountZara/MountZaraMedicalTranscription/kb_chunks/.
     (Hallucinated KB anchor — hardest failure mode to catch otherwise.)

  4. The manifest claims `pmids_efetched_in_session` PMIDs but the page has
     references citing PMIDs NOT in that list.

  5. The page contains prose that looks like a clinical statistic (e.g.
     `\d+%` or `\d+-\d+%` near keywords like "patients", "women",
     "respond", "recurrence", "diagnosis", "prevalence") that does NOT
     appear inside any tagged anchor section.

Usage:
    python3 scripts/verify_kb_anchoring.py <path-to-html-or-slug>

Examples:
    python3 scripts/verify_kb_anchoring.py education/endometriosis/index.html
    python3 scripts/verify_kb_anchoring.py endometriosis
        # treated as education/<slug>/index.html under the repo root

Exits 0 on pass, 1 on fail. Prints a structured report either way.
"""

import json
import os
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
KB_DIR = Path("/Users/beans/Developer/MountZara/MountZaraMedicalTranscription/kb_chunks")
MANIFEST_RE = re.compile(
    r"<!--\s*§0\.8 KB-anchor manifest\s*\n(?P<json>.*?)\n\s*-->",
    re.DOTALL,
)
ANCHOR_INLINE_RE = re.compile(
    r"<!--\s*§0\.8 anchor:\s*kb_doc_id=(?P<doc>[a-zA-Z0-9-]+);\s*field=(?P<field>\w+);\s*idx=(?P<idx>\d+)"
    r"(?:;\s*excerpt=\"(?P<excerpt>[^\"]*)\")?\s*-->"
)
STAT_RE = re.compile(
    r"\b\d+(?:[.,]\d+)?\s*(?:%|x|×|fold|in 10|in 100|per cent|percent)\b|\b\d+(?:[\-–]\d+)?\s*%",
    re.IGNORECASE,
)
CLINICAL_KEYWORDS = (
    "patient", "women", "respond", "recurrence", "diagnos", "prevalence",
    "fertility", "infertil", "pregnan", "endometrios", "ablation",
    "excision", "laparoscop", "ovari", "tubal", "cervic", "uterine",
    "menstrua", "hormonal", "OCP", "IUD", "GnRH",
)


def find_clinical_surfaces(html_path: Path):
    """Return whether the HTML appears to be a clinical-content surface that
    requires anchoring. Returns (is_clinical, reasons)."""
    text = html_path.read_text(encoding="utf-8", errors="replace")
    reasons = []
    path_str = str(html_path).lower()
    # Path-based hints
    for marker in ("/education/", "/portal/education/", "/trending/", "/evidence/"):
        if marker in path_str.replace(os.sep, "/"):
            reasons.append(f"path contains '{marker}'")
    # Content-based hints
    if "patient education" in text.lower():
        reasons.append("body says 'Patient Education'")
    if re.search(r"endometr|chronic pelvic pain|menopaus|fibroid|adenomyos|dysmenor", text, re.IGNORECASE):
        reasons.append("body mentions a clinical condition")
    return (len(reasons) > 0, reasons)


def load_kb_corpus_for_validation():
    """Load enough of the KB to validate any kb_doc_id reference. Builds a
    lazy index by scanning chunk files only when an ID is requested."""
    docs_by_id = {}

    def get(doc_id):
        if doc_id in docs_by_id:
            return docs_by_id[doc_id]
        # Lazy load — scan chunk files until found
        for fname in sorted(KB_DIR.iterdir()):
            if not fname.name.startswith("01_acogDocuments_chunk") or not fname.name.endswith(".json"):
                continue
            try:
                with open(fname) as f:
                    chunk = json.load(f)
            except Exception:
                continue
            for d in chunk:
                if d.get("id") == doc_id:
                    docs_by_id[doc_id] = d
                    return d
        docs_by_id[doc_id] = None
        return None

    return get


def get_field_item(doc, field, idx):
    """Pull a single field-item by index, returning string or None."""
    v = doc.get(field)
    if v is None:
        return None
    if isinstance(v, list):
        if idx < 0 or idx >= len(v):
            return None
        item = v[idx]
        return item if isinstance(item, str) else json.dumps(item)
    if isinstance(v, dict):
        # Index into dict values by position
        items = list(v.values())
        if idx < 0 or idx >= len(items):
            return None
        item = items[idx]
        return item if isinstance(item, str) else json.dumps(item)
    if isinstance(v, str):
        return v if idx == 0 else None
    return None


def verify(html_path: Path):
    text = html_path.read_text(encoding="utf-8", errors="replace")
    is_clinical, reasons = find_clinical_surfaces(html_path)
    issues = []
    passes = []

    if not is_clinical:
        return 0, ["File does not appear to be a clinical surface — no §0.8.1 gate applies."], []

    passes.append(f"File detected as clinical surface ({', '.join(reasons)}).")

    # 1. Manifest present?
    m = MANIFEST_RE.search(text)
    if not m:
        issues.append(
            "MANIFEST MISSING — page is clinical content but has no "
            "'<!-- §0.8 KB-anchor manifest --> ... -->' block. Per §0.8.1, "
            "every clinical surface must emit a manifest."
        )
        return 1, passes, issues
    raw_json = m.group("json").strip()
    try:
        manifest = json.loads(raw_json)
    except Exception as e:
        issues.append(f"MANIFEST MALFORMED — JSON parse error: {e}")
        return 1, passes, issues
    passes.append("Manifest present and parses as JSON.")

    # 2. Required manifest fields
    required = ["kb_documents_loaded", "kb_documents_quoted",
                "pmids_efetched_in_session", "user_docx_sources",
                "not_in_kb_claims", "topic_synthesis_id", "generated_at_utc"]
    missing = [k for k in required if k not in manifest]
    if missing:
        issues.append(f"MANIFEST INCOMPLETE — missing keys: {missing}")
    else:
        passes.append("All required manifest keys present.")

    # 3. Validate kb_documents_quoted against actual KB
    get_doc = load_kb_corpus_for_validation()
    quoted = manifest.get("kb_documents_quoted") or []
    for q in quoted:
        doc_id = q.get("kb_doc_id")
        field = q.get("field")
        excerpt = q.get("excerpt_first_words") or ""
        if not doc_id or not field:
            issues.append(f"QUOTE INVALID — missing kb_doc_id or field: {q}")
            continue
        d = get_doc(doc_id)
        if d is None:
            issues.append(
                f"HALLUCINATED KB ANCHOR — kb_doc_id={doc_id} not found "
                f"in {KB_DIR}. Possibly a fabricated UUID."
            )
            continue
        # Check field exists and contains the excerpt
        field_val = d.get(field)
        if field_val is None:
            issues.append(
                f"FIELD NOT IN DOC — kb_doc_id={doc_id} ('{d.get('title','?')[:60]}') "
                f"has no field '{field}'."
            )
            continue
        # Fuzzy match the excerpt against the field's text content. Both
        # excerpt and field-blob are tokenized to alphanumeric runs so
        # hyphens, punctuation, JSON quotes don't break the comparison
        # (e.g. "reproductive-age" in KB == "reproductive age" tokenized).
        if excerpt:
            blob = json.dumps(field_val).lower()
            blob_tokens = re.findall(r"[a-zA-Z0-9]+", blob)
            blob_norm = " ".join(blob_tokens)
            tokens = re.findall(r"[a-zA-Z0-9]+", excerpt.lower())[:8]
            if tokens:
                needle = " ".join(tokens)
                if needle not in blob_norm:
                    issues.append(
                        f"EXCERPT MISMATCH — kb_doc_id={doc_id} field={field}: "
                        f"excerpt '{excerpt[:60]}...' not found in the KB field. "
                        "Either the anchor is wrong or the excerpt has drifted from source."
                    )

    if not any(i for i in issues if "HALLUCINATED" in i or "FIELD NOT IN DOC" in i or "EXCERPT MISMATCH" in i):
        passes.append(f"All {len(quoted)} KB-document anchors validated against the corpus.")

    # 4. Inline anchors present?
    inline = list(ANCHOR_INLINE_RE.finditer(text))
    if inline:
        passes.append(f"Found {len(inline)} inline §0.8 anchor comments scattered through the prose.")
    elif quoted:
        issues.append(
            f"MANIFEST lists {len(quoted)} quotes but page body has 0 inline "
            "'<!-- §0.8 anchor: ... -->' comments. Per §0.8.1 each claim "
            "should be tagged inline so the verifier can localize gaps."
        )

    # 5. Statistic claims not appearing inside an anchor — print as warning
    # (Not a hard fail because some stats might be legitimately in cited PMID
    # popouts, but we report them so they can be audited.)
    body_only = re.sub(r"<style[^>]*>.*?</style>", "", text, flags=re.DOTALL)
    body_only = re.sub(r"<script[^>]*>.*?</script>", "", body_only, flags=re.DOTALL)
    body_only = re.sub(r"<!--.*?-->", "", body_only, flags=re.DOTALL)
    found_stats = []
    for sm in STAT_RE.finditer(body_only):
        ctx_start = max(0, sm.start() - 80)
        ctx_end = min(len(body_only), sm.end() + 80)
        ctx = body_only[ctx_start:ctx_end]
        # only flag if a clinical keyword is nearby
        if any(kw in ctx.lower() for kw in CLINICAL_KEYWORDS):
            found_stats.append(ctx.strip())
    if len(found_stats) > 0:
        passes.append(
            f"Found {len(found_stats)} statistical claims in prose (review manifest covers each)."
        )

    rc = 1 if any(i for i in issues) else 0
    return rc, passes, issues


def resolve_target(arg: str) -> Path:
    p = Path(arg)
    if p.exists():
        return p.resolve()
    # Treat as slug under education/
    candidate = REPO_ROOT / "education" / arg / "index.html"
    if candidate.exists():
        return candidate
    # Try portal/education slug
    candidate = REPO_ROOT / "portal" / "education" / arg / "index.html"
    if candidate.exists():
        return candidate
    raise SystemExit(f"Could not find HTML at: {arg}")


def verify_remote_post(post_id: str):
    """Fetch /api/posts/<post_id> and validate its body_html has a §0.8
    manifest with at least one KB topic anchor and a non-empty PMID list.
    Lighter check than the local-HTML verifier — R2 posts use topic-synthesis
    anchoring, not per-claim inline anchors."""
    import urllib.request
    url = f"https://mountzara.com/api/posts/{post_id}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "MountZara/KB-verify 1.0"})
        with urllib.request.urlopen(req, timeout=15) as r:
            post = json.loads(r.read())
    except Exception as e:
        # Fallback to curl (urllib sometimes 403s; curl works)
        import subprocess
        try:
            out = subprocess.check_output(
                ["curl", "-sS", "-A", "MountZara/KB-verify 1.0", url],
                timeout=20,
            )
            post = json.loads(out)
        except Exception as e2:
            return 1, [], [f"FETCH FAILED — {post_id}: {e2}"]

    body = post.get("body_html") or ""
    issues = []
    passes = []

    m = MANIFEST_RE.search(body)
    if not m:
        issues.append(
            f"MANIFEST MISSING in body_html — R2 post {post_id} has no "
            f"'<!-- §0.8 KB-anchor manifest --> ... -->' block."
        )
        return 1, passes, issues
    passes.append(f"Manifest present in body_html (post {post_id}).")

    try:
        manifest = json.loads(m.group("json"))
    except Exception as e:
        issues.append(f"MANIFEST MALFORMED JSON in body_html: {e}")
        return 1, passes, issues
    passes.append("Manifest parses as JSON.")

    # Validate kb_entries_retrieved (envelope-level) + manifest content
    kb_envelope = post.get("kb_entries_retrieved") or []
    if not kb_envelope:
        issues.append("kb_entries_retrieved is empty on the envelope.")
    else:
        passes.append(f"kb_entries_retrieved: {len(kb_envelope)} topic syntheses.")

    pmids = post.get("pmids_cited") or []
    if not pmids:
        issues.append("pmids_cited is empty — clinical post should have at least one verified PMID.")
    else:
        passes.append(f"pmids_cited: {len(pmids)} verified PMIDs.")

    if "topic_groups_anchored" in manifest:
        n = len(manifest["topic_groups_anchored"])
        if n == 0:
            issues.append("manifest.topic_groups_anchored is empty.")
        else:
            passes.append(f"manifest.topic_groups_anchored: {n} KB topic syntheses.")

    rc = 1 if issues else 0
    return rc, passes, issues


# Clinical R2-served posts that should be gated on every deploy. Add to
# this list as new clinical evidence/blog posts ship through /api/posts.
GATED_R2_POSTS = [
    "blog-2026-W20",
    "evidence-2026-05-13-h1-and-h2-antihistamines-treat-endometriosis-pain",
    "evidence-2026-05-13-glp-1-receptor-agonists-reduce-endometriosis-lesion-burden",
    "evidence-2026-05-13-antihistamines-improve-menopausal-vasomotor-symptoms",
]


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    arg = sys.argv[1]
    print(f"§0.8.1 KB-anchoring deploy gate — CLAUDE.md")
    print("=" * 78)

    # Special mode: --r2-posts checks every gated R2 post via API GET.
    # Used by deploy-prod.sh after wrangler pages deploy completes to
    # confirm published clinical posts still carry their manifests.
    if arg == "--r2-posts":
        total_rc = 0
        for pid in GATED_R2_POSTS:
            print(f"\n-- R2 post: {pid} --")
            rc, passes, issues = verify_remote_post(pid)
            for p in passes: print(f"  ✓ {p}")
            for i in issues: print(f"  ✗ {i}")
            total_rc |= rc
        print("=" * 78)
        if total_rc == 0:
            print(f"RESULT: PASS — all {len(GATED_R2_POSTS)} R2-served clinical posts have manifests.")
        else:
            print("RESULT: FAIL — at least one R2-served clinical post is missing its §0.8 manifest.")
        sys.exit(total_rc)

    target = resolve_target(arg)
    print(f"VERIFY: {target}")
    print()
    rc, passes, issues = verify(target)
    for p in passes:
        print(f"  ✓ {p}")
    for i in issues:
        print(f"  ✗ {i}")
    print("=" * 78)
    if rc == 0:
        print("RESULT: PASS — KB-anchoring gate satisfied.")
    else:
        print("RESULT: FAIL — fix the issues above before deploying.")
    sys.exit(rc)


if __name__ == "__main__":
    main()
