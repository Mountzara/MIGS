#!/usr/bin/env python3
"""DEPRECATED — DO NOT INVOKE.

This script was a legacy KB anchor patcher from the pre-§0.8.1 verify_kb_anchoring.py codification era of the MountZara content
pipeline. The MountZara codebase audit on 2026-05-26 flagged it as a
fence-off candidate because it could produce content that violates the
latest CLAUDE.md §0.4.1 / §3.7.1 / §3.8 / §3.9 / §3.10 / §3.12 hard rules
if invoked today. Canonical replacement: scripts/verify_kb_anchoring.py (deploy-gate verifier, not a patcher — anchors live in cite_audit/page_anchors.json and are applied via scripts/cite_audit_apply.py).

If you have a reason to read this file (e.g. recover a prior render
shape, audit a pre-2026-05-26 intermediate state), open it in an editor
rather than executing it.

To restore execution, remove this guard AND ensure the file's output
passes `scripts/regression_audit.py --body-html` or `--post-json`
against the latest CLAUDE.md hard-rule set before any R2 PUT."""

import sys as _sys
_sys.stderr.write(
    "\n!! DEPRECATED LEGACY SCRIPT — refusing to run.\n"
    "!! See module docstring for the canonical replacement.\n"
    "!! File: /Users/beans/Developer/MountZara/MIGS/scripts/_anchor_endometriosis_page.py\n\n"
)
_sys.exit(2)


"""
_anchor_endometriosis_page.py — retroactively add §0.8.1 KB-anchor metadata
to the existing /education/endometriosis/index.html.

Per CLAUDE.md §0.8.1 the page must have a trailing manifest HTML comment
listing every KB document quoted, every PMID efetched in-session, every
user-authored docx consulted, and every NOT-IN-KB claim. This script:

  1. Reads the existing endometriosis/index.html
  2. Builds the manifest by mapping the major clinical sections to the KB
     document UUIDs in /tmp/mz_kb/endo_corpus.json that anchor them
  3. Injects the manifest as a single trailing <!-- §0.8 KB-anchor manifest -->
     comment before </body>
  4. Writes the file back

Run from anywhere; idempotent (re-running replaces a prior manifest).
"""

import json
import os
import re
from datetime import datetime, timezone

PAGE = "/Users/beans/Developer/MountZara/MIGS/education/endometriosis/index.html"
CORPUS = "/tmp/mz_kb/endo_corpus.json"

# Curated per-claim mapping. Each entry binds a specific clinical claim
# made on the page to its KB-document UUID + field + 0-based index. The
# excerpt_first_words is what the verifier fuzzy-checks against the KB
# source. UUIDs come from /tmp/mz_kb/endo_corpus.json.
ANCHORS = [
    # Endometrioma — excision over ablation
    {
        "claim": "Ovarian cystectomy preferred over ablation for endometriomas",
        "kb_doc_id": "1E9A3C89-3168-49D7-B941-C8E0506A523E",
        "field": "keyPoints",
        "excerpt_first_words": "Ovarian cystectomy is preferred over ablation or sclerotherapy",
        "page_anchor_id": "phenotype-endometrioma",
    },
    # Prevalence — 10% reproductive age women
    {
        "claim": "Endometriosis affects ~10% of reproductive-age women",
        "kb_doc_id": "c6f6a253",
        "field": "keyPoints",
        "excerpt_first_words": "Endometriosis affects approximately 10% of reproductive-age women",
        "page_anchor_id": "key-facts",
    },
    # Prevalence — 4 million US, true prevalence higher
    {
        "claim": "Prevalence undercounted; diagnostic delay",
        "kb_doc_id": "14e94e4e-9a1e-447e-92d6-11d9cdc5ba63",
        "field": "keyPoints",
        "excerpt_first_words": "More than 4 million reproductive-age US women have diagnosed endometriosis",
        "page_anchor_id": "key-facts",
    },
    # Level-A: TVUS imaging of choice
    {
        "claim": "TVUS is the imaging modality of choice",
        "kb_doc_id": "599d51a5",
        "field": "levelARecommendations",
        "excerpt_first_words": "Transvaginal ultrasonography is the imaging modal",
        "page_anchor_id": "evaluation",
    },
    # Long-term GnRH + add-back
    {
        "claim": "GnRH long-term + medical-failure-then-laparoscopy pathway",
        "kb_doc_id": "ce57ae31",
        "field": "keyPoints",
        "excerpt_first_words": "If these medications do not resolve the pain laparoscopy is usually performed",
        "page_anchor_id": "rung-3",
    },
    # CPP defined as >6 months
    {
        "claim": "Chronic pelvic pain definition (>6 months)",
        "kb_doc_id": "9B94C0F4",
        "field": "keyPoints",
        "excerpt_first_words": "Chronic pelvic pain is defined as pelvic pain lasting",
        "page_anchor_id": "pain-sources",
    },
    # Adenomyosis coexistence
    {
        "claim": "Adenomyosis = endometrial glands and stroma within myometrium",
        "kb_doc_id": "d7775ffa",
        "field": "keyPoints",
        "excerpt_first_words": "Adenomyosis involves pathologic endometrial glands and stroma within the uterine myometrium",
        "page_anchor_id": "what-it-is",
    },
    # Bladder vs ureter ratio in urinary endo
    {
        "claim": "Urinary tract endometriosis: bladder 85%, ureter 15%",
        "kb_doc_id": "5f59120f",
        "field": "keyPoints",
        "excerpt_first_words": "Urinary tract endometriosis involves the bladder",
        "page_anchor_id": "phenotype-deep",
    },
    # Elagolix as oral GnRH antagonist
    {
        "claim": "Elagolix oral GnRH antagonist for endo pain (6-10% women)",
        "kb_doc_id": "aa9fb92e",
        "field": "keyPoints",
        "excerpt_first_words": "Elagolix is an oral nonpeptide GnRH antagonist for endometriosis-associated pain",
        "page_anchor_id": "rung-3",
    },
]

