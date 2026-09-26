# Cloud Content Producer — Operating Runbook

> **Who reads this:** the scheduled Claude sessions that replaced the Mac
> `MountZaraResearchDigest` pipeline after it died silently (last
> submission 2026-07-28; last published post W29, 2026-07-13; discovered
> seven weeks later). You are the producer now. This file is the manual;
> the Routines' prompts point here. Update it in the same commit as any
> contract change.

## Constitution (non-negotiable, in priority order)

1. **NEVER publish.** Pipeline submissions land as `pending` briefs or
   `draft` posts. Publication is Dr. Mabini's action, always. The server
   enforces this (pipeline token cannot publish) — do not try to work
   around it with admin credentials.
2. **Clinical grounding: the master KB and verified literature only —
   never model memory.** KB retrieval goes through
   `POST /api/v1/internal/kb/ground` (see below). Every clinical claim in
   a rendered body ties to a KB doc or a cited PMID whose abstract you
   fetched from PubMed this run. If the KB returns nothing for a topic,
   render the gap banner and record it in `gaps_surfaced` — do not fill
   the gap from what you "know".
3. **Clinician-owned text stays clinician-owned.** The lede, tagline,
   bottom-line verdict prose, and the 8 clinician sections of each
   deep-dive modal are HIS. Render them as the placeholder markers
   (`span.mz-placeholder`, "Pending Dr. Mabini's review" pending tags)
   exactly as the historical briefs do. The §3.8 verdict-gate row
   (label `verdict reviewed (no REVIEW REQUIRED label)`, ok:false) is the
   honest marker that his review is still owed.
4. **Fail loud.** Missing token, unreachable endpoint, zero PubMed
   results, KB empty — say so in your run report and stop the affected
   step. A quiet no-op reads as "pipeline healthy" and that lie is how
   the last one died. The daily stale-alert email is the backstop, not
   the report.
