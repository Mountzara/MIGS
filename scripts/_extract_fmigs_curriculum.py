#!/usr/bin/env python3
"""Extract FMIGS Curriculum 2024 V3 .doc to structured JSON.

The textutil HTML output uses CSS classes (p35/p36/p37 = large fonts =
chapter / section / subsection headings; p12-p15 are sub-headings with
color #1f3763 = section labels) rather than semantic <h1>..<h6>.

This script reads the HTML, classifies each paragraph by its CSS class
into {chapter, section, subsection, body, list, link, table}, and emits
a structured JSON outline. Output goes to
docs/curriculum/data/fmigs-cbg-migs.json.

Run on the operator's Mac (uses the local source .doc):
    python3 scripts/_extract_fmigs_curriculum.py
"""
import json
import re
import sys
import unicodedata
from pathlib import Path
from html import unescape

REPO = Path("/Users/beans/Developer/MountZara/MIGS")
SOURCE_DOC = REPO / "docs" / "curriculum" / "sources" / "fmigs-curriculum-2024-v3.doc"
HTML_DUMP = Path("/tmp/_mz_fmigs.html")
OUT_JSON = REPO / "docs" / "curriculum" / "data" / "fmigs-cbg-migs.json"

# Heading classification per CSS class observed in the textutil HTML.
# p35 ~ 36px = title; p36/p37 ~ 18px color #262626 = chapter heading;
# p12-p15 ~ Times 12px color #1f3763 (dark Word blue) = section sub-heads;
# p1, p2, p7, etc. = body paragraphs; p10/p17/p25/p30 = bulleted/indented.
HEADING_CLASSES = {
    "p35": "title",      # 36px
    "p36": "chapter",    # 18px color #262626
    "p37": "chapter",
    "p12": "section",    # color #1f3763, indented
    "p13": "section",
    "p14": "section",
    "p15": "section",
    "p29": "section",
    "p18": "section",
    "p19": "section",
    "p31": "section",
}
LIST_CLASSES = {"p10", "p17", "p25", "p28", "p30", "p32"}

TAG_RE = re.compile(r"<[^>]+>")
CLASS_RE = re.compile(r'class="([^"]+)"')
WHITESPACE_RE = re.compile(r"\s+")


def strip_html(s: str) -> str:
    """Strip tags, decode entities, collapse whitespace."""
    s = TAG_RE.sub("", s)
    s = unescape(s)
    s = WHITESPACE_RE.sub(" ", s).strip()
    return s


def classify(cls: str) -> str:
    if cls in HEADING_CLASSES:
        return HEADING_CLASSES[cls]
    if cls in LIST_CLASSES:
        return "list_item"
    return "body"


def is_toc_entry(text: str) -> bool:
    # TOC entries either include "PAGEREF" leftovers or look like
    # numbered TOC lines with right-aligned page numbers (after we
    # collapsed whitespace the page number sits at the end as a bare int).
    if "PAGEREF" in text or "_Toc" in text:
        return True
    # "1. Abstract	12" pattern after whitespace collapse looks like
    # "1. Abstract 12" — distinguish from a real chapter heading "1.
    # Abstract" by requiring trailing-int on a TOC.
    return False


