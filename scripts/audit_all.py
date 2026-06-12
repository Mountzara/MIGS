# -*- coding: utf-8 -*-
"""
audit_all.py — runs the THREE independent auditors as a composite safety net:
  1. audit_accuracy.py   — facts/numbers/design vs the live PubMed record
  2. audit_validation.py — claim-strength vs evidence-level; hedging; verdict
  3. audit_voice.py      — one patient-aimed, tactful, evidence-anchored voice

Each runs independently (own strengths, own failure modes); together they audit
the final interpretation + output for accuracy, validation, and authentic voice.
Exit 2 (with --strict) if ANY auditor flags — a single net hole fails the whole.

Usage: python3 scripts/audit_all.py --post <body.json>   (or --dir <dir>)
"""
import argparse, subprocess, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
AUDITORS = ["audit_accuracy.py", "audit_validation.py", "audit_voice.py", "audit_inline_refs.py"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--post"); ap.add_argument("--dir"); ap.add_argument("--strict", action="store_true")
    a = ap.parse_args()
    target = ["--post", a.post] if a.post else ["--dir", a.dir] if a.dir else None
    if not target:
        print("specify --post or --dir", file=sys.stderr); return 3
    worst = 0
    for aud in AUDITORS:
        print("=" * 70)
        r = subprocess.run([sys.executable, str(HERE / aud), *target,
                            *(["--strict"] if a.strict else [])])
        worst = max(worst, r.returncode)
    print("=" * 70)
    print(f"composite result: {'FLAGS RAISED' if worst else 'all three nets clear'}")
    return worst


if __name__ == "__main__":
    sys.exit(main())
