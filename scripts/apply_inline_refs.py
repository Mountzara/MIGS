#!/usr/bin/env python3
"""
apply_inline_refs.py — restore the canonical inline-reference style to posts.

2026-08-12. The owner reported: "the Trending and Evidence pages - the
writeups and briefs also lost the STANDARD INLINE REFERENCES STYLE AND
FORMATTING AND REQUIREMENTS". Measured: blog-2026-W21 carries 216 inline
<sup class="mz-ref"> citations; the 8 evidence briefs and the 3 newest
roundups carried ZERO, with sources relegated to cite cards at the bottom.

This applies verified claim->PMID mappings (produced and adversarially
checked by the post-inline-refs workflow) as canonical sup refs. It builds
each popover from THE POST'S OWN cite card for that PMID — title, journal,
year, and the clinical finding — so nothing is invented and every inline
ref resolves to a source the post already cites.

Markup is byte-identical in shape to the W21 reference implementation:

  <sup class="mz-ref"><a class="mz-ref-link" href="https://pubmed.ncbi.nlm.nih.gov/<pmid>/"
   target="_blank" rel="noopener noreferrer" aria-describedby="ref-pop-<pmid>">
   <pmid></a><span class="mz-ref-pop" id="ref-pop-<pmid>" role="tooltip">
   <span class="mz-ref-pop-title">…</span><span class="mz-ref-pop-meta">…</span>
   <span class="mz-ref-pop-finding">…</span></span></sup>

Safety rules enforced here (a mapping that violates any of them is SKIPPED
and reported, never force-applied):
  * the anchor must occur EXACTLY ONCE in body_html
  * the insertion point must not land inside an HTML tag
  * the anchor must not sit inside <details>, an <article class="mz-cite-card">,
    a <dialog>, or a <style>/<script> block (abstracts and cards are verbatim
    source text — they must never be annotated)
  * the PMID must already appear in the post body
  * a PMID already cited inline within 400 chars is not repeated

Usage:
  scripts/apply_inline_refs.py --mappings <json> --posts-dir <dir> --out <dir>
  scripts/apply_inline_refs.py ... --report-only
"""
import argparse
import json
import os
import re
import sys

SUP = (
    '<sup class="mz-ref"><a class="mz-ref-link" '
    'href="https://pubmed.ncbi.nlm.nih.gov/{pmid}/" target="_blank" '
    'rel="noopener noreferrer" aria-describedby="ref-pop-{pmid}">{pmid}</a>'
    '<span class="mz-ref-pop" id="ref-pop-{pmid}" role="tooltip">'
    '<span class="mz-ref-pop-title">{title}</span>'
    '<span class="mz-ref-pop-meta">{meta}</span>'
    '{finding}</span></sup>'
)
FINDING = '<span class="mz-ref-pop-finding">{0}</span>'

# Two card schemas coexist in the corpus and BOTH must be indexed:
#   roundups  <article class="mz-cite-card" id="mz-cite-<PMID>"> with an
#             <h3 class="mz-cite-title"> and <p class="mz-cite-fits">
#   briefs    <article class="mz-cite-card" id="mz-ref-<N>">   with a
#             <p class="mz-cite-title"> and <p class="mz-cite-finding">, the
#             PMID carried only by the card's pubmed link
# Keying off the id alone silently indexed zero cards for all 8 evidence
# briefs, so the PMID is resolved from the card body instead.
CARD_RE = re.compile(r'<article class="mz-cite-card".*?</article>', re.S)
PMID_IN_CARD = re.compile(r'pubmed\.ncbi\.nlm\.nih\.gov/(\d+)')
TITLE_RE = re.compile(r'<(?:h3|p) class="mz-cite-title">(.*?)</(?:h3|p)>', re.S)
META_RE = re.compile(r'<p class="mz-cite-meta">(.*?)</p>', re.S)
FITS_RE = re.compile(r'<p class="mz-cite-(?:fits|finding)">(.*?)</p>', re.S)


def strip_tags(s):
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', s)).strip()


