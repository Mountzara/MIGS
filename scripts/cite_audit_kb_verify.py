#!/usr/bin/env python3
"""
Citation audit step — verify every KB-canonical PMID via NCBI E-Utilities.

Reads:  cite_audit/per_page_kb_pmid_pools.json  (533 unique PMIDs across 12 page topics,
        each one sourced from clinical_knowledge.json's metaAnalysis.supportingStudies[],
        landmarkStudies[], recentStudies[], or references[].fullCitation field).

For each unique PMID:
  1. esummary.fcgi  → title, first author, journal, year (validates the PMID exists)
  2. efetch.fcgi (rettype=abstract, retmode=xml) → verbatim structured abstract
     (BACKGROUND/OBJECTIVE/METHODS/RESULTS/CONCLUSION sections preserved)

Writes: cite_audit/verified_pmids.json  — { pmid → { title, authors[], journal, year,
        abstract, mesh_terms[], publication_types[], doi, kb_sources[]: [page slugs that
        cite this PMID, with the KB context field that surfaced it] } }

This is §3.6/§3.7-compliant: every PMID round-trips through E-Utilities in this session,
the abstract is the verbatim efetch response, and the source-of-truth is the JSON KB
that already passed §0.8.1 enrichment.

Run on the user's Mac directly (urllib opens https://eutils.ncbi.nlm.nih.gov/...) so
NCBI is reachable. Rate-limited to 3 requests/sec without API key per NCBI policy.
"""
import json
import os
import sys
import time
import urllib.request
import urllib.parse
import urllib.error
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
POOL_FILE = os.path.join(REPO_ROOT, "cite_audit", "per_page_kb_pmid_pools.json")
OUT_FILE = os.path.join(REPO_ROOT, "cite_audit", "verified_pmids.json")
LOG_FILE = os.path.join(REPO_ROOT, "cite_audit", "verify_run.log")

ESUMMARY_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi"
EFETCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
TOOL = "MountZara_CiteAudit_v10"
EMAIL = "chris.mabini@gmail.com"

# NCBI: 3 req/sec without API key — sleep 0.34s between calls to stay safe
RATE_SLEEP = 0.34
BATCH_SIZE = 20  # esummary batches; efetch is per-PMID for clean structured-abstract parse

LOG_LINES = []
def log(msg):
    ts = datetime.now(timezone.utc).strftime("%H:%M:%SZ")
    line = f"[{ts}] {msg}"
    LOG_LINES.append(line)
    print(line, flush=True)


def http_get(url, params, timeout=45):
    """GET with urllib (works on the Mac, no proxy)."""
    full = f"{url}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(full, headers={"User-Agent": f"{TOOL} (chris.mabini@gmail.com)"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8")


def esummary_batch(pmids):
    """Batch esummary call. Returns {pmid: meta-dict, ...} or None on parse failure."""
    if not pmids:
        return {}
    params = {
        "db": "pubmed",
        "id": ",".join(pmids),
        "retmode": "json",
        "tool": TOOL,
        "email": EMAIL,
    }
    raw = http_get(ESUMMARY_URL, params)
    try:
        data = json.loads(raw).get("result", {})
    except json.JSONDecodeError as e:
        log(f"  esummary JSON decode error: {e}")
        return None
    out = {}
    for pmid in pmids:
        entry = data.get(pmid)
        if not entry or "error" in entry:
            out[pmid] = None
            continue
        out[pmid] = {
            "title": (entry.get("title", "") or "").strip(),
            "authors": [(a.get("name", "") or "") for a in entry.get("authors", [])][:8],
            "journal": (entry.get("source", "") or "").strip(),
            "year": (entry.get("pubdate", "") or "")[:4],
            "volume": entry.get("volume", ""),
            "issue": entry.get("issue", ""),
            "pages": entry.get("pages", ""),
            "doi": (entry.get("elocationid", "") or "").replace("doi: ", ""),
            "pub_types": entry.get("pubtype", []),
        }
    return out


