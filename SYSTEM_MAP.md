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
| §1 | Three reference incidents — the foundational regression archetypes this map exists to prevent. |
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

## 1. Three reference incidents — DO NOT REPEAT

These three regressions happened in a single working session on 2026-05-26.
All three would have been preventable if this map had existed beforehand.
They are the foundational patterns this file protects against.

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
2. **§0.4.1 comprehensive regression audit** — calls
   `/Users/beans/Developer/MountZara/agent-platform/scripts/regression_audit.py
   --all` (NOTE: lives outside this repo); audits 25+ surfaces against
   every hard rule in CLAUDE.md; logs to `/tmp/_deploy_audit.log`;
   exits 1 on any HARD FAIL. Skip with `DEPLOY_SKIP_REGRESSION_AUDIT=1`
   — DANGEROUS, only when manually documented.
3. **`wrangler pages deploy .`** — Direct Upload via API token.
4. **HEAD check on mountzara.com** — confirms HTTP 200 with cache-bust
   query.
5. **§0.8.1 R2-post gate** — `scripts/verify_kb_anchoring.py --r2-posts`
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
| `phi.js` | `wrapDek`, `unwrapDek`, `encryptPhi`, `decryptPhi` | Documents, messages with attachments, snapshots | **PHI key rotation:** `scripts/phi_master_key_rotate.sh` calls `functions/api/v1/admin/phi/rotate.js` which uses BOTH `PHI_MASTER_KEY_OLD` + `PHI_MASTER_KEY`. Lock-step. |
| `anthropic.js` | `callClaude(env, prompt, opts)` | `intake/triage.js`, `briefings/*`, AI snapshots, drug-AE, PROM recommender | **§12.2 BAA gating:** until Anthropic BAA signed, NEVER call with PHI. Every caller must de-identify per §11.7.2 prompt template. |
| `totp.js` | `verifyTotp` | `functions/admin/_mfa.js` | RFC 6238 — don't change skew/period without re-enrolling. |
| `mfa_cookie.js` | `signMfaCookie`, `verifyMfaCookie` | `functions/admin/_middleware.js`, `_mfa.js` | If you rotate `ADMIN_MFA_COOKIE_KEY`, every active admin session invalidates. |
| `preview_invite.js` | `mintInvite`, `redeemInvite`, `signCookie`, `verifyCookie` | `/api/v1/admin/preview-invite.js`, `/portal/preview-grant/` | Rotating `PREVIEW_INVITE_KEY` invalidates all outstanding preview-grant URLs. |
| `preview_gate.js` | `previewAccess(request, env)` | `functions/portal/_middleware.js` | Honors `PORTAL_PUBLIC_LAUNCH` env + admin auth + signed preview cookie. |
| `session_trace.js` | `recordTrace`, `traceWrap`, `listRecentTraces` | Optional wrapping in any endpoint for debugging | PHI-conservative SHA256+salt-hashed IPs. |
| `wizard.js` | `WIZARD_STEPS`, `computeStepStatus` | `/api/v1/patient/wizard/state.js`, `portal/_wizard.js` injection | Adding step: update `WIZARD_STEPS` + `computeStepStatus` + UI in `_wizard.js`. |
| `stripe.js` | `createCustomer`, `createPaymentIntent`, `verifyWebhook` | `functions/api/billing/stripe/*` | If signature changes, touch `_stripe_e2e_*.sh` test scripts. |
| `messaging.js` | `listThreads`, `startThread`, `replyInThread`, `markThreadRead`, `computeSlaDueAt`, `ALLOWED_URGENCIES` | `/api/v1/patient/messages/*` + `/api/v1/admin/messages/*` | Patient + admin endpoints share storage — schema change in `0004_phase3_messaging.sql` touches both. **R8 SLA lock-step:** `urgency`/`sla_due_at`/`sla_breached` (migration 0022) flow `startThread`/`replyInThread` → both `listThreads` SELECTs → `portal/messages` compose radios → `admin/messages::slaBadge` → `cron-worker/index.js::runSlaSweep` (15-min cron). Changing the clock semantics touches all six. |
| `intake_sections.js` | Schema for 19 intake sections | `/api/v1/intake/*` endpoints + `portal/intake/*` UI | Adding section: schema migration + endpoint + UI in lock-step. |
| `intake_triage.js` | De-identify intake → call Claude → write `appointment_triage` | `/api/v1/intake/[id]/triage.js` | Per §11.7 — never send PHI to Claude until BAA. |
| `licensure.js` | `getLicensedStates(env)`, `isLicensedInState(env, state)`, `recordLicensureBlock(env, {patient_id, state, reason})`, `_resetCache` | The R3 state-gates + the R4 launch presence re-check — `intake/[id]/submit.js`, `intake/[id]/triage.js`, `appointments/book.js`, `appointments/[id]/launch.js` — plus `/api/v1/admin/practice/licensed-states.js` (write side) + `admin/scheduling/index.html` (picker UI) | **Phase 17 R3/R4.** Reads `practice_settings.licensed_states_json` (keyed by clinician); 60 s cache; conservative `["IL"]` fallback (fails closed). Patient state of residence comes from intake **Section 1 `address_state`** (a `<select>` in `portal/intake/index.html`, stored schemaless in `intake_section_data`). Changing the storage key/shape touches all 3 gates + the admin endpoint + UI + the intake field in lock-step. |
| `prom_*.js` | PROM scoring, AI recommender, intake orchestrator | `/api/v1/patient/proms/*` + `/admin/proms/*` | PROM definitions in `0010_phase10_*.sql` migrations. |
| `billing*.js` | Insurance + Stripe + AI advisor + invoice tax export | `/api/v1/admin/billing/*` | Schema migrations 0007-0009. |
| `coding_coach.js` | Cross-encounter CODING COACH — aggregates the per-encounter coding analysis the transcription app syncs in (`billing_claims` / `billing_compliance_flags` / `billing_upcoding_opportunities` / `billing_claim_lines`) into undercoding-recovery + recurring-flag/modifier/doc-gap patterns + deterministic coaching actions. Pure shapers are unit-testable; reuses `windowRange` from `billing_insights.js`. De-identified aggregates only (no PHI → no BAA needed). | `/api/v1/admin/billing/coding-coach.js` + UI `admin/billing/coach/index.html` (linked from `admin/billing/` header) | Reads the §11 transcription-sync coding tables (schema 0006). Compliance framing is deliberate: undercoding RECOVERY tied to documentation already in the note — never speculative upcoding. |
| `x12_837.js` · `claim_scrub.js` · `clearinghouse.js` · `payer_directory.js` | **Outbound billing rail.** `claim_scrub.scrubClaim(norm)` = clean-claim gate (hard blocks + denial-risk warnings; deterministic, unit-tested). `x12_837.generate837P(norm)` = ANSI X12 5010A1 837P EDI generator (unit-tested structure). `clearinghouse.js` = MULTI-vendor adapter (`mock`/`stedi`/`change_healthcare`/`availity`/`claim_md`/`office_ally`/`waystar`), `CLEARINGHOUSE_VENDOR`-selected, per-vendor creds+endpoints from env; `submitClaim`/`checkEligibility`/`isConfigured`. `payer_directory.js` = IL/CA + national payer scaffold (26 payers; IDs flagged for clearinghouse verification — never trusted blindly). Orchestrated by `POST …/claims/:id/submit`; go-live via `…/billing/clearinghouse` (readiness checklist + `seed_payers`). Runbook: `docs/BILLING_GO_LIVE.md`. | `claims/[id]/submit.js` · `billing/clearinghouse.js` | PHI on a live vendor call → keep `mock` + usage `'T'` until creds set + per-payer EDI enrollment + a verified 277CA test (`CLEARINGHOUSE_LIVE=1` flips usage to `'P'`). Payer IDs are clearinghouse-specific — confirm each against the live payer list before production. Insurance captured per-patient (`patient_insurance` table, schema 0025; `GET/PUT /api/v1/admin/patients/:id/insurance`; editor `admin/billing/insurance/`) → the submit endpoint auto-fills it (body still overrides); scrub blocks if a patient's is missing. Inbound rail: **835 ERA built** — `x12_835.parse835()` + `POST /api/v1/admin/billing/era` (admin or X-Pipeline-Token) auto-posts payments → paid/partially_paid/denied + CARC codes. Go-live console `admin/billing/clearinghouse/index.html` (readiness checklist · one-click payer→CH routing `route_by_kind` · ERA paste/post). 270/271 eligibility interface stubbed (`checkEligibility`); 276/277 status poll still TODO. |
| `claim_assembler.js` | **Single source of truth** for loading a `billing_claims` row (+ lines/diagnoses/patient/`patient_insurance`/payer) and building the NORMALIZED claim object. Extracted from the submit endpoint so the OUTBOUND submit path AND the AI PRE-FLIGHT path assemble byte-identical artifacts. Exports `assembleClaim(env, claimRow, body)` + `billingProvider(env)`. | `claims/[id]/submit.js`, `claims/[id]/preflight.js` | If you change claim normalization, BOTH submit and pre-flight change together — that's the point. Unit-tested for equivalence. |
| `carc_codes.js` | CARC/RARC denial-code knowledge base (curated for OB/GYN + MIGS): `CARC`/`RARC` maps, `lookupCarc`/`lookupRarc`, `recommendStrategy(codes)`. Each CARC carries plain-English text + category + `appealable` + a remediation `strategy` (corrected_claim / appeal / reconsideration / patient_bill / write_off). | `billing_ai_preflight.js`, `billing_appeal.js` | Grounds BOTH the AI features so even the no-AI fallback is code-accurate. Extend as new codes appear on real ERAs. |
| `billing_ai_preflight.js` · `billing_appeal.js` | **AI-assisted denial layer** (BAA executed 2026-06-29). `aiPreflightReview(env,{norm,scrub})` = denial-prevention second opinion on the assembled claim (PHI-FREE — codes only); predicts the CARC each risk draws. `draftAppeal(env,ctx,nowMs)` = denial-response drafter (corrected-claim vs appeal vs reconsideration vs patient-bill) authoring the payer letter + corrected-claim changes; PHI-bearing by necessity (patient name/member id/DOB on the letter). Both default to `claude-opus-4-8` (override via `BILLING_AI_MODEL`; the advisor too), and both DEGRADE GRACEFULLY to a deterministic, CARC-grounded fallback when `ANTHROPIC_API_KEY` is absent. | `claims/[id]/preflight.js`, `claims/[id]/appeal.js` | Needs `ANTHROPIC_API_KEY` set as a Pages secret to enable the AI path (else fallback). **GOTCHA:** the Opus 4.7/4.8 family 400s on sampling params — `anthropic.js` `callClaude` now strips `temperature`/`top_p`/`top_k` for `modelRejectsSamplingParams(model)` (Opus 4.7+); Sonnet/Haiku keep them. `draftAppeal` is audit-logged as a PHI-bearing AI event (`claim_appeal_draft`). Persistence: `billing_preflight_reviews` + `billing_appeals` (schema 0026). |
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

## 8. Static surfaces

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
line-art backdrop): `clearinghouse/` (go-live console), `coach/` (Coding
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
| **Visual VERIFY (Playwright + iPhone)** | `_verify_identity_map_*.py`, `_verify_idmap_c2_screenshot.py`, `_verify_idmap_c3_carousel.py`, `_verify_iphone_*.py`, `_verify_portal_edu_*.py`, `_audit_iphone_*.py`, `_measure_iphone_*.py`, `_remeasure_iphone.py`. **HARD RULE — every verification/audit script MUST write screenshots, PNGs, JSON reports, and any other artifact to `/Users/beans/Documents/` (NEVER `~/Desktop`). User's Desktop is for USER files only. 2026-05-26 cleanup removed 20 `mz_*` dirs + 1 PNG (~193 MB) of prior-session test artifacts that earlier Claude sessions had dumped to Desktop. Do not repeat.** |
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