# A popover summary must be a plain-language finding, never a verbatim
# structured-abstract dump — auditPublishable() rejects the latter outright
# ("the citation summary is a raw abstract dump"). Three W20 popovers tripped
# this on the first pass. When the extracted text looks like an abstract, emit
# NO finding line at all (the span is optional) rather than a bad one.
ABSTRACT_LEAD = re.compile(
    r'^\s*(BACKGROUND|AIM|AIMS|OBJECTIVE|OBJECTIVES|METHODS|METHOD|RESULTS|'
    r'CONCLUSION|CONCLUSIONS|INTRODUCTION|PURPOSE|IMPORTANCE|DESIGN|SETTING|'
    r'PARTICIPANTS|STUDY DESIGN|MATERIALS AND METHODS|MAIN RESULTS|'
    r'SEARCH STRATEGY|SELECTION CRITERIA|DATA COLLECTION)\b[:\s]', re.I)


def is_abstract_dump(txt):
    return bool(ABSTRACT_LEAD.match(txt or ''))


def card_index(body):
    """pmid -> {title, meta, finding} taken from the post's own cite cards."""
    out = {}
    for m in CARD_RE.finditer(body):
        blob = m.group(0)
        idm = re.search(r'id="mz-cite-(\d+)"', blob)
        pm = PMID_IN_CARD.search(blob)
        pmid = idm.group(1) if idm else (pm.group(1) if pm else None)
        if not pmid:
            continue
        t = TITLE_RE.search(blob)
        mt = META_RE.search(blob)
        f = FITS_RE.search(blob)
        finding = ''
        if f:
            txt = strip_tags(f.group(1))
            # the fits paragraph leads with a "DO + CBG/MIGS lens — Frame: …:"
            # preamble; the clinical finding is what follows the last colon of
            # that preamble. Keep the whole string when there is no preamble.
            # roundups lead with "DO + CBG/MIGS lens — Frame: …:"; briefs lead
            # with "Read through the lens of the claim:". Strip either preamble.
            if txt.startswith('Read through the lens'):
                txt = txt.split(':', 1)[-1].strip()
            elif ' lens' in txt and ':' in txt:
                txt = txt.split(':', 2)[-1].strip()
            finding = '' if is_abstract_dump(txt) else txt
        out[pmid] = {
            'title': strip_tags(t.group(1)) if t else '',
            'meta': strip_tags(mt.group(1)) if mt else '',
            'finding': finding,
        }
    # THIRD schema: a plain bibliography list. Several briefs cite papers only
    # in <ol class="mz-references-list"> as
    #   <li>TITLE. JOURNAL. YEAR. [PMID: <a ...>PMID</a>]</li>
    # with no cite card at all. Those PMIDs are legitimately cited by the post,
    # so index them too (title + journal/year; no clinical-finding line, which
    # the popover treats as optional). Cards win when both exist.
    reflists = ''.join(m.group(0) for m in
                       re.finditer(r'<ol class="mz-references-list".*?</ol>', body, re.S))
    for li in re.finditer(r'<li>(.*?)</li>', reflists, re.S):
        blob = li.group(1)
        pm = PMID_IN_CARD.search(blob)
        if not pm:
            continue
        pmid = pm.group(1)
        if pmid in out and out[pmid].get('title'):
            continue
        txt = strip_tags(re.sub(r'\[PMID:.*?\]', '', blob)).strip()
        parts = [x.strip() for x in txt.split('.') if x.strip()]
        if not parts:
            continue
        title = parts[0] + ('.' if not parts[0].endswith('.') else '')
        meta = ' · '.join(parts[1:3]) if len(parts) > 1 else ''
        out[pmid] = {'title': title, 'meta': meta, 'finding': ''}
    return out


