# MIGS — System Map

**REQUIRED READING before any non-trivial edit to this repo.**

Created 2026-05-26 after a session surfaced three legacy-code regressions
(see §1 reference incidents) that would all have been preventable with
proper cross-file mapping in hand. Same pattern as `ABOGCaseListManager/SYSTEM_MAP.md`
per CLAUDE.md §10.11. Living doc — update in the SAME commit when a file
is added, renamed, deleted, or its responsibility changes.

If you are reading this and about to change a file in this repo, find
that file in §3-§14 below and CHECK ITS LOCK-STEP COLUMN. Any file
listed there as "touches X / Y / Z in lock-step" means you cannot
change this file in isolation — you must also touch X, Y, and Z, or
the next deploy regresses.

---

## 0. How this file is organized

| Section | What's in it |
|---|---|
| §1 | Four reference incidents — the foundational regression archetypes this map exists to prevent. |
| §2 | Repository topology + deploy chain (Cloudflare Pages, wrangler, gates). |
| §3 | `index.html` inline `<style>` atlas — line ranges, @media scopes, brace-balance checkpoints. |
| §4 | `index.html` inline `<script>` atlas — function inventory, DOM-timing trap, reference graph. |
| §5 | `functions/_lib/*` shared helpers — signatures + callers + lock-step rules. |
| §6 | `functions/api/v1/*` endpoint inventory. |
| §7 | Surface middlewares (admin, portal, education). |
| §8 | Static surfaces (root pages, education, portal, admin SPAs). |
| §9 | R2 content surfaces (`mountzara-content` bucket). |
| §10 | D1 schema migrations. |
| §11 | Cross-app sync surfaces (which native apps depend on which `/api/sync/*` route). |
| §12 | `cron-worker/` standalone Worker (D1 backups). |
| §13 | `scripts/*` deploy chain + tooling. |
| §14 | Known gaps + legacy patterns to retire. |
| §15 | Maintenance protocol — when + how to update this file. |

---

## 1. Four reference incidents — DO NOT REPEAT

§1.1–1.3 happened in a single working session on 2026-05-26; §1.4 on
2026-08-24. All would have been preventable if this map had been read
beforehand. They are the foundational patterns this file protects against.

### 1.1 CSS corruption — `index.html` line 5703 (silent site-wide breakage)

**Symptom:** SITE-WIDE Apple-glass treatment was silently broken on every
named card class (`.award-tile`, `.surgical-card`, `.domain-card`,
`.zero-card`, `.population-card`, `.evidence-card`, `.bento-card`,
`.app-card-v2`, `.research-card`, `.research-item`, `.research-card-video`)
for an unknown number of prior deploys. Cards on mobile rendered as plain
text-stacked elements with `backdrop-filter: none`, `border-radius: 0px`,
`min-height` not applied. The §3.10 audit grep-counted `blur(28px)
saturate(180%)` as present (16 hits), but the BYTES being present did not
mean the rules APPLIED at runtime.

**Cause:** Lines 5703-5707 were missing FIVE things in sequence: the
closing `}` for `.video-card:hover`, the closing `}` for the parent
`@media (prefers-reduced-motion: reduce)` block, AND the opening `/*`
for the comment block that followed. The CSS parser consumed the comment
text as garbage tokens and skipped ahead. Result: every CSS rule from
line 5703 through the end of the inline `<style>` block was parsed
INSIDE `@media (prefers-reduced-motion: reduce)` and only applied to
browsers with reduced motion enabled. Headless Chrome (which Playwright
uses by default) doesn't have reduced motion, so the visual VERIFY
finally caught it.

**Fix:** Surgical repair at lines 5703-5719 of `index.html` adding the
two missing `}` braces and the opening `/*`.

**Prevention rule:** Every edit to `index.html`'s inline `<style>` MUST
run the brace-balance check before commit:
```bash
awk '/<style>/{f=1} f{open+=gsub(/\{/,"{"); close_+=gsub(/\}/,"}")} \
     /<\/style>/{f=0; print "open=" open " close=" close_; exit}' index.html
```
If `open != close_`, the CSS is corrupted. Also: the §3.10 regression
audit grep cannot detect this class of bug — see §14 known-gap on
"audit-parses-CSS-at-runtime" enhancement needed.

### 1.2 `toggleFeatureSound` stale reference — old line 9854

**Symptom:** New JS added to inline `<script>` block (an IIFE)
mysteriously never ran. No console error visible in summary; manual
`page.evaluate` of the same logic worked. WebKit error log buried under
hundreds of "Button failed to load" iOS HTML5 video control errors:
`[ERROR] Can't find variable: toggleFeatureSound`.

**Cause:** A previous refactor removed the `toggleFeatureSound` function
but missed the bare-identifier reference at `window.toggleFeatureSound
= toggleFeatureSound;` on line 9854. That right-hand side referenced
an undeclared identifier — `ReferenceError` thrown — entire `<script>`
block execution halted at that line. Every line AFTER (including the
new IIFE) silently never ran.

**Fix:** Wrap with `typeof` guard (only safe way to reference a possibly-
undeclared identifier): `if (typeof toggleFeatureSound === 'function')`.

**Prevention rule:** When removing a function, grep for `window.<funcName>
= <funcName>` re-exposure assignments. Either delete them or `typeof`-
guard them. Same for any `<funcName>(` call sites elsewhere in the file.

### 1.3 Script-block timing — initializer runs before end-of-body DOM is parsed

**Symptom:** `initSeeAllSheet()` IIFE inside the inline `<script>` block
(line ~9648) ran without throwing, but every trigger button stayed
`hidden`. Manual `page.evaluate` of identical logic worked perfectly.

**Cause:** The inline `<script>` block opens at line 7914. When the HTML
parser hits a `<script>` element, it PAUSES HTML parsing, executes the
ENTIRE script synchronously, then resumes. The `<dialog id="mz-sheet">`
this initializer queried for was at line 9885 — AFTER line 7914 — so
the parser hadn't created it yet. `document.getElementById('mz-sheet')`
returned `null`, the early-return fired, the IIFE silently exited.

**Fix:** Hoist IIFE to a named function, defer invocation with the
`DOMContentLoaded` pattern:
```js
function initSeeAllSheet() { /* ... */ }
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSeeAllSheet);
} else {
    initSeeAllSheet();
}
```

**Prevention rule:** Any new initializer added to the inline `<script>`
block at line 7914+ that queries DOM elements MUST use the
DOMContentLoaded guard if those elements live anywhere after line 7914
in the document. Default to the guard pattern unless you've verified
the target element is in a section ABOVE the script tag.

---

### 1.4 Cascade source order — the mobile nav shipped black-on-black (2026-08-24)

**Symptom:** the owner opened mountzara.com on an iPhone. Tapping the
hamburger produced an unreadable near-black slab: the hero showed through
it, the links were invisible, the "Request an appointment" pill floated
mid-list overhanging the panel's left edge, and the panel opened 16px up
INSIDE the 64px nav bar. Nothing about it was caught by any deploy gate.

**Cause — two independent instances of the same trap:**

1. *A dark-theme value left behind by the light conversion.* The mobile
   panel still declared `background: rgba(0, 0, 0, 0.95)` from the old dark
   theme, while its links had been swept to `var(--ink-2)` (#4A4658) with
   everything else. Near-black text on a near-black panel. The light sweep
   was done by selector, and this selector was never visited because
   nothing renders it above 1180px — **a desktop review physically cannot
   see it.**
2. *Media queries add no specificity.* The mobile overrides for `.nav-cta`
   and `.nav-links a` sat in the `@media (max-width: 1180px)` collapse
   block near the TOP of `assets/css/home.css`. The base `.nav-cta` rule
   (~line 8400) and the accessibility rule `nav a, .main-nav a { display:
   inline-flex }` (~line 7780) are declared LATER at equal specificity, so
   they won inside the media query too. The CTA kept its 13px desktop pill
   sizing and the panel's links shrank to the width of their own label,
   which is why the row separators stopped mid-word.

**Fix:** panel repainted in `--paper` with `--ink` links; `--nav-h: 64px`
declared once on `nav.main-nav` so the panel's `top` is derived from it and
cannot drift again; and every mobile rule that must beat a later base rule
moved to a **MOBILE NAV CTA block at the END of the file**, labelled as
such. `toggleMenu()` also gained a close-on-tap/Escape handler.

**Prevention rules:**
- Never trust that a light/dark theme sweep reached a rule that only
  renders at a viewport you did not open. Sweep by *rendered viewport*,
  not by selector list.
- Before adding a mobile override, `grep` for the base selector. If any
  declaration of it appears LATER in the file, your override belongs at
  the end of the file, not in the collapse block. This is the same trap
  documented above `.mobile-toggle` (which once hid the hamburger at every
  width) — it has now cost three separate regressions.
- `scripts/_capture_mobile_nav.py` asserts the measured facts (panel
  ground, link colour, panel top vs nav bottom, ≥44px tap targets,
  full-width CTA, close-on-tap). Run it against production after any nav
  or theme change.

---

## 2. Repository topology + deploy chain

### 2.1 Hosting + bindings

- **Cloudflare Pages project:** `mountzara` (account ID
  `8fbe127f640681ddd813aaf33b95507f`)
- **Deploy chain:** Local working tree → `scripts/deploy-prod.sh` →
  `wrangler pages deploy . --branch=main --commit-dirty=true`
- **Branch on origin used as long-lived working branch:**
  `claude/setup-mountzara-landing-01M5e6zmrBbv1hX9jmgH6xz8`
- **Apex:** mountzara.com (DNS via Cloudflare nameservers
  `ziggy.ns.cloudflare.com` + `mitch.ns.cloudflare.com`)

### 2.2 wrangler.toml binding inventory

- D1: `mountzara-clinical` (id `f9b4acfe-4f5f-43bb-a76e-bac87e912fdb`),
  binding name `DB`
- R2: `mountzara-phi` (PHI, AES-GCM envelope-encrypted, 7-yr bucket
  lock), `mountzara-content` (1-yr lock — post body_html lives here),
  `mountzara-media`, `mountzara-backups` (90-day lock on `d1/` prefix)
- KV: `MZ_SESSIONS` (sessions + rate-limit counters), `MZ_MAGIC_LINKS`
- Pages secrets (set via `wrangler pages secret put`):
  `ADMIN_USER` (= `chris.mabini@gmail.com`, NOT `admin` — §10.3.1),
  `ADMIN_PASS_HASH` (PBKDF2-SHA256-100k iter — §9.8.3 Workers cap),
  `ADMIN_TOTP_SECRET`, `ADMIN_TOTP_RECOVERY_HASHES`,
  `ADMIN_MFA_COOKIE_KEY`,
  `PHI_MASTER_KEY` (+ `PHI_MASTER_KEY_OLD` + `PHI_ROTATION_CONFIRM_TOKEN`
  during rotation),
  `PREVIEW_INVITE_KEY`, `IP_HASH_SALT`,
  `ANTHROPIC_API_KEY` (gated on BAA per §12.2),
  `TRANSCRIPTION_SYNC_TOKEN`, `CLINICAL_AI_SYNC_TOKEN`,
  `SURGICAL_WORKFLOW_SYNC_TOKEN`, `IOS_SYNC_TOKEN`,
  `PIPELINE_TOKEN`,
  `PORTAL_PUBLIC_LAUNCH` (default false — §11.5.2 preview gate),
  `EDUCATION_PUBLIC_LAUNCH`

### 2.3 Deploy gate chain (in order, all in `scripts/deploy-prod.sh`)

1. **§0.8.1 KB-anchor pre-deploy gate** — iterates `education/*/index.html`
   + `portal/education/*/index.html` (skips `_*` underscore-prefixed
   scaffolding dirs); calls `scripts/verify_kb_anchoring.py` per file;
   exits 1 on any FAIL. Skip with `DEPLOY_SKIP_KB_GATE=1` (use only
   for non-clinical changes).
2. **SQL column gate** (2026-08-13) — `scripts/check_sql_columns.mjs`
   parses `schema/*.sql` into table→columns, extracts every SQL literal
   from `functions/**`, and fails on any reference to a column that does
   not exist. Hermetic, <1s, **no override flag** — a hit here means the
   handler is guaranteed to throw at runtime. Judges only what is
   decidable without a real parser: `alias.column` where the alias is
   unambiguously bound, and bare identifiers in the SELECT list or
   compared in the WHERE of a single-table statement. Run
   `--self-test` (13 cases) to prove the checker itself still works.
   **It found seven broken endpoints on the day it was written** — the
   admin snapshot dashboard, the whole Transcription-app sync, the
   patient briefing's document list, and the onboarding wizard's
   education step — several of them SILENT, because a bare `catch`
   turned "the query is broken" into "there is no data".
3. **Inline-script gate** (2026-08-14) — `scripts/check_inline_scripts.mjs`
   parses every inline `<script>`, in static HTML AND in the pages a
   Function GENERATES (it evaluates the template literal first, because
   that is where the bug lived). The public `/portal/` page is built from
   a template literal, so an escape written for the BROWSER is evaluated
   at generation time instead: one `\n` that needed to be `\\n` put a real
   newline inside a string literal, and **a script that does not parse runs
   NONE of its lines** — the membership tiers, comparison table, evidence
   and disclosures all silently vanished while the source looked correct,
   the API was healthy and every deploy passed.
4. **Clinical grounding gate** (2026-08-14) — see §5
   `clinical_grounding.js`.
5. **Scheduling timezone gate** (2026-08-14) — `scripts/test_scheduling_tz.mjs`
   (25). Every slot ever offered was five hours early; covers both DST
   transitions.
6. **Triage auto-release gate** / **notification gate** / **date gate** —
   `test_triage_auto_release.mjs` (33), `test_notification_flush.mjs` (37),
   `test_iso_date.mjs` (50).
7. **Working-directory assertion** — the deploy fails if `cite_audit/`,
   `.claude/`, `docs/`, `scripts/` or `schema/` reach the STAGE. Asserted
   rather than trusted, because the exclude list is the thing that was
   wrong: `cite_audit/authoritative-cv-2026-08.txt` was publishing the
   owner's mobile number, which he had deliberately kept off the published
   CV page.
8. **Portal header gate** (2026-08-13) — `scripts/test_portal_headers.mjs`
   (97 assertions). Asserts exactly ONE Permissions-Policy and ONE CSP
   per portal path after `applyPortalHeaders`. See §5 `portal_headers.js`
   for why this cannot live in `_headers`.
4. **§0.4.1 comprehensive regression audit** — calls
   `/Users/beans/Developer/MountZara/agent-platform/scripts/regression_audit.py
   --all` (NOTE: lives outside this repo); audits 25+ surfaces against
   every hard rule in CLAUDE.md; logs to `/tmp/_deploy_audit.log`;
   exits 1 on any HARD FAIL. Skip with `DEPLOY_SKIP_REGRESSION_AUDIT=1`
   — DANGEROUS, only when manually documented.
5. **`wrangler pages deploy .`** — Direct Upload via API token.
6. **HEAD check on mountzara.com** — confirms HTTP 200 with cache-bust
   query.
7. **§0.8.1 R2-post gate** — `scripts/verify_kb_anchoring.py --r2-posts`
   verifies every R2-served clinical post still carries its KB-anchor
   manifest in the structured fields.
6. **All-fields audit gate** — `scripts/audit_live_post.py --list` runs
   the §3.7.1 / §1.2 / §1.2b / §3.7 / §3.11 / §3.12 audit on every
   published R2 post. Exits 1 on any FAIL. The **§1.2b subspecialty-
   relevance gate** (added 2026-06-11) flags cite cards with no CBG/MIGS
   anchor in the paper's own title/meta/abstract — catches the digest
   pipeline's keyword over-match contamination (W21 had 15 off-topic
   papers, W20 had 12, draft W23 had 3: ophthalmology, men's ortho,
   dermatology keloids, rheumatology, hepatology, preclinical
   nanomedicine/phototherapy). It scans BOTH cite-card templates — the
   canonical `mz-cite-card` AND the newer `paper-card` (blog-2026-W23+
   auto-draft path, PMID in the `openDeepDive('dd-<PMID>')` trigger),
   via `relevance_cards()`. It strips the pipeline's `lens-callout`
   "DO + CBG/MIGS lens" framing (and the `mz-cite-fits` label) BEFORE
   checking anchors, so it reads the paper's OWN title/citation/abstract
   — without that strip the framing's gyn name-dropping made off-topic
   papers pass (the W23/W24 false-negative). It is a flag-for-human
   TRIPWIRE: it FAILS and lists candidate PMIDs; a flagged paper is
   either genuine contamination OR a deliberate cross-disciplinary
   mechanism/tech-transfer inclusion (the W23/W24 model) — the operator
   decides. Also new: **§0.8.3 cross-post duplicate-citation check** (in
   `--list` mode) flags any PMID journal-clubbed in >1 post (the W23/W24
   cross-week dup class). Purge tooling: `scripts/_authoring/purge_w2*_offtopic.py`.
   The real upstream cures live in `MountZaraResearchDigest` (Mac) and
   the ingestion endpoint — see **`UPSTREAM_FIXES.md`** for the full
   issue→root-cause→fix table (incl. the ingestion `pmids_cited`
   auto-backfill now in `functions/api/posts/[[path]].js`).
