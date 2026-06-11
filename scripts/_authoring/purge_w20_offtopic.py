# -*- coding: utf-8 -*-
"""
purge_w20_offtopic.py — remove the 12 clearly off-topic (non-gynecologic)
papers the digest pipeline's keyword over-matching pulled into
blog-2026-W20. Same contamination pattern as W21: bare "scar" matched
dermatology keloids/hypertrophic scars, "ICG"/fluorescence matched
imaging-physics + pediatric-oncology surveys, "hormone"/"testosterone"
matched men's-health and RA-nursing papers.

UNLIKE W21, every one of W20's 12 flagged papers was individually
assessed and found genuinely off-topic — none has a complex-MIGS
bowel/bladder/ureter surgical-technique angle (the ATRA paper is skin
hypertrophic scar; the FGS paper is a peds-onc caregiver-attitude
survey; the ICG paper is Monte-Carlo tissue-phantom imaging physics).
So there is no KEEP set here.

This is MECHANICAL structural removal (cards / modals / bibliography
entries), not clinical-content generation. W20 has no inline <sup>
citations, no #ref-N anchors, and no per-group synthesis paragraphs
referencing the flagged papers, so removal is self-contained. Every
removal is verified: tag balance, zero orphaned openDeepDive/dd-
references, exact card/modal/ref counts, and zero residual displayed
mentions of the purged PMIDs.

Reads  /tmp/w20_live.json  (fetched fresh from R2)
Writes /tmp/w20_purged.json (only if all integrity checks pass)
"""
import json, re, sys

# 12 individually-assessed off-topic PMIDs:
#   42116353 RA action-research nursing program (HT confound)
#   42108328 total hip arthroplasty + testosterone replacement (ortho/men's)
#   42089747 testosterone & depression narrative review (men's/psych)
#   42113943 pinhole pupilloplasty, scarred cornea (ophthalmology)
#   42112383 mechanical forces & immunity in keloid formation (derm)
#   42108543 betamethasone vs triamcinolone for hypertrophic scars (derm)
#   42098529 photodynamic therapy of pathological scars (derm)
#   42095960 ferroptosis in keloid pathogenesis (derm)
#   42088054 ATRA reverses myofibroblast activation, hypertrophic scar (derm)
#   42087414 polynucleotide injections for scar prevention (derm/plastics)
#   42090012 caregiver perceptions of FGS in pediatric oncology (peds-onc survey)
#   42088026 ICG imaging sensitivity limit vs tissue autofluorescence (optics physics)
PURGE = ['42116353','42108328','42089747','42113943','42112383','42108543',
         '42098529','42095960','42088054','42087414','42090012','42088026']
assert len(PURGE) == 12

d = json.load(open('/tmp/w20_live.json'))
html = d['body_html']
orig_len = len(html)

def count(pat, s=None):
    return len(re.findall(pat, s if s is not None else html))

before = {
    'cards': count(r'<article[^>]*class="[^"]*mz-cite-card'),
    'modals': count(r'<dialog class="mz-jc-modal"'),
    'ref_li': count(r'<li id="ref-\d+">'),
    'sup': count(r'<sup class="mz-ref">'),
}

# --- 1) remove cite-card <article> blocks containing a PURGE pmid ---
def drop_blocks(html, open_re, close_tok, pmids):
    pat = re.compile(open_re + r'.*?' + re.escape(close_tok), re.DOTALL)
    removed = 0
    def repl(mo):
        nonlocal removed
        block = mo.group(0)
        if any(p in block for p in pmids):
            removed += 1
            return ''
        return block
    return pat.sub(repl, html), removed

html, n_cards = drop_blocks(html, r'<article[^>]*class="[^"]*mz-cite-card[^"]*"[^>]*>', '</article>', PURGE)
html, n_modals = drop_blocks(html, r'<dialog class="mz-jc-modal" id="dd-\d+"[^>]*>', '</dialog>', PURGE)
html, n_refli = drop_blocks(html, r'<li id="ref-\d+">', '</li>', PURGE)

# --- 2) read-across prose: 3 of the 12 are woven into the body narrative via
# inline <sup> citations (the other 9 lived only in cards/modals/refli/manifest).
# Excise each clause individually and rewrite the surrounding sentence to read
# cleanly. This is structural removal of off-topic prose, not clinical-content
# authoring. The kept colorectal (42112223) + urinary (42119081) ICG papers are
# the same bowel/bladder surgical-application papers retained in W21.
prose_errs = []

def sup_block(pmid, src):
    """Return the full <sup …PMID…>…</sup> block for an inline prose citation."""
    m = re.search(
        rf'<sup class="mz-ref"[^>]*data-ref="\d+"><a href="#mz-ref-{pmid}">.*?'
        rf'pubmed\.ncbi\.nlm\.nih\.gov/{pmid}/".*?</sup>',
        src, re.DOTALL)
    return m.group(0) if m else None

