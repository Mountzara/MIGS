# Deep-Dive Journal-Club Authoring — Plan

Status as of 2026-06-11. Scope: the per-PMID §3.9 deep-dive modals on the
CBG/MIGS Monday-Mornings posts (W20 live, W21 live, W23 draft, W24 draft).
This plan exists because the original task — "fill out the empty deep-dive
journal-club analysis sections" — is still unfinished, and the work splits
into two fundamentally different kinds that must not be conflated.

---

## 1. The §3.9 line (read first)

Each deep-dive modal has the 13/15 anchor sections. They divide cleanly:

| Section group | Sections | How it's filled | Scriptable? |
|---|---|---|---|
| **Auto from abstract (§3.7)** | `abstract`, `methods`, `findings`, `rob`, `strengths`, `applicability`, `kb`, `prompts`, `refs` | Rendered from the verbatim PubMed abstract + structural metadata | yes — already ~99% filled |
| **Clinician judgment (§3.9)** | `bottom` (surgeon's bottom line), `question`, `pico`, `equity`, `monday` (change/hold/counsel call) | A clinician reads the paper and writes the assessment | **NO — never regex/heuristic-generated** |

Two operations, and the distinction is the whole ballgame:

- **AUTHOR** = produce the clinician-judgment text. Per CLAUDE.md §3.9 this is
  clinician peer-review work (the Cowork workflow, schema `0017_deep_dive_authoring`).
  Claude may DRAFT candidate text by reading each abstract individually, but a
  Claude draft is **not** §3.9-authored until a clinician reviews/accepts it.
  Claude must never self-certify its own draft as authored, and never bulk-
  generate this text by pattern/script.
- **APPLY** = mechanically merge already-accepted authored text into the post's
  `body_html`, replacing the `mz-jc-pending` tags. This is structural string
  surgery (same class as the `purge_w2*_offtopic.py` scripts) — scriptable,
  with full integrity checks.

The mistake to avoid: treating "fill the pending sections" as one scriptable
job. The APPLY half is; the AUTHOR half is not.

---

## 2. Current state (measured, not assumed)

| Post | Status | Modals | Pending modals | Authored draft exists? | Applied to body? |
|---|---|---|---|---|---|
| blog-2026-W20 | **published** | 68 | 68 | none | n/a |
| blog-2026-W21 | **published** | 88 | 80 | yes — `w21_authored.py` (95 PMIDs) | **NO** |
| blog-2026-W23 | draft | 95 | 95 | none | n/a |
| blog-2026-W24 | draft | 40 | 40 | none | n/a |

Per-section pending counts (W21, representative): the load is concentrated in
exactly five sections — `bottom` (78), `question` (75), `pico` (75),
`equity` (78), `monday` (78). The other ten sections are ≥85/88 already filled
from the abstract. So "author a paper" ≈ write those five short blocks.

Two load-bearing facts:

1. **`w21_authored.py` is a WIP DRAFT, explicitly "NOT applied"** (commit
   895e046). It covers `bottom`/`monday`/`pico` for 95 PMIDs but **not**
   `equity` or `question`, and it has **not** been clinician-certified or
   merged into the live post. The live W21 still shows PENDING for all of it.
2. **No apply-tooling exists in this repo.** The schema-0017 pipeline
   (`prep_*_bundle.py` → Cowork → `apply_deep_dive_patch.py`) is referenced
   but not present here; it lives Mac-side / is unbuilt.

---

## 3. Risk-ordered priorities

1. **W20 — highest exposure.** Live, 68/68 modals pending, zero drafted. A
   published post where every deep-dive is empty is the worst public state.
2. **W21 — drafted-but-unapplied.** Live, 80 pending, but 95 PMIDs already
   have draft `bottom`/`monday`/`pico`. Closest to done *if* the draft is
   clinician-cleared and the missing `equity`/`question` are added.
3. **W23 / W24 — drafts.** 95 and 40 pending. These must **not** be published
   until authored (don't ship empty deep-dives). Lower urgency precisely
   because they're not public.

---

## 4. The plan

### Phase 0 — Build the APPLY tool (Claude can do this now, on-VM) ✅ DONE
`scripts/_authoring/apply_authored.py`: given an authored mapping (the
`w21_authored.py` shape) + a post's `body_html`, replace each pending section's
`mz-jc-pending` block with the authored markup, keyed by `dd-<PMID>-<section>`.
Handles the five judgment sections (`bottom`, `monday`, `pico` P/I/C/O,
`question`, `equity`); strips the section's pending class + the "PENDING REVIEW"
h3 badge. Integrity checks mirror the purge scripts:
- modal/section counts unchanged (edits in place, never adds/removes);
- tag balance preserved across section/p/dl/dt/dd/dialog;
- every applied (PMID, section) carries no pending tag afterward;
- **DRY-RUN by default** — prints a per-section diff and writes nothing; `--apply`
  writes a new JSON but still never uploads to R2 (deploy stays a separate,
  explicit, post-sign-off step).
This tool only ever *applies* accepted content — it generates nothing.

**Dry-run finding (2026-06-11):** running it against `w21_authored.py` applies
231 sections (bottom/monday/pico × 95 PMIDs minus the 3 purged off-topic ones,
correctly skipped) and leaves **zero pending content sections** — the only
residual `mz-jc-pending` strings are the CSS selectors in the `<style>` block.
So W21 is one clinician sign-off away from fully-authored on those three
sections. NOT applied — `w21_authored.py` is still an un-certified WIP draft.

### Phase 1 — W21 (drafted → done)
1. Clinician (Chris) reviews `w21_authored.py` as drafts and accepts/edits —
   this is the §3.9 gate. Without it, the draft is not authored content.
2. Add the two uncovered sections (`equity`, `question`) for the ~78 papers —
   Claude DRAFTS candidates by reading each abstract individually (per the
   no-blind-scripts rule), clinician reviews.
3. Run `apply_authored.py` → dry-run diff → clinician sign-off → upload to R2.
4. `audit_live_post.py blog-2026-W21` must pass (incl. §3.9 "NO pending
   placeholders" once complete).

### Phase 2 — W20 (live, unauthored)
1. Build `w20_authored.py` the same way: Claude drafts the five judgment
   sections per paper from each abstract, individually; clinician reviews.
2. Apply + audit + upload, as Phase 1.

### Phase 3 — W23 / W24 (drafts, keep unpublished)
Same author→review→apply loop. Publish only after `audit_live_post.py` is clean
(zero pending) — never ship a post with empty deep-dives.

---

## 5. What Claude will / won't do on this VM

**Will:** build/maintain `apply_authored.py`; draft candidate judgment text by
reading each abstract one-by-one (clearly labelled un-certified drafts, the
`w21_authored.py` pattern); run the apply + audit + deploy mechanics.

**Won't:** bulk-generate §3.9 clinical text by script/pattern; self-certify its
own drafts as authored; apply any draft to a live post without clinician
sign-off; publish W23/W24 while deep-dives are pending.

**Can't (here):** the upstream digest classifier fix that stops the
contamination at source — that's `MountZaraResearchDigest`, Mac-side.
