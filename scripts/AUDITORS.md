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