def main():
    if not HTML_DUMP.exists():
        sys.exit(f"missing {HTML_DUMP} — run `textutil -convert html -stdout` first")
    html = HTML_DUMP.read_text(encoding="utf-8", errors="ignore")

    # Pull every <p class="pN">...</p> block in order.
    block_re = re.compile(r'<p\s+class="(p\d+)"[^>]*>(.*?)</p>', re.S)

    paragraphs = []
    for m in block_re.finditer(html):
        cls = m.group(1)
        raw = m.group(2)
        text = strip_html(raw)
        if not text:
            continue
        paragraphs.append({"cls": cls, "kind": classify(cls), "text": text})

    # The first ~460 paragraphs are TOC entries — they have hyperlink-
    # style anchors that survive as visible text like "Chapter Name 12".
    # The body begins at "1. Abstract" appearing WITHOUT a trailing page
    # number — find the SECOND occurrence (TOC's first, body's second).
    abstract_idx = [
        i for i, p in enumerate(paragraphs)
        if p["text"].startswith("1. Abstract")
    ]
    body_start = abstract_idx[1] if len(abstract_idx) >= 2 else 0

    body = paragraphs[body_start:]

    # Now group into chapters → sections → blocks.
    outline = {
        "source_doc": "FMIGS Curriculum 2024 V3 7-24-25.doc",
        "source_path_in_repo": "docs/curriculum/sources/fmigs-curriculum-2024-v3.doc",
        "title": "Fellowship in Minimally Invasive Gynecologic Surgery (FMIGS) — Curriculum and Instructional Design",
        "version": "v3 (2025-07-24)",
        "author": "Christopher Z. Mabini, DO, MSAEd — Inaugural MIGS Fellow",
        "institution": "PRIME Illinois St. Francis Hospital, Evanston, IL",
        "chapters": [],
    }

    current_chapter = None
    current_section = None
    chapter_re = re.compile(r"^(\d+)\.\s+(.+)$")
    # Real chapters are sequentially numbered 1..N (top-level). A pattern
    # match where the number RESETS to 1 mid-document or jumps backward is
    # an inline numbered list item, NOT a chapter — reject it.
    expected_next_chapter = 1

    for p in body:
        text = p["text"]
        if is_toc_entry(text):
            continue

        # Skip pattern-match lines that end in a colon — those are sub-
        # headings (e.g. "1. Patient Care:") not chapter titles.
        m_ch = chapter_re.match(text)
        looks_like_chapter = (
            bool(m_ch)
            and len(text) < 110
            and not text.rstrip().endswith(":")
        )

        if looks_like_chapter:
            n = int(m_ch.group(1))
            # Strict sequential enforcement — chapter numbers monotonically
            # increase by 1 (or stay the same in the extremely rare case of
            # an "Appendix 24" re-iteration). Anything else is an inline
            # list item that happens to start with "N. ".
            if n == expected_next_chapter or (n == expected_next_chapter + 1):
                current_chapter = {
                    "number": n,
                    "title": m_ch.group(2).strip(),
                    "sections": [],
                }
                outline["chapters"].append(current_chapter)
                current_section = None
                expected_next_chapter = n + 1
                continue
            # Otherwise: fall through and treat as a body list item.

        # Section heading: short text in a heading class.
        if p["kind"] in ("section", "chapter") and len(text) < 110 and current_chapter:
            current_section = {
                "heading": text,
                "blocks": [],
            }
            current_chapter["sections"].append(current_section)
            continue

        # Body / list item under current section (or create an implicit
        # "Overview" section if a chapter has body text before any section).
        if current_chapter and not current_section:
            current_section = {"heading": "Overview", "blocks": []}
            current_chapter["sections"].append(current_section)

        if current_section:
            kind = "list_item" if p["kind"] == "list_item" else "paragraph"
            current_section["blocks"].append({"kind": kind, "text": text})

    # Stats
    total_chapters = len(outline["chapters"])
    total_sections = sum(len(c["sections"]) for c in outline["chapters"])
    total_blocks = sum(
        len(s["blocks"]) for c in outline["chapters"] for s in c["sections"]
    )
    outline["stats"] = {
        "chapters": total_chapters,
        "sections": total_sections,
        "blocks": total_blocks,
    }

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(outline, indent=2, ensure_ascii=False))
    print(f"wrote {OUT_JSON}")
    print(f"  chapters: {total_chapters}  sections: {total_sections}  blocks: {total_blocks}")
    print()
    print("chapter index:")
    for c in outline["chapters"]:
        print(f"  {c['number']:>2}. {c['title']}  ({len(c['sections'])} sections, {sum(len(s['blocks']) for s in c['sections'])} blocks)")


if __name__ == "__main__":
    main()
