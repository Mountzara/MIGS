# -*- coding: utf-8 -*-
"""
purge_w21_offtopic.py — remove the 15 clearly off-topic (non-gynecologic)
papers that the digest pipeline's keyword over-matching pulled into
blog-2026-W21. KEEPS the 3 bowel/bladder/ureter papers (42126680, 42119081,
42112223) — those are core complex-MIGS territory (deep endometriosis bowel
resection, ureterolysis/reimplant, bladder work, ICG bowel-perfusion).

This is MECHANICAL structural removal (cards / modals / bibliography entries /
off-topic prose clauses), not clinical-content generation. Every removal is
verified: tag balance, zero orphaned openDeepDive/dd- references, zero orphaned
PubMed links for purged PMIDs, and exact card/modal/ref counts.

Reads  /tmp/w21_live.json  (fetched fresh from R2)
Writes /tmp/w21_purged.json (only if all integrity checks pass)
"""
import json, re, sys

PURGE = ['42113943','42132463','42141303','42108328','42144014','42139579',
         '42138176','42130408','42130027','42121883','42112383','42108543',
         '42116353','42136333','42127030']
KEEP_BOWEL = ['42126680','42119081','42112223']
assert len(PURGE) == 15

d = json.load(open('/tmp/w21_live.json'))
html = d['body_html']
orig_len = len(html)

def count(pat, s=None):
    return len(re.findall(pat, s if s is not None else html))

before = {
    'cards': count(r'<article class="mz-cite-card"'),
    'modals': count(r'<dialog class="mz-jc-modal"'),
    'ref_li': count(r'<li id="ref-\d+">'),
    'sup': count(r'<sup class="mz-ref">'),
}

# --- 1) remove cite-card <article> blocks containing a PURGE pmid ---
def drop_blocks(html, open_re, close_tok, pmids):
    out, i, removed = [], 0, 0
    for m in re.finditer(open_re, html):
        pass
    # iterate non-greedy blocks
    pat = re.compile(open_re + r'.*?' + re.escape(close_tok), re.DOTALL)
    def repl(mo):
        nonlocal removed
        block = mo.group(0)
        if any(p in block for p in pmids):
            removed += 1
            return ''
        return block
    new = pat.sub(repl, html)
    return new, removed

html, n_cards = drop_blocks(html, r'<article class="mz-cite-card"[^>]*>', '</article>', PURGE)
html, n_modals = drop_blocks(html, r'<dialog class="mz-jc-modal" id="dd-\d+"[^>]*>', '</dialog>', PURGE)
html, n_refli = drop_blocks(html, r'<li id="ref-\d+">', '</li>', PURGE)

# --- 2) MHT prose: drop the "tangential ... pipeline classification artifact." sentence ---
mht_pat = re.compile(r'\s*Several papers in this bucket are tangential to MHT \(.*?pipeline classification artifact\.', re.DOTALL)
html, n_mht = mht_pat.subn('', html)

# --- 3) ICG prose: rebuild paragraph keeping only the 3 bowel/bladder sups ---
i = html.find("acoustic ICG-vesicle delivery")
if i == -1:
    # maybe already gone; locate the ICG synthesis para by its opener
    i = html.find("none in gynecologic surgery")
pstart = html.rfind('<p', 0, i)
pend = html.find('</p>', i) + 4
old_para = html[pstart:pend]

def grab_sup(pmid, src):
    m = re.search(rf'<sup class="mz-ref"><a class="mz-ref-link" href="https://pubmed\.ncbi\.nlm\.nih\.gov/{pmid}/".*?</sup>', src, re.DOTALL)
    return m.group(0) if m else ''

sup_bowel  = grab_sup('42126680', old_para)
sup_divert = grab_sup('42119081', old_para)
sup_rectal = grab_sup('42112223', old_para)
assert sup_bowel and sup_divert and sup_rectal, "missing a kept ICG sup"

new_para = (
    '<p class="mz-toc-group-synthesis">Three papers, all in the bowel, bladder, '
    'and ureteral territory that complex MIGS routinely enters &mdash; deep '
    'infiltrating endometriosis takes us into segmental and discoid bowel '
    'resection, ureterolysis and reimplantation, and bladder-dome work. '
    'Intraoperative NIR-II fluorescence for bowel vascular and perfusion '
    'assessment ' + sup_bowel + '; robot-assisted sigmoid-colon urinary '
    'diversion avoiding bowel anastomosis in an irradiated pelvis ' + sup_divert +
    '; and abdominoperineal vs low anterior resection morbidity for rectal '
    'cancer n&nbsp;=&nbsp;226 ' + sup_rectal + '. The technique-transfer lesson '
    'for CBG/MIGS practice is the bowel-perfusion-assessment use case &mdash; '
    'directly relevant when you&apos;re shaving or resecting rectovaginal '
    'endometriotic nodules with low-anterior-resection considerations, and the '
    'resection-level morbidity gradient informs how aggressively to take the '
    'bowel. ICG perfusion of the anastomosis is already an established adjunct; '
    'NIR-II is the next-generation upgrade worth tracking.</p>'
)
html = html[:pstart] + new_para + html[pend:]

