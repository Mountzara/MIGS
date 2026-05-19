#!/usr/bin/env python3
"""
Apply citation corrections to a patient-education page.

Reads:
  - cite_audit/verified_pmids.json    (535 NCBI-verified, KB-canonical PMIDs)
  - cite_audit/per_page_kb_pmid_pools.json  (per-slug PMID candidate pools, 18-139 each)
  - cite_audit/page_anchors.json      (per-slug "anchor mapping": which PMID each existing
                                       inline ref-N <sup> citation should point to, plus
                                       per-page relevance keywords for the comprehensive
                                       references list)

Writes:
  - education/<slug>/index.html       (in place; original backed up to .pre-cite-rebuild.html)

Behavior:
  1. Load the page HTML.
  2. For each `<sup class="mz-ref" data-r="ref-N" ...><a href="#ref-N">[N]</a><span
     class="mz-ref-pop">OLD LABEL · PMID OLDPMID</span></sup>` — rewrite the tooltip text
     and the page-prose-side hint to the verified PMID's actual label.
  3. Backup the existing `<ol class="ref-list">...</ol>` block, then rebuild it with:
       a) the N anchor entries (ref-1..ref-N) in the user-curated order
       b) PLUS every other PMID in the per-page pool that passes the relevance filter,
          appended as ref-(N+1)..ref-M, sorted by year descending then by first-author
     Each entry uses the verbatim PubMed efetch metadata: title, authors, journal, year,
     volume/issue/pages, DOI, and the verbatim structured abstract.
  4. Write the result back.

Run:
  python3 scripts/cite_audit_apply.py <slug>          # apply to one page
  python3 scripts/cite_audit_apply.py --all           # apply to every configured page
  python3 scripts/cite_audit_apply.py <slug> --dry    # dry-run (writes to /tmp/<slug>_preview.html)

Constraints (§0.6, §0.8.1, §3.6, §3.7):
  - Every PMID in output came from an NCBI efetch in the verification session.
  - Every abstract is verbatim from that efetch response.
  - Every PMID is sourced from clinical_knowledge.json (the §0.8 KB).
  - Original HTML backed up before rewrite, so any per-page review can roll back trivially.
"""
import argparse
import html
import json
import os
import re
import shutil
import sys
from datetime import datetime, timezone

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CITE_DIR = os.path.join(REPO_ROOT, "cite_audit")
EDU_DIR = os.path.join(REPO_ROOT, "education")
PORTAL_DIR = os.path.join(REPO_ROOT, "portal", "education")

VERIFIED_FILE = os.path.join(CITE_DIR, "verified_pmids.json")
POOLS_FILE = os.path.join(CITE_DIR, "per_page_kb_pmid_pools.json")
ANCHORS_FILE = os.path.join(CITE_DIR, "page_anchors.json")


# ---------- Loading -----------------------------------------------------------

def load_json(path):
    with open(path) as f:
        return json.load(f)


# ---------- Reference rendering -----------------------------------------------

def first_author_surname(authors):
    """Get a proper surname for the citation label.

    PubMed esummary "name" field is typically "LastName Initials" (e.g. "Munro MG",
    "van Dongen H"). Take everything up to the last whitespace-separated token (which is
    initials) — preserves multi-word surnames like "van Dongen", "Bofill Rodriguez".
    """
    if not authors:
        return "?"
    name = authors[0].strip()
    # If the name has at least two whitespace-separated parts and the last looks like initials,
    # drop the initials.
    parts = name.split()
    if len(parts) >= 2 and re.fullmatch(r"[A-Z]+", parts[-1]):
        return " ".join(parts[:-1])
    return name


def format_label(meta):
    """Render: 'Surname et al., <full title>, <em>Journal</em> YYYY'."""
    surname = first_author_surname(meta.get("authors", []))
    title = (meta.get("title") or "").rstrip(".")
    journal = meta.get("journal") or ""
    year = meta.get("year") or ""
    et_al = " et al." if len(meta.get("authors", []) or []) > 1 else ""
    pieces = [f"{surname}{et_al}"]
    if title:
        pieces.append(title)
    if journal:
        pieces.append(f"<em>{journal}</em>")
    if year:
        pieces[-1] = pieces[-1] + f" {year}" if pieces else year
    return ", ".join(pieces)


def format_label_plain(meta):
    """Plain-text version for the inline tooltip <span class='mz-ref-pop'> body."""
    surname = first_author_surname(meta.get("authors", []))
    title = (meta.get("title") or "").rstrip(".")
    journal = meta.get("journal") or ""
    year = meta.get("year") or ""
    et_al = " et al." if len(meta.get("authors", []) or []) > 1 else ""
    short_title = title if len(title) <= 70 else title[:67] + "..."
    parts = [f"{surname}{et_al}"]
    if short_title:
        parts.append(short_title)
    if journal:
        parts.append(f"{journal} {year}".strip())
    elif year:
        parts.append(year)
    return ", ".join(parts)