5. **Voice rules (checked by §3.8 rows 20–24):** no infra language
   ("KB", "RAG", "manifest", "E-Utilities" in reader-facing prose), no
   maximalism ("never X"/"always Y"), no empathy-simping ("your pain is
   real"), no bare "Level A" stamps without a named CPG, "CBG/MIGS" not
   bare "MIGS", no §-numbers in rendered prose.

## Credentials (all on this environment)

| What | Where |
|---|---|
| Pipeline token | `~/.config/mountzara/pipeline-token.txt` → header `X-Pipeline-Token` |
| CF global key (R2 reads/writes) | `~/.config/mountzara/global-api-key.env` |
| Site | `https://mountzara.com` — always send a `User-Agent` (WAF blocks blank/bot UAs); `mz-operator-tools/1.0 (cloud-producer)` works |

If `pipeline-token.txt` is missing, STOP and report — do not fall back to
admin credentials for submissions.

## Flow A — Tuesday trend-brief (claim investigation)

1. **Pick the claim.** Read the watchlist:
   `GET https://api.cloudflare.com/client/v4/accounts/8fbe127f640681ddd813aaf33b95507f/r2/buckets/mountzara-content/objects/config%2Ftrend-watchlist.json`
   (global-key auth: `X-Auth-Email` + `X-Auth-Key`). Choose one claim not
   briefed in the last 90 days (check `last_brief_date`; the queue is
   authoritative if in doubt: `GET /api/v1/admin/trend-briefs/queue` is
   admin-gated, so track via the watchlist you update in step 7).
   Carry the claim's `influencer` attribution if present — never invent
   one.
2. **Investigate on PubMed** (E-utilities; ≤3 req/s; record every query):
   esearch → efetch `rettype=abstract` for candidates; keep the verbatim
   abstracts (structured-label attributes included). Bucket hits into
   `direct_evidence` / `mechanism_evidence` / `adjacent_evidence`, each
   hit `{pmid, title, journal, year}` — the server harvests PMIDs from
   exactly those three sidecar arrays.
3. **Ground in the KB:** `POST https://mountzara.com/api/v1/internal/kb/ground`
   with `X-Pipeline-Token`, body `{query, kind: "visit_prep", topK: 8}`.
   Returns `{grounded, chunks, context, citations, allowed_doc_ids,
   coverage, reason?}`. Use `allowed_doc_ids` as `kb_entries_retrieved`.
   `grounded:false` → render the gap banner (see an exemplar) and record
   the topic in `gaps_surfaced`. NOTE: the 2026-07-28 batch shipped with
   `kb_manifest.fell_back_to_empty=true` — the Mac's KB retrieval was
   already broken; yours is not allowed to be silently.
4. **Render `body_html`** — copy the structure from a real exemplar, not
   from memory. Exemplars: any pending brief body in R2
   (`trend-briefs-pending/<id>/body.html`) for structure; any PUBLISHED
   evidence post (`GET /api/posts/evidence-2026-05-19-h1-and-h2-antihistamines-treat-endometriosis-pain`)
   for the LIGHT palette. Anatomy (§3.8 rows enforce this):
   - `section.mz-post-hero`: pubdate, eyebrow `Journal Club · Trend
     Brief`, `h1` (the claim), lede **placeholder**, SVG verdict gauge
     (`mz-verdict-gauge`, `mzGaugeSwing`/`mzRise` keyframes,
     `prefers-reduced-motion` override, `data-state="review required"`).
   - Sections: tagline (**placeholder**), bottom-line (**placeholder**),
     evidence pyramid (`mz-evidence-pyramid`, ≥5 `mz-pyramid-row`,
     `mz-pyramid-note`), what-the-evidence-shows with ≥2 `mz-cite-grid`
     (recent + mechanism/foundational), Level-A anchors (`mz-level-a`),
     gaps (`mz-gap-section`), counseling frame (`mz-counseling`).
   - Cite cards: `article.mz-cite-card` (+`.mz-external` for mechanism),
     `p.mz-cite-design` "[N] · <design> · <year>", title, meta, fits
     line, `details.mz-abstract` with the **verbatim** PubMed abstract
     (every card must have one — row 12), PubMed link + `openDeepDive`
     trigger (rows 28–29).
   - Deep-dive modals: `dialog.mz-jc-modal#dd-<PMID>` with ALL 13
     sections (row 30): TL;DR / question / PICO / methods / abstract
     (verbatim, complete — first label must not be mid-structure) /
     findings / ROB / strengths / applicability / KB / equity / Monday /
     prompts. The 8 clinician sections carry the amber
     `mz-jc-pending-tag` "Pending Dr. Mabini's review" — BY DESIGN.
   - Citation popovers: `sup.mz-ref > a.mz-ref-link` +
     `span.mz-ref-pop#ref-pop-<PMID>` with `mz-ref-pop-title` /
     `mz-ref-pop-meta` ("Journal · Year") / `mz-ref-pop-finding` — the
     ONE popover schema (`functions/_lib/post_format.js` is the rulebook;
     metadata must match PubMed exactly, findings must be plain-language,
     never abstract pastes).
   - **LIGHT palette only** (the pre-2026-09 briefs were dark; dark now
     fails `auditDarkGrounds` at publish): ink `#1A1726`, secondary
     `#4A4658`, hairlines `#E9E5EE`, cards `rgba(255,255,255,0.72)`,
     paper `#FBFAF8`, accent `#6d28d9`, headline gradient
     `linear-gradient(118deg,#3d1478 0%,#6d28d9 55%,#8b5cf6 100%)`.
   - No empty "0 studies" section headings (row 26) — omit the section.
5. **Build the 32-row §3.8 audit table** — compute each row honestly
   against your rendered body (labels + thresholds verbatim below). All
   must pass except row 25 (`verdict reviewed (no REVIEW REQUIRED
   label)`, ok:false) — the queue REJECTS any other failing row.
6. **Submit:** `POST https://mountzara.com/api/v1/admin/trend-briefs/pending-review`
   with `X-Pipeline-Token`. Body: `{slug, brief_date (YYYY-MM-DD),
   claim_text, influencer, body_html (≤1.5MB), sidecar (≤0.5MB;
   include claim, abstracts map, direct/mechanism/adjacent_evidence,
   queries_issued, kb_manifest, source_url), audit_table,
   topics_covered, pmids_cited, kb_entries_retrieved, gaps_surfaced}`.
   Expect 200 `{ok:true, id, status:'pending', review_url}`.
7. **Update the watchlist** (R2 PUT back): stamp the claim's
   `last_brief_date`/`last_status`.

## Flow B — pull approved briefs → draft posts (run at the start of BOTH weekly runs)

1. `GET /api/v1/admin/trend-briefs/overrides?since=<epoch_ms>` with
   `X-Pipeline-Token` → rows of `kind:'approved_override'` and
   `kind:'suggestions_pending'`.
2. For each approved override: `GET /api/v1/admin/trend-briefs/<id>/override-json`
   (pipeline token). Re-render the brief as a PUBLISHED-format post:
   fill the placeholders from the override (title, lede, tagline,
   verdict + verdict_label, rationale, bottom_line, level_a_items…),
   flip the gauge `data-state` to the verdict, LIGHT palette, structured
   popovers with findings.
3. `POST /api/posts` (pipeline token) with `{id: 'evidence-<brief_date>-<slug-trimmed>',
   kind, title, summary, body_html, week_label, topics_covered,
   pmids_cited, kb_entries_retrieved, gaps_surfaced, verdict}` — lands
   as **draft**; the server runs `autoHealBody` + `auditPublishable`.
   Read the response's `format_warnings`/`publishable` and fix what it
   names (you have the same rulebook in the repo:
   `functions/_lib/post_format.js`, tests in
   `scripts/test_post_format_gate.mjs`).
4. `POST /api/v1/admin/trend-briefs/<id>/finalize` with
   `{rerender_passed: true|false, draft_post_id, failure_detail?}`.
5. `suggestions_pending` rows: read `suggestions_text`, revise the
   pending body accordingly (resubmit via pending-review — same id
   upserts), and note it in your report.

## Flow C — Monday-Mornings weekly digest (kind `blog`)

Same discipline, bigger canvas. Harvest the week's gyn literature
(PubMed, date-windowed), **require a gynecologic/pelvic anchor in each
paper's OWN title/abstract** before bucketing (the Mac pipeline's №1
recurring bug — see `UPSTREAM_FIXES.md` §1 — was topic-bucketing on its
own editorial framing), build the Monday-Mornings editorial body
(masthead, narrative, TOC `nav.mz-toc` with resolving chips, ≥2 topic
groups each opened by a synthesis paragraph, references list, cite cards
+ 13-section modals + structured popovers, LIGHT palette), and
`POST /api/posts` as **draft** `{id: 'blog-<year>-W<week>', kind:
'blog', week_label, ...}`. `auditPublishable` will hold it until his
deep-dive authoring + approval — that is the design, not a failure.
Per-paper lens lines must be paper-specific (template boilerplate and
copy-pasted lens text are hard-blocked).

