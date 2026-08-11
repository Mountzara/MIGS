# Homepage KB-anchor manifests

Moved out of index.html 2026-08-11: these shipped in the served HTML,
readable via View Source, including not_in_kb_claims. Kept here for the
citation audit; never re-embed in a public document.

```
<!-- §0.8 KB-anchor manifest
{
  "spec": "§0.8.1 KB-anchor manifest (CLAUDE.md)",
  "surface": "homepage OMT modal — six-pillar framework, standard-of-care backbone, 8-week trajectory, care-path cards (Who/Services/What to Expect/FAQ/Literature)",
  "page": "/index.html (#omtModal)",
  "user_docx_sources": [
    "OMT_Integrated_Pelvic_Pain_Protocol_v4.1_MAGAZINE_with_Internal_Techniques.docx — Section 1 (six-pillar framework), Section 2 (osteopathic structural exam), Section 3 (diagnosis→technique mapping), Section 5 (patient instructions), Section 6 (verbatim patient-facing scripts), Section 7 (5 SOAP variants), Section 8 (bibliography + outcomes), Section 9 (internal pelvic manual techniques addendum)"
  ],
  "kb_documents_referenced_for_adjacent_claims": [
    {"topic": "Chronic Pelvic Pain", "kb_topic_synthesis": "Chronic Pelvic Pain", "purpose": "Standard-of-care framing for CPP — ACOG PB 218 adjacent"},
    {"topic": "Endometriosis", "kb_topic_synthesis": "Endometriosis", "purpose": "OMT-adjacent endometriosis pillar — supplements user docx with KB-grounded surgical/medical context"}
  ],
  "pmids_efetched_in_session": [
    "37176750",
    "24666560",
    "22503015",
    "37997320",
    "32080045",
    "39037764"
  ],
  "pmid_provenance_note": "RCT and Cochrane PMIDs referenced inside the OMT modal narrative (Muñoz-Gómez 2023, Molins-Cubero 2014, FitzGerald 2012, Alboni 2024, ACOG PB 218 CPP, Han 2024 TENS) all came from the user's OMT v4.1 §8 bibliography and were verified via NCBI E-Utils efetch in this session.",
  "not_in_kb_claims": [
    "OMT-specific technique mechanisms (T12–L1 HVLA, sacral parasympathetic modulation, broad ligament mobilization, pelvic diaphragm release) — sourced entirely from the user's OMT v4.1 Sections 2 and 3. Not in the JSON KB. User-authored source-of-truth per §0.8.1.",
    "Six-pillar framework architecture — entirely user-authored in OMT v4.1 Section 1. Not in the JSON KB by design (the user authored it for this practice)."
  ],
  "generated_at_utc": "2026-05-16T21:30:00Z",
  "note": "The OMT modal is primarily a user-authored clinical asset (Dr. Mabini's OMT v4.1 Protocol). Per §0.8.1 user-authored docx sources are acceptable anchors. Where the modal references endometriosis or chronic pelvic pain standard-of-care (e.g., the Pillar 2 medical-suppression layer for endo), those claims are KB-adjacent and trace back to the Endometriosis + Chronic Pelvic Pain topic syntheses already used by /education/endometriosis/."
}
-->
```

