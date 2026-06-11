# -*- coding: utf-8 -*-
"""abstract_clean.py — strip PubMed citation boilerplate from a cite-card
abstract-block, leaving the verbatim abstract body. Formatting cleanup of
already-verbatim text (NOT content generation); used to mirror the abstract
into the deep-dive modal's 'Verbatim PubMed abstract' section."""
import re

# Structured-abstract section headers that reliably mark the start of the real
# abstract body (after the PubMed citation line, title, authors, affiliations).
_ABS_START = re.compile(
    r'\b(BACKGROUND|OBJECTIVES?|AIMS?|INTRODUCTION|PURPOSE|METHODS?|'
    r'MATERIALS AND METHODS|RESULTS|CASE REPORT|CLINICAL VIGNETTE|RATIONALE|'
    r'SIGNIFICANCE|CONTEXT|IMPORTANCE|HYPOTHESIS)\b')


def clean_abstract(raw: str) -> str:
    t = re.sub(r'<[^>]+>', ' ', raw)
    import html as _h
    t = _h.unescape(t)
    t = re.sub(r'^\s*ABSTRACT\s*', '', t, flags=re.IGNORECASE)
    # Preferred: jump to the first structured-abstract header, which sits after
    # all the citation/author/affiliation boilerplate.
    m = _ABS_START.search(t)
    if m and m.start() > 0:
        t = t[m.start():]
    else:
        # Unstructured abstract — strip the leading citation line + author block.
        t = re.sub(r'^\s*\d+\.\s+[^\n]*?doi:\s*\S+\s*', ' ', t, flags=re.IGNORECASE)
        t = re.sub(r'Author information:.*?(?=[A-Z][a-z]{2,}\s)', ' ', t, flags=re.DOTALL)
    # Drop trailing PMID/DOI/copyright/collection footers.
    t = re.sub(r'(?:Copyright|©|PMID:|DOI:|\bdoi:|eCollection).*$', ' ',
               t, flags=re.IGNORECASE | re.DOTALL)
    # Remove embedded affiliation sentences: "(2)Department of …, Country."
    t = re.sub(r'\(\d+\)[^.]*?(?:Department|Division|Faculty|University|Hospital|Institute|College)[^.]*\.',
               ' ', t)
    # Remove dangling numeric affiliation markers "(2), (4), (4)."
    t = re.sub(r'(?:\(\d+\),?\s*){2,}\.?', ' ', t)
    # Remove dangling author bylines "Huda AU(1), Minhas MR(2)."
    t = re.sub(r'\b[A-Z][a-z]+\s+[A-Z]{1,3}\(\d+\)(?:,\s*[A-Z][a-z]+\s+[A-Z]{1,3}\(\d+\))*\.?', ' ', t)
    t = re.sub(r'\s+', ' ', t).strip()
    return t
