#!/usr/bin/env python3
"""Rename user-facing 'patient portal' → 'member portal' across the MIGS repo.

Per CLAUDE.md §0.6: this is an explicit one-off rename authorized by the user
("not all people who subscribe may be actual patients"). The script operates
file-by-file, prints every changed line so a human can verify, and excludes
the backup files (*.pre-voice-sweep.html, *.pre-cite-rebuild.html), all of
CLAUDE.md / docs / cite_audit (architecture references), and avoids changing
DB-schema 'patient_id' or role='patient' values.

Substitutions applied (case-preserving), in this order:
  'Patient Portal'  → 'Member Portal'   (Title Case)
  'patient portal'  → 'member portal'   (lowercase, prose)

NOT touched anywhere by design:
  - 'patient_id' / 'patient_email' / role='patient' (D1 schema)
  - 'patient' as a generic medical noun in clinical copy
  - patient_journey / patient-counseling / patientCounselingPoints (KB field names)
  - functions/_lib/auth.js role checks
  - CLAUDE.md (architecture doc, internal)
"""
import re
import sys
from pathlib import Path

REPO = Path("/Users/beans/Developer/MountZara/MIGS")

# Substitutions — literal string, case-sensitive, applied in order.
SUBS = [
    ("Patient Portal",  "Member Portal"),
    ("Patient portal",  "Member portal"),
    ("patient portal",  "member portal"),
    ("patient Portal",  "member Portal"),  # rare; cover it
]

# File globs to process — user-facing surfaces only.
GLOBS = [
    "index.html",
    "portal/**/*.html",
    "portal/**/*.js",
    "education/**/*.html",
    "admin/**/*.html",
    "admin/**/*.js",
    "functions/portal/**/*.js",
    "functions/admin/**/*.js",
    "functions/_lib/preview_gate.js",
    "cron-worker/**/*.js",
]

# Excludes — never touch these.
EXCLUDE_PATTERNS = [
    ".pre-voice-sweep.html",
    ".pre-cite-rebuild.html",
    ".pre-",
    "/cite_audit/",
    "/Backups/",
    "/node_modules/",
    "CLAUDE.md",
]

def is_excluded(p: Path) -> bool:
    s = str(p)
    return any(pat in s for pat in EXCLUDE_PATTERNS)

def apply_subs(text: str) -> tuple[str, int]:
    """Apply substitutions in order. Returns (new_text, num_changes)."""
    n = 0
    for old, new in SUBS:
        count = text.count(old)
        if count:
            text = text.replace(old, new)
            n += count
    return text, n

def main():
    files: list[Path] = []
    for g in GLOBS:
        files.extend(REPO.glob(g))
    files = [p for p in files if p.is_file() and not is_excluded(p)]
    # Sort for deterministic output
    files = sorted(set(files))

    grand_total = 0
    changed_files = 0
    for p in files:
        try:
            original = p.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue

        new_text, n = apply_subs(original)
        if n == 0:
            continue

        # Show every changed line so a human can verify
        old_lines = original.splitlines()
        new_lines = new_text.splitlines()
        rel = p.relative_to(REPO)
        print(f"\n[{n:>2} changes]  {rel}")
        for i, (a, b) in enumerate(zip(old_lines, new_lines), start=1):
            if a != b:
                print(f"  line {i}:")
                print(f"    -  {a.strip()[:140]}")
                print(f"    +  {b.strip()[:140]}")

        p.write_text(new_text, encoding="utf-8")
        grand_total += n
        changed_files += 1

    print(f"\n========================================")
    print(f"Total: {grand_total} substitutions across {changed_files} files.")
    print(f"========================================")
    return 0

if __name__ == "__main__":
    sys.exit(main())