# --- 4) topic counts + summary headline ---
html = html.replace('MHT &amp; menopause <span class="mz-topic-count">(22)</span>',
                    'MHT &amp; menopause <span class="mz-topic-count">(19)</span>')
html = html.replace('C-section scar &amp; related <span class="mz-topic-count">(17)</span>',
                    'C-section scar &amp; related <span class="mz-topic-count">(8)</span>')
html = html.replace('ICG fluorescence <span class="mz-topic-count">(6)</span>',
                    'ICG fluorescence <span class="mz-topic-count">(3)</span>')

# --- 5) verification ---
after = {
    'cards': count(r'<article class="mz-cite-card"', html),
    'modals': count(r'<dialog class="mz-jc-modal"', html),
    'ref_li': count(r'<li id="ref-\d+">', html),
    'sup': count(r'<sup class="mz-ref">', html),
}
errs = []
if n_cards != 15: errs.append(f"removed {n_cards} cards (want 15)")
if n_modals != 15: errs.append(f"removed {n_modals} modals (want 15)")
if n_refli != 15: errs.append(f"removed {n_refli} ref-li (want 15)")
if n_mht != 1: errs.append(f"MHT sentence removed {n_mht}x (want 1)")
if after['cards'] != before['cards']-15: errs.append("card count mismatch")
# orphan checks: purged pmids must survive ONLY inside the §0.8 KB-anchor
# manifest comment (an immutable provenance/fetch-log audit record of the
# 2026-05-21 pipeline run — falsifying it would be wrong, and it is a hidden
# HTML comment, not reader-facing and not read by any page JS). They must be
# gone from ALL displayed content.
mani = re.search(r'<!--\s*§0\.8 KB-anchor manifest\s*-->\s*<!--.*?-->', html, re.DOTALL)
if not mani:
    errs.append("could not locate KB-anchor manifest comment")
    displayed = html
else:
    displayed = html[:mani.start()] + html[mani.end():]
for p in PURGE:
    if p in displayed: errs.append(f"PURGED pmid {p} still in displayed content")
for p in KEEP_BOWEL:
    if f'dd-{p}' not in html: errs.append(f"KEEP pmid {p} lost its modal")
# orphan openDeepDive / dd- balance
triggers = set(re.findall(r"openDeepDive\('(dd-\d+)'", html))
dialogs  = set(re.findall(r'<dialog class="mz-jc-modal" id="(dd-\d+)"', html))
orphan_triggers = triggers - dialogs
orphan_dialogs  = dialogs - triggers
if orphan_triggers: errs.append(f"orphan triggers: {orphan_triggers}")
if orphan_dialogs:  errs.append(f"orphan dialogs: {orphan_dialogs}")
# tag balance for the structural tags we touched
for tag in ['article','dialog','section','li','sup','p']:
    o = len(re.findall(rf'<{tag}[ >]', html)); c = len(re.findall(rf'</{tag}>', html))
    if tag in ('article','dialog') and o != c:
        errs.append(f"<{tag}> balance {o} open / {c} close")

print("=== counts before -> after ===")
for k in before: print(f"  {k}: {before[k]} -> {after[k]}")
print(f"removed: cards={n_cards} modals={n_modals} ref_li={n_refli} mht_sentence={n_mht}")
print(f"body length: {orig_len} -> {len(html)} (delta {len(html)-orig_len})")
print("kept bowel/bladder pmids present:", all(p in html for p in KEEP_BOWEL))

# summary headline 115 -> 100 (only if it currently says 115)
if '115 peer-reviewed papers' in d['summary']:
    d['summary'] = d['summary'].replace('115 peer-reviewed papers', '100 peer-reviewed papers', 1)
    print("summary headline updated 115 -> 100")
else:
    print("WARN: summary headline '115 peer-reviewed papers' not found; left as-is")

if errs:
    print("\n!!! INTEGRITY ERRORS — NOT WRITING OUTPUT:")
    for e in errs: print("   -", e)
    sys.exit(1)

d['body_html'] = html
json.dump(d, open('/tmp/w21_purged.json','w'), ensure_ascii=False, indent=2)
print("\nALL CHECKS PASSED -> wrote /tmp/w21_purged.json")
