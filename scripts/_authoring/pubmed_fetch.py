# -*- coding: utf-8 -*-
"""
pubmed_fetch.py — authoritative PubMed abstract retrieval via NCBI E-Utilities,
with on-disk caching. Shared core for the abstract mirror and the auditors so
every accuracy/validation check runs against the live PubMed record, not a
possibly-truncated stored copy.

Cache: scripts/_authoring/.pubmed_cache/<pmid>.json  (verbatim; refresh by deleting).
Respectful use: batches via POST, 0.4s spacing (NCBI allows 3 req/s without a key).
"""
from __future__ import annotations
import json, time, re, urllib.request, urllib.parse, html
from pathlib import Path
from xml.etree import ElementTree as ET

CACHE = Path(__file__).resolve().parent / ".pubmed_cache"
CACHE.mkdir(exist_ok=True)
EFETCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
UA = "mountzara-citation-audit/1.0 (chris.mabini@gmail.com)"


def _parse_article(art: ET.Element) -> dict:
    def txt(p):
        e = art.find(p)
        return "".join(e.itertext()).strip() if e is not None else ""
    title = txt(".//ArticleTitle")
    # structured abstract: join labelled sections in order
    secs = []
    for ab in art.findall(".//Abstract/AbstractText"):
        label = ab.get("Label")
        body = "".join(ab.itertext()).strip()
        if not body:
            continue
        secs.append(f"{label}: {body}" if label else body)
    abstract = " ".join(secs)
    # publication types (design signal straight from PubMed)
    ptypes = [ (pt.text or "").strip() for pt in art.findall(".//PublicationType") ]
    journal = txt(".//Journal/Title")
    year = txt(".//JournalIssue/PubDate/Year") or txt(".//PubDate/MedlineDate")[:4]
    mesh = [ (m.text or "").strip() for m in art.findall(".//MeshHeading/DescriptorName") ]
    return {"title": title, "abstract": abstract, "publication_types": ptypes,
            "journal": journal, "year": year, "mesh": mesh}


def fetch(pmids: list[str], force: bool = False) -> dict[str, dict]:
    out, need = {}, []
    for p in pmids:
        cf = CACHE / f"{p}.json"
        if cf.is_file() and not force:
            out[p] = json.loads(cf.read_text())
        else:
            need.append(p)
    for i in range(0, len(need), 150):
        chunk = need[i:i+150]
        data = urllib.parse.urlencode({"db": "pubmed", "id": ",".join(chunk),
                                       "rettype": "abstract", "retmode": "xml"}).encode()
        req = urllib.request.Request(EFETCH, data=data, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=60) as r:
            root = ET.fromstring(r.read())
        for art in root.findall(".//PubmedArticle"):
            pmid_el = art.find(".//PMID")
            if pmid_el is None:
                continue
            pmid = pmid_el.text.strip()
            rec = _parse_article(art)
            (CACHE / f"{pmid}.json").write_text(json.dumps(rec, ensure_ascii=False))
            out[pmid] = rec
        time.sleep(0.4)
    # mark any that PubMed didn't return
    for p in pmids:
        out.setdefault(p, {"title": "", "abstract": "", "publication_types": [],
                           "journal": "", "year": "", "mesh": [], "_missing": True})
    return out


if __name__ == "__main__":
    import sys
    recs = fetch(sys.argv[1:])
    for p, r in recs.items():
        print(f"\n=== {p} ({r.get('year')}) types={r.get('publication_types')} ===")
        print(r["title"])
        print(r["abstract"][:500])
