#!/usr/bin/env python3
"""Extract patient-counseling, key-points, drug-protocols, references, and PMIDs
from the KB for each of the 9 Surgical Excellence cards.

This is a READ-ONLY extraction — it produces JSON reference files in
cite_audit/domain_modals/<slug>.json. Future Claude sessions will compose the
modal HTML BY HAND from these references per §0.6 (no scripted modal generation
from this output; just a fact-pool for grounded authoring).
"""
import json
from pathlib import Path

KB_DIR = Path("/Users/beans/Developer/MountZara/MountZaraMedicalTranscription/kb_chunks")
OUT_DIR = Path("/Users/beans/Developer/MountZara/MIGS/cite_audit/domain_modals")
OUT_DIR.mkdir(parents=True, exist_ok=True)

# Each card: slug, title, sub-tag, KB topic-synthesis names to walk, max docs to pull
CARDS = [
    ("endometriosis-excision",
     "Endometriosis Excision",
     "ICG-Guided Detection",
     ["Endometriosis", "Endometriosis Excision"],
     20),
    ("myomectomy",
     "Robotic & Laparoscopic Myomectomy",
     "AAGL Video Abstract",
     ["Uterine Fibroids", "Myomectomy", "Robotic Myomectomy"],
     18),
    ("hysterectomy-mis",
     "Complex Minimally Invasive Hysterectomy",
     "Minimally Invasive Routes",
     ["Hysterectomy"],
     22),
    ("operative-hysteroscopy",
     "Operative Hysteroscopy",
     "Golden Hysteroscope Award",
     ["Hysteroscopy", "Hysteroscopic Myomectomy", "Endometrial Polyps"],
     12),
    ("office-hysteroscopy",
     "Office Hysteroscopy & Vaginoscopy",
     "Bettocchi No-Touch Technique",
     ["Hysteroscopy", "Endometrial Polyps"],
     10),
    ("vnotes",
     "vNOTES",
     "Emerging Technique",
     ["Hysterectomy"],
     12),
    ("adhesiolysis",
     "Complex Adhesiolysis",
     "Highest Fellowship Volume",
     ["Adhesiolysis", "Endometriosis"],
     12),
    ("pelvic-reconstruction",
     "Pelvic Reconstruction",
     "Native-Tissue Repair",
     ["Pelvic Organ Prolapse", "Pelvic Reconstructive Surgery", "Urinary Incontinence"],
     14),
    ("urologic-cross-specialty",
     "Urologic & Cross-Specialty",
     "Multidisciplinary",
     ["Hysterectomy", "Adnexal Emergencies"],
     10),
]


def load_chunks():
    """Build {doc_id: doc} for every ACOG doc across 17 chunks. ~6 MB per chunk."""
    docs = {}
    for n in range(1, 18):
        p = KB_DIR / f"01_acogDocuments_chunk{n:02d}.json"
        if not p.exists():
            continue
        for d in json.loads(p.read_text()):
            doc_id = d.get("id") or d.get("filename")
            if doc_id:
                docs[doc_id] = d
    return docs


def topic_synth_index():
    arr = json.loads((KB_DIR / "02_topicSyntheses.json").read_text())
    return {s["topicName"]: s for s in arr}


def pull_field(doc, field):
    v = doc.get(field)
    if isinstance(v, list):
        return [s for s in v if isinstance(s, str) and s.strip()]
    if isinstance(v, str) and v.strip():
        return [v]
    return []


def extract_pmids_from_supporting_studies(doc):
    out = []
    meta = doc.get("metaAnalysis") or {}
    for s in meta.get("supportingStudies") or []:
        cit = s.get("citation") or ""
        import re
        m = re.search(r"PMID:\s*(\d+)", cit)
        if m:
            out.append(m.group(1))
    return out


