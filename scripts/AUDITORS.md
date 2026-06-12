# Three-auditor accuracy safety net

Three INDEPENDENT auditors, each with its own strength and failure mode, that
together audit authored clinical content for **accuracy, validation, and voice**.
Run any one alone, or all three via `audit_all.py`. They overlap (all read the
same authored prose) so a miss by one is caught by another; none depends on the
others.

| # | Auditor | Strength | Source of truth | Catches | Cannot |
|---|---------|----------|-----------------|---------|--------|
| 1 | `audit_accuracy.py` | factual fidelity | **live NCBI PubMed** record (`pubmed_fetch.py`) | fabricated/drifted statistics; study-design vs PubMed `PublicationType` | interpretation nuance, tone |
| 2 | `audit_validation.py` | evidence-logic | NCBI `PublicationType` + authored design | over-claiming on weak evidence; missing hedge on mechanism/animal papers; verdict↔content incoherence | exact numbers, prose feel |
| 3 | `audit_voice.py` | authentic voice | the authored prose itself | audience-split labels ("For patients/clinicians"); abrasive/marketing tone; un-anchored bottom lines; readability | facts, evidence-logic |

```
python3 scripts/audit_all.py --post <post.json>     # all three
python3 scripts/audit_accuracy.py --dir <dir>       # one, over a folder
# --strict makes any flag exit non-zero (CI / pre-publish gate)
```

## These are ADVISORY, by design
Every flag is "**look at this**", not "this is wrong". The tools verify what is
machine-checkable; they do **not** replace clinician review of clinical
interpretation (CLAUDE.md §3.9) — that final judgment stays human.

### Known intentional advisory behaviors (not bugs)
- A **context/foundational paper** about a *proven* standard (e.g. the NAMS
  hormone-therapy statement, the Cochrane surgery review) will trip
  `verdict-incoherence` inside a brief whose soft verdict applies to the *trend
  claim*, not to that context paper. That flag is a prompt to confirm the
  settled reading is intentional — which, for context papers, it is.

## Independence & resilience guarantee
Each auditor **always runs**, with its own self-contained source of truth, so a
failure of one never disables another (no single point of failure):
- **Accuracy** prefers the live NCBI record; if NCBI is unreachable it falls back
  to the post's own stored verbatim abstract and still checks every statistic.
- **Validation** prefers NCBI publication-types; if unavailable it judges
  evidence-strength from the authored PICO design label + stored abstract.
- **Voice** is pure text analysis — no network dependency at all.
`pubmed_fetch.fetch()` never raises: it serves from cache, attempts NCBI, and
marks anything unresolved `_offline` so callers degrade gracefully instead of
crashing. Offline runs emit an informational notice (•), not a failure.

## Header-integrity check (added after the W21 finding)
`audit_accuracy.py` also checks each modal HEADER against the live PubMed record:
- `header-title-placeholder` — header title is a placeholder ("Foundational
  reference", "—", empty).
- `header-title-mismatch` — header title doesn't match the real PubMed title for
  that PMID (entity/tag-normalized, so encoding differences don't false-flag).
- `header-meta-unpopulated` — header still shows "n = —".
This caught a real defect: all 88 deep-dive modal headers on the live W21 post
were never populated (placeholder titles, blank design, "n = —"), and one paper
(42145021) had cross-contaminated metadata. The content below the headers is
correct; the headers are the defect. It also catches a *botched fix* — when a
rebuild left a duplicate cite line, the gate flagged it before publish.

## Visual / interactive runtime gate (audit_visual_runtime.py) — iPhone-faithful
Drives REAL browsers against the live site and verifies what the reader SEES:
images loaded, autoplay videos actually playing (polled — loop-wrap and momentary
mid-load states don't false-fail), the opening #heroVideo drawing animation starts
ON TIME and covers the screen edge-to-edge, the Ken-Burns animation is applied AND
actually moving (transform changes), and the opening fade-in completes.

Tested on the engines REAL users run — desktop on Chromium, and **iPhone on
WebKit (Safari's engine) with a real iPhone device descriptor**, plus an
**iPhone + Reduce-Motion** profile (the hero must still present, not go blank).
A Chromium-with-a-small-viewport test is NOT a faithful iPhone test; WebKit has
different autoplay/animation behavior. Also checks the iOS autoplay PREREQUISITE
(every autoplay/JS-played video is muted + playsinline — without which iOS simply
won't play it). Calibration with a live run found that .ken-burns is JS-added
after the 8s drawing animation (so the check polls for it), and fixed several of
its own false positives (loop-wrap negative Δt, single-sample timing). Stable:
24/24 across repeated runs. Wired into deploy-prod.sh as a soft gate; promote to
hard with DEPLOY_VISUAL_GATE_HARD=1.
