# -*- coding: utf-8 -*-
"""
purge_w23_offtopic.py — remove the 3 off-topic preclinical nanomedicine /
phototherapy bench papers the digest pipeline pulled into the (draft)
blog-2026-W23. Same contamination class the §1.2b OFFTOPIC_DENY list was
built for: phototherm / nanoparticle / nanomedicine / gas-vesicle papers
that name a gyn organ in passing but are bench physics/materials science,
not clinical CBG/MIGS content.

W23 uses the NEWER post template (different from W20/W21):
  - cards  : <article class="paper-card"> … openDeepDive('dd-<PMID>') … </article>
  - modals : <dialog class="mz-jc-modal deepdive-modal" id="dd-<PMID>"> … </dialog>
  - no <li id="ref-N"> bibliography; PMID lives in the openDeepDive() trigger
  - topic counts: <h2>Topic</h2><div class="subspecialty"> · N papers</div>
  - headline   : "… covers 108 peer-reviewed papers across 9 clinical topic areas"
  - §0.8 manifest: two-comment form (label comment + JSON data comment)

The 3 purged PMIDs:
  42177906  "Lesion-centric reprogramming: hydrogel-enabled photothermal
             reset of endometriosis pain" (hydrogel/photothermal bench) —
             appears as TWO cards (Endometriosis + Chronic Pelvic Pain buckets)
  42199653  "Multimodal Nanobubbles Carrying Indocyanine Green and VCAM-1
             Targeting Peptide for Molecular Imaging" (nanobubble imaging agent)
  42183916  "Coupled optical-thermal-chemical modeling of pulsed 808-nm ICG
             phototherapy using Monte Carlo photon transport" (physics modeling)

MECHANICAL structural removal only. No inline prose <sup> citations or
read-across references point to these PMIDs (verified), so no narrative
rewrite is needed. Surviving mentions are allowed ONLY inside the §0.8
manifest comment (immutable provenance/fetch-log audit record, hidden,
non-reader-facing). Every removal is verified.

Reads  /tmp/w23_live.json  (fetched fresh from R2)
Writes /tmp/w23_purged.json (only if all integrity checks pass)
"""
import json, re, sys

PURGE = ['42177906', '42199653', '42183916']
assert len(PURGE) == 3

d = json.load(open('/tmp/w23_live.json'))
html = d['body_html']
orig_len = len(html)

def count(pat, s=None):
    return len(re.findall(pat, s if s is not None else html))

before = {
    'cards': count(r'<article class="paper-card">'),
    'modals': count(r'<dialog class="mz-jc-modal deepdive-modal"'),
    'triggers': count(r"openDeepDive\('dd-"),
}

# --- 1) remove paper-card <article> blocks whose openDeepDive targets a PURGE pmid ---
def drop_blocks(html, open_re, close_tok, pmids):
    pat = re.compile(open_re + r'.*?' + re.escape(close_tok), re.DOTALL)
    removed = 0
    def repl(mo):
        nonlocal removed
        if any(p in mo.group(0) for p in pmids):
            removed += 1
            return ''
        return mo.group(0)
    return pat.sub(repl, html), removed

html, n_cards = drop_blocks(html, r'<article class="paper-card">', '</article>', PURGE)
html, n_modals = drop_blocks(html, r'<dialog class="mz-jc-modal deepdive-modal" id="dd-\d+"[^>]*>', '</dialog>', PURGE)

# --- 2) fix per-topic counts (42177906 sits in TWO buckets; both ICG papers in one) ---
topic_fixes = [
    ('<h2>Endometriosis</h2><div class="subspecialty"> · 16 papers</div>',
     '<h2>Endometriosis</h2><div class="subspecialty"> · 15 papers</div>'),
    ('<h2>ICG Fluorescence in Gynecologic Surgery</h2><div class="subspecialty"> · 9 papers</div>',
     '<h2>ICG Fluorescence in Gynecologic Surgery</h2><div class="subspecialty"> · 7 papers</div>'),
    ('<h2>Chronic Pelvic Pain</h2><div class="subspecialty"> · 4 papers</div>',
     '<h2>Chronic Pelvic Pain</h2><div class="subspecialty"> · 3 papers</div>'),
]
n_topic = 0
for old, new in topic_fixes:
    html, k = re.subn(re.escape(old), new, html)
    n_topic += k

# --- 3) fix the headline total (108 -> 104 cards) ---
html, n_head = re.subn(r'108 peer-reviewed papers across 9 clinical topic areas',
                       '104 peer-reviewed papers across 9 clinical topic areas', html)

# --- 4) verification ---
after = {
    'cards': count(r'<article class="paper-card">', html),
    'modals': count(r'<dialog class="mz-jc-modal deepdive-modal"', html),
    'triggers': count(r"openDeepDive\('dd-", html),
}
errs = []
if n_cards != 4: errs.append(f"removed {n_cards} cards (want 4: 42177906 x2 + 2 others)")
if n_modals != 3: errs.append(f"removed {n_modals} modals (want 3)")
if n_topic != 3: errs.append(f"topic-count fixes applied {n_topic} (want 3)")
if n_head != 1: errs.append(f"headline replaced {n_head}x (want 1)")
if after['cards'] != before['cards'] - 4: errs.append("card count mismatch")
if after['modals'] != before['modals'] - 3: errs.append("modal count mismatch")

# orphan openDeepDive / dd- balance (every trigger must still have a dialog)
triggers = set(re.findall(r"openDeepDive\('(dd-\d+)'", html))
dialogs  = set(re.findall(r'<dialog class="mz-jc-modal deepdive-modal" id="(dd-\d+)"', html))
orphan_triggers = triggers - dialogs
if orphan_triggers: errs.append(f"orphan triggers: {orphan_triggers}")
# (orphan dialogs are allowed: a modal with no card trigger would be dead, but
#  here we removed cards AND their modals together, so check both directions)
orphan_dialogs = dialogs - triggers
if orphan_dialogs: errs.append(f"orphan dialogs: {orphan_dialogs}")

# purged pmids must survive ONLY inside the §0.8 KB-anchor manifest (two-comment
# form: label comment + JSON data comment). They must be gone from displayed body.
mani = re.search(r'<!--\s*§0\.8 KB-anchor manifest\s*-->\s*<!--.*?-->', html, re.DOTALL)
if not mani:
    errs.append("could not locate two-comment KB-anchor manifest")
    displayed = html
else:
    displayed = html[:mani.start()] + html[mani.end():]
for p in PURGE:
    if p in displayed:
        errs.append(f"PURGED pmid {p} still in displayed content")

# tag balance for the structural tags we touched
for tag in ['article', 'dialog']:
    o = len(re.findall(rf'<{tag}[ >]', html)); c = len(re.findall(rf'</{tag}>', html))
    if o != c:
        errs.append(f"<{tag}> balance {o} open / {c} close")

print("=== counts before -> after ===")
for k in before: print(f"  {k}: {before[k]} -> {after[k]}")
print(f"removed: cards={n_cards} modals={n_modals} topic_fixes={n_topic} headline={n_head}")
print(f"body length: {orig_len} -> {len(html)} (delta {len(html)-orig_len})")

if errs:
    print("\n!!! INTEGRITY ERRORS — NOT WRITING OUTPUT:")
    for e in errs: print("   -", e)
    sys.exit(1)

d['body_html'] = html
json.dump(d, open('/tmp/w23_purged.json', 'w'), ensure_ascii=False, indent=2)
print("\nALL CHECKS PASSED -> wrote /tmp/w23_purged.json")