# 2a) Remove the testosterone→depression sentence (sup [21], PMID 42089747).
sup21 = sup_block('42089747', html)
if sup21:
    testo_sentence = (' Testosterone is being looked at as a depression-relevant '
                      'signal, not just a libido one' + sup21 + '.')
    if testo_sentence in html:
        html = html.replace(testo_sentence, '', 1)
    else:
        prose_errs.append("testosterone sentence exact-match failed")
else:
    prose_errs.append("could not locate sup block for 42089747")

# 2b) Rewrite the ICG sentence: keep colorectal + urinary, drop pediatric
# (42090012) and the bench imaging-physics paper (42088026).
sup_ped   = sup_block('42090012', html)   # ", and pediatric<sup>"
sup_bench = sup_block('42088026', html)   # " plus a bench paper …<sup>"
if sup_ped and sup_bench:
    ped_clause   = ', and pediatric' + sup_ped
    bench_clause = ', plus a bench paper quantifying its imaging sensitivity limits' + sup_bench
    if ped_clause in html and bench_clause in html:
        html = html.replace(ped_clause, '', 1)
        html = html.replace(bench_clause, '', 1)
        # Two-item list now reads "colorectal<sup>, urinary<sup>" → join with "and".
        if 'colorectal' + sup_block('42112223', html) + ', urinary' in html:
            html = html.replace(
                'colorectal' + sup_block('42112223', html) + ', urinary',
                'colorectal' + sup_block('42112223', html) + ' and urinary', 1)
        else:
            prose_errs.append("ICG list-join exact-match failed")
    else:
        prose_errs.append("ICG pediatric/bench clause exact-match failed")
else:
    prose_errs.append("could not locate sup blocks for 42090012 / 42088026")

# 2c) Renumber the surviving inline sups so display [N] + data-ref stay
# sequential after [21] was removed (22→21, 23→22, 24→23, 25→24).
RENUMBER = [('42109727', 22, 21), ('42095178', 23, 22),
            ('42112223', 24, 23), ('42119081', 25, 24)]
for pmid, old, new in RENUMBER:
    a = f'data-ref="{old}"><a href="#mz-ref-{pmid}">[{old}]</a>'
    b = f'data-ref="{new}"><a href="#mz-ref-{pmid}">[{new}]</a>'
    if a in html:
        html = html.replace(a, b, 1)
    else:
        prose_errs.append(f"renumber {pmid} {old}->{new} match failed")

# 2d) Rewrite the ICG synthesis paragraph (mz-toc-group-synthesis) — same
# pediatric + bench-physics papers appear here too in expository prose.
old_synth = (
    '<p class="mz-toc-group-synthesis">Four indocyanine-green fluorescence '
    'papers, all from adjacent surgical specialties — colorectal (abdominoperineal '
    'resection versus low anterior resection for rectal cancer), urinary '
    'reconstruction (robot-assisted sigmoid colon conduit for urinary diversion '
    'avoiding bowel anastomosis in a patient with prior loop colostomy and pelvic '
    'radiation), and pediatric oncology (caregivers\' perceptions of '
    'fluorescence-guided surgery in pediatric solid tumors) — plus a bench paper '
    'quantifying the sensitivity limits of ICG imaging in the presence of tissue '
    'autofluorescence. ICG is a tool that has earned its way across specialties. '
    'For gynecologic surgery, the relevance is direct: sentinel-lymph-node mapping '
    'for endometrial-cancer staging, vascular and lymphatic visualization in '
    'deep-infiltrating endometriosis dissection, ureteric tracing in radical cases, '
    'and confirming perfusion at the cuff. The bench-level sensitivity work matters '
    'because the practical resolution of what we can see with ICG is set by tissue '
    'autofluorescence, not by the dye itself — knowing that limit changes how we '
    'interpret a faint signal in the operating field. Tools cross specialties when '
    'they earn it; the ICG story is one of those quiet validations.</p>'
)
new_synth = (
    '<p class="mz-toc-group-synthesis">Two indocyanine-green fluorescence papers '
    'from adjacent surgical specialties — colorectal (abdominoperineal resection '
    'versus low anterior resection for rectal cancer) and urinary reconstruction '
    '(robot-assisted sigmoid colon conduit for urinary diversion avoiding bowel '
    'anastomosis in a patient with prior loop colostomy and pelvic radiation). ICG '
    'is a tool that has earned its way across specialties. For gynecologic surgery, '
    'the relevance is direct: sentinel-lymph-node mapping for endometrial-cancer '
    'staging, vascular and lymphatic visualization in deep-infiltrating '
    'endometriosis dissection, ureteric tracing in radical cases, and confirming '
    'perfusion at the cuff. Tools cross specialties when they earn it; the ICG '
    'story is one of those quiet validations.</p>'
)
if old_synth in html:
    html = html.replace(old_synth, new_synth, 1)
