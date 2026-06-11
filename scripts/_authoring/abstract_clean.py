# -*- coding: utf-8 -*-
"""abstract_clean.py — strip PubMed citation boilerplate from a cite-card
abstract-block, leaving the verbatim abstract body. Formatting cleanup of
already-verbatim text (NOT content generation); used to mirror the abstract
into the deep-dive modal's 'Verbatim PubMed abstract' section."""
import re

def clean_abstract(raw: str) -> str:
    t = re.sub(r'<[^>]+>', ' ', raw)
    import html as _h
    t = _h.unescape(t)
    t = re.sub(r'^\s*ABSTRACT\s*', '', t, flags=re.IGNORECASE)
    # Drop a leading PubMed citation header block:
    #   "1. J Coll Physicians Surg Pak. 2026 Jun;36(6):779-788. doi: 10...."
    t = re.sub(r'^\s*\d+\.\s+[^\n]*?doi:\s*\S+\s*', ' ', t, flags=re.IGNORECASE)
    # Drop "Author information:" ... up to the first real sentence/structured head.
    t = re.sub(r'Author information:.*?(?=(?:[A-Z]{3,}:|BACKGROUND|OBJECTIVE|AIM|INTRODUCTION|PURPOSE|METHODS|RESULTS|[A-Z][a-z]+\s))',
               ' ', t, flags=re.DOTALL)
    # Drop trailing PMID/DOI/copyright footers.
    t = re.sub(r'(?:Copyright|©|PMID:|DOI:|\bdoi:).*$', ' ', t, flags=re.IGNORECASE | re.DOTALL)
    # Drop a dangling author byline like "Huda AU(1), Minhas MR(2)."
    t = re.sub(r'\b[A-Z][a-z]+\s+[A-Z]{1,3}\(\d+\)(?:,\s*[A-Z][a-z]+\s+[A-Z]{1,3}\(\d+\))*\.?', ' ', t)
    t = re.sub(r'\s+', ' ', t).strip()
    return t
