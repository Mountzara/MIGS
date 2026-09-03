#!/usr/bin/env python3
"""No internal machinery on public surfaces.

Two classes of leak reached production and had to be stripped by hand on
2026-09-02, after the owner found them on the live site:

  1. AI-provenance disclosure. An <aside class="mz-ai-disclaimer"> saying the
     page "was prepared with AI assistance" shipped on all 24 education and
     portal pages and inside all 15 posts. The owner had already had this
     removed once (2026-08-11) and it regressed when pages were regenerated
     from their build scripts. It is not to come back. The medical-advice
     disclaimer (mz-eddisclaimer) is a SEPARATE block and is required — see
     audit_no_dosing.py.

  2. Build-time internals. KB-anchor manifests carrying the owner's local
     filesystem paths (/Users/beans/...), private .docx source filenames,
     internal document UUIDs and spec references (CLAUDE.md, section marks)
     were embedded in public HTML as <script type="application/json"> blocks
     and comments, plus 556 inline anchor comments.

This gate fails the deploy if either class reappears in a deployable route.
Run: python3 scripts/audit_no_internal_leakage.py
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Directories that never deploy.
SKIP_DIRS = {".git", "node_modules", "docs", "cite_audit", "scripts", ".wrangler"}

BANNED = [
    ("mz-ai-disclaimer",        re.compile(r"mz-ai-disclaimer")),
    ("AI-provenance wording",   re.compile(r"prepared with AI assistance", re.I)),
    ("local filesystem path",   re.compile(r"/Users/[A-Za-z0-9._-]+/")),
    ("macOS app bundle path",   re.compile(r"\.app/Contents/MacOS")),
    ("internal CLI invocation", re.compile(r"--start-[a-z-]*run\b")),
    ("KB-anchor manifest",      re.compile(r"kb-anchor-manifest|KB-anchor manifest")),
    ("KB manifest field",       re.compile(r"kb_chunks_path|kb_documents_loaded|user_docx_sources|topic_synthesis_id")),
    ("internal spec reference", re.compile(r"CLAUDE\.md|§0\.8")),
]


def deployable_html():
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
        for fn in filenames:
            if fn.endswith((".html", ".js")):
                yield os.path.join(dirpath, fn)


# Server code under functions/ is never shown to a visitor, so ordinary
# engineering comments referencing an internal spec are fine there. What is
# never acceptable anywhere is a leak that can be RENDERED to a visitor.
SERVER_EXEMPT = {"internal spec reference"}


def main():
    problems = []
    scanned = 0
    for path in deployable_html():
        rel = os.path.relpath(path, ROOT)
        try:
            src = open(path, encoding="utf-8").read()
        except (UnicodeDecodeError, OSError):
            continue
        scanned += 1
        server_side = rel.startswith("functions" + os.sep)
        for label, pat in BANNED:
            if server_side and label in SERVER_EXEMPT:
                continue
            hits = pat.findall(src)
            if hits:
                problems.append(f"{rel}: {label} ({len(hits)} occurrence(s))")
    if problems:
        print("\n\U0001f6d1 INTERNAL-LEAKAGE GATE FAILED — build internals or an "
              "AI-provenance notice reached a public route:")
        for p in problems[:40]:
            print(f"  ✗ {p}")
        if len(problems) > 40:
            print(f"  … and {len(problems) - 40} more")
        return 1
    print(f"no-internal-leakage gate: CLEAN — {scanned} deployable file(s); "
          "no AI-provenance notice, no local paths, no build manifests")
    return 0


if __name__ == "__main__":
    sys.exit(main())