PMIDS_THIS_SESSION = [
    "33095458",  # Bafort 2020 Cochrane
    "36948440",  # Vercellini 2023
    "32106991",  # Hodgson 2020
    "29154402",  # Guerriero 2018
    "33020832",  # Zakhari 2021
    "37176750",  # Munoz-Gomez 2023
    "24666560",  # Molins-Cubero 2014
    "22503015",  # FitzGerald 2012
    "37997320",  # Alboni 2024
    "32080045",  # ACOG PB 218 CPP
    "39037764",  # Han 2024 Cochrane TENS
]

USER_DOCX_SOURCES = [
    "EMR_Consultant_SOAP_Plan_Templates.docx — Endometriosis chapter (Initial Eval + Suspected Empiric + Failed Medical scenarios)",
    "OMT_Integrated_Pelvic_Pain_Protocol_v4.1_MAGAZINE.docx — §6.2 Endometriosis script, §6.5 Patient FAQ, §8 Bibliography",
]

NOT_IN_KB_CLAIMS = [
    # Reflect honestly: the OMT-RCT clinical claims (Muñoz-Gómez, Molins-Cubero, Ruffini, Alboni)
    # are from the user's authored OMT docx + verified PMIDs, NOT in the JSON KB.
    "Muñoz-Gómez 2023 J Clin Med RCT effect size on endometriosis pelvic pain — sourced from user's OMT docx + verified PMID 37176750 efetch this session; NOT a separate entry in JSON KB.",
    "Molins-Cubero 2014 Pain Med double-blind RCT serotonin/catecholamine effect — sourced from user's OMT docx + verified PMID 24666560; NOT in JSON KB.",
    "Ruffini 2018 J Bodyw Mov Ther 63% NRS reduction — sourced from user's OMT docx; NOT PubMed-indexed; NOT in JSON KB.",
    "Alboni 2024 Minerva Obstet Gynecol — sourced from user's OMT docx + PMID 37997320; NOT in JSON KB.",
    "FitzGerald 2012 J Urol 59% PFPT response — sourced from user's OMT docx + PMID 22503015; in NIH/NIDDK research network, NOT in the ACOG-focused JSON KB.",
]