def render_abstract(meta):
    """HTML-escape the verbatim efetch abstract and preserve paragraph breaks as <br><br>."""
    text = meta.get("abstract") or ""
    if not text:
        return ""
    esc = html.escape(text)
    esc = esc.replace("\n\n", "<br><br>").replace("\n", " ")
    return esc


def render_li(ref_id, pmid, meta, claim_summary):
    label = format_label(meta)
    abs_html = render_abstract(meta)
    lines = [f'<li id="{ref_id}">']
    lines.append(f'<div class="ref-label"><strong>{label}</strong></div>')
    if claim_summary:
        lines.append(f'<div class="ref-what">{claim_summary}</div>')
    lines.append(
        f'<div class="ref-meta">PMID&nbsp;'
        f'<a href="https://pubmed.ncbi.nlm.nih.gov/{pmid}/" target="_blank" rel="noopener">'
        f'{pmid}</a></div>'
    )
    if abs_html:
        lines.append(
            f'<details class="abstract-toggle"><summary>Read the abstract</summary>'
            f'<div class="abstract-body">{abs_html}</div></details>'
        )
    lines.append("</li>")
    return "\n".join(lines)


# ---------- Relevance filter --------------------------------------------------

def is_relevant(meta, keywords):
    """Returns True if the paper's title or MeSH terms intersect the per-page keywords.

    Keywords are lowercase substrings or regex-friendly tokens. Match is case-insensitive
    against title + journal + MeSH terms concatenated.
    """
    haystack = " ".join([
        (meta.get("title") or ""),
        (meta.get("journal") or ""),
        " ".join(meta.get("mesh_terms", []) or []),
    ]).lower()
    return any(kw.lower() in haystack for kw in keywords)


# ---------- Per-page rewrite --------------------------------------------------

REFLIST_RE = re.compile(
    r'<ol class="(ref-list|refs-list)">.*?</ol>',
    re.DOTALL,
)

# Match a single inline citation tooltip: capture group 2 = ref-N. The tooltip body
# (group 4) is whatever sits inside <span class="mz-ref-pop">; some pages put a PMID
# string in it (AUB style), others use "Author Year · Journal · claim" (endo/CPP style).
INLINE_REF_RE = re.compile(
    r'(<sup class="mz-ref" data-r="(ref-\d+)"[^>]*>'   # opening sup
    r'<a href="#\2">\[(\d+)\]</a>'                     # [N]
    r'<span class="mz-ref-pop"[^>]*>)'                 # opening span
    r'([^<]+)'                                          # tooltip body
    r'(</span></sup>)',                                # closing
    re.DOTALL,
)


def rebuild_page(slug, page_html, anchors_for_slug, pool, verified):
    """Return (new_html, summary_dict)."""
    summary = {
        "slug": slug,
        "anchor_count": len(anchors_for_slug["anchors"]),
        "appended_count": 0,
        "tooltip_swaps": 0,
        "missing_anchors": [],
        "skipped_no_abstract": [],
        "skipped_off_topic": [],
    }

    # 1. Build the new <ol class="ref-list"> block
    anchor_pmids = []
    new_lis = []
    for entry in anchors_for_slug["anchors"]:
        ref_id = entry["ref_id"]
        pmid = entry["pmid"]
        claim = entry.get("claim", "")
        meta = verified.get(pmid)
        if not meta:
            summary["missing_anchors"].append((ref_id, pmid))
            continue
        new_lis.append(render_li(ref_id, pmid, meta, claim))
        anchor_pmids.append(pmid)

    # 2. Append all OTHER verified PMIDs in the per-page pool that pass the relevance filter
    keywords = anchors_for_slug.get("keywords", [])
    pool_pmids = [p["pmid"] for p in pool]
    next_ref_n = len(anchor_pmids) + 1
    appended = []
    for pmid in pool_pmids:
        if pmid in anchor_pmids:
            continue
        meta = verified.get(pmid)
        if not meta:
            continue
        if not meta.get("abstract"):
            summary["skipped_no_abstract"].append(pmid)
            continue
        if keywords and not is_relevant(meta, keywords):
            summary["skipped_off_topic"].append(pmid)
            continue
        appended.append((pmid, meta))

    # Sort appended by year DESC, then by first-author surname ASC
    def sort_key(item):
        pmid, m = item
        try:
            y = int(m.get("year") or "0")
        except ValueError:
            y = 0
        return (-y, first_author_surname(m.get("authors", [])))

    appended.sort(key=sort_key)
    for pmid, meta in appended:
        ref_id = f"ref-{next_ref_n}"
        # Auto-generate a short "what" line from the title — no claim_summary for tail refs
        new_lis.append(render_li(ref_id, pmid, meta, ""))
        next_ref_n += 1
    summary["appended_count"] = len(appended)

    m_existing = REFLIST_RE.search(page_html)
    if not m_existing:
        raise RuntimeError(f"Could not find <ol class=\"(ref-list|refs-list)\"> in {slug}")
    # Preserve the page's original ol class so existing CSS hooks keep working
    existing_class = m_existing.group(1)
    new_block = f'<ol class="{existing_class}">\n' + "\n".join(new_lis) + "\n</ol>"
    new_html = REFLIST_RE.sub(new_block, page_html, count=1)

    # 3. Update inline <sup class="mz-ref" data-r="ref-N"> tooltip texts
    # Build a lookup: ref-N → new tooltip plain text
    anchor_lookup = {}
    for entry in anchors_for_slug["anchors"]:
        ref_id = entry["ref_id"]
        pmid = entry["pmid"]
        meta = verified.get(pmid)
        if not meta:
            continue
        anchor_lookup[ref_id] = f"{format_label_plain(meta)} &middot; PMID {pmid}"

    def replace_tooltip(m):
        opening = m.group(1)
        ref_id = m.group(2)
        closing = m.group(5)
        new_tooltip = anchor_lookup.get(ref_id)
        if new_tooltip is None:
            return m.group(0)  # no change for refs we don't have an anchor for
        summary["tooltip_swaps"] += 1
        return f"{opening}{new_tooltip}{closing}"

    new_html = INLINE_REF_RE.sub(replace_tooltip, new_html)

    # 4. Update the §0.8 manifest comment's pmids_efetched_in_session list (so the
    # in-document audit trail matches what's actually cited on the page now).
    final_pmids = anchor_pmids + [pmid for pmid, _ in appended]
    manifest_re = re.compile(
        r'("pmids_efetched_in_session":\s*\[)([^\]]*)(\])',
        re.DOTALL,
    )
    if manifest_re.search(new_html):
        pmids_block = ",\n    ".join(f'"{p}"' for p in final_pmids)
        new_html = manifest_re.sub(
            lambda m: f'{m.group(1)}\n    {pmids_block}\n  {m.group(3)}',
            new_html,
            count=1,
        )
        summary["manifest_pmids_updated"] = len(final_pmids)

    return new_html, summary


