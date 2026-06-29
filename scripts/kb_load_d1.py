#!/usr/bin/env python3
"""
kb_load_d1.py — Load the master OB/GYN KB into the mountzara-clinical D1 FTS
index (kb_docs): the grounding source for backend Claude processes
(functions/_lib/kb.js + schema/0026_kb_fts.sql).

Reads kb_chunks from the MedicalTranscription app (reference knowledge, NOT
PHI), extracts the high-signal clinical text per document, and bulk-loads it
into D1 via the D1 HTTP API using *bound parameters* (so big text never bloats
the SQL statement → no SQLITE_TOOBIG). Idempotent: DROPs + recreates kb_docs.

Usage:
    source ~/.config/mountzara/cf-creds.env   # CLOUDFLARE_API_TOKEN + _ACCOUNT_ID
    python3 scripts/kb_load_d1.py [--limit N] [--rows-per-batch 20]
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


def collect():
    rows = {}
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
            rows[str(did)] = [str(did), source_of(d), str(title), text]
    return list(rows.values())


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
    a = ap.parse_args()

    acct = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
    token = os.environ.get("CLOUDFLARE_API_TOKEN")
    if not acct or not token:
        sys.exit("[kb_load] set CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN "
                 "(source ~/.config/mountzara/cf-creds.env)")

    rows = collect()
    if a.limit:
        rows = rows[:a.limit]
    print(f"[kb_load] collected {len(rows)} docs", file=sys.stderr)
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


if __name__ == "__main__":
    main()