```
<!-- §0.8 KB-anchor manifest — Surgical Excellence domain modals (9 cards in #excellence)
{
  "spec": "§0.8.1 KB-anchor manifest (CLAUDE.md)",
  "surface": "homepage Surgical Excellence section — 9 patient-centered modals (Endometriosis Excision, Robotic & Laparoscopic Myomectomy, Complex MIS Hysterectomy, Operative Hysteroscopy, Office Hysteroscopy & Vaginoscopy, vNOTES, Complex Adhesiolysis, Pelvic Reconstruction, Urologic & Cross-Specialty)",
  "page": "/index.html (#excellence → .domain-grid; data in /assets/js/domain-modals.js)",
  "kb_documents_loaded": [
    "Loaded via scripts/_extract_domain_modal_kb.py from kb_chunks/02_topicSyntheses.json + kb_chunks/01_acogDocuments_chunk*.json on 2026-05-17.",
    "Per-card extract files at cite_audit/domain_modals/<slug>.json — total 121 unique ACOG documents loaded across 9 cards.",
    "Topic syntheses used: Endometriosis (38 docs), Endometriosis Excision (1), Uterine Fibroids (11), Myomectomy (6), Robotic Myomectomy (3), Hysterectomy (22), Hysteroscopy (3), Hysteroscopic Myomectomy (1), Endometrial Polyps (3), Adhesiolysis (2), Pelvic Organ Prolapse (3), Pelvic Reconstructive Surgery (6), Urinary Incontinence (1), Adnexal Emergencies (1)."
  ],
  "kb_fields_extracted": [
    "patientCounselingPoints", "keyPoints", "clinicalPearls", "teachingPoints",
    "criticalThresholds", "drugProtocols", "complicationsManagement",
    "safetyConsiderations", "decisionPoints", "references[].fullCitation",
    "metaAnalysis.supportingStudies[].citation (PMID source pool)"
  ],
  "claims_anchored_per_card": {
    "endometriosis-excision":   {"counseling_points": 19, "key_points": 148, "pmids_in_kb_pool": 50, "primary_anchor": "ACOG Clinical Practice Guideline No. 11 — Management of Endometriosis (kb_chunks/01_acogDocuments_chunk04.json doc id e010f4126035) — used for Level A/B recommendations driving the modal narrative (TVUS imaging, excision > ablation, surgical management improves pregnancy rates, OCs/GnRH agonists ineffective for infertility, medical+surgical pain control with high recurrence)"},
    "myomectomy":               {"counseling_points": 19, "key_points": 127, "pmids_in_kb_pool": 50},
    "hysterectomy-mis":         {"counseling_points": 10, "key_points": 178, "pmids_in_kb_pool": 50},
    "operative-hysteroscopy":   {"counseling_points": 2,  "key_points": 47,  "pmids_in_kb_pool": 24},
    "office-hysteroscopy":      {"counseling_points": 2,  "key_points": 32,  "pmids_in_kb_pool": 19},
    "vnotes":                   {"counseling_points": 7,  "key_points": 106, "pmids_in_kb_pool": 46},
    "adhesiolysis":             {"counseling_points": 7,  "key_points": 88,  "pmids_in_kb_pool": 39},
    "pelvic-reconstruction":    {"counseling_points": 21, "key_points": 39,  "pmids_in_kb_pool": 26},
    "urologic-cross-specialty": {"counseling_points": 7,  "key_points": 88,  "pmids_in_kb_pool": 38}
  },
  "pmids_cited_per_modal": "5-6 anchor PMIDs per modal, all drawn from the KB pmids_in_kb pool (metaAnalysis.supportingStudies[].citation) or from ACOG Practice Bulletin numbers known to be in the KB. No PMID was authored from training-memory.",
  "patient_voice_principles": [
    "Patient-centered, plain-language explanation (no surgeon-CV voice).",
    "Q&A section with 5–6 patient questions per modal in patient voice.",
    "Honest R/B/A — expectant vs. medical vs. surgical for every modal.",
    "Timeline section — Before / Day of / First 2 weeks / 6 weeks+ for every modal.",
    "No infra-language (no '§0.8', 'KB', 'manifest', 'topic synthesis') in patient-facing copy."
  ],
  "not_in_kb_claims": [
    "vNOTES — the KB does not have a dedicated vNOTES topic synthesis. The vNOTES modal content draws on general Hysterectomy KB content for adjacent claims (mesh erosion, route selection) and on published RCT data (HALON trial, Baekelandt et al.) which is cited inline.",
    "ICG fluorescence for endometriosis is referenced from the user's published research methodology and a single KB document on ICG use; broader claims about ICG sensitivity/specificity vs. white light are not made beyond what the KB document supports."
  ],
  "compliance_notes": [
    "Per §0.6 — every modal entry was hand-authored from the KB extract; no scripted content generation.",
    "Per §0.8.1 — every clinical claim traces to a KB-loaded ACOG document field or an inline PMID-anchored citation.",
    "Per §3.10 — purple Apple-glass treatment throughout; no blue tokens; mzRise-compatible (modal opens with cascade animation handled by parent .app-modal); prefers-reduced-motion respected by global override.",
    "Per §3.6 — PMIDs cited are drawn from the KB pmids_in_kb pool which itself was populated from metaAnalysis.supportingStudies[].citation fields (canonical PMID source per §3.6.1)."
  ],
  "generated_at_utc": "2026-05-17T20:00:00Z"
}
-->
```

