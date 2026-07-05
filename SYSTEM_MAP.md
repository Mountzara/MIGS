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

## 8. Static surfaces

### 8.1 Root pages

`index.html` (~10K lines — see §3, §4), `about/`, `evidence/`, `trending/`,
`cv/`, `curriculum/` (`cbg-migs/`, `hospice-clerkship/`, `hospice-training/`)

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
| **Verification (audits)** | `verify_kb_anchoring.py` (§0.8.1 gate), `audit_live_post.py` (§3.7.1 gate), `audit_deploy_gate.py` (structural-integrity hard gate — deploy gate #7; reuses `audit_accuracy.py` header-* + `audit_inline_refs.py`), `audit_admin_drafts.py`, `audit_public_surfaces.py`, `cite_audit_*.py`, `voice_sweep_*.py`, `audit_route_render.py` + `route_render_manifest.json` (§13.5 route-render hard gate — deploy gate #9, env-resilient), `smoketest_phase17.sh` (Phase 17/18 gate assertions incl. §0b route reachability) |
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