def process(slug, dry=False, mirror_to_portal=True):
    verified = load_json(VERIFIED_FILE)
    pools = load_json(POOLS_FILE)
    anchors = load_json(ANCHORS_FILE)

    if slug not in anchors:
        print(f"❌ no anchor mapping for slug '{slug}' in {ANCHORS_FILE}")
        sys.exit(1)
    if not anchors[slug].get("anchors"):
        print(f"⚠️  '{slug}' has empty anchors array — skipping (rebuild would break inline tooltip→list link)")
        print(f"   Add anchor PMID mappings to cite_audit/page_anchors.json before running.")
        sys.exit(0)
    pool = pools.get(slug, [])
    if not pool:
        print(f"⚠️  no PMID pool for '{slug}' in {POOLS_FILE}")

    page_path = os.path.join(EDU_DIR, slug, "index.html")
    if not os.path.exists(page_path):
        print(f"❌ page not found: {page_path}")
        sys.exit(1)
    with open(page_path) as f:
        page_html = f.read()

    new_html, summary = rebuild_page(slug, page_html, anchors[slug], pool, verified)

    if dry:
        out = f"/tmp/{slug}_preview.html"
        with open(out, "w") as f:
            f.write(new_html)
        print(f"DRY: wrote preview → {out}")
    else:
        # Backup once per session
        backup_path = page_path + ".pre-cite-rebuild.html"
        if not os.path.exists(backup_path):
            shutil.copy2(page_path, backup_path)
            print(f"  backed up original → {backup_path}")
        with open(page_path, "w") as f:
            f.write(new_html)
        print(f"  wrote: {page_path}")

        if mirror_to_portal:
            portal_path = os.path.join(PORTAL_DIR, slug, "index.html")
            if os.path.exists(portal_path):
                with open(portal_path, "w") as f:
                    f.write(new_html)
                print(f"  mirrored → {portal_path}")

    print()
    print(f"  anchors applied: {summary['anchor_count']}")
    print(f"  tail PMIDs appended: {summary['appended_count']}")
    print(f"  inline tooltip swaps: {summary['tooltip_swaps']}")
    if summary["missing_anchors"]:
        print(f"  ⚠️  missing anchor PMIDs (not in verified set):")
        for r, p in summary["missing_anchors"]:
            print(f"      {r}: PMID {p}")
    if summary["skipped_no_abstract"]:
        print(f"  skipped (no abstract): {len(summary['skipped_no_abstract'])} PMIDs")
    if summary["skipped_off_topic"]:
        print(f"  skipped (off-topic per keyword filter): {len(summary['skipped_off_topic'])} PMIDs")

    return summary


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("slug", nargs="?")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--no-mirror", action="store_true")
    args = ap.parse_args()

    if args.all:
        anchors = load_json(ANCHORS_FILE)
        for slug in sorted(anchors.keys()):
            print(f"=== {slug} ===")
            process(slug, dry=args.dry, mirror_to_portal=not args.no_mirror)
            print()
    elif args.slug:
        process(args.slug, dry=args.dry, mirror_to_portal=not args.no_mirror)
    else:
        ap.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