7. **Structural-integrity gate (added 2026-06-12)** —
   `scripts/audit_deploy_gate.py` fetches every published post and
   hard-fails on the STRUCTURAL defect class that the prose-focused
   §3 gate (#6) does not cover and that let the W21 regression ship:
   placeholder modal titles (`Foundational reference`), cross-
   contaminated header metadata (a different paper's title/cite/n on a
   modal header — e.g. W21 PMID 42145021 carrying "Management of
   Symptomatic Uterine Leiomyomas / Case Series / n=23,986" instead of
   the real "Benign metastasizing leiomyoma" review), `n = —`
   unpopulated headers, broken inline-reference popovers (truncated /
   empty / author-byline / wrong-paper synopsis), and unfilled
   `Foundational reference` reference-list entries. It REUSES the
   existing auditors (`audit_accuracy.audit_post` header-* flags +
   `audit_inline_refs.audit_post`) so rules can't drift, and gates ONLY
   unambiguous structural defects — advisory judgment calls
   (number-not-in-abstract derived sums, mechanism hedging, bottom-line
   phrasing) are deliberately NOT gated so the gate never cries wolf.
   The header-title-mismatch check (in `audit_accuracy.py`) uses
   significant-word OVERLAP (flag only when <40% of the shorter title's
   content words are shared), so legitimate abbreviation ("MRI" for
   "magnetic resonance imaging"), an added article, or paraphrase do NOT
   false-fire — only a genuinely different paper does.
   Skip: `DEPLOY_SKIP_STRUCTURAL_GATE=1` (non-clinical shell pushes only).
8. **Runtime-CSS audit** — `scripts/audit_runtime_css.py homepage`
   (getComputedStyle on live; the §1.1 bytes-present-runtime-absent
   class). Skip: `DEPLOY_SKIP_RUNTIME_CSS_AUDIT=1`.
   **Environment resilience (2026-07-22):** all Python browser audits
   (this one, visual, route-render) launch via
   `scripts/_lib_pw_launch.py` — container-Chromium fallback when the
   pip-pinned browser build is absent, webkit→chromium fallback (loudly
   noted) when WebKit isn't installed, env-proxy injection
   (HTTPS_PROXY) plus `--ssl-version-max=tls1.2` in proxied containers
   (the egress MITM resets Chromium's TLS 1.3 hello; cert verification
   stays ON via the proxy CA in the NSS store). These audits previously
   SILENTLY SKIPPED in the remote deploy environment — which let a
   stale `#how-you-visit` manifest selector (element moved to portal
   2026-06-25, commit 5953296) sit undetected for a month.
   **2026-08-10 — the TLS cap is CHROMIUM-ONLY** (`_with_chromium_tls_cap`,
   applied inside `launch_chromium`, no longer inside `_with_env_proxy`):
   passing `--ssl-version-max` to `launch_engine('webkit')` killed WebKit
   at startup ("browser has been closed"), so every 'webkit' audit had
   silently run on Chromium since 7-22. WebKit is installed in this
   container and now launches natively; keep engine-specific args with
   the engine.
8b. **Visual/interactive audit — HARD gate since 2026-07-22** —
   `scripts/audit_visual_runtime.py`: images loaded, autoplay videos
   playing, hero video starts/covers, Ken-Burns actually animating,
   fade-in + Apple-reveal completed, across desktop-chromium + iPhone +
   iPhone-reduce-motion profiles. Calibrated 29/29 on live: videos this
   test engine cannot DECODE (mp4-only sources; Playwright Chromium
   ships no H.264 — detected as readyState 0 + NETWORK_NO_SOURCE +
   canPlayType('avc1')='') are skipped LOUDLY as unjudgeable rather
   than false-failed; a decodable video that stalls still fails.
   **Hero-settle assertion (2026-07-22b):** once `.ken-burns` attaches,
   the hero must be PAUSED at ~duration with `dataset.heroEnded` and stay
   there across 1.5s — catches the replay-loop class ("advancing" alone
   passed an endlessly looping hero).
   **2026-08-10 viewer-faithful recalibration (33/33 on live, real WebKit
   for the first time — see 8a's TLS-cap note):** "hero started" accepts
   the animated-IMG hero (`complete && naturalWidth > 0`) — on touch and
   under refused autoplay the hero is never a `<video>`, so the
   currentTime-only check failed real-WebKit iPhone by definition. Reels
   are judged ONE AT A TIME, each scrolled to viewport center first —
   they are viewport-woken `preload="none"` videos with `loading=lazy`
   preview imgs, so sampling all four from one scroll position reports
   designed-in idleness as failure; pass = playing video OR loaded
   animated preview. Both hero samples and the settle check treat a
   mid-window `ended`+1.4s poster swap as settled (sampling currentTime
   off the swapped `<img>` crashed the audit).
   Demote: `DEPLOY_VISUAL_GATE_SOFT=1`. Skip: `DEPLOY_SKIP_VISUAL_AUDIT=1`.
8c. **Nav + reading-sheet audit — HARD gate since 2026-08-20** —
   `scripts/audit_nav_and_reading.py`. Driven by a shipped regression:
   a nav consolidation left `.mobile-toggle { display: none }` as the
   LAST rule for that selector, so the hamburger was invisible at every
   width and there was **no navigation at all below 1180px**. All
   thirteen existing gates passed — fact-sync, contrast, visual,
   route-render, public headers — because not one of them asks whether
   a person can reach the menu. Runs WebKit (Chromium's connections are
   reset by this VM's proxy; same note as 8a/8b) at 1512 / 1100 / 390
   and asserts: the menu button is visible whenever the bar is
   collapsed; all thirteen destinations are reachable at every width;
   the bar never overflows its own width; the reading sheet opens,
   carries its copy, closes on Escape, and holds its typography
   (>= 19px, >= 1.7 leading, measure capped under 820px); and gradient
   headlines keep descender room. A transport failure reports
   UNJUDGEABLE and exits 0 — proving reachability is the canary's job.
   Skip with `DEPLOY_SKIP_NAV_AUDIT=1`.

9. **Route-render audit (added 2026-06-10)** —
   `scripts/audit_route_render.py` per §13.5: every manifest route loaded
   in headless Chromium on live + title/selector asserted (homepage-
   fallthrough + broken-page-JS classes), PLUS the discovery contract
   (any repo route absent from `scripts/route_render_manifest.json`
   fails the deploy). Skip: `DEPLOY_SKIP_ROUTE_RENDER_AUDIT=1`.
   **Environment resilience (2026-06-12):** no longer Mac-only. When the
   admin password is unavailable (env `ADMIN_PASS`/`MZ_ADMIN_PASS` or
   macOS Keychain), it DEGRADES GRACEFULLY — hard-audits the 4 PUBLIC
   routes (`/`, `/about/`, `/evidence/`, `/trending/`, no auth needed,
   where a homepage-fallthrough actually hurts) and SKIPS the 10 gated
   `/admin/*` + `/portal/*` routes with an advisory (set `ADMIN_PASS`
   to include them). The browser context sets `ignore_https_errors=True`
   so a sandbox/CI TLS-MITM (self-signed root → `ERR_CERT_AUTHORITY_
   INVALID`) doesn't block the gate. Orphan-discovery still enforced
   in all environments.
10. **Content-render gate (added 2026-07-21, §14.1)** —
    `scripts/audit_render.mjs`: renders every published weekly roundup's
    `body_html` in headless Chromium and asserts on the reader's actual
    DOM — each topic group shows real per-topic AI synthesis prose,
    deep-dive modals are authored (no "Pending review") AND styled
    (a force-opened modal's section heading picks up the stylesheet's
    `text-transform:uppercase`; default `none` catches the unstyled
    `dd-*` grammar), and the body throws no JS error. Grammar-ADAPTIVE:
    stays green on both valid corpus layouts (W20 nests synthesis in a
    TOC sibling → count check; W21+ nests it inside each group → per-group
    check). Closes the systemic blind spot behind the string/structural
    gates — they check whether markup EXISTS as a source string (often
    only in CSS), not whether it RENDERS. Verified 2026-07-21 green on the
    whole approved corpus (W20/W21 + W23–W29) and red on each of the three
    regressions (stripped synthesis, injected `Pending review`, `dd-*`
    class with no matching CSS). Best-effort: self-skips (exit 0) when
    playwright-core / Chromium is absent. Skip: `DEPLOY_SKIP_RENDER_AUDIT=1`.
11. **Reader-path gate (added 2026-07-22, §14.1)** —
    `scripts/audit_reader_path.mjs`: walks the path a READER actually
    takes for EVERY published post (all 15, both shells — not just
    roundups): `/evidence/` + `/trending/` listings render one linked
    card per published post; each detail page loads through the real
    shell (API fetch → innerHTML → script re-execution); deep-dive
    modals are opened BY CLICKING their trigger buttons (dialog.open,
    authored, styled); roundup synthesis + references VISIBLE
    (offsetHeight>0); zero page JS errors; and NO page — post detail,
    listing, home, about — scrolls horizontally at 390px. Shell-grammar
    aware (`brief-*` on /evidence/, `post-*` on /trending/). Its first
    run caught 3 shipped defects invisible to every other gate: the
    /trending/ shell never re-executed injected body scripts (every
    deep-dive button was a DEAD CLICK on all 8 trend briefs), a 39px
    site-wide mobile nav overflow, and 115–246px mobile overflow from
    legacy `.mz-ref-pop` popovers on W20/W21-era posts. Best-effort
    skip without Chromium. Skip: `DEPLOY_SKIP_READER_PATH_AUDIT=1`.
    **No-grey enforcement (2026-07-22c):** the gate also walks every
    rendered text element on `/` and one brief page — any achromatic
    color with effective luminance 30–235 on a dark backdrop FAILS
    (light panels legitimately carry dark text and are skipped). This
    enforces the user directive "ALL text white on the dark theme":
    the purge replaced solid greys (#86868b/#a1a1a6/#6e6e73/#d2d2d7),
    alpha-white tiers (<0.93), `--gray-1..5`, `--text-secondary-dark`,
    cv `--muted/--dim`, education `--fg-mid/soft/dim`, and post-body
    embedded tiers (shell-level override; verdict/link/heading accent
    colors preserved) across 71 pages. Survey went 141 → 0 live.
    LESSON (round 2): a `color:\s*` regex also matches the tail of
    `background-color:`/`border-color:` — property-anchor with
    `(?<![-\w])` or you turn glass panels solid white (the runtime-CSS
    gate caught exactly that before it shipped).
    **Theme-consistency enforcement (2026-07-28):** section 3e asserts on
    a 9-page live set: backdrop stages (.page-bg-stage/.hero-bg-stage)
    must NOT have an opaque background (the black-slab class that hid the
    plum theme on 70 pages), their line-art must be screen-blended, and
    the page canvas (html/body) must carry a gradient — a flat achromatic
    near-black canvas fails. Root causes fixed 2026-07-28: the 2026-06-29
    "move base to html" block's var-fallback chain bottomed out at legacy
    #07070a on 65 pages (now an explicit plum gradient), and 5
    admin/billing pages had no canvas at all.
    **Contrast enforcement (2026-07-22):** the gate also samples homepage
    text elements (eyebrows, buttons, links, tags) and fails any below
    WCAG AA (4.5:1 small / 3:1 large) against the plum gradient's
    LIGHTEST region — guards the accessibility pass that fixed
    `#6d28d9`-as-text (2.83:1 → `--accent-soft` 7.3:1).
12. **Design tokens (2026-07-22 accessibility + gradient pass):** pure
    `#000` backgrounds replaced by deep-plum gradients — homepage
    `.hero-bg-stage` carries the full gradient; shells carry a calmer
    half-alpha version; `about/` keeps true black on purpose (portrait
    vignettes blend to black). Hero drawing + shell `.page-bg-art` use
    `mix-blend-mode: screen` so the line-art's black pixels are
    transparent and the drawing floats on the gradient (hero lock
    updated deliberately). Text never uses `--accent #6d28d9` on dark
    (2.83:1) — text/icons use `--accent-soft #a78bfa`; the two
    decorative blockquote quote-marks are the only exemption. Reading
    text weight floor: 400 under 20px. Shells now have
    `:focus-visible` rings matching the homepage.
    **2026-07-22 evening batch (all iPhone-report driven):** OLED
    brightening (base `#120b22`, stage/overlay/glow lift + hero
    brightness 1.45); `html` canvas carries the plum linear gradient
    (deep scroll no longer goes flat-dark when the stage fades to .75);
    hero `retryHeroPlay` guarded by `dataset.heroEnded` (ended-handler
    seek fired `canplay` → endless replay loop) plus a bounded
    300ms×20 determined-start poll (cached-media visits: canplay fired
    before listeners attached, a rejected play() froze frame 1 until
    tap); loader font-gate cap 6000ms→1600ms (fonts.ready on cellular
    ate the whole cap — drawing now starts ~2.6s on throttled LTE);
    `text-align: justify` removed on all 30 pages that had it; shells
    force REAL glass modals (translucent plum + blur44 + -webkit-
    prefix — posts embedded a 98.5%-opaque bg, trend briefs had no
    blur at all) and ALL modal text `#fff` (headings/links stay brand
    purple). Hero lock deliberately updated per change.
    **2026-08-08 readiness-gated loader (user: page "opens all out of
    timing and sync"):** the loader gate raced fonts vs a flat 1600ms
    timer and never waited on the hero media (`heroVideo.dataset.src`
    is null on the `<video>` hero → `preloadImageURL` was a no-op), so
    cold-cache visits started with nothing buffered and every timer
    drifted. Now `waitForHeroMedia()` holds the loader until
    `readyState >= 3`/`canplaythrough` (interval+event, survives
    element swaps), fonts get a bounded 2000ms slot, min 700ms brand
    moment, hard cap 6500ms. The determined-start poll only counts
    strikes toward the animated-WebP bail when `readyState >= 3`
    (buffering ≠ policy block; absolute bail at 40 ticks), and the
    hero text cascade + Ken-Burns mop-up are anchored to
    `whenHeroAnimating()` (video advancing past frame 1 or swapped to
    `<img>`; 12s stranded-text fallback) instead of blind timers from
    `startHeroSequence()`. Verified fast / throttled / autoplay-blocked
    (scratchpad `verify_loader_gate.py`). Hero lock updated per change.
    **2026-08-08 measured-perf batch (workflow-diagnosed on live site):**
    backdrop-filter glass = ~90% of throttled-mobile scroll stalls (A/B);
    infinite `rlWave` height + `pulse` box-shadow animations kept idle
    frame time at 259ms (21ms with them off). Fixes: rlWave→scaleY,
    pulse→transform/opacity ring on `::after`, hero Ken Burns bounded to
    one 45s run (`forwards`), closed `.app-modal`/`.contact-modal`/
    `.surgical-hub-panel` now display:none (were permanent full-viewport
    blur roots at opacity:0; open-fade via `mzOverlayIn` ANIMATION —
    close is instant by design), 4 surgical reels preload="none" w/o
    autoplay attr (10.0MB no longer downloads at open; TWO legacy play()
    paths — `ensureVideoPreviewsAutoplay` and `initVideoPreviews` — are
    both proximity-gated now, IO pauses off-screen reels), app-reel HEAD
    probes deferred to idle/first-scroll. Ruled out by A/B: scroll-snap
    removal (made it worse) — do not remove snap for perf.
    **2026-08-08 art-dominance sweep (68 subpages):** `.page-bg-stage`
    opacity 0.75→0.42 and `.page-bg-art` filter saturate(2.0)→1.5,
    brightness(1.28)→1.08, contrast(1.28)→1.12 — at desktop widths the
    boosted strokes crossed naked headings/ledes at near-full strength.
    Homepage hero stage untouched (different mechanism + vignette).
    **2026-08-08 /curriculum/ CSS-comment catastrophe:** the header
    comment contained the path `/education/*/` — its `*/` closed the
    comment early, the parser ate the entire `:root` block, every
    `var(--fg-*)` failed, and all text without a literal-color override
    rendered BLACK on dark (pills, footer, CTA copy, cycle descs).
    Fixed the comment; `audit_route_render.py` now asserts on every
    route that referenced design tokens actually resolve
    (`ALL-TOKENS-MISSING` fail). NEVER put a path containing `*/`
    inside a CSS comment.
    **2026-08-08 Kothari purge:** Dr. Kothari is NOT final faculty (user
    directive) — removed from curriculum/cbg-migs/ (only deployable
    mention) and added to the fact-sync forbidden list alongside UIC.
    cbg-migs modals rewritten as curated synthesis (v3.1) — no raw
    reading-list/projection-table dumps; regenerate via scratchpad
    `build_curric_deep2.py`, never hand-edit facts in.
    **2026-08-08 accessibility + palette + width pass (user: "too purple ...
    washed out", "you have failed in every regard" on accessibility, "sections
    only take up part of the screen"):** all three had overlapping causes.
    (a) PALETTE — the wash was NOT the canvas gradient but
    `.hero-bg-vignette` (glows 0.30/0.26 over a 0.46 plum wash); now
    0.15/0.13 over a deeper 0.60 base, plus canvas saturation cut ~45%
    (#171030→#191526, #120b22→#120f1b, #150e2a→#161321) across 315 sites.
    (b) ACCESSIBILITY — measured, not assumed, by the NEW
    `scripts/audit_contrast_pixels.py` (now a deploy gate, skip flag
    DEPLOY_SKIP_CONTRAST_AUDIT). Fixed: homepage About interlude had
    accumulated contradictory rules over sessions (light panel + `color:
    var(--dark)` + `.section-sub{#fff}` + a later `{#3a3a3c}`) producing
    white-on-light AND near-black-on-dark in ONE section — it is now a
    single dark surface with white text; sticky nav 0.28→0.94 alpha
    (white links measured 1.00:1 crossing a light band); small accent
    text #a78bfa/#8b5cf6→#c4b5fd (3.2-4.4:1 → 10:1); tap targets ≥24px
    (pips were 7x7); visible focus rings; skip link on #2e1065.
    (c) WIDTHS — containers disagreed page-to-page (1040/1080/1140/1180/
    1200) and within pages (contact 760, footer 1024 vs a 1140 body);
    unified to 1280 (1180 under 1360px) and grid column counts now divide
    their item counts (hub 7→4 cols, cycle 6→3, detail-grid scoped per
    section) so no row strands a lone card.
    **The contrast gate's method matters:** four attempts to compute
    contrast by compositing CSS layers all gave wrong answers on this
    site. It now renders each page twice per scroll position — once
    normally, once with every glyph transparent (and background-clip:text
    backgrounds neutralized, or the glyphs paint themselves) — samples
    only points that hit-test back to the text element, discards
    partially-unpainted frames, and re-confirms every candidate by
    scrolling it to viewport centre. Do not "simplify" it back to
    ancestor-walking; that is what produced 169 phantom failures.
    **2026-08-08c opening animation — FILMED, not reasoned about
    (`scratchpad/filmstrip.py`, `opening_timing.py`):** the readiness gate
    added earlier waited for `canplaythrough` (readyState 4 = whole clip
    buffered), which held the loader 3.4s at 1.5 Mbps and up to its 6.5s
    cap on slower links — the reader watched a spinner. It now waits for
    readyState >= 2 (first frame decodable) with a 1.5s cap. Separately,
    a refused autoplay was only noticed after ~1.1s of poll strikes, so a
    frozen frame sat on screen; the rejected play() promise is now used
    directly (retry once, fall back to the animated WebP at 400ms).
    MEASURED on live: loader clears at 1.9-3.0s by connection and the
    drawing starts 276-351ms later in every condition, 683ms with
    autoplay refused. Keep the loader tied to first-frame readiness; do
    NOT reintroduce a full-buffer wait.
    **Surgical reels:** `preload="none"` without the autoplay attribute
    stopped playback entirely on real devices (an element with no data
    cannot start from play() alone). They now carry `autoplay
    preload="metadata"` — cold open costs ~1 KB of range probes instead
    of the old 10 MB, native autoplay is back, and the IntersectionObserver
    still pauses them off-screen. The grid is 2x2 by explicit rule: a
    4-across row (added to avoid an orphan) shrank the thumbnails.
    **2026-08-09/10 opening choreography + autoplay-refused Safari (four
    user recordings, root-caused one per recording):** the user's Safari
    refuses ALL video autoplay (site-wide "Never Auto-Play" — the hero
    video never played once across four recordings), so every video path
    needs an animated-image fallback. Current contract, owned ENTIRELY by
    the in-body bootstrap in `index.html` (home.js's `startHeroSequence`
    returns early; its cascade is a no-bootstrap safety net only):
    loader → drawing → monogram → headline → sub → credentials, anchored
    on VISIBLE drawing (video `currentTime > 0.5`, or the animated IMG
    `complete && naturalWidth > 0`, then +1300ms; 7s hard fallback).
    **2026-08-11b THE CURTAIN DOES ITS JOB (owner's design, verbatim: the spinner exists to make sure the page is completely loaded before the sequence runs; give it leeway; get the order right; nothing fighting).** The bootstrap desktop branch is now the SINGLE curtain owner: behind the opaque loader it (1) probes autoplay once (play -> pause+rewind) to learn the path invisibly, (2) on the video path buffers the ENTIRE clip (canplaythrough; his recording showed a 2.2s mid-drawing buffering stall when it started unbuffered), on the refused path fetches AND DECODES the fallback image, (3) waits for document.fonts.ready, plus a 1.5s minimum and 600ms leeway; 7s absolute cap. Only then does the curtain lift and the drawing start; text anchors on visible motion. home.js's own readiness chain DEFERS entirely when __mzHeroStarted (it raced the bootstrap and lifted the curtain early). Verified on production, both paths, zero mid-play stalls. Do not add a second hideLoader caller, and do not start hero media before its readiness promise resolves.
    **2026-08-11 THE OWNER CALLED IT: FULL RESTORE TO VIDEO-FIRST (f46f271).** After a full day of universal-browser reengineering (animated WebP, replay bytes, tile atlas, canvas patches, vector strokes) he judged every variant worse than the original and asked for the site as it was: full-quality mp4/webm hero, native video reels, the specified choreography order. index.html, home.js, home.css and the fingerprint lock are restored verbatim from f46f271, plus exactly two additive fixes: the bootstrap owns the video 'ended' -> ken-burns settle (a latent flaw of the original: fast desktop loads never got the zoom), and heroKenBurnsSlow uses ease-out so the drift is visible from its first second. The curriculum redesign, _headers no-store, audit/launcher fixes, and the media-function replay endpoint are kept (the endpoint is unused by the restored client). The audit detects the architecture via #heroCanvas presence and judges each accordingly, and accepts a FINISHED 45s zoom as settled rather than stuck. Everything below this line documents the superseded experiments — kept for the measurements, not as guidance.
    **2026-08-10f THE DRAWING DRAWS ITSELF AGAIN — BAKED CANVAS PATCHES.**
    The user refused a static reveal ("I refuse simple appear instead of
    actual animation of my drawing") — rightly. The real stroke animation
    is back on the no-autoplay path at plain-HTML cost: the ENTIRE hero
    stack (stage gradient + glows + screen blend + color filter + vignette
    + rotation) is baked OFFLINE into browser-true composites — captured
    from the live page itself rendering each frame (not modeled; a PIL
    model missed the above-art vignette and blend subtleties) — then
    reduced to `hero-draw-base-v1.webp` (8 KB, the art-free stage) plus
    `hero-draw-atlas-v1.webp` (63 KB, 2.9 MP decoded once: ONLY the
    pixels that change per frame — the stroke tips, ≤10 rects/frame,
    grain-noise cells filtered) plus `hero-draw-meta-v1.json` (6 KB
    timings/rects). Runtime = `#heroCanvas` (pre-placed in
    `.hero-bg-stage`, 1440×900, object-fit cover): draw base once, stamp
    one frame's patches per rAF tick at the original cadence — a handful
    of tiny drawImage calls, no blend, no filter, no decode storm, no
    layout. Replay fidelity vs the browser's own final render: 0.35/255
    mean. **FRAME-PACED PLAYBACK IS MANDATORY (2026-08-10h).** The canvas loop advanced to `performance.now() - t0`, so ANY stall — a backgrounded tab (rAF suspends entirely), a slow load, a main-thread hitch — made one tick dump every remaining frame: the drawing appeared already finished and static. This is invisible to every instrument that samples a healthy run, and it is the failure mode the owner kept reporting. The loop now accumulates capped time (`MAX_STEP` 90ms per rAF) and defers start while `document.hidden` — so a 3s freeze delays the drawing but can never fast-forward it (verified by injecting a 3s main-thread block mid-draw: 2737ms of visible drawing still played). NEVER drive this animation from raw wall-clock elapsed again.
    **REDUCE MOTION IS THE ANSWER TO THE WHOLE SAGA (2026-08-10g).** The owner's Mac has prefers-reduced-motion ON (same accessibility posture as his site-wide 'Never Auto-Play'). Two rules were erasing his opening for him and ONLY him, which is why nine other fixes changed nothing: (1) this canvas code stamped all 72 patches at once under reduce-motion — measured 364ms vs 2967ms, i.e. a finished still the instant the loader lifted; (2) the CSS reduce-motion block forced `.hero-inner{opacity:1!important}`, so monogram+headline+sub+credentials were ALL on screen immediately, with no order at all. BOTH are fixed: the drawing plays at full pace under reduce-motion (a line drawing revealing itself in place is CONTENT, not vestibular motion) and the hero cascade runs as OPACITY-ONLY with its 0/900/1800/2600ms delays intact (transform/filter stripped; never use a `transition:` shorthand in that block — it resets transition-delay and collapses the stagger). What reduce-motion legitimately drops is the 45s Ken-Burns ZOOM, and only that. Verified on production: reduce-motion draw span 3180ms, children revealing at 2951/3830/4705/5532ms — matching normal motion. NEVER short-circuit the drawing or the cascade on this media query again. THE STROKES WAIT FOR THE CURTAIN: play() blocks on `window.__mzLoaderGone` (set ~250ms into the loader fade; 6s safety valve) — on a fast machine with the 77KB pre-cached the drawing played out BEHIND the loader and the reveal showed a finished static image (user report). `dataset.mzArt` is set at visible play start, so the monogram anchor (+1300ms) counts from strokes the viewer can actually see. The canvas takes the
    `#heroVideo` id at handoff (`dataset.mzArt='1'` = drawing visible —
    the anchor and audits key on it); its settle zoom is
    `@keyframes heroCanvasZoom` (plain scale — NOT the rotated KenBurns
    keyframes). `fallbackFade()` (static frame + opacity) remains as the
    canvas/meta-failure net. Rebuild pipeline lives in this session's
    scratchpad pattern: capture per-frame composites off the live page at
    1440×900 dpr1 (data-URL src swaps on #heroVideo), diff → cluster →
    atlas. mp4 video still plays where autoplay is allowed.
    **2026-08-10d (superseded by f) THE REVEAL WAS BRIEFLY A WIPE.**
    Recording 5 proved the last freeze was DECODE COST: ~95MP of animated
    WebP frames blocked a weak Mac's main thread ~4s (monogram landed —
    composited fade — while the main-thread-painted headline froze). The
    no-autoplay opening is now ONE static frame
    (`hero-last-frame-lite-v2.webp`, 15KB, single 1.3MP decode, filter
    baked in) revealed by `.hero-video.wipe-in` — a 2.4s clip-path
    `inset()` animation that sweeps in pre-rotation element space
    (renders bottom-left→top-right after the -22deg transform). The
    client has NO fetch/base64/replay/localStorage machinery left; all
    preloads (head kick, home.js constants) point at the static frame.
    The mp4 video still plays the true stroke animation where autoplay
    is allowed; `functions/media` keeps the ?replay endpoint (unused by
    the client, harmless). Do not reintroduce a multi-frame animated
    image on the hero path — every variant of it froze the user's
    machine across five recordings.
    **2026-08-10c THE FREEZE WAS THE MAIN THREAD, NOT THE MEDIA** (traced
    with CDP under 6x CPU throttle after the asset diet still froze):
    full-document layouts cost 400-730ms EACH on this DOM. Mid-opening
    layout triggers, all now eliminated — treat every one as a regression
    class: (1) **WEB FONTS**: the Google link loaded 18 Nunito Sans
    variants, each arrival forcing a swap-relayout (350-730ms at 2.0s and
    2.7s — the user's "freezes 2-3s midway"). Now ONE self-hosted
    variable woff2 (`assets/fonts/nunito-sans-var.woff2`, 31KB, weights
    200-1000, + italic 14KB), preloaded `fetchpriority=high`, latin
    unicode-range, @font-face inline in the head — the single swap lands
    while the loader still covers. Layout total 2192ms → 824ms, all
    under the loader. Do NOT reintroduce a fonts.googleapis stylesheet
    on the homepage. (2) **DOM swaps**: `#heroImgSlot` (an empty img,
    `opacity:0`) is PRE-PLACED next to the hero video; the video→img
    handoff is src/id/visibility/opacity flips only — replaceChild was a
    full-layout freeze. The slot having no src is intentional (the
    visual audit's broken-image check exempts src-less imgs). (3) the
    loader's `.removed` is `visibility:hidden`, NOT display:none.
    (4) **home.js loads AFTER the opening**: a tiny in-head loader
    injects it on `mz:hero-settled` (+600ms; dispatched by both settle
    paths), on first user intent (scroll/tap/key), or at 11s — its init
    layouts froze the cascade when it evaluated mid-opening (a fixed
    6.2s timer landed right after the headline: user report "freezes
    after 'A passion for women's health.'"). (5) remaining known stall:
    Cloudflare's zone-injected challenge script (~650ms throttled,
    ~100ms real) — not controllable from Pages scope. (6) CONSISTENCY
    (user: "colors turn more sharp/contrast when the animation ends"):
    the settle frame is `hero-last-frame-lite-v1.webp` — the lite
    animation's OWN final frame re-encoded (pixel-equivalent, verified),
    never the old 1080p v2 frame; hero panels (.hero-sub/.hero-meta)
    keep ONE translucent-card look permanently — no settle-time glass
    switch-on (that pop read as a contrast jump; live blur over the
    animating drawing was also a freeze contributor). The monogram is
    pre-baked white+shadow (`monogram-white.png`) — no
    brightness/invert/drop-shadow filter chain; the halo gradient is
    soft WITHOUT filter:blur(40px).
    **2026-08-10b THE ASSET ITSELF WAS THE ROOT CAUSE** (user: "the fix
    shouldn't require multiple trys" — correct): every freeze traced to
    moving a 1.2 MB animation whose strokes END AT FRAME 70 (2.9s) —
    the remaining 123 frames were a frozen hold, at 1920×1080 behind
    text. The drawing is now `/media/hero-animation-lite-v1.webp`:
    72 frames, 1536×864, q50, **171 KB** — it arrives before it is
    needed on any plausible connection. Rebuild recipe: PIL over the
    original, cut at last-motion frame +1, LANCZOS to 1536×864,
    quality 50, method 6, loop=1. All prior delivery hardening remains
    below (each layer still guards a real failure mode).
    Pieces that must not regress: (a) REPLAY IS SERVER-SIDE:
    `/media/<key>.webp?replay=1&t=<now>` makes `functions/media/[[path]].js`
    append a 12-byte random XTRA chunk + RIFF-size fixup, so every view
    gets byte-unique content over a PLAIN URL and WebKit's CONTENT-keyed
    decoded-animation cache can never serve the final frame (recording 3).
    Client-side padding via blob: URLs was abandoned 2026-08-10 — some
    WebKit builds refuse to decode a large animated WebP from blob:
    entirely (`complete=true, naturalWidth=0`), which put the monogram
    over a blank canvas while every fresh-context test passed (fresh
    contexts have a cold decoded cache, so the plain-URL fallback always
    drew). First visit uses the plain preloaded URL (localStorage
    `mzHeroSeen` gates this); repeats use ?replay. (b) FETCH-FIRST
    ATTACH: `toAnimatedImage` fetches the FULL file, then sets img.src to
    the SAME now-HTTP-cached URL (the ?replay response is
    `private, max-age=300`, NOT no-store, for exactly this handoff) —
    Safari animates a WebP while it streams, so attaching early froze the
    drawing mid-stroke whenever the network fell behind (user: "freezes
    2-3s midway"). 4s cap, then stream anyway. (c) a hero `play()`
    rejection with `err.name === 'NotAllowedError'` swaps the hero
    immediately (no 1800ms stall wait), sets `__mzAutoplayRefused`, and
    dispatches `mz:autoplay-refused`; (d) `home.js` listens and converts
    ALL FOUR reels to their looping animated previews at once
    (`/media/<name>-reel-v2-preview.webp` in R2, 480px/12fps/6s cut from
    the liveliest frame-diff window, `loading=lazy`) — one refusal is a
    site-wide setting, nobody scrolls onto a frozen thumbnail; reels also
    self-convert on their own NotAllowedError or a ~1.2s no-advance poll.
    `swapToPreview` lives at the IIFE's FUNCTION scope — it was
    block-scoped inside the IntersectionObserver branch, which made the
    fast path dead (`typeof` on an out-of-scope const is 'undefined').
    (e) the bootstrap ALSO owns the settle: video `ended` → ken-burns →
    static last-frame poster swap at +1.4s. home.js's ended-handler never
    registers (early return), so without (e) a fast desktop load left a
    live full-viewport video layer composited forever and no Ken Burns.
    (f) IMG-path settle (`settleLater`) fires at attach+5600ms — AFTER
    the text cascade (choreo+3.6s ends the credentials). The clip's
    strokes finish at ~3.5s and the remaining 4.4s is a frozen hold, so
    8400 left ~4s of dead canvas; but 4400 fired MID-CASCADE and the
    last-frame fetch+decode blocked paint while the headline's
    background-clip:text words were mid-transition — the text visibly
    froze after "A passion" (user report). LAST is pre-decoded
    (`img.decode()`) so the swap never costs a paint stall. Change any
    cascade timing and 5600 must move with it. (g) REDUCE MOTION rests
    the reels on their posters: ensureVideoPreviewsAutoplay strips
    autoplay+pauses and returns; recoverPausedVideos, initVideoPreviews,
    the research-card IO, and the modal-close resume are ALL
    reduce-motion-gated (each was found replaying the rested reels).
    **Modals** (`scripts/audit_modals.py`, new): cbg-migs chapter/detail
    cards were 720px inside a 1440px window — now 1040px so the milestone
    table and month detail use the space; app-modal bodies clip their own
    horizontal overflow (52px on a 390px screen); `.omt-modal` and
    `.evidence-modal` join the display:none-when-closed set. The nine
    practice-area modals were verified rich (7-9.6k chars each) — a
    "Coming soon" panel only appears for an invalid slug.
    **2026-08-08 quality batch (9-page audit → 8 parallel fix agents):**
    homepage apps cards were WHITE text on a near-white panel (stale
    light-era override removed; cards are dark glass again —
    `audit_runtime_css.py` now asserts glass ON + white text there, the
    old "light-section solid" assertion is retired); duplicate ICG
    publication merged with CV-verified provenance; apps=6 and
    "Ten peer-reviewed publications & presentations" (exact list count)
    everywhere; fellowship name canonical "Anatomy & OPP Preclinical
    Fellowship". /curriculum/ hub: third case card added
    (hospice-training) so "Three curricula" is true; card copy
    de-noun-piled. cbg-migs: Y3 tiles shortened (overflow 0), sim grid
    3×3 with per-session modality lines, synthesis dedup. about/: heading
    grammar, "The following month" timeline fix, honest PDF-request copy,
    envelope icons. cv/: credential middot, visible timeline labels,
    near-opaque top bar, Lake Shore Dr. address, canonical hospital
    naming, SAAO order. evidence/ shell: counters render final values
    synchronously, double-encoded entities fixed, slug display-name map,
    Generated-timestamp hidden, design-distribution bars, centered
    modal, REVIEWED/CLAIM chrome removed, forest-tick thinning.
    trending/ shell: single human date (ISO pill suppressed), slug
    labels, explicit dark html background-color (white overscroll flash),
    eyebrow relabel, takeaways de-quoted, single-column refs +
    HIDE ABSTRACT toggle, card foot anchored, duplicate digest header
    suppressed — `audit_reader_path.mjs` title assertion now accepts the
    embedded `.mz-post-title` when the shell suppresses its own block
    (must be VISIBLE either way). hospice pages: provenance box
    rewritten first-person (never "the operator"), breadcrumb middots
    now CSS-generated separators, X-not-Y density capped. R2 content:
    testosterone brief's "FDA-approved compounded cream" contradiction
    corrected in posts JSON (no FDA-approved female testosterone product
    exists in the US).
    **2026-08-08 all-36-months clickable (user: "where the fuck are the
    details for YEAR 1 / YEAR 2 ... you only include year 3 details"):**
    the deep-dive layer originally wired only the 12 Y3 tiles. Y1/Y2
    detail is extracted from chapter 12 of
    `assets/curriculum/fmigs-cbg-migs.json` — month boundaries there are
    PARAGRAPH BLOCKS ("August (Y1) - ..."), not section headings, and
    September (Y2) has NO marker in the source (inferred from the
    endometriosis-medical sections between Aug and Oct Y2). Scripts:
    scratchpad `extract_y12.py` -> /tmp/_y12data.json ->
    `build_y12_modals.py`, which merges 24 entries into the existing
    `DETAIL_DATA` (56 total) and converts the tiles to buttons. Two
    source defects repaired at build time: a lost inter-word space
    ("thepelvic") and escape-order (escape text BEFORE appending
    `&hellip;`, or it renders as `&amp;hellip;`). Tile-copy correction:
    May Y1 said "Specialty topics & quality improvement" but chapter 12
    documents "Surgical Complications: Vascular, Bleeding, Vaginal Cuff"
    — the complications series is now I (Apr) / II (May) / III (Jun).

12. **Fact-sync gate (added 2026-07-28)** — `scripts/audit_fact_sync.mjs`,
    hermetic, runs FIRST (before the hero lock), no override flag: scans
    every deployable file (html/json/js outside staging exclusions) against
    the canonical fact list — forbids the never-established UIC /
    University of Illinois affiliation anywhere; requires departure
    context on every "Riley Lloyd" mention (Year 3 addendum: duties
    assumed by Dr. Sankey-Thomas); requires the three-year / 36-month
    curriculum phrasing, the CV-canonical award name, and the full GMIT
    citation; asserts `docs/` stays excluded from BOTH staging paths.
    Origin story: the public curriculum data JSON kept UIC + departed
    faculty long after the pages were corrected (two-worktree drift), and
    the `docs/` tree — including the SFH risk-management letter — was
    being served publicly. `docs/`, `*.doc`, `*.docx` now excluded from
    staging; legacy 2024-v3 source .doc removed from public assets.
    NOTE: the deploy token has no zone-cache scope, so removed files can
    persist at the EDGE for up to max-age=14400 (4h) after removal;
    dashboard Purge Everything clears instantly.

### 2.4 Admin auth canonical resolver (§10.3.1)

**`ADMIN_USER` on Cloudflare Pages = `chris.mabini@gmail.com`** (NOT
`admin` — every operator script that hard-codes `admin` will get a 401).

Every operator script that needs admin Basic Auth MUST:
```bash
source "$(dirname "$0")/_lib_admin_auth.sh"
resolve_admin_auth   # populates $MZ_ADMIN_USER + $MZ_ADMIN_PASS
```
`resolve_admin_auth` walks Keychain (`mountzara-admin-password`) →
`pbpaste` → `$ADMIN_PASS_ENV` → pre-flight against `/api/posts/_admin?
kind=blog` → self-heals Keychain on success.

### 2.5 PBKDF2 iteration cap (§9.8.3)

Cloudflare Workers' `crypto.subtle.deriveBits` rejects iteration counts
above **100,000**. Every PBKDF2 hash baked for Pages auth MUST use
exactly 100k. Sites: `scripts/_reset_admin_password_node.sh`,
`functions/_lib/auth.js::PBKDF2_ITERATIONS`. If you change one, you
MUST also touch the other.

---

## 3. `index.html` inline `<style>` atlas (lines 12 – ~6243)

| Line range | Region | @media scope at end of range |
|---|---|---|
| 12–242 | Reset + root tokens (`:root`, `body`, font-stack, `--accent`, `--glow-purple` family) | none |
| 243–650 | Hero (`.hero`, `.hero-inner`, `.cinematic-intro`, hero animations, mzKenBurnsSlow keyframes) | enters @media (max-width: 640px) and (orientation: portrait) at 354 |
| 651–1300 | Nav, container, hero CTAs, scroll bar | several @media at 654, 828, 963, 1014 |
| 1956–2107 | Surgical hub grid + hub-tile | @media (min-width: 720px) + (min-width: 1080px) at 1956-1957 |
| 2217 | `@media (prefers-reduced-motion: reduce) { ... }` block — animation cascade disablers | reduced-motion |
| 3032, 4927, 5411, 5623, 5682 | Additional `@media (prefers-reduced-motion: reduce)` blocks | reduced-motion |
| 5682–5707 | **DANGER ZONE** — the line 5703 corruption (§1.1) lived here. Now repaired. Every edit here MUST run brace-balance check. | reduced-motion → exits at 5707 |
| 5708–5982 | SITE-WIDE-APPLE-GLASS treatment + purple hover glow + focus rings + Identity Map navigator CSS | none (until 6044) |
| 6044–6166 | Identity Map mobile compression + sheet modal CSS + mobile carousel CSS | @media (max-width: 640px) at 6044 + 6123 |
| 6200+ | iPhone mobile section padding compression block | @media (max-width: 640px) |

**Brace-balance checkpoint after every edit:**
```bash
awk '/<style>/{f=1} f{open+=gsub(/\{/,"{"); close_+=gsub(/\}/,"}")} \
     /<\/style>/{f=0; print "open=" open " close=" close_; exit}' index.html
```
Must report equal open/close counts. As of 2026-05-26 commit `c0596b3`:
**936 open / 936 close**. As of 2026-06-25 (apps-section dark-glass +
footer/AAGL-banner glass + hero-parallax fix): **968 open / 968 close**.

**2026-06-25 — Apps section converted from LIGHT to DARK glass.**
`.apps-section` background was `rgba(255,255,255,0.60)` (light); it is now
`rgba(0,0,0,0.45)` (dark, matching `.research-section`) so the fixed hero
line-art shows boldly behind the app cards. `.app-card-v2` is no longer a
solid white card — it is REAL frosted glass (added to the site-wide glass
selector list alongside `.research-card`), with light text (h3 `--white`,
p `--gray-4`, `.app-tag` `#c4b5fd`). The old opaque
`linear-gradient(#ffffff→#f3f0fb)` + `backdrop-filter:none` override was
REMOVED. **DO NOT revert the apps section to a light/white background or
re-add an opaque fill to `.app-card-v2` — that recreates the "permanent
frost, not Apple glass" bug the user repeatedly reported.** Same change
gave `.aagl-accepted-banner` (was solid `#16161c`) and `footer` (was solid
`#000`) real backdrop-filter glass.

**2026-06-25 — Hero parallax must emit `transform: none` at rest.**
In `tick()`, `.hero-inner` now sets `transform: none` when the parallax
offset ≈ 0 (instead of `translateY(0px)`, which computes to an identity
matrix). An identity-matrix transform STILL makes `.hero-inner` a backdrop
root on iOS Safari and flattens the `.hero-sub` / `.hero-meta` glass on
load. Do not "simplify" this back to an unconditional `translateY()`.

**2026-06-26 — All 7 modals converted to full-screen Liquid Glass overlays.**
User requirement: "FULL SCREEN WITH EASY CLICK OUT WHERE THE MODAL IS FULL
APPLE GLASS BACKGROUND EFFECT" — previous frost-style treatment rejected
("that looks frost, not glass").

Surgical hub panel (lines 2378-2454): Now `position:fixed; inset:0; z-index:250`
full-screen overlay (was inline `display:grid` that stacked below next section
on mobile). Lighter backdrop (rgba 0.52, blur 8px vs old 0.78/28px). Card is
translucent: 55-62% tint gradient + `backdrop-filter: blur(42px) saturate(190%)`
— page content refracts through (glass, not frost). Luminous purple border +
specular top edge (inset white highlight). Body scroll locked via
`document.body.style.overflow='hidden'` on open. Backdrop-click + Escape + X
button handlers for "easy click out".

Video modal (relocated lines 8386+): Moved from inside research section
(~line 7913) to body level (before app-modal at 8386). Fix: z-index was
trapped in research section's stacking context, letting nav paint over it.
Now at body level with z-index:10000, close button properly clears nav.

App/domain/contact/omt/evidence modals: Same Liquid Glass treatment applied.
All backdrops lightened to rgba 0.52, blur 8px. Cards translucent with heavy
backdrop-filter blur(42px) saturate(190%). Luminous borders (rgba white
0.14-0.30) + specular edges. **DO NOT revert any modal to opaque cards on
heavy blurred backdrops — that's frost. The translucent card + light backdrop
+ heavy card blur pattern is Liquid Glass.**

---

## 4. `index.html` inline `<script>` atlas (lines ~7914 – ~9990)

### 4.1 The execution-timing trap

The inline `<script>` block opens at line **~7914**. When the HTML
parser hits this `<script>` element, it pauses HTML parsing, executes
the ENTIRE script synchronously, then resumes parsing. Therefore:

- DOM elements declared BEFORE line ~7914 are in the DOM when the
  script first runs.
- DOM elements declared AFTER line ~7914 (e.g. `<dialog id="mz-sheet">`
  near line ~9885, end-of-body decorative HTML) are NOT in the DOM
  when the script first runs.

**RULE:** Any initializer in this block that queries an element
declared after line 7914 MUST defer execution to `DOMContentLoaded`:
```js
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', myInit);
} else {
    myInit();
}
```

Reference incident: §1.3.

### 4.2 Function / IIFE inventory (high-level)

| Line range | Name | Queries DOM after 7914? | DOMContentLoaded guard? |
|---|---|---|---|
| 7913–7982 | Hero loader + page-loader fade | no | n/a (queries hero, declared earlier) |
| 7997–8033 | Contact modal handlers (`openContactModal`, `closeContactModal`) | no | n/a |
| ~8040–8100 | Hub-panel modal handlers (surgical hub overlay, 2026-06-26) | no | n/a |
| ~8100–8165 | App modal handlers (`openAppModal`, `closeAppModal`) | no | n/a |
| ~8165–8230 | Domain modal handlers (`openDomainModal`, `closeDomainModal`) | no | n/a |
| ~8230–8285 | OMT modal handlers (`openOmtModal`, `closeOmtModal`) | no | n/a |
| 8286–8444 | Evidence modal handlers (`openEvidenceModal`, `closeEvidenceModal`) | no | n/a |
| ~8386+ | Video modal (relocated 2026-06-26 from research section to body level for z-index fix) | yes (videoModal) — but globals, not auto-fired | n/a |
| 9285–9398 | Identity Map setup (`identityCards`, `identityPips`, `identitySections`) | no — declared at line ~6260 (before script) | n/a |
| 9404–9637 | `tick()` rAF-throttled scroll handler + `lastIdentityActive` + scroll-spy | no | n/a |
| 9645–9728 | `initSeeAllSheet()` (sheet modal dormant — currently no triggers fire it) | **YES — queries `mz-sheet` at line 10066** | **YES (added 2026-05-26)** |
| 9730–9820 | `initMobileCarousels()` (carousel + pip indicators for each `[data-mobile-carousel]` grid) | no — queries grids at lines 6369 / 6650 / 6847 / 6969 | YES (defensive — same pattern) |
| 9908–9935 | Research-card preview autoplay IntersectionObserver IIFE | yes (`.video-preview`) but tolerant of empty results | n/a |
| 9941 | `if (typeof toggleFeatureSound === 'function') { window.toggleFeatureSound = toggleFeatureSound; }` — **DEFENSIVE GUARD added 2026-05-26 per §1.2.** | n/a | n/a |
| 9959–9980 | Hero video autoplay IIFE | yes — hero declared earlier, fine | n/a |

### 4.3 Reference graph — IDs / classes the script depends on

If you rename / remove ANY of these in HTML, JS will break:
- `#heroVideo`, `.hero-inner`, `.monogram-stage` — hero loader + tick()
- `#scrollProgressBar`, `#ambientGlow` — tick()
- `.pinned-showcase`, `.pinned-frame` — pinned showcase. 2026-06-25 (a): the
  300vh sticky scroll-swap was REMOVED; the two `.pinned-frame`s became
  normal-flow blocks that scroll-reveal independently via `data-reveal="up"`.
  `.pinned-bg` is `display:none`. `tick()` no longer switches frames. The
  cinematic backdrop fade reads `pinnedSection.offsetHeight` live, so it
  auto-adapts.
  2026-06-25 (b): each `.pinned-frame` is now `min-height:100svh` (one
  viewport per component) and a **velocity-independent scroll-snap
  controller** (`initPinnedSnap()` IIFE, just after `tick();`) hijacks
  wheel/touch/keyboard ONLY while the showcase is in view, animating
  scrollY one frame per stroke regardless of flick velocity (busy-lock
  swallows the rest of the gesture). Snap stops are
  `[hero-escape, Foundation, Innovation, About-escape]`; the escape
  anchors release the reader out at each end instead of trapping. Stops
  use the **offsetParent-chain layout top** (NOT getBoundingClientRect —
  the frames' `data-reveal` transform would otherwise skew the stop).
  Controller temporarily sets inline `scroll-behavior:auto` on `<html>`
  during its animation because the global `html{scroll-behavior:smooth}`
  (line ~47) would otherwise fight every per-rAF `scrollTo`. Disabled
  under `prefers-reduced-motion` and a no-op with <2 frames. If you rename
  `.pinned-frame`, change `#about` (the down-escape anchor), or remove the
  100svh frame sizing, this controller breaks.
- `#cinematicIntro` — cinematic video backdrop
- `.identity-card[data-identity]`, `.identity-pip[data-target]`,
  `#identity-map` — Identity Map scroll-spy (Commit 1)
- `[data-mobile-carousel]` — initMobileCarousels()
- `.mz-grid-pips` — built dynamically by initMobileCarousels()
- `#mz-sheet`, `#mz-sheet-content`, `[data-mz-sheet-close]` —
  initSeeAllSheet() (currently dormant)
- `#hub-panel`, `.surgical-hub-panel`, `#appModal`, `#domainModal`,
  `#contactModal`, `#omtModal`, `#evidenceModal`, `#videoModal` —
  full-screen Liquid Glass modal overlays (2026-06-26). All have
  open/close function pairs + backdrop-click + Escape handlers + body
  scroll lock. Video modal relocated from research section to body level
  (z-index was trapped in stacking context, nav painted over it).
- `.hub-tile[data-category]` — triggers surgical hub panel overlay
- `.research-card-video[onclick=openVideoModal(...)]` — video previews

---

## 5. `functions/_lib/*` — shared helpers

For each helper: who calls it, what depends on its signature.

| File | Exports | Callers | Lock-step requirement |
|---|---|---|---|
| `auth.js` | `getSession`, `requireRole`, `requireRoleOptional`, `signSession`, `verifyPassword`, `hashPassword`, `nowMs`, `PBKDF2_ITERATIONS` | Every `functions/api/v1/patient/*` + every `functions/api/v1/admin/*` (~80 files); `_middleware.js` | **§9.8.3:** `PBKDF2_ITERATIONS` MUST equal 100000 — if you change, you also change `scripts/_reset_admin_password_node.sh::iters`. **§10.10:** `getSession` accepts optional `ctx` and uses `ctx.waitUntil()` for `last_seen_at` UPDATE; if you change signature, touch `requireRole` + `requireRoleOptional` + every endpoint that passes `ctx`. |
| `audit.js` | `logAudit(env, entry, ctx?)` | Every auth-sensitive route (~60 files) | **§10.10:** `ctx` param hands D1 INSERT to `ctx.waitUntil()`. If you remove `ctx` support, every endpoint regresses to synchronous audit and CPU-budget 503s reappear. |
| `db.js` | `requireDb`, `getById`, `newId`, table/column whitelist | Most of `functions/api/v1/*` | If you add a table, add it to the whitelist here AND add migration to `schema/*.sql`. |
| `phi.js` | `wrapDek`, `unwrapDek`, `encryptPhi`, `decryptPhi`, `decryptPhiText`, `decryptPhiJson`, `putPhiObject`, `getPhiObject` | Documents, messages with attachments, snapshots | **PHI key rotation:** `scripts/phi_master_key_rotate.sh` calls `functions/api/v1/admin/phi/rotate.js` which uses BOTH `PHI_MASTER_KEY_OLD` + `PHI_MASTER_KEY`. Lock-step. **`decryptPhi` returns a `Uint8Array`, not a string** — passing it to `JSON.parse` coerces to `"123,45,67,…"` and throws at position 3; use `decryptPhiText`/`decryptPhiJson`. **AAD is not a hint:** AES-GCM decryption FAILS on a mismatch, and five different AAD conventions exist across writers (`documents:<patient>:<doc>`, `message_attachment/<attachment_id>`, `encounter/<enc>/photo_<n>`, `encounter/<enc>/ios_photo_<n>`, `clinical_ai/<session>/<part>`). Since **schema 0037** every writer records what it sealed with in `documents.phi_aad` and readers use that instead of guessing — the guess is what made a member's own message attachment 500 on download from `/portal/documents/`. A new writer MUST set `phi_aad`. |
| `anthropic.js` | `callClaude(env, prompt, opts)` | `intake/triage.js`, `briefings/*`, AI snapshots, drug-AE, PROM recommender | **§12.2 BAA gating:** until Anthropic BAA signed, NEVER call with PHI. Every caller must de-identify per §11.7.2 prompt template. |
| `totp.js` | `verifyTotp` | `functions/admin/_mfa.js` | RFC 6238 — don't change skew/period without re-enrolling. |
| `mfa_cookie.js` | `signMfaCookie`, `verifyMfaCookie` | `functions/admin/_middleware.js`, `_mfa.js` | If you rotate `ADMIN_MFA_COOKIE_KEY`, every active admin session invalidates. |
| `preview_invite.js` | `mintInvite`, `redeemInvite`, `signCookie`, `verifyCookie` | `/api/v1/admin/preview-invite.js`, `/portal/preview-grant/` | Rotating `PREVIEW_INVITE_KEY` invalidates all outstanding preview-grant URLs. |
| `preview_gate.js` | `previewAccess(request, env)` | `functions/portal/_middleware.js` | Honors `PORTAL_PUBLIC_LAUNCH` env + admin auth + signed preview cookie. |
| `clinical_grounding.js` · `kb_fields.js` | **The KB rule, enforced.** The owner's standing instruction: clinical answers come from HIS curated library, never from model training data. On 2026-08-13 that was enforced NOWHERE — the 1,144-document `kb_docs` index was wired into ONE endpoint (`admin/ai/suggest-edit.js`, a website-copy editor) while triage, after-visit summaries, patient message drafts, visit-prep packs and the PROM recommender all called the model with no reference material at all. A PRE-FLIGHT topical gate was built first and **abandoned on the evidence**: `scripts/calibrate_kb_grounding.mjs` showed in-scope CBG/MIGS questions score 98% mean coverage and out-of-scope questions score 98% too ("diabetic ketoacidosis insulin infusion protocol" scored 100%), because this is a general OB/GYN corpus that legitimately discusses asthma, insulin and corticosteroids. Coverage is kept as an ADVISORY signal and is explicitly not a gate. Enforcement is POST-GENERATION: `verifyGrounding()` rejects output with a fabricated citation, a citation whose document does not support the claim (checked by term overlap against the real text), or any uncited clinical assertion. `kb_fields.js` maps each task to the KB fields that answer it — a patient reply leads with `patientCounselingPoints`, triage with `criticalThresholds` — because `kb_load_d1.py` used to flatten all fifteen structured fields into one blob, which is why the first live run grounded a patient reply in a JMIG paper about robotic device malfunctions. | `_lib/intake_triage.js` · `_lib/visit_summary.js` · `_lib/visit_prep.js` · `_lib/prom_recommender.js` · `api/v1/admin/messages/[thread_id]/draft.js` · `api/v1/sync/ai-bridge/[[path]].js` · `scripts/claude_bridge.sh` | **`scripts/check_clinical_grounding_wired.mjs` is a deploy gate**: it enumerates every model call site and requires each CLINICAL one to ground, instruct AND verify. A new model call site must be classified deliberately or the deploy fails. Field-aware retrieval needs `kb_sections`, loaded by `scripts/kb_load_d1.py` from the machine holding the KB chunks; it degrades to the flat `kb_docs` index when absent, so deploying is safe either way. |
| `iso_date.js` | Real-calendar date validation and bounded query windows. Three endpoints validated dates with a SHAPE regex, so `2026-02-31` was accepted, stored, and then matched no calendar query again — written, acknowledged and lost. `isLoggableDate()` also refuses the future (one day of grace for patients west of UTC). `checkWindow()` caps a request at 400 days: `?from=1900-01-01` on trends returned 46,246 points in 1.6 MB. | `api/v1/patient/symptoms/diary/[date].js` · `.../diary.js` · `.../trends.js` | Gate: `scripts/test_iso_date.mjs` (50). |
| `portal_headers.js` | `PORTAL_BASE`, `BASE_CSP`, `BILLING_CSP`, `PERMISSIONS_DEFAULT`/`_TECH_CHECK`/`_BILLING`, `portalHeaders(path)`, `applyPortalHeaders(resp, path)` | `functions/portal/_middleware.js` (every `/portal/*` response passes through `seal()`) | **DO NOT move these back into `_headers`.** That file APPENDS — a path rule does not replace the site-wide `/*` rule, and the browser then resolves duplicate **Permissions-Policy** features **first-wins** and duplicate **CSPs** by **intersection**. Both overrides were therefore inert while looking correct in `curl`: `/portal/tech-check/` still had `camera=()` in force (an EMPTY allowlist disables the feature for the page's OWN origin, so `getUserMedia` rejected with `NotAllowedError` before any prompt and the device check told every patient their camera was broken), and `/portal/billing/` still enforced the strict CSP alongside the Stripe one (`window.Stripe` undefined → "Stripe is not defined" in the payment modal). Only `!` genuinely unsets. Separately, `_headers` never applies to a response a **Function constructs** — the pre-launch Coming Soon page, `/portal/visit/<id>/launch`, `/portal/nps/<token>` shipped with three headers, no CSP and a `public, max-age=60` cache. `applyPortalHeaders` uses `Headers.set()` so exactly one policy per header reaches the browser. Adding a portal page that needs a different policy = add a branch in `portalHeaders()` + a case in `scripts/test_portal_headers.mjs` (97 assertions, deploy gate). |
| `admin/_login.js` + `admin_session.js` | **One BRANDED sign-in for the whole backend (2026-08-19).** `/admin/_login` is the door: a glass sign-in page matching the admin theme, accepting the username OR any address in `ADMIN_EMAILS` (case-insensitive) against the same PBKDF2 hash and the same KV lockout the Basic path used. The middleware no longer sends `WWW-Authenticate` to a browser — that header is what summons the unstyled grey dialog — so a document request without a session gets a 302 to the login page, while an API client still gets a plain 401 (Basic is ACCEPTED everywhere, just never DEMANDED of a person). `admin_api.js`'s 401 dropped its challenge header too, for the same reason, and carries `login_url` so the SPA can send the operator somewhere branded. **One sign-in for the whole backend.** Signing into the admin used to take TWO credential prompts with TWO DIFFERENT usernames: the browser's native Basic dialog wanting `ADMIN_USER` (`drmabini`), then a glass modal injected by `admin/_nav.js` before any API call that defaulted to an EMAIL ADDRESS — a value `readAdminIdentity` never accepts, since it compares against `ADMIN_USER`. `admin/trend-briefs/` carried a THIRD copy via `prompt()`. The second prompt existed because SPA fetches to `/api/v1/admin/*` could not rely on the browser replaying Basic credentials outside the `/admin` path tree; the fix is a SESSION, not another prompt. A successful password check in `functions/admin/_middleware.js` now mints a signed HttpOnly cookie (`mz_admin_session`, HMAC over `expiry|user`, 12 h, keyed by `ADMIN_SESSION_KEY` falling back to `SESSION_SECRET`), and every admin auth path accepts it. | `functions/admin/_middleware.js` (mints + accepts) · `_lib/admin_api.js::readAdminIdentity` · `api/posts/[[path]].js::isAdminRequest` · `admin/_signout.js` (clears it) · `admin/_nav.js` | **Do NOT reintroduce a client-side credential prompt in `admin/_nav.js` or any admin page.** A 401 on an admin fetch means the session expired — reload, and the middleware challenges once. Basic auth is still accepted for API clients with no cookie jar (the transcription app, scripts, curl). `SameSite=Lax` is load-bearing: the cookie rides top-level navigation to `/admin` but is not sent on cross-site POSTs, which is what protects the state-changing admin API from CSRF; `HttpOnly` keeps it away from an XSS payload on an admin page. Verified live: forged signature, wrong user, and expired-but-signed cookies are all 401, and `/admin/_signout` clears both `mz_session` and `mz_admin_session`. |
| `session_trace.js` | `recordTrace`, `traceWrap`, `listRecentTraces` | Optional wrapping in any endpoint for debugging | PHI-conservative SHA256+salt-hashed IPs. |
| `wizard.js` | `WIZARD_STEPS`, `computeStepStatus` | `/api/v1/patient/wizard/state.js`, `portal/_wizard.js` injection | Adding step: update `WIZARD_STEPS` + `computeStepStatus` + UI in `_wizard.js`. |
| `stripe.js` | `createCustomer`, `createPaymentIntent`, `verifyWebhook` | `functions/api/billing/stripe/*` | If signature changes, touch `_stripe_e2e_*.sh` test scripts. |
| `messaging.js` | `listThreads`, `startThread`, `replyInThread`, `markThreadRead`, `computeSlaDueAt`, `ALLOWED_URGENCIES` | `/api/v1/patient/messages/*` + `/api/v1/admin/messages/*` | Patient + admin endpoints share storage — schema change in `0004_phase3_messaging.sql` touches both. **R8 SLA lock-step:** `urgency`/`sla_due_at`/`sla_breached` (migration 0022) flow `startThread`/`replyInThread` → both `listThreads` SELECTs → `portal/messages` compose radios → `admin/messages::slaBadge` → `cron-worker/index.js::runSlaSweep` (15-min cron). Changing the clock semantics touches all six. **Attachments (2026-08-18, UI closed):** `message_attachments` rows (schema 0037) + envelope-encrypted bytes in `mountzara-phi` flow `POST /api/v1/{patient\|admin}/messages/<thread>/<message>/attachments` (multipart `file`, 25 MB cap, MIME allowlist; patient may attach only to messages they authored, admin only to clinician-authored) → `loadThreadMessages` returns an `attachments` array per message → BOTH messages pages render download chips (`/api/v1/{patient\|admin}/messages/attachments/<id>`, served `content-disposition: attachment`) and both compose surfaces (new + reply, each side) carry a file picker that uploads after the send returns `message_id`. The endpoints predate 2026-08-18; the UI did not — a send failure leaves no orphan because the upload only fires after a 201. |
| `intake_sections.js` | Schema for 19 intake sections | `/api/v1/intake/*` endpoints + `portal/intake/*` UI | Adding section: schema migration + endpoint + UI in lock-step. |
| `intake_triage.js` | De-identify intake → call Claude → write `appointment_triage` | `/api/v1/intake/[id]/triage.js` | Per §11.7 — never send PHI to Claude until BAA. |
| `licensure.js` | `getLicensedStates(env)`, `isLicensedInState(env, state)`, `recordLicensureBlock(env, {patient_id, state, reason})`, `_resetCache` | The R3 state-gates + the R4 launch presence re-check — `intake/[id]/submit.js`, `intake/[id]/triage.js`, `appointments/book.js`, `appointments/[id]/launch.js` — plus `/api/v1/admin/practice/licensed-states.js` (write side) + `admin/scheduling/index.html` (picker UI) | **Phase 17 R3/R4.** Reads `practice_settings.licensed_states_json` (keyed by clinician); 60 s cache; conservative `["IL"]` fallback (fails closed). Patient state of residence comes from intake **Section 1 `address_state`** (a `<select>` in `portal/intake/index.html`, stored schemaless in `intake_section_data`). Changing the storage key/shape touches all 3 gates + the admin endpoint + UI + the intake field in lock-step. |
| `prom_*.js` | PROM scoring, AI recommender, intake orchestrator | `/api/v1/patient/proms/*` + `/admin/proms/*` | PROM definitions in `0010_phase10_*.sql` migrations. |
| `billing*.js` | Insurance + Stripe + AI advisor + invoice tax export | `/api/v1/admin/billing/*` | Schema migrations 0007-0009. |
| `coding_coach.js` | Cross-encounter CODING COACH — aggregates the per-encounter coding analysis the transcription app syncs in (`billing_claims` / `billing_compliance_flags` / `billing_upcoding_opportunities` / `billing_claim_lines`) into undercoding-recovery + recurring-flag/modifier/doc-gap patterns + deterministic coaching actions. Pure shapers are unit-testable; reuses `windowRange` from `billing_insights.js`. De-identified aggregates only (no PHI → no BAA needed). | `/api/v1/admin/billing/coding-coach.js` + UI `admin/billing/coach/index.html` (linked from `admin/billing/` header) | Reads the §11 transcription-sync coding tables (schema 0006). Compliance framing is deliberate: undercoding RECOVERY tied to documentation already in the note — never speculative upcoding. |
| `x12_837.js` · `claim_scrub.js` · `clearinghouse.js` · `payer_directory.js` | **Outbound billing rail.** `claim_scrub.scrubClaim(norm)` = clean-claim gate (hard blocks + denial-risk warnings; deterministic, unit-tested). `x12_837.generate837P(norm)` = ANSI X12 5010A1 837P EDI generator (unit-tested structure). `clearinghouse.js` = MULTI-vendor adapter (`mock`/`stedi`/`change_healthcare`/`availity`/`claim_md`/`office_ally`/`waystar`), `CLEARINGHOUSE_VENDOR`-selected, per-vendor creds+endpoints from env; `submitClaim`/`checkEligibility`/`isConfigured`. `payer_directory.js` = IL/CA + national payer scaffold (26 payers; IDs flagged for clearinghouse verification — never trusted blindly). Orchestrated by `POST …/claims/:id/submit`; go-live via `…/billing/clearinghouse` (readiness checklist + `seed_payers`). Runbook: `docs/BILLING_GO_LIVE.md`. | `claims/[id]/submit.js` · `billing/clearinghouse.js` | PHI on a live vendor call → keep `mock` + usage `'T'` until creds set + per-payer EDI enrollment + a verified 277CA test (`CLEARINGHOUSE_LIVE=1` flips usage to `'P'`). Payer IDs are clearinghouse-specific — confirm each against the live payer list before production. Insurance captured per-patient (`patient_insurance` table, schema 0025; `GET/PUT /api/v1/admin/patients/:id/insurance`; editor `admin/billing/insurance/`) → the submit endpoint auto-fills it (body still overrides); scrub blocks if a patient's is missing. Inbound rail: **835 ERA built** — `x12_835.parse835()` + `POST /api/v1/admin/billing/era` (admin or X-Pipeline-Token) auto-posts payments → paid/partially_paid/denied + CARC codes. Go-live console `admin/billing/clearinghouse/index.html` (readiness checklist · one-click payer→CH routing `route_by_kind` · 837 test-claim box). **ERA paste/post UI lives on `admin/billing/index.html`** (2026-08-18 — this row previously claimed the console had it; it never did): a collapsible panel POSTs the raw 835 text to `/api/v1/admin/billing/era` and renders payer/trace/posted/unmatched/skipped plus per-claim results. The same page's claim list now sends an explicit `days` window (60/180/365 selector) — before that the API's silent 60-day default hid older claims with no UI hint. 270/271 eligibility interface stubbed (`checkEligibility`); 276/277 status poll still TODO. |
| `clearinghouse_onboarding.js` · `clearinghouse_credentials.js` | **Clearinghouse setup wizard engine.** `clearinghouse_onboarding.js` is pure, testable logic: `STEPS`/`PROFILE_FIELDS`/`PROFILE_GROUPS` (field specs), `npiValid` (CMS Luhn over `80840`+NPI — catches transpositions at entry, not six weeks later in a rejection), `zip9Valid`/`tinValid`/`taxonomyValid`, `validateProfile` (conditional requirements — a sole proprietor is not nagged for a Type 2 NPI), `VENDOR_FACTS` (per-vendor enrollment facts, each carrying `verified` + source URL), `INTERVIEW`+`scoreVendors` (ranked recommendation that ships its REASONS so it is auditable), `pairingAdvice`/`routingPlan`/`validateVendorSet`/`vendorReadiness` — **the vendor list is a SET, not a single choice**: running Availity (free Blues eligibility) alongside a full-service clearinghouse (government claims) is the normal shape for an IL/CA practice, so steps 3-5 render a tab per clearinghouse and each keeps its own packet, credentials, payer enrollment and test claim. `validateVendorSet` catches the expensive mistake (Availity alone cannot carry Medicare/Medicaid); `routingPlan` proposes payer-kind → vendor and NAMES the gap rather than silently routing government to a vendor that cannot carry it; `apply_routing` writes it onto `billing_payers.clearinghouse_vendor`, which `submitClaim` already honours. Add/remove is a soft delete (`clearinghouse_vendors.removed_at`) so leaving a clearinghouse keeps its enrollment history and credentials, `buildApplicationPacket` (profile → the exact values each application asks for), `buildEnrollmentMatrix`/`enrollmentSummary` (per-payer EDI/ERA/EFT tracker — the step that actually stalls practices), `readiness` (six-step gating; every step reports a human reason, never a bare false). `clearinghouse_credentials.js` = envelope-encrypted vendor credential storage + `withStoredCredentials(env, vendor)`, a Proxy that merges stored creds into `env` so `submitClaim`/`isConfigured` pick them up **without any change to `clearinghouse.js`** — env secrets ALWAYS win, DB is the fallback. | `api/v1/admin/billing/clearinghouse-setup.js` · `admin/billing/clearinghouse/index.html` · `schema/0032` · `_lib/phi.js` · `_lib/payer_directory.js` | **DOCTRINE (inherited from `credentialing_wizard.js`): never assert a requirement the vendor does not publish.** Vendor terms/pricing/endpoints change without notice; unverified items surface as explicit "confirm with the vendor" tasks, visually separated from sourced ones. **No invented pricing and no invented turnaround** — `cost_verified` is `false` everywhere on purpose. AI is deliberately OFF the critical path: every step is deterministic data, so the wizard cannot be blocked by an unreachable model. Tests: `scripts/test_clearinghouse_onboarding.mjs` (95 assertions; covers NPI check digit, conditional requirements, scoring direction, TIN masking, and the regression that matters — **rebuilding the payer checklist must never discard recorded enrollment progress**, and **one verified clearinghouse must never vouch for an unverified second one**). Requires migration `schema/0032`; the API returns `503 {schema_missing:true}` with the exact wrangler command rather than a 500 with a SQL string in it, and the page renders that as an instruction. |
| `nppes.js` · `enrollment_extract.js` | **Wizard autofill — two paths, both refusing to guess.** `nppes.js` calls the public CMS NPI registry (no key, no cost) and maps the record onto the profile: legal name, taxonomy, licence, practice + pay-to addresses, ZIP+4, phone. This is BETTER than AI here — it is the authoritative source payers themselves check, so filling from it makes the commonest EDI rejection (name/address mismatch vs NPPES) impossible by construction. Proposes, never overwrites. `enrollment_extract.js` reads the practice's OWN paperwork (W-9, CMS-855, PTAN letter, Medicaid welcome, licence, clearinghouse welcome, EDI approval) and proposes profile fields. **It deliberately does NOT de-identify** — a W-9's whole purpose is to carry the identifiers we are reading — so admission is gated deterministically by `looksLikePatientDocument()`, which runs `_lib/deidentify.js` (the website mirror of the Mac app's `DeidentificationService`) as a DETECTOR and hard-refuses on MRN / member-ID / clinical language **before any model call or any storage**. Every proposed field must carry a verbatim `quote` or it is dropped; values are format-checked (NPI check digit catches OCR misreads) and confined to an allowlist so a hallucinated key cannot reach the profile. Nothing auto-commits — the physician accepts field by field. | `api/v1/admin/billing/clearinghouse-setup.js` · `_lib/deidentify.js` · `_lib/ai_router.js` · `_lib/phi.js` · `schema/0033` | **Do NOT route patient documents here — use `correspondence_extract.js`, which Safe-Harbor scrubs first.** The two pipelines have opposite requirements and sharing one would either leak PHI or return nothing useful. Files are stored envelope-encrypted in R2 (`env.PHI`) because a W-9 carries an EIN or an SSN; D1 keeps metadata and the extraction OUTCOME only, never the document text. AI routes through `ai_router` — with no `ANTHROPIC_API_KEY` it enqueues a CLI-bridge job and says so rather than failing silently. Autosave lives in `clearinghouse_profile_draft`, kept SEPARATE from the saved profile so a half-finished draft can never be silently promoted past validation. Tests: `scripts/test_enrollment_autofill.mjs` (32 assertions — the gate must refuse a chart/EOB/op-note AND admit a W-9; a gate that blocks everything gets uninstalled). |
| `_lib/notify.js` (sendViaCloudflare) · `scripts/setup_cloudflare_email.sh` · `scripts/test_notify_provider.mjs` | **Mail provider: Cloudflare Email Sending (2026-08-20).** AWS refused SES production access twice on "no sending history" — a catch-22 for a sandboxed account. Owner: "Fix this for cloudflare." `sendViaCloudflare` posts the REST endpoint (`from.address` / `reply_to` — the WORKERS-binding names `from.email`/`replyTo` are wrong for REST and 400), and the send response's `permanent_bounces` writes the `email_suppression` row synchronously — replacing the whole SES/SNS webhook pipeline, which stays wired only for the SES fallback. **The retry hole this work found:** `sendDirect()` (the outbox flush path) skipped the reserved-domain and suppression guards, and `isPermanent()` treats the sandbox's "not verified" as recoverable — so the first flush after a working provider went live would have replayed six `@mountzara.test` rows as guaranteed hard bounces. Guards added to `sendDirect`, error strings pinned to `isPermanent`'s classifier, and the six rows retired to `abandoned` in D1. **BAA:** Cloudflare Email Service's BAA coverage is UNDOCUMENTED — "cloudflare" is deliberately NOT in `BAA_PROVIDERS`; `NOTIFY_ALLOW_NON_BAA=yes` is valid only pre-launch, and the notifications health endpoint surfaces this as a launch gate. Setup is one command once a token with **Email Sending: Edit** exists (the ONLY human step — no on-box credential can reach `/email/sending/*` or mint tokens, both probed 2026-08-20): `CF_EMAIL_TOKEN=<tok> ./scripts/setup_cloudflare_email.sh`. | `functions/api/v1/internal/notifications/flush.js` · `functions/api/v1/admin/notifications/health.js` · `functions/api/v1/internal/ses/feedback.js` · Pages env (`CF_EMAIL_TOKEN`, `CF_EMAIL_ACCOUNT_ID`, `NOTIFY_PROVIDER`) | **The provider switch is `NOTIFY_PROVIDER` and nothing else** — rollback is setting it back to `ses`; both providers' secrets stay configured. `test_notify_provider.mjs` (24 checks, in the deploy suite) pins payload shape, synchronous bounce suppression, the guarded retry path and the BAA gate. |
| `scripts/strip_html_comments.mjs` · `scripts/audit_nav_and_reading.py` | **Authoring comments were a published design document (2026-08-20).** The existing strip step removed only `§0.8` / `kb_doc_id` provenance, so every other comment this repo writes into markup was served: which gate enforces which invariant, where the hero fingerprint lock lives, why each breakpoint is the number it is, what every `data-` attribute drives. 204 comments across 48 pages, 45.6 KB — against the owner's directive that a visitor must not be able to learn how the site works. `strip_html_comments.mjs` now removes ALL HTML comments from the **stage only** (repo keeps them), skipping `<script>`/`<style>` regions because a JS string may contain `<!--` and a naive regex would eat live code to the next `-->`; it has a `--self-test` the deploy runs before letting it touch the stage. Same commit added the nav + reading-sheet gate — see §8c. | `scripts/deploy-prod.sh` · every `*.html` | **A comment is deployed code.** The stripper must never be a bare global regex; the KB-manifest leak happened because `[^>]` stopped at the first `>` inside JSON. The self-test covers exactly that case, plus comment-lookalike strings inside `<script>` and `<style>`. |
| `education/_middleware.js` (hardening) · `check_public_headers.mjs` | **The `_headers` trap, third occurrence (2026-08-20).** `_headers` declared the full hardening set — HSTS, CSP with `frame-ancestors 'none'`, `X-Frame-Options: DENY`, the `noai` directives — and **none of it reached `/education/*`**, because Cloudflare never applies `_headers` to a response a FUNCTION returns and that middleware returns every one of them. Twelve clinical guides were served with no CSP and embeddable in any third-party page, while the file that configured them read correctly. `/portal/*` hit the identical trap (`_lib/portal_headers.js`) and the pre-launch Coming Soon page hit it before that. Fixed by hardening inside the middleware with `Headers.set()` (append would leave duplicates, which browsers resolve for CSP by INTERSECTION and Permissions-Policy first-wins). Separately, the deploy now **strips internal provenance from the staged copy**: 278 `§0.8 anchor` comments plus a 6,200-char KB-anchor manifest carrying knowledge-base document ids, the field taxonomy and the claims quoted from them — the repo keeps them for the citation audit, the public bytes do not, and a guard fails the deploy if any `kb_doc_id` survives. | `_headers` · `functions/education/_middleware.js` · `functions/portal/_middleware.js` · `scripts/deploy-prod.sh` | **Configuration is not evidence.** `check_public_headers.mjs --strict` runs POST-deploy against the LIVE site and fails the deploy if any public route lacks CSP / HSTS / frame protection / `noai`, because every previous instance of this bug looked correct in the config file. Any new middleware will hit the same trap; the assertion is what catches it. Source is not otherwise exposed — verified that `/functions/*`, `/schema/*`, `/scripts/*`, `wrangler.toml`, `CLAUDE.md`, `SYSTEM_MAP.md`, `docs/*` and `.git/*` all 404, and every admin/internal/sync endpoint refuses unauthenticated. |
| `check_citation_integrity.mjs` · `verify_citations.mjs` · `attach_citation.mjs` | **The site enforces its own citations (2026-08-20).** The twelve patient guides shipped for months carrying 556 references of which only 85 were cited anywhere in the text; the padding read as rigour, several unused papers were plainly off-topic for their guide (music therapy during labour under contraception, adjuvant breast-cancer therapy under the same), and the endometriosis guide had TWO `<li id="ref-14">` blocks so every `[14]` marker silently resolved to the first. A patient is invited to check these sources, so that invitation must hold on every deploy rather than on the days someone audits. `check_citation_integrity.mjs` is a **deploy gate**, structural and offline: every reference must be cited somewhere, every inline marker must resolve, ids unique and sequential, the visible `[N]` must match its anchor, and the public `/education/<t>/` and member `/portal/education/<t>/` copies must stay byte-identical. `verify_citations.mjs` is the network half — it checks each PMID against PubMed's own record (author, title, year) and screens whether the paper shares subject matter with its guide; run it before publishing clinical content, never in the deploy path, so a deploy cannot depend on NCBI. `attach_citation.mjs` puts one verified reference back behind one claim, editing both trees together. | `education/*` · `portal/education/*` · `scripts/deploy-prod.sh` | **Judgement about WHICH paper supports a claim is never automated** — the matcher proposes by term overlap and a human reads both before attaching, because a citation that resolves perfectly and does not support its sentence is the failure this whole apparatus exists to prevent. Verified 2026-08-20: 97 citations across the guides and 555 PMIDs across the 15 published posts all resolve to real papers, zero dead PMIDs. Each gate branch was proven by injecting an orphan reference, a dangling marker and a mirror drift, and confirming the deploy blocked. |
| `note_extract.js` · `visit_type_alias.js` | **Closing the two gaps the app left, platform-side (2026-08-19).** The transcription app pushes the note but not always a patient recap, so encounters landed "not drafted" — nothing waiting for him, nothing for the patient. AI drafting cannot run on this deployment (no `ANTHROPIC_API_KEY`; the CLI bridge has not checked in for six days), so `note_extract.js` does the part needing no model: it parses the note's own SOAP structure and lifts the assessment and plan into a draft **VERBATIM**. Nothing is authored, softened or inferred, so the KB rule is satisfied by construction; a note with no recognisable assessment or plan produces **no draft rather than a mangled one**. `flagJargon()` then names the words a patient would look up (leiomyoma → fibroid) on the review screen AND in the approval response — advisory, never blocking, because approving an unedited extraction quietly hands her his note. `visit_type_alias.js` fixes the other gap: the app labels visits in speech ("Problem Visit") while `billing_service_catalog` is keyed by slug, so every synced claim sat at $0; labels resolve to keys, then the E/M code as a coarse floor, recording WHICH route priced it. | `api/v1/sync/transcription/notes.js` (auto-draft) · `coding.js` (pricing) · `api/v1/admin/encounters/[id]/summary.js` (`draft_from_note` action, jargon at review + approve) · `scripts/backfill_avs_drafts.mjs` · `scripts/backfill_claim_pricing.mjs` | **The draft is created `pending_clinician_review` and can never reach a patient unapproved** — its job is to remove the blank page, not to replace his judgement, and `source='note_extract'` records which he is reading. **The catalog holds CASH prices**: sound only while every patient is self-pay (true today — no payer contract signed, nothing submitted), and the response labels the basis `practice_cash_catalog` so a contracted rate supersedes it later. Backfills are idempotent and never overwrite a figure the app actually sent. Gates: `test_note_extract.mjs` (32), `test_visit_type_alias.mjs` (22). |
| `avs_education.js` | **The after-visit summary carries the reading for THAT visit (2026-08-19).** An AVS that says "we discussed fibroids" and stops there sends the patient to a search engine, which is where the worst information about her condition lives. On approval, the visit's ICD-10 codes (from the encounter AND from orders placed at it) map to topic tags, tags select from the practice's own PUBLISHED primers, and up to three are assigned to the patient with the reason in her words ("Because you and Dr. Mabini talked about fibroids at this visit"). `SUPPORTED_AVS_LANGUAGES` + `buildPrompt({language})` write the patient half in her `preferred_language` AND an English rendering of the same text, split at `---ENGLISH---`, so she reads her language while the approval gate still means something — he cannot be asked to approve words he cannot read. | `api/v1/admin/encounters/[id]/summary.js` (attach on approve) · `api/v1/patient/visits.js` (reading returned with the opened summary) · `_lib/visit_summary.js` · `patient_education_assignments` · `education_materials` | **Selection is by CODE, never by asking a model what the note seems to be about, and NOTHING is authored here** — the patient receives Dr. Mabini's own ACOG/peer-review-anchored primers, per the standing rule that clinical content comes from the curated library. **An unmatched visit attaches NOTHING**: a generic pamphlet stapled to a specific visit teaches her the attachments are noise, and then the one that matters is ignored too. Capped at three. Gate: `scripts/test_avs_education.mjs` (31). |
| `sync/transcription/*` (the app seam) | **MedicalTranscription.app integration — VERIFIED END TO END 2026-08-19.** The seam had looked wired for three months and had never worked once: (1) `sync_auth.js::syncRoute` never passed route `params` through, so `GET /patients/:id/context` — the endpoint that seeds every visit — returned 400 on every call it ever received while each handler looked correct in isolation; (2) `/coding` silently dropped any diagnosis whose code field was not one of two exact spellings while returning `ok:true` (a claim with no diagnoses is a guaranteed payer rejection) — it now accepts `icd10` too and reports `diagnoses_dropped` + a `warning`; (3) the app's summaries were sealed with AAD `encounter/<enc>/summary_patient` while both readers unsealed with `visit_summary_patient:<id>`, so an approved after-visit summary was marked visible and permanently undecryptable — both readers now try both conventions (safe: AAD fails closed). New rail: `POST /orders` turns dictated orders into tracked `clinical_orders` with the result clock running; `dry_run:true` returns what would be created so a mishearing is confirmed by the physician before it becomes a real order. Proven loop: pull patients → pull context → push note → push coding (claim + diagnoses land) → push snapshot → dry-run + commit orders → physician approves in /admin/visits/ → patient reads the exact dictated summary in /portal/visits/. | `functions/api/v1/sync/transcription/{patients,patients/[id]/context,notes,coding,snapshot,orders}.js` · `_lib/sync_auth.js` · `api/v1/patient/visits.js` · `api/v1/admin/encounters/[id]/summary.js` · `scripts/transcription_smoke.sh` · `docs/transcription-app-integration.md` | **STANDING POLICY: a rail is not "integrated" until data has made the round trip in production and been read back by the person it was for.** Token: `TRANSCRIPTION_SYNC_TOKEN` (rotated 2026-08-19; ops copy in `~/.config/mountzara/transcription-sync-token.txt`). Setup checklist shows "Connect the Medical Transcription app" until a real non-test encounter exists — evidence, not configuration. Smoke: `TRANSCRIPTION_SYNC_TOKEN=<t> ./scripts/transcription_smoke.sh` from the Mac. |
| `bridge_context.js` | **The PHI boundary for the local Claude CLI bridge.** The bridge runs `claude -p` against the owner's PERSONAL subscription; the Anthropic BAA covers the **API**, not a consumer CLI — so everything reaching the bridge has LEFT BAA-covered infrastructure and must carry no PHI. Enforcement is **server-side and fail-closed**: the bridge is an untrusted client (token on a laptop, editable script), so `/api/v1/sync/ai-bridge/context/<kind>/<id>` scrubs, **re-scans to VERIFY**, and returns 409 with nothing when verification fails. There is no parameter, header or flag that yields raw text. `BRIDGE_KINDS` is an allowlist — an unvetted kind is refused and `claimNext` will not even dispatch it, so billing kinds (API-only per the owner's rule) can never land here. `tokenizeNames`/`tokenizeDates` keep names and dates as INDEXED tokens so a draft is still writable ("your surgery on [DATE_1]"); `rehydrate()` restores them **server-side** before the physician reads it, and `unresolvedTokens()` discards any draft citing a token that maps to nothing rather than showing a fiction. `billingContext()` is minimum-necessary by SELECTION, not by scrubbing — CPT/ICD/modifiers/units/POS only; narrative is never chosen. | `api/v1/sync/ai-bridge/[[path]].js` · `_lib/deidentify.js` · `_lib/phi.js` · `schema/0034` · `scripts/claude_bridge.sh` | The reverse map is a literal list of real names and dates — envelope-encrypted on `ai_jobs`, dropped the moment a result is rehydrated, and TTL'd via `map_expires_at` so an abandoned job leaves nothing behind. `bridge_disclosure_log` is the append-only artifact answering "prove no PHI was disclosed": rule counts and verification results, **never matched values**, readable at `GET …/ai-bridge/disclosures`. **2026-08-13 — REAL BUG FIXED in `deidentify.js`:** the MRN / member-ID / account patterns only matched colon-separated forms (`MRN: 123`), so natural phrasing (`my MRN is 123`) passed through **while the verifier reported ok=true** — a fail-OPEN that every downstream gate trusted. Patterns now accept linking words and require a digit in the value (which also stops "medical record was complete" over-redacting). ⚠️ **The Mac app's `DeidentificationService` needs the same fix.** Tests: `scripts/test_bridge_phi.mjs` (39 assertions) — written adversarially: each searches the OUTPUT for the identifier that went IN, rather than trusting a boolean. |
| `membership.js` · `no_double_dip.js` · `visit_prep.js` · `brand.js` | **Membership programme.** `membership.js` = tiers (Standard $0 · Navigator $59 · Priority $199 · Complete $449), unit economics splitting `physician_minutes` from `automated_minutes` (the split is why the model closes — costing every minute at his rate made every tier a loss), `capacity()`/`maxPanel()` because minutes not dollars are the binding constraint for a solo surgeon, `validateTierLegality()` which fails a tier that sells a covered service **including on wording**, `eligibility()` excluding federal beneficiaries by default (42 U.S.C. §1320a-7a(a)(5)), verified `EVIDENCE` with URLs, and `valueComparison()`. **`no_double_dip.js` is the structural guarantee** the owner demanded — `TIER_PAID_FOR` maps each tier to the CPT codes its fee already bought, `screenClaim()` REFUSES those lines at submit time, and `screenTierBenefits()` guards the reverse direction so the offer cannot drift into the claim's territory. `visit_prep.js` = Navigator's deliverables + the licensure/scope gate. `brand.js` = tokens extracted from his own email signature. | `api/v1/membership.js` (public) · `api/v1/membership/interest.js` (waitlist) · `api/v1/admin/membership/interest.js` + `admin/membership/` (demand console) · `api/v1/admin/billing/claims/[id]/submit.js` (**gate wired here**) · `functions/portal/_middleware.js` (the public page) · `schema/0035`,`0036` | **THE DOUBLE-DIP GATE RUNS BEFORE THE CLEAN-CLAIM GATE AND FAILS CLOSED.** A claim that has gone out cannot be recalled; "we spotted it on the remittance" is not a control. The concrete risk it closes was already latent: Standard deliberately routes clinically-significant messages into a billable online digital E/M (99421-99423) so unpaid work does not accumulate — but Priority and Complete INCLUDE messaging in the fee, so billing 99421 for one of those members is payment twice for one message. `NEVER_BLOCKED` asserts by test that surgery, office E/M, imaging and pathology are never suppressed, because a member who is under-billed has still been failed. Tests: `scripts/test_no_double_dip.mjs` (51), `test_membership.mjs` (106), `test_visit_prep.mjs` (86), `test_membership_analytics.mjs` (26 — the demand console sits behind HTTP Basic auth and cannot be clicked through from CI, so its arithmetic is tested directly rather than shipped unverified). **Membership has no standalone page** — it lives inside `/portal/` in the portal's dark-glass theme, rendered from `/api/v1/membership`, with `/membership/*` 301'ing there. |
| `visit_summary.js` | **After-visit summaries — the feature that was advertised and not built.** `encounter_ai_summaries` has existed since schema 0003, complete with a `pending_clinician_review -> approved` status column, and NOTHING wrote to it; only `phi/rotate.js` knew the table was there. Generates TWO summaries from the encounter note — patient-facing plain language, and a denser clinician version ending in an `UNCERTAIN:` line naming whatever was ambiguous, which is what he reviews against. `checkPatientTone()` flags language that promises an outcome, minimises a concern, introduces advice or speculates — it does NOT block, because he is reviewing anyway and a flagged phrase he can see beats a silent regeneration that loses a good summary. `extractDenormalised()` fills the plan/next-step/medication columns so the portal list view needs no decryption. | `api/v1/admin/encounters/[id]/summary.js` (generate + sign off) · `api/v1/patient/visits.js` (read) · `_lib/bridge_context.js` · `_lib/phi.js` · `schema/0003` | **"REVIEWED AND SIGNED OFF BY DR. MABINI" IS A GATE, NOT A DESCRIPTION.** The portal makes that promise, which is a clinical safety claim; an unreviewed AI summary of a medical visit reaching a patient is precisely the harm it prevents. `status = 'approved'` is in the **WHERE clause** of the patient read, not applied afterwards in JavaScript where a refactor could drop it and nothing would visibly break — the rows would simply start appearing. **Regenerating RESETS approval**, because a summary he approved is not the one he is now looking at. Approving with edits replaces the patient text with HIS words, since the point of the edit is that the model got something wrong. `visit_summary` is a vetted `BRIDGE_KINDS` entry, so the note is de-identified and verified server-side before it can reach the CLI, then rehydrated. Tests: `scripts/test_visit_summary.mjs` (49). |
| `claim_assembler.js` | **Single source of truth** for loading a `billing_claims` row (+ lines/diagnoses/patient/`patient_insurance`/payer) and building the NORMALIZED claim object. Extracted from the submit endpoint so the OUTBOUND submit path AND the AI PRE-FLIGHT path assemble byte-identical artifacts. Exports `assembleClaim(env, claimRow, body)` + `billingProvider(env)`. | `claims/[id]/submit.js`, `claims/[id]/preflight.js` | If you change claim normalization, BOTH submit and pre-flight change together — that's the point. Unit-tested for equivalence. |
| `carc_codes.js` | CARC/RARC denial-code knowledge base (curated for OB/GYN + MIGS): `CARC`/`RARC` maps, `lookupCarc`/`lookupRarc`, `recommendStrategy(codes)`. Each CARC carries plain-English text + category + `appealable` + a remediation `strategy` (corrected_claim / appeal / reconsideration / patient_bill / write_off). | `billing_ai_preflight.js`, `billing_appeal.js` | Grounds BOTH the AI features so even the no-AI fallback is code-accurate. Extend as new codes appear on real ERAs. |
| `billing_ai_preflight.js` · `billing_appeal.js` | **AI-assisted denial layer** (BAA executed 2026-06-29). `aiPreflightReview(env,{norm,scrub})` = denial-prevention second opinion on the assembled claim (PHI-FREE — codes only); predicts the CARC each risk draws. `draftAppeal(env,ctx,nowMs)` = denial-response drafter (corrected-claim vs appeal vs reconsideration vs patient-bill) authoring the payer letter + corrected-claim changes; PHI-bearing by necessity (patient name/member id/DOB on the letter). Both default to `claude-opus-4-8` (override via `BILLING_AI_MODEL`; the advisor too), and both DEGRADE GRACEFULLY to a deterministic, CARC-grounded fallback when `ANTHROPIC_API_KEY` is absent. | `claims/[id]/preflight.js`, `claims/[id]/appeal.js` | Needs `ANTHROPIC_API_KEY` set as a Pages secret to enable the AI path (else fallback). **GOTCHA:** the Opus 4.7/4.8 family 400s on sampling params — `anthropic.js` `callClaude` now strips `temperature`/`top_p`/`top_k` for `modelRejectsSamplingParams(model)` (Opus 4.7+); Sonnet/Haiku keep them. `draftAppeal` is audit-logged as a PHI-bearing AI event (`claim_appeal_draft`). Persistence: `billing_preflight_reviews` + `billing_appeals` (schema 0026). |
| `orders.js` · `gfe.js` · `referrals.js` | **The downstream-of-the-visit safety net (2026-08-18).** The practice could see a patient, bill the visit and submit a claim, but could not place a lab/imaging/referral order, know a result never came back, prove the patient was told, or check that a referral went somewhere the plan covers — the exact gaps that turn an independent telehealth practice into a malpractice or No-Surprises-Act problem. `orders.js` makes SILENCE QUERYABLE: every placed order carries `result_due_at`, `isOverdue()` is a pure function of the clock so the board and any sweep cannot disagree, a `critical` result runs its own 4-hour acknowledgment clock, and ACKNOWLEDGING a result is tracked separately from COMMUNICATING it to the patient (two duties clinicians conflate and plaintiffs do not). `escalationLevel()` ranks 0–5 so the most dangerous row sorts first without anyone scanning. `gfe.js` encodes 45 CFR 149.610: the business-day deadline ladder (≥10 business days out → 3 business days; 3–9 → 1 business day; <3 → not required; on request → 3), the required content elements as a `validateGfe()` checklist that NAMES what is missing, practice-vs-outside totals, and the $400 / 120-day dispute disclaimers. `referrals.js` is the coverage guard: `coverageRisk()` BLOCKS an out-of-network HMO/EPO/Medicaid destination, WARNS on PPO, and returns `verify` — never a confident yes — whenever the answer depends on a plan document; it also raises the second HMO trap (the plan may only honour a referral from its own designated PCP). `priorAuthAdvice()` flags advanced imaging (MRI/CT/PET) as likely-required and names the ordering practice, not the imaging centre, as responsible. | `api/v1/admin/orders.js` · `orders/[id].js` · `orders/[id]/results.js` · `orders/[id]/prior-auth.js` · `api/v1/admin/referral-directory.js` · `api/v1/admin/gfe.js` · `gfe/[id].js` · `api/v1/patient/orders.js` · `api/v1/patient/gfe.js` · UI `admin/orders/` `admin/referrals/` `admin/gfe/` `portal/orders/` · `schema/0040` | **DOCTRINE: never assert a payer requirement the payer does not publish** (inherited from `clearinghouse_onboarding.js`) — unknowns surface as `verify`, never as a confident answer. Two refusals are deliberate and load-bearing: an order cannot be marked `reviewed` when nothing has come back (that would be a false record — chase the result instead), and a GFE cannot be ISSUED while any required element is missing (an incomplete estimate is worse than none because it looks like compliance). The patient-facing endpoints show result STATUS but never result narrative, and only after clinician acknowledgment — an abnormal result reaches a patient through their clinician, not a status field refreshed at midnight. **The sweep is what makes it a safety net rather than a dashboard:** `POST /api/v1/internal/orders/sweep` (hourly from `cron-worker/index.js::runOrderSweep`, or admin-triggered via the board's "Run check now" button — the button exists because the cron Worker deploys separately, and without it the net would look installed while lying dormant) finds orders past their expected result date and unacknowledged critical results, stamps `overdue_notified_at` so each order alerts ONCE (a digest repeating yesterday's numbers gets filtered, and then the one that matters gets filtered with it), and emails the practice a CONTENT-FREE digest — counts and a link, never a patient, test or result, because that alert lands in an ordinary inbox. Gates: `scripts/test_orders.mjs` (59, incl. sweep planning + digest copy asserted to carry no identifiers), `test_gfe.mjs` (45), `test_referrals.mjs` (36), all three wired into `deploy-prod.sh`. Migration `schema/0040` is APPLIED to production D1. |
| `care_goals_mapper.js` | Intake → care goals projection | `/api/v1/patient/profile.js`, `/api/v1/admin/briefings/*` | Per §11.5.1 expanded portal scope. |
| `patient_briefing.js` | Aggregate snapshot for clinician pre-visit | `/api/v1/admin/briefings/*` | Pulls from intake + sync notes + messages + symptoms + PROMs. |
| `trend_briefs.js` | Override JSON shape for trend-brief gold-renderer | `/api/v1/admin/trend-briefs/*` + `MountZaraResearchDigest/src/research_digest/gold_brief_render.py` (SIBLING REPO) | Per §3.8. Override shape lock-stepped across repos. |
| `drug_ae_engine.js` | openFDA cache + KB cross-ref | `/api/v1/admin/medications/*` | Per §10.8 / §15. |

---

## 6. `functions/api/v1/*` — endpoint inventory (high-level)

See `functions/api/v1/` filesystem for full per-file. Grouped by domain:

- **`auth/`** — `login`, `logout`, `signup`, `me`, `magic-link/issue`,
  `magic-link/redeem`
- **`patient/`** — `appointments/available`, `appointments/book`,
  `billing/*`, `documents` + `documents/[id]`, `education` +
  `education/[slug]`, `feedback` (POST), `intake/new` + `intake/current`
  + `intake/[id]/section/[n]` + `intake/[id]/submit` + `intake/[id]/triage`,
  `messages/*`, `photo`, `profile`, `proms/*`, `symptoms/*`,
  `triage/current`, `wizard/state`
- **`admin/`** — `analytics`, `appointments/*`, `availability`,
  `billing/*` (claims/invoices/payers/payments/reports/services/insights),
  `briefings/*`, `carousels/*`, `cases/[patient_id]` (keystone aggregation),
  `debug/sessions`, `education/*`, `feedback/*` (approve/reject/screenshot),
  `messages/*`, `patients/*` + `patients/[id]/(notes|photo|profile|proms)`,
  `patients/[id]/id-verify` (R6 — GET status + POST {method,notes}; stamps
  `patients.identity_verified_*`; "deferred" leaves the timestamp NULL so the
  cases banner re-surfaces; lock-step with `admin/cases/_t/index.html::renderIdVerify`
  + the cases keystone patient SELECT + migration 0021),
  `phi/rotate`, `practice-settings`, `practice/licensed-states` (R3 licensure gate),
  `preview-invite`, `proms/*`,
  `snapshots/[patient_id]`, `trend-briefs/*`, `triage/*`, `visit-types`
  - **Phase 17 R5 device-check badge:** `admin/appointments.js` (GET list) +
    `admin/cases/[patient_id].js` (keystone, `upcoming` only) LEFT-JOIN the
    latest `tech_check_results` row per appointment (correlated subquery on
    `idx_tech_check_appointment`) and emit a compact `device_check`
    `{status,checked_at,network_kbps,failures}` per row. Rendered as an inline
    badge in `admin/scheduling/index.html::deviceCheckBadge` +
    `admin/cases/_t/index.html::deviceCheckBadge` (telehealth rows only).
    Lock-step: the `device_check` shape is shared across both endpoints + both
    SPA badge helpers — change one, change all four.
- **`billing/stripe/`** — webhook receiver + checkout flows
- **`sync/`** — `clinical-ai/cases`, `ios/encounters`, `patients/lookup`,
  `surgical/cases`, `transcription/notes` (cross-app surfaces; see §11)
- **`posts/[[path]].js`** — R2-backed router (CBG/MIGS Monday Mornings
  + trend briefs); structured fields per §0.8.2 are AUTHORITATIVE
  §0.8 manifest
- **`_health.js`** — liveness

**Critical:** Every endpoint that calls `requireRole` MUST pass `ctx`
as the first argument so `getSession`'s `last_seen_at` UPDATE goes via
`ctx.waitUntil()` (§10.10). Same for `logAudit(env, entry, ctx)`.

---

## 7. Surface middlewares

| File | What it does | Lock-step |
|---|---|---|
| `functions/admin/_middleware.js` | Basic Auth + MFA gate on `/admin/*` and `/api/v1/admin/*` | If signature of `requireMfa()` changes, also touch `_mfa.js` + `admin_totp_enroll.sh`. PBKDF2-100k cap per §9.8.3. |
| `functions/admin/_mfa.js` | POST endpoint — TOTP code or `xxxx-xxxx` recovery code → signed cookie | `_lib/totp.js` + `_lib/mfa_cookie.js` |
| `functions/admin/_signout.js` | Drops Basic Auth + MFA cookie | Lock-stepped to `admin/index.html` Sign Out button |
| `functions/portal/_middleware.js` | §11.5.2 preview gate via `_lib/preview_gate.js`; HTMLRewriter `PortalScriptInjector` injects `_feedback.js` + `_wizard.js` before `</body>` on every portal SPA | If you remove the injection, the floating Feedback button + Wizard chip disappear from every portal page. Sibling `portal/*/index.html` files don't import these scripts themselves. |
| `functions/education/_middleware.js` | Per-slug allow-list + `EDUCATION_PUBLIC_LAUNCH` env gate | Lock-stepped to the 12 `education/<slug>/index.html` files |
| `functions/api/_middleware.js` | JSON-only guarantee for `/api/*` — converts the static-HTML SPA fallthrough (wrong method / typo'd path previously returned the MARKETING HOMEPAGE as 200 text/html) into JSON 404 | Post-processes `next()` by content-type. Safe because every legit `/api/*` response is JSON/CSV, never text/html — keep it that way or exempt the new route here. |

---


### 8.0 Homepage asset split (2026-08-08) — READ BEFORE EDITING index.html

`index.html` no longer carries its CSS or its main JavaScript inline:

| file | was | now |
|---|---|---|
| `index.html` | 682 KB (266 KB `<style>` + 249 KB `<script>`) | ~150 KB markup |
| `assets/css/home.css` | — | the extracted stylesheet |
| `assets/js/home.js` | — | the extracted script, loaded `defer` |

**Why:** measured in REAL WebKit (Safari's engine, now installed in the
container — `playwright install-deps webkit && playwright install webkit`).
With everything inline, Safari had to download and parse the entire document
before a single line could run: the opening animation did not begin for
**9.0 seconds** and the screen did not change a pixel for 4+ of them. Chromium
parses it fast enough to hide the problem, which is why headless Chromium
testing never caught it.

Also in index.html and NOT to be moved back:
* a head-level script BEFORE the stylesheet link that starts the 1.2 MB
  animated-drawing download on touch devices;
* an in-body bootstrap immediately after the hero markup that starts the
  drawing, releases the loader and reveals the hero text without waiting for
  `home.js` (guards: `__mzHeroStarted`, `__mzHeroTextRan`).

`scripts/hero_anim_fingerprint.mjs` fingerprints index.html + home.js +
home.css together; editing any of the three requires `--update` after
visually verifying the opening.

### 7.9 Tier A polish pass (2026-08-11) — the "AI slop" deletions

An evidenced audit (16 agents, 82 verified findings) established that the
site's "unpolished / AI slop" quality came mostly from surfaces that
announced the site's own construction. Tier A was almost entirely
DELETION. What was removed, and why it must not come back:

* **12 `.ai-badge` "AI Snapshot" spans** above the owner's own peer-reviewed
  summaries, plus the badge CSS and the section-sub sentence "Tap any
  publication for an AI snapshot". NEVER label content by the tool that
  produced it — this is the single most damaging class of string on a
  physician's site.
* **2 `§0.8 KB-anchor manifest` HTML comments** (15KB) that shipped inside
  index.html and were readable in View Source, including
  `not_in_kb_claims`. Moved to `cite_audit/homepage-kb-anchors.md`.
  Citation-audit artefacts NEVER ship in a public document.
* **56 `.tile-more` "Details"/"Open details" chips** on cbg-migs (two
  wordings for one control; the hosts are already `<button
  aria-haspopup="dialog">`).
* **13 numbered `.cv-section-eyebrow` spans** on /cv/ that restated the `<h2>`
  beneath them. The one unique fact (2020–2025) was folded into that
  section's sub.
* **8 `.tag year` spans** that duplicated the year already in the citation
  line beneath (verified per-card, not bulk-removed — 4 that add
  information were kept).
* **7 `.hub-badge` chips** whose every word already appeared in their own
  card's prose (verified per-card; 8 that add a fact were kept).

Also fixed: `#excellence` → `#surgical` (the "Surgery" nav item pointed at
an ID that does not exist), and the `scroll-padding-top: 0px` override at
home.css that beat the correct 80px and made all 13 in-page anchors land
behind the nav. Counters on cbg-migs now ship their real values in markup
(they shipped literal `0`) and `animateCounter` has its reduce-motion guard
restored (it had been deleted, leaving an orphaned brace). Fonts are
self-hosted on all 8 public pages (Google's 18-variant link was still
render-blocking on 7 of them; /cv/ was loading Inter and rendering in a
different typeface from the rest of the site). Inter-only
`font-feature-settings: "ss01","cv11"` stripped from 46 public files — it
renders nothing on an Avenir/Nunito stack and was the clearest fingerprint
of pasted CSS. Canva export `Black White Elegant Personal Monogram Logo.png`
renamed to `mount-zara-monogram.png` (6 files). `/assets/*` now cached
immutable; `color-scheme`/`theme-color` meta added to 9 pages.

### 7.10 The authoritative CV (2026-08-11) — SOURCE OF TRUTH for every figure

The owner supplied his final CV ("most accurate cv") as a PDF. Text extract
committed at `cite_audit/authoritative-cv-2026-08.txt`. **Any number on the
site describing his record must match this file.** Established figures:

* Operative log Sept 2023 – May 2026: **444 operative cases**, **1,511
  distinct procedures** (1,475 minimally invasive, 3.4 per MIS case),
  **500+ da Vinci robotic procedures attested in writing**.
* Outcomes: **2.9% intraoperative events** (ClassIntra, N=13), **0.2%
  postoperative** (Clavien–Dindo, N=1), **3.15% total / 14 reportable**,
  and **0 major adverse events** (0 conversions to laparotomy, 0
  reoperations, 0 full-thickness injuries, 0 vascular, 0 nerve, 0 VTE,
  0 cuff dehiscence, 0 deaths). NEVER render this as "zero complications" —
  the correct claim is zero MAJOR ADVERSE EVENTS against a stated rate.
* **SCHOLARSHIP — CANONICAL COUNTS. Use these; do not re-derive.**
  - **4** journal publications (GMIT 2026, Arch Gynecol Obstet 2025,
    JMIG 2025, J Intellect Disabil Res 2012)
  - **5** published abstracts — every one of them is ALSO one of the
    presentations below, so never add 4+5+11
  - **11** peer-reviewed presentations: **8 national** (7 AAGL Global
    Congress across 2020/2022×2/2024×3/2025, plus ACOG 2024 Ward et al.)
    and **3 regional** (CAOG 2025 poster #46, CAOG 2024 Morley, ACOG
    district 2022)
  - **15 = the headline number.** Distinct peer-reviewed works =
    4 journal + 11 presentations. The homepage identity card says
    "Fifteen peer-reviewed publications & presentations"; /about/ says
    11 presentations. Both verified against the site's own listings,
    which now enumerate exactly 15 (4 + 7 AAGL + 4 ACOG/CAOG).
  - The original site claim of "Ten" UNDERCOUNTED, and an interim
    correction to "Nine peer-reviewed publications" dropped the
    presentations entirely. The owner caught both.
  - **4 awards**, of which **2 are peer-reviewed research awards**
    (AAGL Golden Hysteroscope 2024, CAOG George W. Morley 2024).
* Residency ACGME log Jul 2019 – Jun 2023: 395 cases, 523 gynecologic
  procedures; 349 robotic cases combined across training.
* **Active research: exactly TWO IRB studies — RIL20240017 (NBI /
  adenomyosis) and RIL20220137 (ICG / endometriosis-related fibrosis).**
  The site additionally cites RIL20240009 (TAP block RCT) and RIL20240078
  (ICG appendiceal endometriosis) and claims "4 Active IRB Studies".
  RESOLVED 2026-08-11 by the owner: "2 active IRB's now". The /cv/
  Active IRB Research section and the /about/ stat now show exactly those
  two. The other two studies (RIL20240009 TAP block RCT, RIL20240078 ICG
  appendiceal) remain on the homepage as research cards but are no longer
  tagged "Active IRB" or "Active" — their true status (completed /
  published / paused) is still unstated and should be set by him.

Corrected on the site in this pass: fellowship counters 435→444 and
760→1,511 (and their labels, which claimed "through Feb 2026"); the
"2.1% minor-complication rate" line replaced with the real ClassIntra /
Clavien–Dindo figures; homepage "Ten peer-reviewed publications &
presentations" → "Nine peer-reviewed publications"; /about/ "9+
Peer-Reviewed Presentations" → "11".

> ⚠️ **2026-08-11 follow-up — the owner caught two survivors, angrily.**
> (1) The curriculum page's "Case Volume" modal lives inside the
> `DETAIL_DATA` JS blob (`vol-summary` key, one physical line), so
> markup-oriented grep sweeps missed it: it still said "2.1%
> minor-complication rate", "grew 63% from Year 1 to Year 2", "243% of
> the required volume", and "435 cases and 760 procedures by February
> 2026". None of those numbers exist in the authoritative CV; replaced
> with 444 / 1,511 / ClassIntra / Clavien–Dindo. **When sweeping for
> stale figures, ALWAYS grep the JS string blobs (`DETAIL_DATA`,
> modal-injected HTML), not just markup.**
> (2) The homepage claimed ">95% same-day discharge" in three places;
> the CV states **90.4% MIS same-day discharge** — the site was
> overclaiming against his own record. All three now read 90.4%, and
> /cv/ gained the missing 90.4% outcomes row. The canonical figure for
> same-day discharge is **90.4%**, never ">95%".

ADDED to `/cv/` 2026-08-11: **Fellowship Surgical Experience & Outcomes**
(volume, case mix, ClassIntra/Clavien–Dindo outcomes, zero major adverse
events), **Fellowship Procedure Breakdown** (hysterectomy, endometriosis,
fibroids & fertility preservation, hysteroscopy, prolapse, adhesiolysis &
cross-specialty, urinary tract), and **Residency Surgical Experience**
(ACGME log). 39 log rows, all figures transcribed from the authoritative
CV. Rendered with a new `.cv-log` pattern — figure-first rows with
`font-variant-numeric: tabular-nums`, NOT another card class (the site
already has 45). Section nav updated with the three new anchors.

Still missing from `/cv/` versus the PDF: CLINICAL EXPERIENCE (locums
across four states), PROGRAM DEVELOPMENT/QUALITY/ACCREDITATION (COEMIG
committee, Robotic Steering Committee), and CLINICAL INNOVATION &
INFORMATICS (the six-app suite, FMIGS Reporting Tool).

### 7.11 Voice pass (2026-08-11) — AI-provenance labels and slogan copy

Two separate problems, fixed together.

**(a) AI-provenance labels — the 13 patient-education pages.**
`education/<topic>/index.html` and their 12 `portal/education/` copies
(25 files) carried a visible `<aside class="mz-ai-disclaimer">` reading
"This page was prepared with AI assistance to organize and improve
readability of a high volume of clinical literature…", plus `§0.8
KB-anchor manifest` HTML comments. Both described how the page was
assembled, not anything clinical. Replaced with
`<aside class="mz-page-note">` carrying only the educational-purposes /
not-medical-advice / error-report disclosure. **The owner explicitly
ruled out any authorship attribution: "No do not put my authorship on
there. remove it. just leave the footer disclosures."** Do not add a
"Reviewed and published by" line back.

Legitimate AI references were deliberately LEFT ALONE — "Mount Zara
Clinical AI", "Optional Claude API for elevated reasoning", "AI/LLM
developer" all describe his own products and his own skill set. The rule
is: remove labels that mark *this website's content* as AI-produced;
keep copy that describes *the software he builds*.

**(b) Slogan voice on `/` and `/about/` — ATTEMPTED AND REVERTED.**

> 🛑 **Do not re-run a "voice pass" against the CV.** A pass on
> 2026-08-11 rewrote ~25 headlines and lines on `/` and `/about/` into a
> quantitative, declarative register on the theory that the authoritative
> CV shows the owner's real voice. **He rejected the premise:** *"I'm not
> sure I want you to change the tone of this — because my CV is my CV, my
> website is more me than a CV."* The CV is a formal instrument written
> for credentialing bodies; the site is where his personality lives. All
> of it was restored the same day.

Restored and to be LEFT ALONE — this is his voice, not AI slop:
"Built by a surgeon, for the future of women's health.", "Whole-person
care, not just a diagnosis.", "Engineered for the working surgeon.",
"A surgeon-innovator at the intersection of women's health and
intelligence.", "Multidisciplinary by design.", "Five identities. One
practice.", "Hands-on AI. / Clinical-grade craft.", "Six apps. One
mission.", "Let's build something remarkable.", "six pillars, layered
with intent", "anatomical awareness practiced as a discipline",
"Adenomyosis remains a clinical chameleon", "Patients finally SEE their
own anatomy", "Three roles · One practice", "isn't a footnote — it's a
discipline", "turn impossible into inevitable", "unapologetically
modern", "cutting-edge".

The ONE prose deletion that stands is on the 2012 self-injury paper —
"The methodological rigor and patient-centered framing established here
continues to inform his current surgical research approach" — removed
because it asserts a claim about his research lineage that nothing
supports, and carried a subject-verb disagreement. That is a FACT
problem, not a tone problem, which is the line to draw: **fix what is
false, leave what is his.**

**Stale counts corrected in the same pass** (they contradicted §7.10):
homepage stat `10 → 15` peer-reviewed publications & presentations,
`4 → 2` Active IRB studies, identity card "4 active IRB studies" →
"2", "apps in development" → "apps in beta"; `/about/` "five native
macOS applications" → "six native applications".

### 7.12 Motion easing scale + the disclosure mechanism (2026-08-11)

`assets/css/home.css` previously spelled out a `cubic-bezier()` at every
call site — 49 of them across **six** near-identical curves
(`0.16,1,0.3,1` ×45, `0.22,1,0.36,1`, `0.2,1,0.3,1`, `0.2,0.7,0.3,1`,
`0.25,0.1,0.25,1`, `0.34,1.56,0.64,1`). Consolidated onto a token scale
in the first `:root`: `--ease-out-quint`, `--ease-out-cubic`,
`--ease-in-out-quart`, `--ease-spring`.

> ⚠️ **The hero animation rules are deliberately EXCLUDED from the token
> scale.** `.hero-content-delayed > *` and `.word-reveal .w` keep their
> literal `cubic-bezier(0.22, 1, 0.36, 1)` and
> `cubic-bezier(0.2, 1, 0.3, 1)` — they are covered by
> `scripts/hero_animation.lock`, and the opening sequence should carry no
> indirection that could fail to resolve. A first attempt at this pass
> tripped the lock precisely because the token substitution rewrote them,
> and the naive revert collapsed both onto the dominant curve. If you
> touch easing, run `node scripts/hero_anim_fingerprint.mjs --check`.

**`.research-detail` disclosure** was `max-height: 0 → 1200px`. Two real
defects: any detail body taller than 1200px would clip, and because the
cap is ~6× the real content height, the transition reached full height in
the first ~10% of its 500ms and then sat still — measurably a snap, not
an ease. Now `grid-template-rows: 0fr → 1fr`.

> ⚠️ **`.research-detail-clip` is load-bearing — do not remove it.** A
> `0fr` track floors at the grid item's **padding + border**;
> `min-height: 0` and `overflow: hidden` zero out the *content*
> contribution but not padding or border. Putting the padded
> `.research-detail-inner` directly in the grid left every row stuck
> **61px** open (28 + 32 padding + 1px border-top). The clip wrapper is
> the grid item and carries no padding or border; all spacing stays on
> `.research-detail-inner` inside it. 12 blocks in `index.html`.

Measured in WebKit 26.5 (Chromium is unusable here — the agent proxy
returns `net::ERR_CONNECTION_RESET`): closed 0px, opens to true content
height, recloses to 0, 0 clipped items, no page errors, identical under
`prefers-reduced-motion: reduce`. In an isolated probe
`grid-template-rows` interpolates over 32 frames while
`max-height: 0 → 1200px` yields 2 — confirming which one actually eases.

**Known, pre-existing, NOT caused by this change:** on the real homepage
both the old and the new mechanism stall ~1.2–1.4s on open (HEAD and the
new build measured side by side, 3 rAF frames each). Layout is 1ms and
full-document layout is 0ms, so this is **rasterization**: the page
carries **136 elements with `backdrop-filter`**, every one of which
re-rasterizes per animated frame. Cutting that count is the single
highest-value performance fix left on the homepage (Tier B).

### 7.13 Hero settle color/motion (2026-08-11, owner recording)

The owner recorded a "subtle color change at the very end of the
animation after everything has settled" and asked for the settled purple
to hold. Root causes found and fixed, measured in WebKit:

1. **Ken Burns easing.** Desktop used `ease-out` (chosen 2026-08-08 so
   the drift is "visible from its first second") — meaning the zoom moved
   FASTEST right at settle: 84,381 px displaced within 1.25s of `ended`,
   which reads as the ink shifting tone. Now `ease-in-out` (matching
   mobile): 364 px in the same window. The settle frame holds; the drift
   creeps in later. Lives in `.hero-video.ken-burns` (NOT a locked rule).
2. **Poster color grade.** `hero-last-frame-v2.webp` rendered measurably
   brighter than the video (the mp4 is tagged bt2020/smpte2084, so Safari
   tone-maps it; an sRGB still can't match by math). Replaced with
   **hero-last-frame-v3.webp** — lossless WebP captured from the VIDEO'S
   OWN rendered pixels at the settle frame (duration − 0.04s) in WebKit;
   video-vs-v3 rendered diff = 0 (was max 28/255). All three references
   updated (home.js ×2, index.html bootstrap `LAST`). Note the current
   bootstrap video path never swaps to a poster — the poster is used by
   the image/touch fallback path and the legacy home.js path.
   v3 uploaded via the R2 API (`PUT accounts/<id>/r2/buckets/
   mountzara-media/objects/<key>` — upload-token.txt does not exist on
   this VM; the CF API token works).

Hero lock intentionally updated after end-to-end verification (the v3
URL lives inside locked `startHeroSequence`).

Deliverable produced for the owner: `mz-hero-drawing-transparent.png` —
the completed drawing from hero-ink-v2.webp (transparent, 1920×1080).

### 7.13.1 Hero title ghost glyphs in Chrome 151 — parent clip-text gradient (2026-08-20)

Owner-reported (Chrome 151.0.7922.170 / macOS 15.6 arm64): the hero
headline rendered with a pile of duplicate glyphs at the line start —
"Aasaisrion for women's health." — deterministic (every load, survives
zoom re-raster, scroll-away, Incognito), while copy/paste of the
headline yielded the correct single string.

**Root cause (CONFIRMED by live console bisection with the owner).**
The `<h1>` carries TWO copies of the gradient treatment: each `.w`
paints its slice of the line-spanning gradient, and the PARENT
(`.hero-title` / `.word-reveal` rules) ALSO has
`background-clip: text` + gradient — deliberately, as the first-paint
fallback for the moment before `splitWords` runs. Post-split, the h1's
only direct text is inter-word whitespace, so the parent layer should
paint nothing. Chrome 151 instead paints the parent's
descendant-glyph clip mask at collapsed offsets, compositing a ghost
copy of EVERY word at the line start. The bisection that proved it,
in order, all live on the owner's machine: `will-change: auto` on all
`.w` → no change; `filter: none` on the h1 → no change;
`background-position: 0` on all `.w` → gradient went per-word, ghost
unchanged (per-word slices innocent); `background: none` on the h1 →
**ghost gone instantly**. DOM was verified clean throughout
(`elementsFromPoint`, one `.hero-title`, five non-overlapping masks).

**Fix in `assets/js/home.js`** directly after the
`applyLineSpanGradient` invocation block (deliberately OUTSIDE every
fingerprinted region — lock hash unchanged, verify with
`node scripts/hero_anim_fingerprint.mjs --check`): once
`heroTitle.dataset.split === '1'`, set inline `background: none` on
the h1. The `.w` slices own the gradient from that point; the
pre-split fallback still paints for no-JS, reduced-motion (no split),
and pre-script first paint. Two hygiene measures shipped alongside
(neither was the root cause): release `will-change: auto` on the `.w`
spans via `transitionend` after the entrance settles (five permanent
GPU layers for a run-once entrance), and re-run
`applyLineSpanGradient` on `document.fonts.ready` (the lone rAF
measurement runs against fallback-font metrics on a cold cache).

Upstream: this is a Chrome 151 regression in parent-level
`background-clip: text` masking over inline-block descendants. If a
later Chrome fixes it, the inline `background: none` stays — it is
correct layering regardless (the parent copy is redundant post-split).

### 7.14 Research reel autoplay — ONE observer owns .video-preview (2026-08-12)

The four "Peer-reviewed work" reels were dead. Root-caused by patching
play/pause/load on the LIVE page and reading the stack traces: **8 PAUSE
calls against 2 play calls**, issued by TWO IntersectionObservers that
both owned `.video-preview` with incompatible geometry —
`threshold 0 + rootMargin 75%` (the intended owner) and the legacy
`initVideoPreviews` at `threshold 0.25`. In the band between them one
observer played while the other paused, every scroll frame.

> ⚠️ **Exactly ONE IntersectionObserver, play loop, and pause() path may
> exist over `.video-preview`.** The legacy block's own comment already
> said the other observer "owns everything else" while its observer sat
> five lines below, still running. It is deleted. Do not add another.

Also fixed in the same pass:
* `wake()` called `load()` unconditionally — `load()` resets currentTime
  to 0, so it restarted reels from zero. Now only when `readyState < 2`.
* `openVideoModal()` pauses all four reels to free the decoder and
  `closeVideoModal()` never restarted them — every reel stayed dead
  until reload after any modal use. `window.__mzWakePreviews()` is the
  single resume hook, called on modal close.
* Owner directive "they should always be looping": a 2s watchdog
  re-asserts `loop`/`muted` and restarts any near-viewport reel that is
  paused OR whose clock has not advanced since the previous tick.
  Off-screen reels stay paused (four decoders for invisible video was
  measured battery drain).

> 🧪 **Measurement trap — do not repeat.** `paused === false` with
> `currentTime` frozen at 0.00 is ALSO what WebKit reports for a video
> that is simply BELOW THE FOLD (offscreen autoplay suspension). Two
> debugging rounds were spent on a phantom because
> `#research.scrollIntoView({block:'start'})` leaves the reels ~983px
> down in a 900px viewport. **Scroll the VIDEO itself into view
> (`block:'center'`) before judging playback**, and confirm with the
> control that settles it: a fresh `<video>` appended to the same live
> page plays normally, so a frozen clock is context, not codec.

Verified on production after deploy: all four reels advance when on
screen under normal motion, under `prefers-reduced-motion: reduce`, with
autoplay blocked (recovering after one gesture), and after an
openVideoModal/closeVideoModal cycle. Exactly one `pause()` caller
remains in the served bundle.

### 7.15 Inline references restored to the briefs and roundups (2026-08-12)

Owner: *"the Trending and Evidence pages — the writeups and briefs also
lost the STANDARD INLINE REFERENCES STYLE AND FORMATTING AND
REQUIREMENTS."* Measured and confirmed: `blog-2026-W21` carries **216**
inline `<sup class="mz-ref">` citations; all 8 evidence briefs and the 3
newest roundups carried **ZERO**, with sources pushed to cards at the
bottom of the page.

`scripts/apply_inline_refs.py` restores them from VERIFIED claim→PMID
mappings (produced by the `post-inline-refs` workflow: 12 mapping agents
+ 12 adversarial verifiers; 212 approved, 16 rejected). **196 inline refs
applied across 12 posts; prose proven byte-identical afterwards** (strip
the sups, compare text — 0 mismatches), and only `body_html` changed in
the stored R2 objects.

Three citation schemas coexist in the corpus and the indexer handles ALL
of them — keying off only the first silently indexed zero cards for every
evidence brief:
1. roundups — `<article class="mz-cite-card" id="mz-cite-<PMID>">`,
   `<h3 class="mz-cite-title">`, `<p class="mz-cite-fits">`
2. briefs — `<article class="mz-cite-card" id="mz-ref-<N>">`,
   `<p class="mz-cite-title">`, `<p class="mz-cite-finding">`; the PMID
   lives only in the card's PubMed link
3. bibliography — `<ol class="mz-references-list"><li>TITLE. JOURNAL.
   YEAR. [PMID: …]</li>`, with no card at all

> ⚠️ **Popover summaries must never be a raw abstract dump.**
> `auditPublishable()` rejects a summary that opens with a structured
> abstract label (`BACKGROUND:`, `AIM:`, `OBJECTIVE:` …) — three W20
> popovers failed the gate on the first pass. The tool now detects and
> omits those (the finding span is optional) rather than emitting one.

Never-annotate regions (a mapping landing inside any of them is SKIPPED,
never force-applied): `<details>`, `<article class="mz-cite-card">`,
`<dialog>`, `<style>`, `<script>`, and `<ol class="mz-references-list">`.
Also skipped: anchors that are not unique, insertion points inside a tag,
PMIDs absent from the post, and a PMID already cited within 400 chars.

Posts are stored as R2 objects `posts/<id>.json` in `mountzara-content`
and written with the CF API (`PUT .../r2/buckets/mountzara-content/
objects/posts/<id>.json`). Always fetch the RAW R2 object, patch, and PUT
back — the `/api/posts/<id>` view is not the stored shape. Backups of all
12 pre-change objects: scratchpad `r2_backup/`.

Verified live: `/evidence/?id=…` renders 18/18 sups with 18 links, 18
popovers, 0 malformed hrefs, 0 empty popovers, 0 dangling
`aria-describedby`, no page errors.

## 8. Static surfaces

### 8.0.-1 The patient journey is gated, not just the routes (2026-08-25)

`scripts/audit_patient_journey.py` walks the path a patient is actually
invited onto and asserts the AFFORDANCE at each step — the appointment CTA
opens a contact route and that route reaches an inbox; the education index
offers guides and a guide has content; the portal door explains itself rather
than dead-ending; sign-in has an email field and a submit; `/cv/` offers a
working request form; the footer routes to portal, what-I-treat and contact.

**Why it is separate from `audit_route_render.py`.** That gate proves a route
LOADS — right title, right selector. It cannot tell you whether a patient can
get from one step to the next. A contact modal that opens onto no email, a
portal door that dead-ends, an education index whose cards link nowhere: each
of those renders perfectly and passes a render check while the journey is
broken. Assert what a patient must be able to DO, not what markup is present.

Public surfaces only, so it runs on every deploy without credentials. `/cv/`
is Function-gated, so its request-form assertion only runs against production
— locally the gate is not in the path and the raw page is served.

### 8.0.0 ONE THEME — the light conversion is site-wide (2026-08-25)

**The site is light. There is no dark surface left by design except
brand-violet button/badge grounds, the `/about/` magazine cover photo, and
modal scrims.** If you are adding a page, it inherits the light tokens; if
you are editing one, do not reintroduce a dark ground.

**Why this is called out.** The light conversion shipped in stages and each
stage looked finished while a whole class of surface stayed dark, because
nobody was measuring rendered pixels across every route:

* the first pass converted the homepage only;
* the second converted 12 education page pairs — and left
  `.mz-modal :is(p,li,td,…) { color:#ffffff !important }` in all 25 of them,
  so every one of those pages had a LIGHT modal carrying WHITE text. The page
  looked converted; open a modal and the text was gone;
* 65 further pages (all of `/admin/*`, `/portal/*`, `/cv/`, `/curriculum/*`,
  `/evidence/`, `/trending/`, `/about/`, `/accessibility/`, `404`) were still
  dark, plus 7 pages built inside Pages Functions that no file sweep touches
  (`functions/admin/_login.js`, `_signout.js`, `cv/_middleware.js`,
  `education/_middleware.js`, `portal/_middleware.js`,
  `portal/preview-grant/index.js`, `api/v1/admin/trend-briefs/[id]/preview.js`).

**The EIGHT surface families, and how each was missed.** Every one of these
was found only after the previous fix had been declared done. A regex for one
family says nothing about the others — walk all eight:

1. **Tokens** — `--bg-base`, `--fg-*`, `--border`, `--bg-card`. Easy, and the
   only family the early passes handled.
2. **Gradient canvases** — 52 pages paint `html` with
   `linear-gradient(178deg, #191526, #120f1b, #161321)`. A `background: #hex`
   regex does not match a gradient stop, so every one of these pages kept a
   near-black canvas while its tokens read light.
3. **Dark neutral surfaces** — `dialog { background:#1a1626 }`, `#241d36`,
   `#131217`, `rgba(7,7,10,.96)` panels and `rgba(0,0,0,.3)` input wells.
   THIS is what kept MODALS dark after the page behind them went light.
4. **Function-generated HTML** — `functions/admin/_login.js`, `_mfa.js`,
   `_signout.js`, `cv/_middleware.js`, `education/_middleware.js`,
   `portal/_middleware.js`, `portal/preview-grant/`, the trend-brief preview.
   Never in the static tree at all.
5. **Shared JS components that inject their own CSS** — `admin/_nav.js` paints
   the admin toolbar and `portal/_wizard.js` the patient intake; a sweep over
   `*.html` plus `functions/**` misses both, leaving a near-black bar on every
   otherwise-light admin page.
6. **White text left on a ground that is now paper** — a rule that paints text
   white and declares no dark ground of its own inherits whatever is behind
   it. 78 such rules.
7. **White gradients clipped to text** — `background: linear-gradient(#fff…)`
   with `-webkit-text-fill-color: transparent`. The ground check reads it as a
   background; the colour check finds no `color:` at all. On `/cv/` this left
   the page's largest headline — the owner's own name — invisible.
8. **Bespoke per-page text tokens** — `--muted`, `--dim`, `--soft`,
   `--ink-mute`, `--fg-faint` and friends, defined white on individual pages.
   40 definitions. A converter that only knows `--fg-*` walks straight past.

**Do NOT blanket-replace `color:#fff`.** On these pages most white text sits
on a violet button/badge (`#2e1065`, `#6d28d9`, `#7c3aed`, `#4c1d95`) or on
the `/about/` cover photo, where white is correct. Convert grounds, then let
the rendered contrast gate name the exceptions.

**THE DETERMINISM RULE — derive, never enumerate.** Every family above was
missed for the same underlying reason: a check enumerated its surfaces from a
hand-maintained list — a default of nine routes, a glob that covered only
`functions/`, a memory of which pages exist — instead of deriving them from
the system. A sample can only prove the sample, and a list maintained from
memory drifts the moment the person maintaining it does.

So every audit's surface list is now derived, and adding a surface adds its
coverage with nobody remembering anything:

* `audit_light_text.py` with no `--routes=` walks the tree: every
  `index.html` is a route, plus `404.html` — 92 today, N tomorrow. The deploy
  chain passes no route list, so it always audits everything. (Full-tree runs
  cost minutes, not seconds; that is the price of a guarantee over a sample,
  and it is paid on deploy, not on patients.)
* `audit_dark_surfaces.py` globs `**/*.html` and `**/*.js`, and pulls every
  published post from the API — failing LOUD if the posts cannot be fetched,
  because a scan that covered zero posts would report clean.
* `audit_route_render.py` already carries a discovery contract: a repo route
  absent from its manifest fails the deploy.
* `cite_verify_pubmed.mjs` derives its PMIDs from the pages and fails on any
  PMID missing from the committed corpus.

When adding an audit, this is the acceptance test: delete its list and it
should still know what to check, or fail loudly that it cannot.

**Enforcement — three gates, all in the deploy chain.**

* `scripts/audit_dark_surfaces.py` — static, and checks by COLOUR rather than
  by name, so a dark ground fails wherever it is written and in whatever
  syntax. Also covers families 6 and 7. Scans `**/*.html` AND `**/*.js`.
* `scripts/audit_light_text.py` — runtime, and the one that covers BREADTH.
  One paint per route with modals forced open, so it can run over every route
  rather than nine. Resolves each text run's real ground (colour or gradient,
  walking ancestors) and flags text within 42 luminance of it. Skips text over
  a photograph — `/about/`'s cover is white type on a headshot, which is
  correct — and text on violet buttons.
* `scripts/audit_contrast_pixels.py` gained `--open-modals`
(2026-08-25): it force-opens every `dialog` / `[class*=modal|overlay|sheet|
drawer|lightbox|popover]` before measuring, because a modal only paints once
something opens it — which is exactly how the 25 education modals shipped
inverted and unnoticed. Scrims (containers ≥95% of the viewport) are excluded
from the ground check; a dark scrim is correct on a light theme.

### 8.0.0.0 Medico-legal constitution: no dosing, disclaimers, paper grounds (2026-09-01)

**Owner directives, verbatim and standing:** "I always need this to be
medico-legally sound with CLEAR disclaimers that I am not OFFERING MEDICAL
ADVICE, this is just an educational platform." And: "I NEVER want you to
post actual dosing and things that really should be reserved for private
patient-doctor decisions about management… This applies to all the other
condition-specific cards and everywhere else in the website."

* **No dosing in counseling prose — anywhere.** Doses (mg/mcg/µg/IU),
  frequencies (q6-8h, BID/TID/QID), titration/regimen specifics. Text
  ATTRIBUTED to a specific paper — verbatim abstracts, journal-club
  deep-dive analyses, cite cards, citation popovers, reference-list
  entries — is research reporting and keeps the study's own facts (an
  analysis that cannot say what dose a trial tested is not an analysis).
  Concentration units (mg/dL, IU/L…) are lab values, not dosing. HTML
  comments and JSON provenance manifests are non-rendered and exempt.
  Gates: `scripts/audit_no_dosing.py` (deploy; derived surfaces incl.
  posts API, fail-loud) + `auditDosingLanguage` in
  `functions/_lib/post_format.js` (publish choke point). The 2026-09-01
  backfill stripped doses from 16 education pages, the homepage condition
  modals (`assets/js/domain-modals.js`), and three posts' narrative
  paragraphs — removal/generalization only, nothing authored.
* **The disclaimer block (`mz-eddisclaimer`)** on every educational
  surface: all education + portal education pages, the /evidence/ and
  /trending/ shells (covers every post they render), and every homepage
  condition modal — appended by the ONE renderer in `assets/js/home.js`
  (`domainModalBody`), never per-entry. `scripts/fix_disclaimers.py`
  injects; `audit_no_dosing.py` enforces presence.
* **Every route grounds on opaque paper.** The light conversion left
  html/body TRANSPARENT on most routes (only tint gradients painted), so
  the ground became the visitor's browser canvas — grey in dark-mode
  Safari ("you turned my website into an ugly grey").
  `scripts/fix_page_canvas.py` appends
  `<style id="mz-canvas-guard">html{background-color:#FBFAF8}</style>`
  before the LAST `</body>` of every derived route;
  `scripts/audit_page_canvas.py` (deploy gate) proves the RENDERED result
  by pixels — three corner samples per route, all light (≥200 lum; the
  violet tint washes are the design's own and pass) — because a
  computed-style check false-positives on opaque gradient grounds.

### 8.0.0.0c Mount Zara's Reflections — the /learn/ course platform (2026-09-02)

**What it is:** free, open, guided patient courses on the conditions the
practice treats (design doc: the "Mount Zara's Reflections" artifact,
rev 3; owner decisions baked in). Phase 1 ships the engine + the
endometriosis pilot.

**The pedagogy IS the schema** (owner's MSAEd, enforced not remembered):
every lesson = lived-experience `opening` → `teaching` blocks LIFTED from
the approved library (education pages + condition modals — citations and
popovers ride along; the generator NEVER authors clinical prose) →
private `reflection` (client-side only, never transmitted) → optional
`check` (wrong answers are real myths; corrections open with the belief's
plausibility and trace to a published source) → one `action` feeding the
questions-for-your-visit builder (localStorage; printable at
`/learn/<topic>/your-questions/`).

**Pieces:** `education/<topic>/course.json` (the manifest, one per topic
that has a course) → `scripts/build_reflections_course.py` (generator →
`learn/` catalog + course home + per-lesson routes; disclaimer + canvas
guard baked into every page) → `scripts/audit_course_schema.py` (deploy
gate: modules exactly 1..6, every lesson complete, checks well-formed,
counseling prose dose-free and CPG-free, regeneration is a no-op so
manifest and pages cannot drift). Generated pages are ordinary routes —
every site-wide runtime gate (canvas, light-text, text-width, contrast,
no-dosing) covers them automatically.

**Module 4's voice** ("questions to ask any surgeon") renders with the
amber owner-pending note until Dr. Mabini sets its tone personally —
lessons carry `tone_owner_pending: true` in the manifest until then.

### 8.0.0.0b Text width + hero motion are MEASURED, not eyeballed (2026-09-02)

**Owner reports:** "text wraps to next line in middle of page, doesn't use
the entire width where it should — widespread throughout the ENTIRE
website," and "the opening page animation is stalling AGAIN — prevent
this from breaking after every revision."

* **`scripts/audit_text_width.py`** (deploy gate) — renders every derived
  route at 1440px and measures true line-box geometry per text block
  (rects of visible text nodes grouped per line; grid/flex cells use
  their own track as available width; inline elements, boxes <320px,
  closed-`<details>` content, hidden descendants and `data-widthok`
  opt-outs exempt). Flags narrow-off-center columns beside dead space,
  premature mid-box wraps, tiny measures in wide containers. The
  2026-09-02 sweep found 72 blocks/12 signatures; headline cause: 20
  education pages declared `<section class="key-facts">` while the CSS
  styles `.facts` — the stat grid NEVER applied and cards rendered as
  stacked full-width strips. All fixed (also: curriculum subtitles,
  admin ledes, /cv/ tagline, portal greeting widened; /about/ cover deck
  judged intentional and annotated `data-widthok`; bonus: /about/
  scene-2 headline was invisible from a malformed gradient — fixed).
  Now CLEAN on all 92 routes.
* **RUNTIME GATE POOL (2026-09-02):** the seven browser gates
  (patient-journey, page-canvas, light-text, contrast, text-width,
  hero-motion, nav+reading) launch CONCURRENTLY in `deploy-prod.sh`
  (`pool_launch`/`pool_rc`) and each result block waits on its own gate
  with unchanged messaging and ordering — wall time is the slowest
  single gate, not the sum. The serial chain had reached ~1 hour per
  deploy, which turned a one-line fix into an hour of the owner staring
  at the broken live version. Skip flags unchanged
  (`DEPLOY_SKIP_CONTRAST_AUDIT`, `DEPLOY_SKIP_NAV_AUDIT` gate the
  launches). NOTE for operators: never test "is a deploy running" with
  `pgrep -f deploy-prod.sh` from a wrapper whose own command line
  contains that string — three such waiters detected each other and
  deadlocked all deploys for 3 hours on 2026-09-02; match
  `[s]cripts/deploy-prod.sh` or check a PID you saved.
* **`scripts/audit_hero_motion.py`** (deploy gate) — the fingerprint lock
  protects the animation CODE; this proves the RENDERED lifecycle on
  desktop + iPhone emulation: hero media decoded, visible motion between
  early and settled frames, IMG src reaching the last-frame asset (or
  VIDEO reaching its end) within 16s, no stuck intro overlay, no page
  errors. A halted script, renamed asset, broken handoff or endless
  spinner now fails the deploy instead of reaching the owner.

### 8.0.0.1 Citation popovers — ONE rulebook, enforced everywhere (2026-09-01)

**The requirement (owner, standing):** hovering ANY inline citation shows the
paper's title, its journal/year/PMID meta line, and the curated
plain-language summary of what the paper shows — on education guides,
evidence briefs, trending posts, and every modal those surfaces open. 826
education popovers and a published brief shipped without this; 51 post
findings were verbatim abstract pastes; hundreds of metas carried the wrong
thing entirely (author lists where the journal belongs; "PMID N" with no
journal/year; citation lines mashed into the title). Root cause each time:
**every surface had its own generation rules in its own script.**

**THE RULE (owner directive, 2026-09-01): the popover rules live in ONE
place — `functions/_lib/post_format.js`, `auditPopoverSurface()` — and every
consumer walks surfaces into it. NEVER fork a copy of these rules into a
per-surface script; change the module and every gate changes together.**

**The spec markup** (single schema, everywhere):
`<span class="mz-ref-pop"><span class="mz-ref-pop-title">PubMed title</span>
<span class="mz-ref-pop-meta">journal · year (education adds · PMID N)</span>
<span class="mz-ref-pop-finding">curated summary</span></span>`
inside `<sup class="mz-ref">`.

**The rulebook checks** (codes): `unstructured`, `missing-sourced` (summary
absent though grounded text exists on the surface), `raw-dump` (finding
starts with an abstract section label), `verbatim-dump` (finding is a
contiguous copy of the paper's abstract — title-as-descriptor exempt),
`near-empty`, `bad-title` / `bad-journal` / `bad-year` (metadata contradicts
the paper's PubMed record; a meta year passes if ANY year in it is a PubMed
date for the paper, so "Rev Assoc Med Bras (1992) · 2026" is fine).
`missing-unsourced` is ADVISORY — writing "what a paper shows" is clinical
content for the clinician, never for a gate.

**Two enforcement layers around the one module:**

* **Deploy chain:** `scripts/audit_ref_popovers.mjs` (in `deploy-prod.sh`) —
  a WALKER only. Derives education pages from the tree and posts from the
  live API (zero posts scanned = FAIL), and feeds each surface plus its
  curated map into `auditPopoverSurface`. Metadata/dump facts come from the
  committed corpus `scripts/popover_meta_corpus.json` (title / journal /
  journal_abbrev / years / abstract for EVERY PMID cited anywhere on the
  site, entities decoded; `--refresh` refetches, a cited PMID missing from
  it fails the gate). Replaced `audit_ref_popovers.py` — deleted, do not
  resurrect a second implementation.
* **Publish choke point** (every POST/PUT/approve through `/api/posts`,
  which is what protects SCHEDULED pipeline publishes between deploys):
  `auditPopoverSummaries(post)` = the same `auditPopoverSurface` with the
  post's own grounded pool; `auditDarkGrounds` refuses a dark embedded
  stylesheet (same colour rules as `audit_dark_surfaces.py`). Both wired
  into `auditPublishable`, so a failing auto-post is held as a draft. The
  worker skips the metadata checks only because it has no corpus; the
  deploy gate covers them.
* **The heal** (`healPopoverSummaries`, runs in `autoHealBody` at ingest) is
  grounded-only: (1) W20-era class-schema rename (pure attribute rename),
  (2) dump findings — labelled OR verbatim-paste — replaced from the paper's
  own modal Bottom-line, (3) missing finding filled from
  `groundedSummarySources` (Bottom-line, else cite-card lens; author lists
  and abstract dumps rejected). No grounded source → LEFT ALONE.

**Sourcing rule (unchanged, absolute):** no tool may author clinical text to
silence a gate. Curated summaries come from the post's own cite cards /
modal bottom-lines, the education pages' `.ref-what` blocks, or the owner.
Metadata is different: title/journal/year are facts from PubMed and ARE
deterministically correctable — `scripts/fix_popover_metadata.mjs` rebuilds
every popover's title/meta from the corpus, uniformly, on every surface
(and repaired the 2026-09-01 backlog: ~1,000 rebuilt metas/titles, 119
dump findings replaced from grounded sources).

All of it is unit-tested by `scripts/test_post_format_gate.mjs` (hard deploy
gate; 101 checks). `scripts/fixtures/canonical_reference_post.json` carries
the LIVE light stylesheet — refresh it from live W21 if the canonical
palette ever changes again, or the dark-ground tests will fail the fixture.
One-off backfill scripts (2026-09-01, superseded for future work by the
module + `fix_popover_metadata.mjs`): `scripts/fix_ref_popovers.py`,
`scripts/fix_post_popovers.py`.


### 8.1 Root pages

`index.html` (~10K lines — see §3, §4), `about/`, `evidence/`, `trending/`,
`cv/`, `curriculum/` (`cbg-migs/`, `hospice-clerkship/`, `hospice-training/`)

**`curriculum/cbg-migs/` Year-3 deep-dive layer (2026-08-08):** beyond the
16 chapter chips, the page now carries 32 `[data-mkey]` triggers feeding a
`DETAIL_DATA` registry through the same `#ch-modal` chrome — 12 clickable
Year-3 month tiles (faculty/objectives/reading/videos), 4
graduated-responsibility cards (Y1/Y2/Y3 + milestone table), 6
week-in-Year-3 day cards, 9 simulation-series cards, and the case-volume
projection table. Content is generated from `docs/fmigs-year3/`
(checklist md + PGY7 overview PDF) via the session builder
(`build_curric_deep.py`); NEVER hand-edit facts into the modals without
re-checking those sources — and never any UIC affiliation (fact-sync gate
enforces). The counter animator is generalized (`animateCounter` +
per-row IntersectionObserver) because the page has two `.counter-row`s.

**R11 lock-step (2026-06-10; relocated 2026-06-25):** the 14-row visit-type →
modality matrix mirroring `functions/_lib/visit_types.js` was MOVED off the
homepage (`#how-you-visit` section deleted) into the Member-Portal Coming-Soon
page (`functions/portal/_middleware.js`, `COMING_SOON_HTML`, `.visit-matrix`).
Any visit-type add/rename or modality/chaperone change MUST update that matrix
in `_middleware.js` in the same commit.

### 8.2 Education (gated by `EDUCATION_PUBLIC_LAUNCH` + middleware)

12 topics × 2 surfaces (public + portal mirror):
- abnormal-uterine-bleeding, adenomyosis, chronic-pelvic-pain,
  contraception, dysmenorrhea, endometriosis, fibroids, menopause,
  ovarian-masses, pcos, postoperative-recovery, pregnancy-loss
- `_template/` is scaffolding (underscore-prefixed; deploy gate skips
  it per §2.3 step 1)
- Each page carries: §0.8.1 manifest, §3.12 AI disclaimer, §3.10
  design tokens, `<sup>` PMID footnotes
- **Mirror drift risk:** `education/<slug>/index.html` and
  `portal/education/<slug>/index.html` are byte-similar copies. When
  editing one, update the other in the SAME commit.

### 8.3 Portal SPAs (preview-gated)

13 surfaces — `appointments/`, `billing/`, `documents/`, `education/`,
`intake/`, `login/`, `magic-link/`, `messages/`, `profile/`, `proms/`,
`signup/`, `symptoms/`, plus `_feedback.js` + `_wizard.js`

**Pre-launch sign-in allowlist (2026-07-05):** `preview_gate.js`
`isMemberSignIn()` keeps `/portal/login`, `/portal/magic-link`,
`POST /api/v1/auth/{login,logout}` + `magic-link/issue` reachable while
the gate is closed — without it a member whose preview + session cookies
both expired was permanently locked out (magic-link REDEEM was open but
ISSUE was cloaked). Magic-link issue+redeem are rate-limited
(`rate_limit.js`, same 10/15-min policy as password login).

**Dashboard experience lock-steps (2026-07-05):** `portal/index.html`
Billing card ← `/api/v1/patient/billing/invoices`
(`outstanding_balance_cents` + per-invoice `status`); booked-visit card
state ← `triage/current` now returns `appointment_id` →
`/api/v1/patient/appointments/<id>` (`modality`,`starts_at`) → telehealth
renders Join-visit (`/portal/visit/<id>/launch`) + `/portal/tech-check/`
links (previously BOTH pages were orphaned — zero inbound links).
Booking confirmation (`appointments/book/`) shows the same two links.
`symptoms/diary/[date].js` exports `onRequestPost = onRequestPut`
because the diary page's beforeunload `sendBeacon` can only POST.
Login + magic-link-redeem honor `?next=` (portal-internal only).

### 8.4 Admin SPAs

14 surfaces — `analytics/`, `billing/`, `briefings/`, `carousels/`,
`cases/`, `compliance/`, `content/`, `debug/`, `education/`,
`feedback/`, `messages/`, `patients/`, `scheduling/`, `trend-briefs/`,
`triage/` + `_nav.js` (shared sidebar) + `index.html`

(`login/` REMOVED 2026-07-05 — it was orphaned dead code whose form
POSTed to a nonexistent `/admin/api/login`; real admin auth is the
browser Basic prompt from `functions/admin/_middleware.js` + `/admin/_mfa`.
`compliance/` added to `_nav.js` the same day — it existed with full API
backing but was unreachable from the sidebar.)

`billing/` sub-pages (all linked from the `billing/` header, all glass +
line-art backdrop): `clearinghouse/` (**six-step setup wizard** — see the
clearinghouse-onboarding row below), `coach/` (Coding
Coach), `insurance/` (per-patient insurance editor), `payers/`,
`preflight/` (AI pre-flight denial-prevention review), `appeals/`
(AI denial-response / appeal drafter).

`_nav.js` is the canonical admin navigation source — every admin
surface includes it. Adding a new admin section: update `_nav.js` AND
create the SPA dir.

---

## 9. R2 content surfaces — `mountzara-content` bucket

| Key prefix | Content | Renderer |
|---|---|---|
| `posts/<id>.json` | Post body_html + structured §0.8.2 manifest fields | `/evidence/` (kind=evidence) + `/trending/` (kind=blog) page wrappers + `functions/api/posts/[[path]].js` |
| `_index/blog.json`, `_index/evidence.json` | Listing indexes | Admin dashboards |
| `manifests/<id>.json` | Per-post run manifests | `verify_kb_anchoring.py --r2-posts` |

**CANONICAL-FORMAT GATE + AUTO-HEAL (2026-07-02; expanded 2026-07-05)** —
single source of truth `functions/_lib/post_format.js` (imported by
`functions/api/posts/[[path]].js`). `auditPostFormat()` now enforces THREE
layers, all derived from the live corpus (W20/W21 = proper; the shipped
W23/W24 = broken on all three):
  1. **Cards** — canonical = `mz-cite-card > 0` AND `paper-card == 0`.
  2. **Deep-dive modals** — must use the `mz-jc-*` grammar the post's own
     inline CSS styles, NOT the `deepdive-modal`/`dd-*` grammar (dd-section,
     dd-body, dd-h3, dd-title, glass-card). The dd-* grammar has ZERO matching
     CSS, so W23/W24 modals rendered as UNSTYLED raw HTML when opened (the
     "garbage" reported 2026-07-05). `healDeepDiveModals()` converts dd-* →
     mz-jc-* losslessly (class-rename + flat dd-body unwrap; PMID multiset +
     modal-id set + per-modal word-multiset preserved or it REFUSES).
  3. **Editorial architecture** (weekly roundups only — detected by ≥2
     `mz-topic-group`/`topic-section` blocks or the "Monday Mornings"
     masthead; the single-topic `evidence-2026-05-19-*` trend briefs are
     exempt). A proper roundup MUST carry: an editorial narrative
     (`mz-(post-)?narrative`), the Five Picks feature (`mz-five-pick`),
     per-topic synthesis groups (`mz-topic-group`), and a references list
     (`mz-references-list`). Feature-matched (not exact class names) so BOTH
     the W20-era and W21-era vocabularies pass. This blocks a stripped,
     cards-only directory from ever publishing — that class of regression
     can only be repaired by REGENERATING the editorial layer (the AI
     authoring pass used to rebuild live W23/W24 on 2026-07-05), not a
     mechanical heal, so a stripped roundup lands as a blocked draft.
`healPost(body, refBody)` orchestrates both mechanical heals (paper-card →
cards, then dd-* → modals); `autoHealBody` in `[[path]].js` calls it at
ingest.

**MODAL-CONTENT DEPTH (2026-07-05).** Beyond structure, each deep-dive
modal has 13 sections; auto-generation leaves some as placeholder text
("Study design not auto-classified", "No explicit limitations extracted",
"No matching foundational topic synthesis found", "See verbatim abstract
below"). W20 shipped fully-filled; W21/W23/W24 had degraded methods /
risk-of-bias / findings / strengths / literature-placement sections. These
were DEEPENED on 2026-07-05 by an AI authoring pass grounded strictly in
(a) each modal's own verbatim PubMed abstract and (b) KB context retrieved
from the D1 `kb_docs` FTS5 index (1,144 docs; `_lib/kb.js retrieveKB`,
queried per topic — see `scripts/kb_load_d1.py` to (re)load). Splicing
replaces ONLY the placeholder body of the degraded section (keeps the
`<h3>` + any `mz-jc-section-intro`), verified lossless (modal-id set + card
count + abstract-block count unchanged). Pipeline artifacts live in the
session scratchpad (`modal_author_wf.js`, `splice_modals.py`,
`extract_modalwork.py`). NOT gate-enforced (content depth, not structure) —
the real durable fix is the sibling generator emitting filled sections.
Every roundup now carries 0 residual placeholders across 287 modals.

**NUMERIC-FIDELITY GATE (2026-07-06).** `auditNumericFidelity(post)` in
`post_format.js`: every decimal EFFECT ESTIMATE (single-digit `d.dd` — the
shape of an OR/RR/HR/AUC/CI bound) inside a deep-dive modal's Key-Findings
section MUST be traceable to that modal's OWN embedded verbatim PubMed
abstract (`mz-jc-abstract-body`) — literally OR within a 2-decimal rounding
tolerance (|abstract − value| ≤ 0.006, so a 3-decimal 1.885 legitimately
renders as 1.89). Catches a generator misextraction or an authored
fabrication before publish; tolerates faithful rounding. Deterministic +
offline (the abstract is in the modal). Deploy gate
`scripts/audit_numeric_fidelity.mjs` (imports the same function; runs
against the live R2 corpus, `--file` for local; network-flaky load degrades
to skip, never a false block) wired into `deploy-prod.sh` right after the
structural gate; hermetic fixtures in `test_post_format_gate.mjs` (literal
pass / rounding pass / fabrication fail / no-abstract skip / non-clinical
exempt). Origin: the 2026-07-05 trust audit — an operator-skeptic pass that
cross-checked every modal number against real PubMed; all live effect
estimates were faithful (roundings, not fabrications), and the handful of
authored PROSE roundings (`~92%`→91.6%, `~45%`→45%, a derived `n=105`→
"three groups of 35") were tightened to the exact source figures. Prose
approximation isn't gate-enforceable (editorial license); the effect-table
numbers are, and now are.

**ABSTRACT-COMPLETENESS GATE (2026-07-06).** `auditAbstractCompleteness(post)`
in `post_format.js`: a modal's embedded "verbatim from PubMed" abstract
(`mz-jc-abstract-body`) must NOT start with a mid-structure section label
(Interventions/Results/Outcomes/Conclusions/Lessons/…) — that can only be the
FIRST label if the opening sections (Background/Objective/Introduction/Methods/
Patient Concerns/Rationale) were truncated. Deterministic + offline (no PubMed
at gate time). Runs in the SAME gate script (`audit_numeric_fidelity.mjs`, now
a combined content-fidelity gate: effect estimates + abstract completeness) and
`test_post_format_gate.mjs` (gate 47/47). Origin: the 2026-07-06 exhaustive
corpus audit found 5 modals (4 in W21, 1 in the MCAS/POTS/EDS trend brief)
whose "verbatim" abstract had dropped its leading structured sections; each was
re-embedded with the COMPLETE English abstract from efetch (bilingual PubMed
records: English `AbstractText` blocks only). That pass also confirmed corpus
health independently of the site's own audits: all 357 unique cited PMIDs
resolve on PubMed (zero fabricated citations); all 286 effect-estimate decimals
trace to their embedded abstracts; all 71 reference-list entries + 372
inline-citation popovers carry real titles with zero dangling links.

**POPOVER-SUMMARY GATE (2026-07-06).** `auditPopoverSummaries(post)` in
`post_format.js`: each inline-citation hover popover's `mz-ref-pop-finding`
must be an ADEQUATE plain-language summary of the paper's finding (the W20/W21
standard), NOT a raw dump of the abstract's opening. Hard signal: a finding
that starts with a structured-abstract section label (RATIONALE:/INTRODUCTION:/
BACKGROUND:/METHODS:/…) is a truncated abstract dump, never a summary; also
flags effectively-empty findings (< 25 chars — floor sits BELOW the W20/W21
reference minimum of 53 so concise foundational-citation descriptors pass).
Deterministic + offline; part of the combined content-fidelity gate
(`audit_numeric_fidelity.mjs`) + `test_post_format_gate.mjs` (gate 53/53).
Origin: the 2026-07-06 audit found ~106 W23/W24 citation popovers (43 unique
papers) whose finding field was the truncated abstract opening; each was
replaced with that paper's own modal Bottom-line (already grounded +
numeric-gated) — median summary length rose to ~300 chars, matching/exceeding
W21. W20 uses an older popover grammar (`mz-ref-title`, title-only, no finding
field) and is exempt.

**SUMMARY-DUPLICATION GATE (2026-07-06).** `auditSummaryDuplication(post)` in
`post_format.js`: each study card's `mz-cite-fits` "DO + CBG/MIGS lens" line must
be paper-specific. The regressed W23/W24 pipeline stamped ONE canned essay-length
per-topic paragraph verbatim onto up to 13 different papers ("Infertility is
rarely just an organ failing…" on every infertility card) — fake per-paper
insight. Rule, calibrated against the live corpus (max repeat of a ≥200-char
lens line: W20 = 0, W21 = 0, W23 = 13, W24 = 4): an essay-length lens line (≥ 200
chars) must not appear on more than one card. Short honest category tags (W21's
"Where it fits: Evidence on X — see abstract", ≤ 141 chars) legitimately repeat
and sit below the 200-char floor, so they never trip it. The auto-heal cannot
synthesize grounded per-paper prose, so a tripping post is held as a
non-publishable draft for regeneration. Part of the combined content-fidelity
gate (`audit_numeric_fidelity.mjs`) + `test_post_format_gate.mjs` (gate 69/69) +
`auditPublishable`. Fix for the live corpus: the 72 duplicated W23/W24 cards (61
+ 11) were regenerated with paper-specific, abstract-grounded lens lines via a
fan-out workflow (generate → adversarial grounding+specificity verify).

**AUTHORITATIVE PUBLISH GATE — closes the scheduled-auto-post hole (2026-07-06).**
Before this, the ingest/`/approve` choke points keyed off `auditPostFormat().canonical`
(STRUCTURAL only), so a scheduled auto-post that was structurally canonical but
had a fabricated effect number, a truncated verbatim abstract, or a raw-dump
citation popover would AUTO-PUBLISH. `auditPublishable(post)` in `post_format.js`
is now the single "may this go live" check = structural canonical AND all four
content-fidelity audits (numeric fidelity, abstract completeness, popover
summaries, summary duplication). EVERY path in `functions/api/posts/[[path]].js` that sets
`status:"published"` routes through it: (1) pipeline "publish immediately"
(`body.status==="published"`) → only if `publishable`; (2) stale→canonical
format-heal auto-republish → only if the incoming re-render is fully `publishable`;
(3) `POST /:id/approve` → 422 unless `publishable` (admin `{"force":true}` recorded);
(4) `PUT /:id` flipping `status:"published"` → 422 unless `publishable` (was an
UNGATED admin shortcut — the bypass this pass closed; `{"force":true}` recorded).
A failing auto-post lands as a NON-PUBLISHABLE draft (never public) with
`publish_problems` in the 201 + on `_admin/freshness` (dead-man surfaces it). The
auto-heal still uses `auditPostFormat().canonical` (structure = its contract) —
it fixes grammar, not clinical content, so a numeric/abstract/popover defect it
cannot fix simply holds the post as a draft. Hermetic proof in
`test_post_format_gate.mjs` (gate 57/57): a structural-canonical body with a
raw-dump popover / truncated abstract / fabricated OR is asserted NOT publishable;
the canonical fixture IS. So a scheduled post now meets the full W20/W21 standard
before it can ever reach the public — enforced at the API, not just at my deploys.

**CONTENT-FIDELITY AUTO-REPAIR AT INGEST (2026-07-06).** Beyond blocking, the
ingest `autoHealBody` now REPAIRS a substandard auto-post to publishable where a
ground truth exists — so a good post goes live without waiting on a human:
  * `healPopoverSummaries(body)` (offline) — replaces a raw-abstract-dump citation
    summary with that paper's OWN modal Bottom-line (already grounded +
    numeric-gated).
  * `healAbstractCompleteness(body, fetchAbstract)` — replaces a truncated
    "verbatim" abstract with the COMPLETE English abstract from PubMed
    (`fetchPubmedAbstract` in `posts/[[path]].js` → eutils efetch, edge-cached,
    6 s timeout, ≤30 fetches/ingest, second-language blocks skipped). Lossless
    guard: the fetched text must cover ≥85% of the embedded text's VISIBLE words
    (tag/attribute tokens excluded) or the modal is left untouched.
Both run on EVERY ingest — even a structurally-canonical body — because that was
exactly the W23/W24 failure (canonical cards, broken modals/popovers). Order:
structural heal → popover heal → abstract completion; completing a truncated
abstract also RESOLVES numeric-fidelity flags whose only cause was the truncation.
NUMBERS ARE NEVER FABRICATED: a genuinely untraceable effect estimate that
survives completion is left for the publish gate to hold as a draft (repair what
we can verify; refuse to guess where we can't). Clean posts incur zero fetches /
zero changes. Hermetic proof in `test_post_format_gate.mjs` (gate 65/65):
popover raw-dump → bottom-line; truncated abstract → completed via injected
fetcher; non-lossless fetch refused; a fabricated number survives and stays
NOT publishable.

**TEMPLATE-BOILERPLATE GATE (2026-07-14).** `auditTemplateBoilerplate(post)`
in `post_format.js`, wired into `auditPublishable` + `audit_numeric_fidelity.mjs`
+ `test_post_format_gate.mjs`. Catches the softer sibling of exact duplication:
the regressed generator emitted ONE fill-in-the-number template ("…This week's
signal is a sample of N with an OR of X … That's the gap I'm building tools to
close.") across 30-44 cards/post. Each copy is byte-UNIQUE (different N/X) so
`auditSummaryDuplication` passes it, yet it reads as robotic filler — a
regression from W21, whose every card line is paper-specific. Detection: strip
each card's shared "Frame: …:" prefix, number-normalize the remaining
sentences, flag any substantive sentence (≥40 chars) reused across **≥10**
cards. Calibration: the W21 gold standard's most-reused fallback recurs in 7
cards, so ≤9 is tolerated as shared framing; the template's content-free filler
recurs across 16-44. 10 cleanly separates them (verified: W20/W21/trend briefs
PASS, the 5 regressed roundups FAIL). Fix: the 190 templated cards across
W23/W24/W25/W28/W29 were regenerated to grounded, paper-specific,
adversarially-verified lens lines (same pipeline as the duplicate-card rehab).

The base card rule (kept verbatim for the fixtures):
`mz-cite-card > 0` AND `paper-card == 0` (W20/W21/evidence briefs canonical;
the originally-shipped W23/W24/W25 stale).
`healPaperCardPost(body, refBody)`: server-side conversion of a stale
paper-card body to canonical (style swap from reference post
`env.CANONICAL_REFERENCE_POST || blog-2026-W21` read from R2, card
grammar → mz-cite-card, DOI links → real PubMed, .mz-post-wrap ELEMENT
wrap — substring test is a trap, the canonical CSS contains the selector
text). SAFETY MODEL: post-conditions verify losslessness (modal-id set
equality + PMID superset + size sanity) or the heal REFUSES and the
original body lands as a blocked draft — the healer can only improve,
never worsen. Enforcement layers: (1) AUTO-HEAL at ingest (stamps
`format_auto_healed_at`, returns `auto_healed` in the 201); (2) warn
(`format_warnings` + stored `post.format_audit`); (3) `/approve`
HARD-BLOCKS (422) non-canonical unless `{"force":true}` (recorded).
Overwrite-guard exception: a canonical (incl. auto-healed) re-render may
replace a PUBLISHED stale-format post under the same id (`format_healed_at`).
**Deploy gate:** `scripts/test_post_format_gate.mjs` (hermetic, fixtures
in `scripts/fixtures/` built from the real regressed corpus) runs as a
HARD no-override step in `deploy-prod.sh`. Operator repair tool:
`scripts/heal_paper_card_posts.py` (bs4; used to heal live W23/W24/W25).
`GET /api/posts/_admin/freshness` (admin) = content-pipeline dead-man
dashboard (newest published age per kind, stale > 8 days, drafts pending
approval with per-draft format verdicts, trend-brief queue depth,
carousel freshness); surfaced by the freshness banner in `admin/_nav.js`
(passive — only when creds cached) and checked daily by cron-worker
`runContentFreshnessCheck` (writes audit_log `content_freshness_alert`,
allowlisted in `_lib/audit.js`).

**Current shipped posts (as of 2026-05-26):**
- `blog-2026-W20` — CBG/MIGS Monday Mornings W20
- `blog-2026-W21` — CBG/MIGS Monday Mornings W21
- 7 trend briefs at `evidence-2026-05-19-*` (H1/H2, GLP-1, MHT-WHI,
  testosterone, MCAS-POTS-EDS, mast-cell, pelvic-congestion,
  antihistamines-vasomotor)

**Lock-step:** When editing post body_html, run pre-PUT audit
(`scripts/audit_live_post.py --pre-put <payload>`) per §3.7.1.

---

## 10. D1 schema migrations — `schema/*.sql`

| File | Phase | What it adds |
|---|---|---|
| `0001_phase0_foundation.sql` | Phase 0 | patients, sessions, intake, encounters, messages, documents, audit_log |
| `0002_phase2_practice_settings.sql` | Phase 2 | clinicians, practice_settings (Doxy URL, hours) |
| `0003_phase3_portal_modules.sql` | Phase 3 | symptom_definitions, symptom_diary, cycle_log, womens_health, education, content_subs |
| `0004_phase3_messaging.sql` | Phase 3 | message threads + posts |
| `0005_phase3_message_attachments.sql` | Phase 3 | envelope-encrypted attachments |
| `0006_phase2_5_triage.sql` | Phase 2.5 | appointment_triage (AI categorization) |
| `0007_phase8_billing_foundation.sql` | Phase 8 | claims, payers, services |
| `0008_phase8_payments_invoices.sql` | Phase 8 | invoices, payments |
| `0009_phase8_billing_ai.sql` | Phase 8 | AI advisor outputs |
| `0010_phase10_proms_foundation.sql` | Phase 10 | PROM definitions + assignments |
| `0011_phase10_proms_extended.sql` | Phase 10 | Tier-2/3 instruments |
| `0012_phase9_snapshots.sql` | Phase 9 | snapshot history + diff |
| `0013_phase_qa_session_trace.sql` | Phase QA | session_trace + preview_invites |
| `0014_phase_qb_feedback.sql` | Phase QB | member_feedback + audit_events |
| `0015_phase_qc_wizard.sql` | Phase QC | wizard_state |
| `0016_phase14_humanization.sql` | Phase 14 | patient profile photo + nickname + care_goals |
| `0017_deep_dive_authoring.sql` | — | deep-dive modal authoring storage (trend-brief §3.8) |
| `0018_phase17_telehealth_safety.sql` | Phase 17 | R1 chaperone cols on `appointments`; `visit_launch_attestations` (R4); `tech_check_results` (R5 — read by the admin appointments + cases device-check badge); `licensure_blocks` (R3). **Applied to D1 2026-05-28.** |
| `0019_phase17_signatures.sql` | Phase 17 | compliance-doc signature storage |
| `0020_phase17_visit_presence.sql` | Phase 17 | ALTER `visit_launch_attestations` ADD `current_state` (R4 per-visit presence). **Applied to D1 2026-06-09.** |
| `0021_phase18_id_verify.sql` | Phase 18 | ALTER `patients` ADD `identity_verified_at` / `identity_verified_method` / `identity_verification_notes` (R6 first-visit photo-ID verification). **Not idempotent — apply ONCE, BEFORE deploying the Sprint 2 code (the cases keystone SELECT references the new columns).** |
| `0022_phase18_messaging_sla.sql` | Phase 18 | ALTER `message_threads` ADD `urgency` / `sla_due_at` / `sla_breached` + partial index (R8 response-window SLA). **Not idempotent — apply ONCE, BEFORE code deploy (startThread INSERT references the columns). The 15-min sweep also requires a separate `cd cron-worker && wrangler deploy`.** |
| `0023_phase18_nps.sql` | Phase 18 | `nps_dispatches` + `nps_responses` (R9 post-visit NPS). Idempotent. Lock-step: `/api/v1/internal/nps/dispatch` (pipeline-token) ← cron-worker `0 11 * * *` (needs `PIPELINE_TOKEN` secret on the worker); `/api/v1/patient/nps/respond` (token-is-auth, 14-day TTL); `portal/nps/index.html` + `_redirects` wildcard; `/api/v1/admin/nps/{scores,responses}`; analytics NPS cards; cron-worker backup TABLES list. |
| `0025_patient_insurance.sql` | Billing | `patient_insurance` (member id / group / subscriber / gender / billing address). Idempotent. Auto-filled into claims by `claims/[id]/submit.js`; editor `admin/billing/insurance/`. **Applied to D1.** |
| `0026_billing_ai_appeals.sql` | Billing AI | `billing_preflight_reviews` (AI pre-flight denial-prevention records) + `billing_appeals` (denial-response drafts: strategy + letter + remediation + CARC codes). Idempotent. Backs `claims/[id]/preflight.js` + `claims/[id]/appeal.js`. **Applied to D1 2026-06-29.** |
| `0027_session_token_hash.sql` | Auth hardening | ALTER `auth_sessions` ADD `token_hash` — closes the D1 session-fallback gap (getSession previously accepted session_id ALONE on a KV miss). Code is migration-TOLERANT: `createSession` falls back to the legacy INSERT if the column is missing, and `getSession` uses `SELECT *` + FAILS CLOSED (KV-miss + no/mismatched hash = rejected, forcing one re-login). **Applied to D1 2026-07-05 (user-approved); column verified via pragma_table_info. Sessions created BEFORE this date have NULL token_hash — they fail closed on a KV miss (one re-login) and age out within the 12h TTL.** |

Apply: `wrangler d1 execute mountzara-clinical --remote
--file=schema/<file>.sql`

---

## 11. Cross-app sync surfaces

| Endpoint | Native app caller | Auth | Schema |
|---|---|---|---|
| `/api/v1/sync/transcription/notes` | MountZaraMedicalTranscription (macOS) | `TRANSCRIPTION_SYNC_TOKEN` | encounters + transcription_notes |
| `/api/v1/sync/clinical-ai/cases` | MountZaraClinicalAI (macOS) | `CLINICAL_AI_SYNC_TOKEN` | encounters + ai_cases |
| `/api/v1/sync/surgical/cases` | SurgicalVideoArchiveApp (macOS) | `SURGICAL_WORKFLOW_SYNC_TOKEN` | encounters + surgical_cases |
| `/api/v1/sync/ios/encounters` | MountZaraAI-iOS | `IOS_SYNC_TOKEN` | encounters |
| `/api/v1/sync/patients/lookup` | All native apps (read-only patient resolution) | Any sync token | patients |

**Lock-step:** If sync schema changes, native apps must update their
upload payloads. `functions/_lib/sync_auth.js` enforces tokens; each
sync route has a per-app permissions filter.

---

## 11.5 `companion-app/` — native SwiftUI admin app (iPhone / iPad / Mac)

"MZ Admin" — one SwiftUI codebase, three platforms. Talks to the SAME
`/api/posts/*` + `/api/v1/admin/*` HTTP Basic-auth endpoints as the web
admin (NO separate backend; §7 middleware applies).

| File | Role |
|---|---|
| `MZAdmin.xcodeproj/` | COMMITTED Xcode project (hand-generated 2026-06-12, machine-verified). Open-and-⌘R on a Mac — no XcodeGen needed. Shared scheme `MZAdmin` → CLI `xcodebuild -scheme MZAdmin` works. |
| `build-mac.sh` | One-command Mac build: `sim` (default, no signing), `mac`, `device`. |
| `project.yml` | XcodeGen spec, kept in lock-step with the .xcodeproj (only needed to REGENERATE after restructuring). |
| `MZAdmin/MZAdmin.entitlements` | macOS App Sandbox + outbound network. Wired via `CODE_SIGN_ENTITLEMENTS[sdk=macosx*]` in BOTH pbxproj and project.yml. |
| `MZAdmin/Sources/MZAdminApp.swift` | `@main` App; injects `AuthStore`. |
| `MZAdmin/Sources/Theme.swift` | Site-matching dark palette + glass card. |
| `MZAdmin/Sources/Models/Post.swift` | Codable mirror of the R2 post envelope (type-checked on Linux CI/VM, pure Foundation). |
| `MZAdmin/Sources/Models/AdminModels.swift` | Codable mirrors of triage / messaging / scheduling / visit-type JSON (`/api/v1/admin/*`). |
| `MZAdmin/Sources/Models/AdminAPI.swift` | async URLSession client, Basic auth; posts + triage (list/save/release) + messages (threads/detail/reply) + appointments + visit-types. Centralizes errors (type-checked on Linux w/ FoundationNetworking shim). |
| `MZAdmin/Sources/Models/AuthStore.swift` | Keychain-backed credentials (`import Security` — Apple-only). |
| `MZAdmin/Sources/Models/AppModel.swift` | Observable state + approve/reject/refresh actions (posts). |
| `MZAdmin/Sources/Views/*` | RootView → `MainTabs` (Posts / Triage / Messages / Schedule TabView). PostListView + PostDetailView (WKWebView). TriageView + TriageDetailView (AI rec + override + Save/Release). MessagesView + ThreadView (SLA badges, reply, stale-response seq guard). ScheduleView (30-day appt list by day). LoginView, FlowLayout. |

**Lock-step rules:**
- Add/rename/delete a Swift file → update BOTH `MZAdmin.xcodeproj/project.pbxproj`
  (or re-run `xcodegen generate`) AND `project.yml`, same commit.
- API shape changes in `functions/api/posts/[[path]].js` or
  `functions/api/v1/admin/*` → mirror in `Post.swift`/`AdminAPI.swift`.
- Build verification possible on this Linux VM: `swiftc -parse` all sources +
  `swiftc -typecheck` the Models data layer (toolchain at
  `/tmp/swift-toolchain/`, re-downloadable from swift.org). SwiftUI views
  type-check only on a Mac (`./build-mac.sh`).

---

## 12. `cron-worker/` — standalone Worker

Separate `wrangler.toml` deploy (`cd cron-worker && wrangler deploy`).
Schedule `0 9 * * *` UTC nightly: dumps every D1 table to NDJSON,
gzips via CompressionStream, PUTs to `mountzara-backups/d1/<UTC-date>.ndjson.gz`.

`workers_dev=false` — cron-only invocation, no public URL.

**Lock-step:** When schema migration adds a new table to D1, add it to
the cron-worker's enumerated table list (`cron-worker/src/index.js`)
or it won't be backed up.

**Cloud content producer (2026-09-01) — the Mac pipeline's replacement.**
The Mac `MountZaraResearchDigest` producer died after 2026-07-28 (last
published post W29 2026-07-13; 24 briefs stranded `pending`; its KB
retrieval was already broken — `kb_manifest.fell_back_to_empty=true` on
the whole 7/28 batch — and its influencer list never reached the server).
Its job now runs as scheduled Claude sessions per
`scripts/cloud_producer_runbook.md` — THE manual: constitution (never
publish, KB+PubMed grounding only, clinician text stays clinician-owned,
fail loud), both flows (Tuesday trend briefs via
`/api/v1/admin/trend-briefs/pending-review`; pull of approved overrides →
light-format draft posts → `/finalize`; Monday digest drafts), the
verbatim 32-row §3.8 audit table, template anatomy, light palette, and
the Routine definitions. Supporting pieces: the KB endpoint below; R2
`config/trend-watchlist.json`; `scripts/relight_pending_briefs.py`
(converted all 24 stranded pending bodies dark→light in R2 on 2026-09-01
— they rendered white-on-paper in the admin preview shell, which is part
of why review stalled; prose asserted byte-identical outside styling).

**KB grounding for the content pipeline (2026-09-01).**
`functions/api/v1/internal/kb/ground.js` — POST, X-Pipeline-Token or
admin auth — exposes `groundClinical()` (the one retrieval rulebook in
`_lib/clinical_grounding.js`, over the production `kb_docs` FTS5 index,
1,500 docs) to producer sessions, so cloud-side brief/post generation
grounds its clinical framing in the curated KB, never model memory
(§0.8.1 constitution). Thin wrapper only: retrieval logic and per-kind
policies stay in the lib. Companion config: R2 `mountzara-content`
`config/trend-watchlist.json` — the claim ledger (seeded from the
trend_brief_pending history) plus the owner-supplied influencer watch
list (empty until he provides it; the Mac pipeline's list never reached
the server, which is why every 2026-07-28 brief carries influencer=null).

**Content-pipeline stale-alert email (2026-09-01).** The daily 09:00 run
also fires `runContentStaleAlert` → `POST
/api/v1/internal/content/stale-alert` (Pages, X-Pipeline-Token — email
delivery lives in the Pages runtime). The endpoint checks two facts and
EMAILS the owner (`ALERT_EMAIL` || first `ADMIN_EMAILS`): newest published
post older than 8 days (the Mac digest pipeline has stopped), and trend
briefs sitting `pending` review longer than 7 days (the queue is waiting
on a human and nobody knows). Throttles itself to one email per 7 days via
its own `audit_log` rows (`action=content_stale_email`); counts and admin
links only, no clinical content. This closes the freshness check's
documented "KNOWN GAP: no mailer" — the W29 stall sat unnoticed for seven
weeks with 15 briefs pending because the audit row existed and nothing
told a human.

---

## 13. `scripts/*` — deploy chain + tooling (~129 files)

| Category | Files |
|---|---|
| **Canonical deploy gate** | `deploy-prod.sh` (the chain in §2.3), `_lib_admin_auth.sh` (§10.3.1), `_run_deploy.sh` |
| **Admin auth + security** | `_reset_admin_password_node.sh` (PBKDF2-100k), `_regen_admin_pw.sh`, `admin_totp_enroll.sh`, `phi_master_key_rotate.sh` |
| **Phase deploys** | `_deploy_phase14_a/b/c/d.sh`, `_deploy_phase15.sh`, `_deploy_phase_qa/qb/qc.sh`, `_deploy_p25a.sh`, `_redeploy_phase14_*_fix.sh` |
| **Per-feature commits** | `_commit_*.sh` (~15 — per-iteration commits for major features) |
| **Content generation** | `_gen_<topic>_page.py` (12 — one per education topic), `_anchor_*.py`, page builders |
| **Verification (audits)** | `verify_kb_anchoring.py` (§0.8.1 gate), `audit_live_post.py` (§3.7.1 gate), `audit_deploy_gate.py` (structural-integrity hard gate — deploy gate #7; reuses `audit_accuracy.py` header-* + `audit_inline_refs.py`), `audit_admin_drafts.py`, `audit_public_surfaces.py`, `cite_audit_*.py`, `voice_sweep_*.py`, `audit_route_render.py` + `route_render_manifest.json` (§13.5 route-render hard gate — deploy gate #9, env-resilient; `/` asserts `#identity-map` since 2026-07-22 — `#how-you-visit` moved to portal in 5953296), `_lib_pw_launch.py` (shared Playwright launcher: container-Chromium/engine fallback + proxy env wiring for ALL Python browser audits), `smoketest_phase17.sh` (Phase 17/18 gate assertions incl. §0b route reachability) |
| **Visual VERIFY (Playwright + iPhone)** | `_verify_identity_map_*.py`, `_verify_idmap_c2_screenshot.py`, `_verify_idmap_c3_carousel.py`, `_verify_iphone_*.py`, `_verify_portal_edu_*.py`, `_audit_iphone_*.py`, `_measure_iphone_*.py`, `_remeasure_iphone.py`, `_capture_mobile.py` (2026-08-24 — screenshots + horizontal-overflow report for `/`, `/about/`, `/evidence/` at 390×844 and 430×932; takes `[outdir] [base_url]` so it runs against production OR a local `python3 -m http.server`), `_capture_mobile_nav.py` (2026-08-24 — opens the hamburger panel and asserts the MEASURED facts that the 8/24 mobile regression broke: panel top == nav bottom, panel ground is paper not `rgba(0,0,0,.95)`, link colour is ink, every tap target ≥44px, CTA is full-width, and the panel closes on link tap). **HARD RULE — every verification/audit script MUST write screenshots, PNGs, JSON reports, and any other artifact to `/Users/beans/Documents/` (NEVER `~/Desktop`). User's Desktop is for USER files only. 2026-05-26 cleanup removed 20 `mz_*` dirs + 1 PNG (~193 MB) of prior-session test artifacts that earlier Claude sessions had dumped to Desktop. Do not repeat.** |
| **Stripe** | `_stripe_e2e_*.sh`, `_stripe_create_webhook.sh` |
| **Seed** | `_seed_jane_doe.sh`, `_seed_jane_meds.sh`, `_seed_blank_test_patient.sh`, `_send_jane_magic_link_email.sh` |
| **D1** | `_backup_d1_to_r2.sh` (manual; cron does it nightly), `_apply_phase14_migration.sh`, `_verify_phase14_schema.sh` |

**§0.4.1 audit lives outside this repo** at
`/Users/beans/Developer/MountZara/agent-platform/scripts/regression_audit.py`.
If `agent-platform/` moves, update `deploy-prod.sh::AUDIT` constant.

---

## 13.5 HARD RULE — dynamic-segment routes are served by Pages Functions, NEVER `_redirects` (codified 2026-06-10)

**The failure mode (hit THREE times now):** a `_redirects` wildcard rewrite
for a dynamic-segment path (`/admin/cases/<id>/` 2026-05-21,
`/portal/visit/<id>/launch/` since 2026-05-28, `/portal/nps/<token>/`
2026-06-10) silently falls through to the **marketing homepage**. The page
"ships," its API endpoints pass curl smoketests, and the route itself is
unreachable — invisible until someone loads the URL in a browser (§0.2.1).
The R4 launch interstitial was unreachable BY URL for 13 days this way.

**The rule.** Any route with a dynamic path segment that must serve a
static SPA/HTML file gets a **Pages Function** that fetches the asset via
`env.ASSETS` and stamps an **`x-mz-route` response header** (see
`functions/portal/nps/[token].js` for the canonical ~20-line pattern).
Never add a `_redirects` wildcard for such a route.

**The enforcement (3 layers — all must be done for any NEW dynamic route):**
1. Create the Pages Function with a unique `x-mz-route` header value.
2. Add a `check_route` assertion to `scripts/smoketest_phase17.sh` §0b
   (asserts the header for BOTH trailing-slash forms; a missing header
   means homepage fallthrough).
3. Add the route to `scripts/route_render_manifest.json` with title +
   selector assertions — `scripts/audit_route_render.py` is a HARD
   post-deploy gate in `deploy-prod.sh` (gate #9) that loads every
   manifest route in headless Chromium and fails the deploy on a wrong
   title, homepage fallthrough, or missing DOM selector. Its discovery
   contract also fails the deploy when ANY static SPA route exists in
   the repo without a manifest entry — so a new page physically cannot
   ship without its render assertions (or a conscious, diff-visible
   `unaudited` row) in the same commit. The visual-VERIFY discipline is
   thereby a machine check, not a memory. (Negative-tested 2026-06-10:
   an unregistered `/portal/route-gate-negative-test/` was correctly
   flagged as an orphan.)

**Sibling rule — frontends never reference nonexistent endpoints.** The
launch page fetched `GET /api/v1/patient/appointments/<id>` for 13 days
before the endpoint existed (the catch swallowed it). When shipping a page
that calls an API, curl that exact API in the same session; "best-effort"
fetches still need a real backend. The smoketest §0b content-type check
covers the known instance.

---

## 14. Known gaps + legacy patterns to retire

These are tracked separately so future sessions can prioritize. Items
struck through are RESOLVED — kept in this list as audit history.

1. ~~**`MountZaraResearchDigest/blog_generator.py`** (SIBLING REPO) —
   still emits legacy `<div class="deepdive-modal">` instead of
   canonical `<dialog class="mz-jc-modal">`.~~
   **RESOLVED 2026-05-26** by parallel session — now emits
   `<dialog class="mz-jc-modal deepdive-modal">` with `<dialog>` as
   the primary tag (W3C-canonical modal semantics: ESC + ::backdrop)
   and `deepdive-modal` retained as secondary class so the existing
   CSS keeps matching. Dual-class transition state is acceptable.
2. ~~**§3.10 audit grep-vs-runtime gap** — current audit grep-counts
   token byte-presence; cannot detect CSS that's bytes-present-but-
   runtime-absent (the §1.1 incident).~~
   **RESOLVED 2026-05-26** by `scripts/audit_runtime_css.py` (28
   getComputedStyle assertions on homepage covering Identity Map
   cards × 3 each, 6 site-wide-glass selectors, hero, active pip,
   4 carousels, body bg blue tokens; plus 3-check audit per education
   page covering disclaimer visibility + body bg + `--glow-purple`
   CSS var). Wired into `deploy-prod.sh` as a post-deploy gate.
   **§14.1 — content-render generalization (2026-07-21).** The §1.1 /
   item-2 gap was not CSS-specific: the WHOLE content-gate stack asserts
   on whether markup EXISTS as a source string, not whether it RENDERS.
   This let weekly briefs (W25/W28/W29) ship that a reader saw as broken —
   per-topic AI synthesis absent, deep-dive modals as placeholder stubs or
   unstyled raw HTML — while every string/structural gate stayed green
   (the `mz-topic-group` substring matched inside a CSS rule; the modal
   markup was byte-present). ~~No render-level gate covered post BODIES
   (only routes/homepage).~~ **RESOLVED 2026-07-21** by
   `scripts/audit_render.mjs` (deploy gate #10 above): renders each
   published roundup's `body_html` in headless Chromium and asserts on the
   reader's DOM — synthesis prose per topic, authored+styled modals, no JS
   error. Grammar-adaptive; verified green on the approved corpus and red
   on stripped-synthesis / `Pending review` / unstyled-`dd-*` regressions.
3. **§3.7 / §3.11 audit coverage** — `/curriculum/` + `/evidence/`
   wrapper pages not yet covered by KB-anchor gate (currently only
   `/education/*` + `/portal/education/*`).
4. **`agent-platform` path dependency** — deploy-prod.sh hard-codes
   `/Users/beans/Developer/MountZara/agent-platform/scripts/regression_audit.py`.
   If that repo moves, deploy breaks.
5. ~~**Mirror drift between `education/<slug>/` and
   `portal/education/<slug>/`** — no automation enforces byte-similarity.~~
   **RESOLVED 2026-05-26** by `scripts/audit_mirror_drift.py` (checks
   §0.8.1 manifest + §3.12 disclaimer + §3.10 purple tokens on both
   surfaces; diffs `<main>` region after stripping an allowlist of
   legitimate divergence patterns; first run confirms 12/12 topics
   byte-identical). Wired into `deploy-prod.sh` as a pre-deploy gate.
6. **`index.html` size** — ~10K lines in one file is fragile. Long-
   term: break the inline `<style>` and `<script>` into external files,
   so brace-balance + JS syntax checks can use standard CSS/JS tooling.
7. **129 `scripts/*` files** — many are one-shot per-iteration scripts
   safe to delete. Periodic sweep needed.

---

## 15. Maintenance protocol

When you edit any file in this repo:

1. **BEFORE the edit:** find the file in this map (§3-§13). Read its
   lock-step column. List every other file you must touch in the same
   commit.
2. **Make the edits surgically** (§0.6 manual-edit rule — no regex
   sweeps).
3. **Run the brace-balance check** if you touched `index.html`'s
   inline `<style>` (§3).
4. **Run `node --check`** if you touched `index.html`'s inline
   `<script>` (§4):
   ```bash
   python3 -c "import re; \
     blocks = re.findall(r'<script(?![^>]*\\bsrc=)[^>]*>(.*?)</script>', \
                         open('index.html').read(), re.S); \
     open('/tmp/_inline_js.js', 'w').write(blocks[0])" && \
   node --check /tmp/_inline_js.js
   ```
5. **Deploy via `scripts/deploy-prod.sh`** — all gates pass.
6. **§0.2.1 visual VERIFY** post-deploy.
7. **Update THIS file in the SAME commit** if a file was added,
   renamed, deleted, or its responsibility changed.

A new lock-step requirement discovered during debugging? Add it here
in the same commit as the fix, so future sessions don't rediscover it
the hard way.
