#!/usr/bin/env python3
"""
kb_load_d1.py — Load the master OB/GYN KB into the mountzara-clinical D1,
the grounding source for every clinical Claude process on the website
(functions/_lib/kb.js, functions/_lib/clinical_grounding.js).

Reads kb_chunks from the MedicalTranscription app (reference knowledge, NOT
PHI) and loads TWO indexes:

  kb_docs      one row per document, all fields concatenated. The original
               index. Kept because everything already reads it.

  kb_sections  one row per (document, FIELD). This is the one that matters.

WHY kb_sections EXISTS (added 2026-08-14)
-----------------------------------------
The app's KB chunks are STRUCTURED records: an abstract, a clinical summary,
counseling points written for patients, critical thresholds, decision
points, safety considerations, a management algorithm. Those fields exist
because they answer different questions, and the app uses them accordingly.

build_text() concatenated all fifteen into one unlabelled blob and loaded
only that. Every distinction was gone, and the website could only do
bag-of-words retrieval over the mush.

The consequence showed up the first time clinical grounding ran against
live data: a draft reply to a PATIENT retrieved "Device-related
malfunctions and associated patient harm in robotic-assisted surgery" — a
real document in the library, and exactly the wrong part of it. A patient
reply needs patientCounselingPoints. A triage safety flag needs
criticalThresholds. Flattened, those are the same field.

kb_sections preserves the structure so functions/_lib/kb_fields.js can
retrieve the part that answers the task. The website degrades to kb_docs
when kb_sections is absent, so loading this is safe to do at any time.

Usage:
    source ~/.config/mountzara/cf-creds.env   # CLOUDFLARE_API_TOKEN + _ACCOUNT_ID
    python3 scripts/kb_load_d1.py [--limit N] [--rows-per-batch 20]
    python3 scripts/kb_load_d1.py --docs-only     # skip kb_sections
"""
import argparse, glob, json, os, sys, urllib.request, urllib.error

KB_DIR = os.environ.get(
    "KB_DIR",
    "/Users/beans/Developer/MountZara/MountZaraMedicalTranscription/kb_chunks",
)
DB_ID = "f9b4acfe-4f5f-43bb-a76e-bac87e912fdb"   # mountzara-clinical (wrangler.toml)
MAX_TEXT = 8000

STR_FIELDS = ["abstract", "clinicalSummary", "backgroundSummary",
              "summaryOfRecommendations", "complications"]
LIST_FIELDS = ["keyPoints", "clinicalPearls", "teachingPoints",
               "patientCounselingPoints", "oralBoardPearls",
               "criticalThresholds", "decisionPoints", "clinicalTopics",
               "safetyConsiderations", "managementAlgorithm"]


def flatten(v):
    out = []
    if isinstance(v, str):
        out.append(v)
    elif isinstance(v, list):
        for it in v:
            if isinstance(it, str):
                out.append(it)
            elif isinstance(it, dict):
                for k in ("recommendation", "text", "point", "item", "summary"):
                    if isinstance(it.get(k), str):
                        out.append(it[k]); break
    return out


def build_text(doc):
    parts = []
    for f in STR_FIELDS:
        if isinstance(doc.get(f), str):
            parts.append(doc[f])
    for f in LIST_FIELDS:
        parts += flatten(doc.get(f))
    return " \n".join(p.strip() for p in parts if p and p.strip())[:MAX_TEXT]


def source_of(doc):
    s = doc.get("medicalSociety") or (doc.get("allSources") or [None])[0] or "KB"
    bits = [str(s)]
    dt = doc.get("documentType")
    if dt and dt != "Other":
        bits.append(str(dt))
    yr = doc.get("publicationYear")
    if yr:
        bits.append(str(yr))
    return " · ".join(bits)


def sections_of(doc):
    """One (field, text) pair per populated field, structure intact.

    This is the whole point of the rewrite: the app distinguishes what you
    tell a patient from what changes management, and so must the website.
    """
    out = []
    for f in STR_FIELDS:
        v = doc.get(f)
        if isinstance(v, str) and v.strip():
            out.append((f, v.strip()[:MAX_TEXT]))
    for f in LIST_FIELDS:
        items = [x.strip() for x in flatten(doc.get(f)) if x and x.strip()]
        if items:
            # Bullets keep list items as separate propositions instead of
            # running them into one sentence, which matters when an excerpt
            # is pasted into a prompt and cited.
            out.append((f, "\n".join("• " + x for x in items)[:MAX_TEXT]))
    return out