else:
    prose_errs.append("ICG synthesis paragraph exact-match failed")

# --- 3) count references in body intro + summary headline ---
# Body intro lede: "84 peer-reviewed papers across 11 topics" -> 72
html, n_intro = re.subn(r'\b84 peer-reviewed papers across 11 topics',
                        '72 peer-reviewed papers across 11 topics', html)

# --- 3) verification ---
after = {
    'cards': count(r'<article[^>]*class="[^"]*mz-cite-card', html),
    'modals': count(r'<dialog class="mz-jc-modal"', html),
    'ref_li': count(r'<li id="ref-\d+">', html),
    'sup': count(r'<sup class="mz-ref">', html),
}
errs = list(prose_errs)
if n_cards != 12: errs.append(f"removed {n_cards} cards (want 12)")
if n_modals != 12: errs.append(f"removed {n_modals} modals (want 12)")
if n_refli != 12: errs.append(f"removed {n_refli} ref-li (want 12)")
if n_intro != 1: errs.append(f"intro count line replaced {n_intro}x (want 1)")

# inline prose sups must remain sequential 1..N with no gaps/dupes after renumber
disp = sorted(int(x) for x in re.findall(r'<sup class="mz-ref"[^>]*data-ref="(\d+)"', html))
if disp != list(range(1, len(disp) + 1)):
    errs.append(f"inline sup data-ref not sequential 1..N: {disp}")
dref = re.findall(r'data-ref="(\d+)"><a href="#mz-ref-\d+">\[(\d+)\]', html)
mism = [(a, b) for a, b in dref if a != b]
if mism:
    errs.append(f"data-ref != display-[N] after renumber: {mism}")
if after['cards'] != before['cards']-12: errs.append("card count mismatch")
if after['modals'] != before['modals']-12: errs.append("modal count mismatch")

# orphan checks: purged pmids must survive ONLY inside the §0.8 KB-anchor
# manifest comment (immutable provenance/fetch-log audit record of the
# pipeline run — falsifying its efetched-PMID list would be wrong, and it is
# a hidden HTML comment, not reader-facing and not read by any page JS). They
# must be gone from ALL displayed content. Two on-disk manifest layouts exist:
#   W20: a single comment    "<!-- §0.8 KB-anchor manifest {JSON} -->"
#   W21: two adjacent comments "<!-- §0.8 KB-anchor manifest --><!-- {JSON} -->"
mani = re.search(r'<!--\s*§0\.8 KB-anchor manifest\s*-->\s*<!--.*?-->', html, re.DOTALL) \
    or re.search(r'<!--\s*§0\.8 KB-anchor manifest\b.*?-->', html, re.DOTALL)
if mani:
    displayed = html[:mani.start()] + html[mani.end():]
else:
    errs.append("could not locate KB-anchor manifest comment")
    displayed = html
for p in PURGE:
    if p in displayed:
        errs.append(f"PURGED pmid {p} still in displayed content")

# orphan openDeepDive / dd- balance
triggers = set(re.findall(r"openDeepDive\('(dd-\d+)'", html))
dialogs  = set(re.findall(r'<dialog class="mz-jc-modal" id="(dd-\d+)"', html))
orphan_triggers = triggers - dialogs
orphan_dialogs  = dialogs - triggers
if orphan_triggers: errs.append(f"orphan triggers: {orphan_triggers}")
if orphan_dialogs:  errs.append(f"orphan dialogs: {orphan_dialogs}")

# tag balance for structural tags we touched
for tag in ['article','dialog']:
    o = len(re.findall(rf'<{tag}[ >]', html)); c = len(re.findall(rf'</{tag}>', html))
    if o != c:
        errs.append(f"<{tag}> balance {o} open / {c} close")

print("=== counts before -> after ===")
for k in before: print(f"  {k}: {before[k]} -> {after[k]}")
print(f"removed: cards={n_cards} modals={n_modals} ref_li={n_refli} intro_line={n_intro}")
print(f"body length: {orig_len} -> {len(html)} (delta {len(html)-orig_len})")

# summary headline "Eighty peer-reviewed papers" -> "Sixty-eight"
if 'Eighty peer-reviewed papers' in d['summary']:
    d['summary'] = d['summary'].replace('Eighty peer-reviewed papers',
                                        'Sixty-eight peer-reviewed papers', 1)
    print("summary headline updated Eighty -> Sixty-eight")
else:
    print("WARN: summary headline 'Eighty peer-reviewed papers' not found; left as-is")

if errs:
    print("\n!!! INTEGRITY ERRORS — NOT WRITING OUTPUT:")
    for e in errs: print("   -", e)
    sys.exit(1)

d['body_html'] = html
json.dump(d, open('/tmp/w20_purged.json','w'), ensure_ascii=False, indent=2)
print("\nALL CHECKS PASSED -> wrote /tmp/w20_purged.json")
