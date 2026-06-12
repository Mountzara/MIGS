# Upstream Fixes — recurring digest-pipeline issues and where they're really cured

This session surfaced a cluster of issues that **kept recurring** because they
originate in the `MountZaraResearchDigest` pipeline (on the Mac,
`/Users/beans/Developer/MountZara/MountZaraResearchDigest/`), which is **not in
this repo**. Each is logged below with: the symptom, the root cause, the
**in-repo enforcement now deployed** (the boundary fixes that stop the issue
reaching a published post regardless of pipeline behavior), and the **real
upstream fix** the pipeline needs so the problem stops being generated at all.

The two enforceable choke points in THIS repo are:
- **Ingestion** — `functions/api/posts/[[path]].js` `POST /api/posts` (every
  pipeline draft passes through here) and `PUT` (edits).
- **Pre-publish gate** — `scripts/audit_live_post.py` (the always-run audit).

---

## §1 — Off-topic papers passing the relevance gate (contamination blindspot)

**Symptom.** W20 shipped with an ophthalmology paper; W21 with dermatology; the
§1.2b gate still reported "all cards on-topic." In W23/W24, 15 and 3 non-gyn
papers (scar biology, neurosurgery, ophthalmology, veterinary) passed unflagged.

**Root cause.** The pipeline writes a per-topic **`<div class="lens-callout">`
"DO + CBG/MIGS lens" framing** into *every* card in a topic group — text that
name-drops gyn terms ("Every cesarean scar reorganizes…", "mediators
traditional gynecology rarely measure…"). The §1.2b gate scanned the whole card,
so that framing satisfied the subspecialty anchors on papers that have nothing
gynecologic in their *own* metadata. The gate was reading the pipeline's
editorializing, not the paper.

**In-repo enforcement (DEPLOYED).** `offtopic_cards()` now strips the
`lens-callout` block (and the legacy `mz-cite-fits` label) and checks anchors in
the paper's **own** title/citation/abstract only. Result: 0 false positives on
the genuinely-gyn W20/W21, and it now correctly flags every non-gyn-by-own-
metadata card for human review (W23: 15, W24: 3). It stays a **halt-for-human
tripwire**, not an auto-prune — because a flagged paper may be genuine
contamination *or* a deliberate cross-disciplinary mechanism / technology-
transfer inclusion (the W23/W24 model), and only a human knows which.

**Real upstream fix (Mac pipeline).** The gate can't tell intentional from
accidental because the pipeline applies the *same* generic lens framing to both.
Fix in two parts:
1. **Classifier:** require a gynecologic/pelvic anchor in the paper's own
   title/abstract/MeSH before auto-assigning it to a topic bucket. Papers
   lacking one must not be silently bucketed.
2. **Tag deliberate cross-disciplinary inclusions** with an explicit marker
   (e.g. a card attribute `data-inclusion="tech-transfer|mechanism"` and a
   pipeline field). Then the gate (and reviewers) pass *tagged* cross-
   disciplinary papers and any *untagged* non-gyn card stands out as true
   contamination. This is the only way to make "is this contamination?"
   machine-decidable.

---

## §2 — Incomplete `pmids_cited` manifest (§0.8.2)

**Symptom.** W23 listed 8 PMIDs in `pmids_cited`, W24 listed 9 — against 95 and
40 papers actually journal-clubbed. The §0.8 manifest was technically present
but did not reflect the real citation set.

**Root cause.** The pipeline populates `pmids_cited` with only the **featured
paper per topic group** (≈one per topic), not every cited PMID. The full set
lived only in the rendered deep-dive modals (`id="dd-<PMID>"`).

**In-repo enforcement (DEPLOYED).** Ingestion now **auto-backfills** the
manifest: `backfillManifest()` extracts the full cited set from the body's
`dd-<PMID>` modal ids and expands `pmids_cited` to it on both `POST` (new draft)
and `PUT` (edit). It only ever expands (never shrinks to empty), so non-cite-
card surfaces are untouched. Every future draft now lands with a complete
manifest, zero pipeline changes required. (The two existing drafts were
backfilled manually this session: W23→95, W24→37.)

**Real upstream fix (Mac pipeline).** The manifest builder should write the full
deduplicated cited-PMID set into `pmids_cited`, not just the featured picks —
keep a separate `featured_pmids` field if the per-topic highlight is wanted.

---

## §3 — Cross-week duplicate papers (no rolling dedup)

**Symptom.** Three papers (42219838, 42219828, 42219343) were journal-clubbed in
**both** W23 and W24.

**Root cause.** The pipeline dedups within a week but has **no ledger of PMIDs
cited in prior weeks**, so a paper indexed in two consecutive runs is published
twice.

**In-repo enforcement (DEPLOYED).** `audit_live_post.py` (in `--list`/multi-post
mode) now runs a **§0.8.3 cross-post duplicate-citation check**: any PMID whose
deep-dive appears in more than one post fails the audit with the offending post
ids listed, so duplicates are caught before they accumulate. (W24's 3 duplicates
were removed this session; cross-post check now clean.)

**Real upstream fix (Mac pipeline).** Maintain a **rolling cited-PMID ledger**
(persisted across runs) and exclude any PMID already published in a recent
window (e.g. last 8 weeks) from the next digest's candidate pool.

---

## §4 — Empty "Verbatim PubMed abstract" modal sections (§3.7 mirror)

**Symptom.** W23/W24 modals shipped with the abstract section reading "Pending
Dr. Mabini's review" even though the verbatim abstract was present in the card.

**Root cause.** The pipeline renders the abstract into the cite **card** but
does not mirror it into the modal's §3.7 "Verbatim PubMed abstract" section,
leaving it as a pending placeholder.

**In-repo enforcement.** The §3.7 abstract section is a verbatim copy, not
clinical authorship, so it is safe to mirror mechanically. `apply_authored.py` +
`abstract_clean.py` now mirror the card abstract into the modal section during
authoring. This is a *fix-time* tool, not an ingestion auto-step (kept manual so
it never silently rewrites content).

**Real upstream fix (Mac pipeline).** The modal renderer should fill the §3.7
abstract section from the same verbatim PubMed text it puts in the card — there
is no reason that section ships empty.

---

## §5 — PubMed boilerplate inside card abstracts

**Symptom.** Card abstracts carried citation-header noise ("1. J Coll Physicians
Surg Pak. 2026…doi:…"), author lists, and affiliation blocks before the actual
abstract body.

**Root cause.** The pipeline stores the raw efetch text without stripping the
PubMed citation/author/affiliation preamble.

**In-repo enforcement.** `abstract_clean.py` anchors on the first structured
section header (BACKGROUND/OBJECTIVE/METHODS/RESULTS/…) and strips affiliation
fragments when mirroring abstracts.

**Real upstream fix (Mac pipeline).** Strip the PubMed citation/author/
affiliation preamble at efetch-parse time so the stored abstract is the body
only.

---

## §6 — `#MIGS` hashtag trips §1.2 canonical-naming in social drafts

**Symptom.** `linkedin_draft`/`instagram_draft` contain `#CBGMIGS #MIGS …`; the
bare `#MIGS` trips the §1.2 "no bare MIGS" gate.

**Root cause.** The pipeline's social-copy generator emits both hashtags.

**Decision (operator).** `#MIGS` and `#CBGMIGS` are BOTH acceptable as
discoverability hashtags — this is marketing copy, not prose, so the §1.2
canonical-naming rule does not really apply to hashtags. No fix required; the
gate's §1.2 check already scopes to `body_html`/prose, not the social-draft
fields, so this does not block publication.

**Real upstream fix (optional, Mac pipeline).** If a clean gate run is wanted,
have the social generator emit `#CBGMIGS` plus a non-colliding tag.

---

## §7 — Some records arrive with no abstract in the source feed

**Symptom.** 3 W23 PMIDs (42199797, 42181183, 42213691) had no abstract in the
ingested feed.

**Root cause.** The pipeline's efetch/sidecar occasionally yields an empty
abstract (record type, retraction, or fetch miss) but still includes the paper.

**In-repo enforcement.** When authoring, a missing abstract is filled with an
explicit "abstract not captured in the source feed" note — never a machine-
generated summary — so the gap is visible, not silently papered over.

**Real upstream fix (Mac pipeline).** Flag records with empty abstracts at
ingestion (drop, or mark `abstract_missing: true`) so they're handled
deliberately rather than shipped as silent blanks.

---

## §8 — Deep-dive §3.9 clinical sections ship empty ("Pending review")

**Symptom.** Every new Monday-Mornings post ships with the 8 clinical judgment
sections (bottom-line, clinical-question, PICO, findings, strengths,
applicability, equity, prompts) unfilled — the entire reason this authoring
effort exists.

**Root cause / boundary.** This is BY DESIGN per CLAUDE.md §3.9 — clinical
content must be clinician-authored, never machine-generated. The pipeline
correctly leaves them pending. The recurring *pain* is that there was no tool to
apply accepted authored content at scale.

**In-repo enforcement (DEPLOYED).** `apply_authored.py` is the mechanical
APPLY tool: it splices clinician-accepted §3.9 text into the pending sections
across all three card templates, dry-run by default, with full integrity checks,
and never generates content. `DEEP_DIVE_AUTHORING_PLAN.md` documents the
author→review→apply→audit workflow.

**Real upstream fix.** None at the pipeline — §3.9 forbids it. The cure is the
authoring workflow + apply tool, now in place.

---

## Summary

| # | Issue | In-repo enforcement (deployed) | Mac-pipeline root fix |
|---|-------|--------------------------------|-----------------------|
| 1 | Contamination passes gate | §1.2b strips lens-callout, checks own metadata | gyn-anchor classifier + tag intentional cross-disc. |
| 2 | Incomplete `pmids_cited` | ingestion auto-backfills full set | write full cited set in manifest |
| 3 | Cross-week duplicates | §0.8.3 cross-post audit check | rolling cited-PMID ledger |
| 4 | Empty abstract sections | abstract-mirror tool | renderer fills §3.7 from card text |
| 5 | Abstract boilerplate | `abstract_clean.py` | strip preamble at efetch-parse |
| 6 | `#MIGS` hashtag | n/a — both hashtags accepted | optional social-copy tweak |
| 7 | Missing abstracts | explicit "not captured" note | flag empty-abstract records |
| 8 | Empty §3.9 sections | `apply_authored.py` + workflow | none (§3.9 by design) |