def parse_efetch_xml(xml_text):
    """Parse a single-PMID efetch response. Returns abstract + mesh."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as e:
        return None, f"XML parse error: {e}"

    art = root.find(".//PubmedArticle")
    if art is None:
        # Could be a BookDocument / different shape
        art = root.find(".//PubmedBookArticle")
        if art is None:
            return None, "No PubmedArticle/PubmedBookArticle in response"

    # Abstract — preserve structured Labels (BACKGROUND/METHODS/RESULTS/CONCLUSION)
    parts = []
    for ab in art.findall(".//Abstract/AbstractText"):
        label = (ab.get("Label", "") or "").strip()
        text = "".join(ab.itertext()).strip()
        if not text:
            continue
        if label:
            parts.append(f"{label}: {text}")
        else:
            parts.append(text)
    abstract = "\n\n".join(parts)

    # MeSH
    mesh = []
    for m in art.findall(".//MeshHeading/DescriptorName"):
        if m.text:
            mesh.append(m.text)

    return {"abstract": abstract, "mesh_terms": mesh}, None


def efetch_one(pmid):
    """Per-PMID efetch for clean structured-abstract parse."""
    params = {
        "db": "pubmed",
        "id": pmid,
        "rettype": "abstract",
        "retmode": "xml",
        "tool": TOOL,
        "email": EMAIL,
    }
    raw = http_get(EFETCH_URL, params)
    parsed, err = parse_efetch_xml(raw)
    return parsed, err


def main():
    log(f"Loading PMID pool from {POOL_FILE}")
    pools = json.load(open(POOL_FILE))

    # Invert: pmid → list of (slug, kb_context)
    pmid_sources = {}
    for slug, items in pools.items():
        for it in items:
            pmid = it["pmid"]
            pmid_sources.setdefault(pmid, []).append({
                "page_slug": slug,
                "kb_source_doc": it.get("src_doc", ""),
                "kb_field": it.get("src_field", ""),
                "kb_context_snippet": it.get("context", "")[:240],
            })

    all_pmids = sorted(pmid_sources.keys(), key=int)
    log(f"Unique PMIDs to verify: {len(all_pmids)}")
    log(f"Page slugs covered: {sorted(pools.keys())}")

    # Resume support — if OUT_FILE exists, load prior progress
    verified = {}
    if os.path.exists(OUT_FILE):
        try:
            verified = json.load(open(OUT_FILE))
            log(f"Resuming: {len(verified)} PMIDs already verified")
        except Exception:
            verified = {}

    todo = [p for p in all_pmids if p not in verified]
    log(f"Remaining to verify: {len(todo)}")

    # Phase 1: esummary in batches
    log("=" * 60)
    log("PHASE 1: esummary batches (validates PMID + gets bibliographic metadata)")
    log("=" * 60)

    summaries = {}
    for i in range(0, len(todo), BATCH_SIZE):
        batch = todo[i:i + BATCH_SIZE]
        log(f"  batch {i // BATCH_SIZE + 1}/{(len(todo) + BATCH_SIZE - 1) // BATCH_SIZE}: PMIDs {batch[:3]}...({len(batch)} total)")
        try:
            res = esummary_batch(batch)
        except urllib.error.URLError as e:
            log(f"    ⚠️  URLError: {e}")
            time.sleep(2.0)
            continue
        if res is None:
            log("    ⚠️  parse failed, skipping batch")
            continue
        for pmid, meta in res.items():
            if meta is None:
                log(f"    ❌ PMID {pmid}: NOT FOUND in PubMed (stale/wrong PMID in KB)")
                continue
            summaries[pmid] = meta
        time.sleep(RATE_SLEEP)

    log(f"esummary complete: {len(summaries)}/{len(todo)} PMIDs returned bibliographic data")

    # Phase 2: per-PMID efetch for verbatim abstract
    log("=" * 60)
    log("PHASE 2: efetch per-PMID for verbatim structured abstract")
    log("=" * 60)

    successes, abs_missing, errors = 0, 0, 0
    for i, pmid in enumerate(sorted(summaries.keys(), key=int), 1):
        try:
            parsed, err = efetch_one(pmid)
        except urllib.error.URLError as e:
            log(f"  [{i:>4}/{len(summaries)}] PMID {pmid}: URLError {e} — retry once")
            time.sleep(2.0)
            try:
                parsed, err = efetch_one(pmid)
            except Exception as e2:
                log(f"      retry also failed: {e2}")
                errors += 1
                continue
        if err:
            log(f"  [{i:>4}/{len(summaries)}] PMID {pmid}: efetch error — {err}")
            errors += 1
            continue
        meta = summaries[pmid]
        abstract = parsed.get("abstract", "") if parsed else ""
        verified[pmid] = {
            **meta,
            "abstract": abstract,
            "mesh_terms": (parsed or {}).get("mesh_terms", []),
            "kb_sources": pmid_sources[pmid],
            "verified_at_utc": datetime.now(timezone.utc).isoformat(),
        }
        if abstract:
            successes += 1
        else:
            abs_missing += 1
            log(f"  [{i:>4}/{len(summaries)}] PMID {pmid}: ⚠️  no abstract returned ({meta['title'][:60]})")
        # Periodic save every 25 PMIDs for crash safety
        if i % 25 == 0:
            with open(OUT_FILE, "w") as f:
                json.dump(verified, f, indent=2)
            log(f"      [checkpoint: {len(verified)} saved]")
        time.sleep(RATE_SLEEP)

    # Final write
    with open(OUT_FILE, "w") as f:
        json.dump(verified, f, indent=2)
    with open(LOG_FILE, "w") as f:
        f.write("\n".join(LOG_LINES) + "\n")

    log("=" * 60)
    log("DONE")
    log(f"  Total verified (with bibliographic): {len(verified)}")
    log(f"  With verbatim abstract: {successes}")
    log(f"  With bibliographic only (no abstract returned): {abs_missing}")
    log(f"  Errors: {errors}")
    log(f"  Wrote: {OUT_FILE}")
    log(f"  Log:   {LOG_FILE}")


if __name__ == "__main__":
    main()