def collect():
    rows = {}
    sections = []
    for fp in sorted(glob.glob(os.path.join(KB_DIR, "*.json"))):
        if os.path.basename(fp).startswith("00_"):
            continue
        try:
            data = json.load(open(fp))
        except Exception:
            continue
        docs = data if isinstance(data, list) else (
            data.get("documents") if isinstance(data, dict) else None)
        if not isinstance(docs, list):
            continue
        for d in docs:
            if not isinstance(d, dict):
                continue
            did, title = d.get("id") or d.get("canonicalId"), d.get("title")
            if not did or not title:
                continue
            text = build_text(d)
            if not text:
                continue
            src = source_of(d)
            rows[str(did)] = [str(did), src, str(title), text]
            for field, body in sections_of(d):
                sections.append([str(did), field, src, str(title), body])
    return list(rows.values()), sections


def d1_query(acct, token, sql, params=None):
    url = f"https://api.cloudflare.com/client/v4/accounts/{acct}/d1/database/{DB_ID}/query"
    body = json.dumps({"sql": sql, "params": params or []}).encode()
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            out = json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"[kb_load] D1 HTTP {e.code}: {e.read().decode()[:400]}")
    if not out.get("success"):
        sys.exit(f"[kb_load] D1 error: {json.dumps(out.get('errors'))[:400]}")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--rows-per-batch", type=int, default=20)  # 20*4=80 bound params
    ap.add_argument("--docs-only", action="store_true",
                    help="load kb_docs only; skip the structured kb_sections index")
    a = ap.parse_args()

    acct = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
    token = os.environ.get("CLOUDFLARE_API_TOKEN")
    if not acct or not token:
        sys.exit("[kb_load] set CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN "
                 "(source ~/.config/mountzara/cf-creds.env)")

    rows, sections = collect()
    if a.limit:
        rows = rows[:a.limit]
        keep = {r[0] for r in rows}
        sections = [x for x in sections if x[0] in keep]
    print(f"[kb_load] collected {len(rows)} docs, {len(sections)} field sections", file=sys.stderr)
    if not rows:
        sys.exit("[kb_load] no docs — check KB_DIR")

    d1_query(acct, token, "DROP TABLE IF EXISTS kb_docs")
    d1_query(acct, token,
             "CREATE VIRTUAL TABLE kb_docs USING fts5("
             "doc_id UNINDEXED, source UNINDEXED, title, text, "
             "tokenize='porter unicode61')")
    print("[kb_load] table recreated", file=sys.stderr)

    n = a.rows_per_batch
    loaded = 0
    for i in range(0, len(rows), n):
        batch = rows[i:i + n]
        placeholders = ",".join(["(?,?,?,?)"] * len(batch))
        params = [v for r in batch for v in r]
        d1_query(acct, token,
                 f"INSERT INTO kb_docs(doc_id,source,title,text) VALUES {placeholders}",
                 params)
        loaded += len(batch)
        if (i // n) % 10 == 0:
            print(f"[kb_load] {loaded}/{len(rows)}", file=sys.stderr)
    print(f"[kb_load] done — {loaded} docs loaded to remote D1", file=sys.stderr)

    if a.docs_only:
        print("[kb_load] --docs-only: skipping kb_sections", file=sys.stderr)
        return

    # -----------------------------------------------------------------
    # kb_sections — one row per (document, field).
    # -----------------------------------------------------------------
    d1_query(acct, token, "DROP TABLE IF EXISTS kb_sections")
    d1_query(acct, token,
             "CREATE VIRTUAL TABLE kb_sections USING fts5("
             "doc_id UNINDEXED, field UNINDEXED, source UNINDEXED, "
             "title, text, tokenize='porter unicode61')")
    print("[kb_load] kb_sections recreated", file=sys.stderr)

    m = max(1, a.rows_per_batch // 2)     # 5 bound params per row, not 4
    sloaded = 0
    for i in range(0, len(sections), m):
        batch = sections[i:i + m]
        placeholders = ",".join(["(?,?,?,?,?)"] * len(batch))
        params = [v for r in batch for v in r]
        d1_query(acct, token,
                 f"INSERT INTO kb_sections(doc_id,field,source,title,text) VALUES {placeholders}",
                 params)
        sloaded += len(batch)
        if (i // m) % 20 == 0:
            print(f"[kb_load] sections {sloaded}/{len(sections)}", file=sys.stderr)
    print(f"[kb_load] done — {sloaded} field sections loaded", file=sys.stderr)

    by_field = {}
    for r in sections:
        by_field[r[1]] = by_field.get(r[1], 0) + 1
    for f, n in sorted(by_field.items(), key=lambda kv: -kv[1]):
        print(f"[kb_load]   {n:6d}  {f}", file=sys.stderr)


if __name__ == "__main__":
    main()