## The 32 §3.8 audit rows (labels + thresholds, verbatim)

| # | label | threshold |
|---|---|---|
| 1 | `<svg> blocks` | >=1 (verdict gauge) |
| 2 | `mz-verdict-gauge` | >=1 |
| 3 | `mzGaugeSwing keyframe` | @keyframes + animation reference |
| 4 | `mzRise keyframe` | @keyframes + animation reference |
| 5 | `prefers-reduced-motion override` | @media block |
| 6 | `mz-evidence-pyramid` | >=1 |
| 7 | `mz-pyramid-row` | >=5 |
| 8 | `mz-pyramid-note` | >=1 |
| 9 | `mz-cite-grid (>=2)` | >=2 (meta + mechanism) |
| 10 | `mz-cite-card (>=2 — at least one per grid)` | >=2 (per-`<article>` count; substring grep forbidden) |
| 11 | `mz-external (mechanism amber cards)` | >=1 (per-`<article>` count) |
| 12 | `abstracts == cite cards (per §3.7)` | every cite-card `<article>` has an `mz-abstract` `<details>` |
| 13 | `mz-level-a` | >=1 |
| 14 | `mz-gap-section` | >=1 |
| 15 | `mz-counseling` | >=1 |
| 16 | `<style> block` | >=1 (inline gold style) |
| 17 | `<script> block (touch popout toggle)` | >=1 |
| 18 | `mz-post-hero` | >=1 |
| 19 | `mz-post-eyebrow` | >=1 |
| 20 | infra-language ("§0.8", "MountZara KB", "clinical knowledge base", "in this session", "NCBI E-Utilities", "manifest", "RAG") | == 0 |
| 21 | maximalism ("never X" / "always Y") | == 0 |
| 22 | empathy-simp ("your pain is real" etc) | == 0 |
| 23 | bare "Level A" stamps unanchored | == 0 unless named CPG cites it |
| 24 | "MIGS" alone (without CBG/) in user-facing text (§1.2) | 0 |
| 25 | `verdict reviewed (no REVIEW REQUIRED label)` | 0 (override authoring required before publish) — **the ONE row submitted ok:false** |
| 26 | section heading "0 recent studies" / "0 foundational papers" | 0 (omit empty sections) |
| 27 | at least one mz-cite-grid rendered | >=1 |
| 28 | every cite card has a deep-dive trigger | every card PMID has an openDeepDive trigger |
| 29 | every trigger has a matching `<dialog id="dd-<PMID>">` | every unique trigger PMID has a matching dialog |
| 30 | every deep-dive modal has all 13 sections | 13-section anatomy per §3.9 |
| 31 | no duplicate `<dialog id>` attributes | unique |
| 32 | no §-number references in rendered prose | 0 |

## Scheduling (the Routines)

The producer runs as Claude Code Remote **Routines** — scheduled triggers
that spawn a fresh session in this environment on each firing (the LLM
work cannot live in the cron Worker; §12.1 forbids Anthropic spend from
site endpoints, and the Worker has no model anyway). Two Routines:

| Routine | Cron (UTC) | Duties |
|---|---|---|
| MZ trend-brief producer | `0 12 * * 2` (Tue ~6-7am CT) | Flow B (pull approved → draft posts + finalize; handle suggestions), then Flow A (one new claim brief), then report |
| MZ Monday-Mornings digest | `0 12 * * 1` (Mon ~6-7am CT) | Flow B first, then Flow C (weekly digest draft), then report |

Both use `create_new_session_on_fire`, completion notifications
(push + email) on, and a prompt that says: read THIS runbook first, obey
the constitution, fail loud, never publish. Creating/updating a Routine
is an MCP `create_trigger` call that needs the owner's one-time approval
when issued from a headless session — if the Routines are missing (check
`list_triggers`), recreate them from this table and ask the owner to
approve.

The daily stale-alert email (`cron-worker` → `/api/v1/internal/content/
stale-alert`) is the dead-man watchdog over THIS system too: if the
Routines stop firing, the owner hears about it within days, not weeks.

## Reporting

End every run with a plain summary: claim briefed (or why not), overrides
pulled → draft post ids, suggestions handled, gaps surfaced for the
clinician, and anything that failed loudly. The run's session transcript
is the audit trail; the queue and the posts API are the state.
