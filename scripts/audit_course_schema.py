#!/usr/bin/env python3
"""Every Reflections course honors the pedagogy contract — enforced, not remembered.

The owner's MSAEd principles are the architecture of Mount Zara's
Reflections (SYSTEM_MAP §8.0.0.0c): a lesson that skips its
lived-experience opening or its private reflection is not "a bit thin,"
it is out of contract. This gate makes the contract mechanical:

  * catalog DERIVED: every education/<topic>/course.json is a course;
    every course must render (learn/<topic>/ exists and is IN SYNC with
    the manifest — regenerating must be a no-op, same philosophy as the
    fact-sync gate).
  * per course: exactly 6 modules, numbered 1..6, each with 1+ lessons.
  * per lesson: an `opening` (lived experience before content), 1+
    `teaching` blocks, a `reflection` prompt, and an `action` with the
    addable visit question. A `check`, when present, carries options
    (exactly one right), a grounded `explanation`, and a `source`.
  * teaching text is dose-free counseling prose (same boundary as
    audit_no_dosing.py) and never says "CPG".
  * generated pages carry the disclaimer and the canvas guard.

  python3 scripts/audit_course_schema.py
"""
import glob, json, os, re, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DOSE_RE = re.compile(
    r"\b\d+(?:[.,]\d+)?(?:\s*[–-]\s*\d+(?:[.,]\d+)?)?\s*(?:mg|mcg|µg|IU)\b(?!\s*/\s*(?:d?L|mL)\b)"
    r"|\bq\s*\d+(?:\s*[–-]\s*\d+)?\s*h\b|\b(?:BID|TID|QID)\b", re.I)

def text_of(html):
    html = re.sub(r"<sup class=\"mz-ref\"[\s\S]*?</sup>", " ", html)
    return re.sub(r"<[^>]+>", " ", html)

def main():
    problems = []
    manifests = sorted(glob.glob(os.path.join(ROOT, "education", "*", "course.json")))
    if not manifests:
        print("course-schema gate: no course manifests yet — nothing to check")
        return 0
    for mp in manifests:
        topic = os.path.basename(os.path.dirname(mp))
        try:
            c = json.load(open(mp, encoding="utf-8"))
        except Exception as e:
            problems.append(f"{topic}: course.json unparseable: {e}")
            continue
        mods = c.get("modules") or []
        if [m.get("n") for m in mods] != [1, 2, 3, 4, 5, 6]:
            problems.append(f"{topic}: modules must be exactly 1..6 (got {[m.get('n') for m in mods]})")
        for m in mods:
            if not m.get("title") or not m.get("what") or not (m.get("lessons") or []):
                problems.append(f"{topic} module {m.get('n')}: needs title, what, and 1+ lessons")
            for l in m.get("lessons") or []:
                where = f"{topic} {m.get('n')}/{l.get('slug')}"
                if not l.get("slug") or not re.fullmatch(r"[a-z0-9-]+", l.get("slug", "")):
                    problems.append(f"{where}: bad or missing slug")
                if not l.get("title"):
                    problems.append(f"{where}: missing title")
                if not (l.get("opening") or "").strip():
                    problems.append(f"{where}: missing the lived-experience opening")
                if not [t for t in l.get("teaching") or [] if t.strip()]:
                    problems.append(f"{where}: no teaching blocks")
                if not (l.get("reflection") or "").strip():
                    problems.append(f"{where}: missing the private reflection prompt")
                act = l.get("action") or {}
                if not act.get("text") or not act.get("question"):
                    problems.append(f"{where}: action needs text + the addable question")
                chk = l.get("check")
                if chk is not None:
                    rights = [o for o in chk.get("options") or [] if o.get("right")]
                    if len(chk.get("options") or []) < 2 or len(rights) != 1:
                        problems.append(f"{where}: check needs 2+ options with exactly one right")
                    if not chk.get("explanation") or not chk.get("source"):
                        problems.append(f"{where}: check needs a grounded explanation + source")
                body = " ".join(text_of(t) for t in l.get("teaching") or [])
                body += " " + text_of(l.get("opening") or "")
                doses = sorted(set(mm.group(0) for mm in DOSE_RE.finditer(body)))
                if doses:
                    problems.append(f"{where}: dosing in counseling prose: {', '.join(doses[:4])}")
                if re.search(r"\bCPG\b", body):
                    problems.append(f"{where}: says 'CPG' — use 'the national guideline'")
        # rendered output in sync + carries the standing blocks
        home = os.path.join(ROOT, "learn", topic, "index.html")
        if not os.path.exists(home):
            problems.append(f"{topic}: learn/{topic}/ not generated — run scripts/build_reflections_course.py")
        else:
            src = open(home, encoding="utf-8").read()
            if "mz-eddisclaimer" not in src:
                problems.append(f"{topic}: generated course home missing the disclaimer")
            if "mz-canvas-guard" not in src:
                problems.append(f"{topic}: generated course home missing the canvas guard")
    # regeneration must be a no-op (manifest and pages cannot drift)
    if not problems and manifests:
        before = {}
        for f in glob.glob(os.path.join(ROOT, "learn", "**", "index.html"), recursive=True):
            before[f] = open(f, encoding="utf-8").read()
        r = subprocess.run([sys.executable, os.path.join(ROOT, "scripts", "build_reflections_course.py")],
                           capture_output=True, text=True)
        if r.returncode != 0:
            problems.append(f"generator failed: {r.stderr.strip()[:160]}")
        else:
            for f, old in before.items():
                if open(f, encoding="utf-8").read() != old:
                    problems.append(f"{os.path.relpath(f, ROOT)}: generated page drifted from its manifest — commit the regenerated output")
    if problems:
        for p in problems:
            print(f"  ✗ {p}")
        print(f"\n🛑 COURSE-SCHEMA GATE FAILED — {len(problems)} pedagogy-contract violation(s).")
        return 1
    n = len(manifests)
    print(f"course-schema gate: CLEAN — {n} course(s) honor the pedagogy contract and match their rendered pages")
    return 0

sys.exit(main())