# Regions whose text is verbatim source material and must never be annotated.
FORBIDDEN = [
    (re.compile(r'<details\b', re.I), re.compile(r'</details>', re.I)),
    (re.compile(r'<article class="mz-cite-card"', re.I), re.compile(r'</article>', re.I)),
    (re.compile(r'<dialog\b', re.I), re.compile(r'</dialog>', re.I)),
    (re.compile(r'<style\b', re.I), re.compile(r'</style>', re.I)),
    (re.compile(r'<script\b', re.I), re.compile(r'</script>', re.I)),
    (re.compile(r'<ol class="mz-references-list"', re.I), re.compile(r'</ol>', re.I)),
]


def forbidden_spans(body):
    spans = []
    for op, cl in FORBIDDEN:
        pos = 0
        while True:
            o = op.search(body, pos)
            if not o:
                break
            c = cl.search(body, o.end())
            end = c.end() if c else len(body)
            spans.append((o.start(), end))
            pos = end
    return spans


def in_span(idx, spans):
    return any(a <= idx < b for a, b in spans)


def inside_tag(body, idx):
    lt = body.rfind('<', 0, idx)
    gt = body.rfind('>', 0, idx)
    return lt > gt


def apply_post(body, mappings, report):
    cards = card_index(body)
    spans = forbidden_spans(body)
    applied = 0
    # Apply from the END backwards so earlier offsets stay valid.
    resolved = []
    for mp in mappings:
        anchor, pmid = mp.get('anchor', ''), str(mp.get('pmid', '')).strip()
        if not anchor or not pmid:
            report.append(('skip', pmid, 'empty anchor/pmid'))
            continue
        n = body.count(anchor)
        if n != 1:
            report.append(('skip', pmid, f'anchor occurs {n}x'))
            continue
        if pmid not in body:
            report.append(('skip', pmid, 'pmid not present in post'))
            continue
        idx = body.index(anchor) + len(anchor)
        if in_span(idx, spans):
            report.append(('skip', pmid, 'anchor inside abstract/card/dialog'))
            continue
        if inside_tag(body, idx):
            report.append(('skip', pmid, 'insertion point inside a tag'))
            continue
        near = body[max(0, idx - 400):idx + 400]
        if f'ref-pop-{pmid}' in near:
            report.append(('skip', pmid, 'already cited inline nearby'))
            continue
        meta = cards.get(pmid)
        if not meta or not meta['title']:
            report.append(('skip', pmid, 'no cite card metadata in this post'))
            continue
        resolved.append((idx, pmid, meta))

    for idx, pmid, meta in sorted(resolved, key=lambda x: -x[0]):
        sup = SUP.format(
            pmid=pmid,
            title=meta['title'],
            meta=meta['meta'],
            finding=(FINDING.format(meta['finding'])
                     if meta['finding'] and not is_abstract_dump(meta['finding']) else ''),
        )
        body = body[:idx] + sup + body[idx:]
        applied += 1
    return body, applied


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--mappings', required=True)
    ap.add_argument('--posts-dir', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--report-only', action='store_true')
    a = ap.parse_args()

    data = json.load(open(a.mappings))
    os.makedirs(a.out, exist_ok=True)
    grand = skipped = 0
    for entry in data:
        pid = entry['post']
        src = os.path.join(a.posts_dir, pid + '.json')
        if not os.path.isfile(src):
            print(f'  !! {pid}: post json missing')
            continue
        doc = json.load(open(src))
        key = 'body_html' if 'body_html' in doc else ('body' if 'body' in doc else None)
        if key is None:
            print(f'  !! {pid}: no body field')
            continue
        before = doc[key]
        report = []
        after, applied = apply_post(before, entry.get('approved') or [], report)
        grand += applied
        skipped += len(report)
        print(f'  {pid[:54]:56s} applied={applied:3d} skipped={len(report):2d} '
              f'refs {before.count(chr(34) + "mz-ref" + chr(34))}->{after.count(chr(34) + "mz-ref" + chr(34))}')
        for kind, pmid, why in report:
            print(f'      - {pmid}: {why}')
        if not a.report_only:
            doc[key] = after
            json.dump(doc, open(os.path.join(a.out, pid + '.json'), 'w'), ensure_ascii=False)
    print(f'TOTAL applied={grand} skipped={skipped}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