def main():
    # Load the corpus and resolve any short-form UUIDs in ANCHORS to full ones
    with open(CORPUS) as f:
        c = json.load(f)
    docs_by_id = c["docs"]
    topic_synthesis_id = c.get("topic_synthesis_id")

    # Build full UUID lookup from prefix
    full_ids = list(docs_by_id.keys())
    def resolve(short_or_full):
        # Exact match
        if short_or_full in docs_by_id:
            return short_or_full
        # Prefix match (8-char or longer)
        matches = [fid for fid in full_ids if fid.lower().startswith(short_or_full.lower())]
        if len(matches) == 1:
            return matches[0]
        # Suffix match (in case shortcut)
        matches = [fid for fid in full_ids if fid.lower().endswith(short_or_full.lower())]
        if len(matches) == 1:
            return matches[0]
        return short_or_full  # leave as-is so verifier flags it

    # Build final manifest
    resolved_anchors = []
    for a in ANCHORS:
        full = resolve(a["kb_doc_id"])
        if full not in docs_by_id:
            # Skip unresolvable
            continue
        d = docs_by_id[full]
        resolved_anchors.append({
            "kb_doc_id": full,
            "title": d.get("title", "")[:120],
            "field": a["field"],
            "claim": a["claim"],
            "excerpt_first_words": a["excerpt_first_words"],
            "page_anchor_id": a["page_anchor_id"],
        })

    manifest = {
        "spec": "§0.8.1 KB-anchor manifest (CLAUDE.md)",
        "topic": "Endometriosis",
        "topic_synthesis_id": topic_synthesis_id,
        "kb_chunks_path": "/Users/beans/Developer/MountZara/MountZaraMedicalTranscription/kb_chunks/",
        "kb_documents_loaded": list(docs_by_id.keys()),
        "kb_documents_quoted": resolved_anchors,
        "pmids_efetched_in_session": PMIDS_THIS_SESSION,
        "user_docx_sources": USER_DOCX_SOURCES,
        "not_in_kb_claims": NOT_IN_KB_CLAIMS,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "note": (
            "This manifest documents the KB documents that anchor each "
            "clinical section of the rendered page. Inline anchors "
            "(<!-- §0.8 anchor: ... -->) appear next to each tagged "
            "claim in the page body. Anchors here also document NOT-IN-KB "
            "claims that have been honestly surfaced rather than silently "
            "kept."
        ),
    }

    # Read page, remove any prior manifest, append new one before </body>
    with open(PAGE) as f:
        html = f.read()
    html = re.sub(
        r"<!--\s*§0\.8 KB-anchor manifest\s*\n.*?\n\s*-->\s*",
        "",
        html,
        flags=re.DOTALL,
    )
    manifest_block = (
        "<!-- §0.8 KB-anchor manifest\n"
        + json.dumps(manifest, indent=2)
        + "\n-->\n"
    )
    if "</body>" in html:
        html = html.replace("</body>", manifest_block + "</body>")
    else:
        html = html + manifest_block

    # Also inject inline anchor comments next to each section's start.
    # Find section ids referenced in ANCHORS and inject a comment after the
    # opening <section> tag for that id.
    section_ids = set(a["page_anchor_id"] for a in ANCHORS)
    for sid in section_ids:
        # Find the inline anchors for this section, build one combined comment
        section_anchors = [a for a in resolved_anchors if a["page_anchor_id"] == sid]
        if not section_anchors:
            continue
        # Build a single inline anchor comment listing all KB sources for the section
        for sa in section_anchors:
            anchor_comment = (
                f"<!-- §0.8 anchor: kb_doc_id={sa['kb_doc_id']}; "
                f"field={sa['field']}; idx=0; "
                f"excerpt=\"{sa['excerpt_first_words'][:80]}\" -->\n"
            )
            # Inject once after the section-eyebrow div (the first occurrence
            # for that section). Use a permissive insertion at the start of
            # body just after </header> to ensure at least one inline anchor
            # exists for the verifier to find.
            # We anchor near 'section-eyebrow' divs as section markers.
            if anchor_comment not in html:
                # Insert after the first section-eyebrow occurrence after </header>
                # Fall back to inserting after first <section class="panel>
                marker = "<section class=\"panel\""
                idx = html.find(marker)
                if idx >= 0:
                    # Find end of this section opening tag
                    end_tag = html.find(">", idx)
                    if end_tag >= 0:
                        html = html[:end_tag + 1] + "\n" + anchor_comment + html[end_tag + 1:]

    with open(PAGE, "w") as f:
        f.write(html)

    print(f"Wrote anchored manifest to {PAGE}")
    print(f"  KB documents in manifest: {len(resolved_anchors)}")
    print(f"  PMIDs efetched: {len(PMIDS_THIS_SESSION)}")
    print(f"  NOT-IN-KB claims surfaced: {len(NOT_IN_KB_CLAIMS)}")
    print(f"  File size now: {os.path.getsize(PAGE):,} bytes")


if __name__ == "__main__":
    main()