def build_card(card_slug, title, tag, topic_names, max_docs):
    syn_idx = topic_synth_index()
    docs = load_chunks()

    related_ids = []
    used_topics = []
    for tn in topic_names:
        if tn in syn_idx:
            used_topics.append(tn)
            related_ids.extend(syn_idx[tn].get("relatedDocumentIds", []))

    # de-dupe, preserve order, cap
    seen = set()
    uniq_ids = []
    for did in related_ids:
        if did not in seen and did in docs:
            uniq_ids.append(did)
            seen.add(did)
    uniq_ids = uniq_ids[:max_docs]

    # collect patient-relevant content
    counseling = []
    key_points = []
    pearls = []
    thresholds = []
    drug_protocols = []
    complications = []
    safety = []
    decision_points = []
    teaching = []
    refs = []
    pmids = []
    doc_summary = []

    for did in uniq_ids:
        d = docs[did]
        counseling.extend(pull_field(d, "patientCounselingPoints"))
        key_points.extend(pull_field(d, "keyPoints"))
        pearls.extend(pull_field(d, "clinicalPearls"))
        teaching.extend(pull_field(d, "teachingPoints"))
        thresholds.extend(pull_field(d, "criticalThresholds"))
        drug_protocols.extend(pull_field(d, "drugProtocols"))
        complications.extend(pull_field(d, "complicationsManagement"))
        safety.extend(pull_field(d, "safetyConsiderations"))
        decision_points.extend(pull_field(d, "decisionPoints"))
        for r in (d.get("references") or [])[:25]:
            fc = r.get("fullCitation") or ""
            if fc and "PMID" in fc:
                refs.append(fc.strip())
        pmids.extend(extract_pmids_from_supporting_studies(d))
        doc_summary.append({
            "id": did,
            "title": d.get("title", "?"),
            "documentType": d.get("documentType", "?"),
            "publicationYear": d.get("publicationYear"),
        })

    # de-dupe text fields preserving order
    def uniq(lst):
        seen = set()
        out = []
        for s in lst:
            k = s.strip()[:200]
            if k and k not in seen:
                seen.add(k)
                out.append(s.strip())
        return out

    payload = {
        "slug": card_slug,
        "title": title,
        "tag": tag,
        "topic_syntheses_used": used_topics,
        "kb_documents_loaded": doc_summary,
        "patientCounselingPoints": uniq(counseling),
        "keyPoints": uniq(key_points),
        "clinicalPearls": uniq(pearls),
        "teachingPoints": uniq(teaching),
        "criticalThresholds": uniq(thresholds),
        "drugProtocols": uniq(drug_protocols),
        "complicationsManagement": uniq(complications),
        "safetyConsiderations": uniq(safety),
        "decisionPoints": uniq(decision_points),
        "references_with_pmids": uniq(refs)[:40],
        "pmids_in_kb": list({p for p in pmids})[:50],
    }
    out_path = OUT_DIR / f"{card_slug}.json"
    out_path.write_text(json.dumps(payload, indent=2))
    return payload, out_path


def main():
    print(f"Loading KB chunks from {KB_DIR}")
    summary = []
    for slug, title, tag, topics, maxd in CARDS:
        payload, path = build_card(slug, title, tag, topics, maxd)
        n_docs = len(payload["kb_documents_loaded"])
        n_counsel = len(payload["patientCounselingPoints"])
        n_key = len(payload["keyPoints"])
        n_refs = len(payload["references_with_pmids"])
        n_pmid = len(payload["pmids_in_kb"])
        print(f"  ✓ {slug:30s} docs={n_docs:>2}  counsel={n_counsel:>3}  key={n_key:>3}  refs={n_refs:>2}  pmids={n_pmid:>2}")
        summary.append({
            "slug": slug, "title": title, "n_docs": n_docs,
            "n_counseling": n_counsel, "n_key_points": n_key,
            "n_refs": n_refs, "n_pmids": n_pmid,
            "path": str(path),
        })
    (OUT_DIR / "_index.json").write_text(json.dumps(summary, indent=2))
    print(f"\nIndex written → {OUT_DIR / '_index.json'}")


if __name__ == "__main__":
    main()
