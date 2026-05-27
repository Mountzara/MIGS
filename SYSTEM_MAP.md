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
   the §3.7.1 / §1.2 / §3.7 / §3.11 / §3.12 audit on every published R2
   post. Exits 1 on any FAIL.

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
**936 open / 936 close**.

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
| 7997–8033 | Contact modal handlers | no | n/a |
| 8286–8444 | Evidence modal handlers | no | n/a |
| 9285–9398 | Identity Map setup (`identityCards`, `identityPips`, `identitySections`) | no — declared at line ~6260 (before script) | n/a |
| 9404–9637 | `tick()` rAF-throttled scroll handler + `lastIdentityActive` + scroll-spy | no | n/a |
| 9645–9728 | `initSeeAllSheet()` (sheet modal dormant — currently no triggers fire it) | **YES — queries `mz-sheet` at line 10066** | **YES (added 2026-05-26)** |
| 9730–9820 | `initMobileCarousels()` (carousel + pip indicators for each `[data-mobile-carousel]` grid) | no — queries grids at lines 6369 / 6650 / 6847 / 6969 | YES (defensive — same pattern) |
| ~9860–9896 | `openVideoModal()` / `closeVideoModal()` globals | yes (videoModal at 9952) — but globals, not auto-fired | n/a |
| 9908–9935 | Research-card preview autoplay IntersectionObserver IIFE | yes (`.video-preview`) but tolerant of empty results | n/a |
| 9941 | `if (typeof toggleFeatureSound === 'function') { window.toggleFeatureSound = toggleFeatureSound; }` — **DEFENSIVE GUARD added 2026-05-26 per §1.2.** | n/a | n/a |
| 9959–9980 | Hero video autoplay IIFE | yes — hero declared earlier, fine | n/a |

### 4.3 Reference graph — IDs / classes the script depends on

If you rename / remove ANY of these in HTML, JS will break:
- `#heroVideo`, `.hero-inner`, `.monogram-stage` — hero loader + tick()
- `#scrollProgressBar`, `#ambientGlow` — tick()
- `.pinned-showcase`, `.pinned-frame`, `.pinned-bg` — pinned showcase frame switcher
- `#cinematicIntro` — cinematic video backdrop
- `.identity-card[data-identity]`, `.identity-pip[data-target]`,
  `#identity-map` — Identity Map scroll-spy (Commit 1)
- `[data-mobile-carousel]` — initMobileCarousels()
- `.mz-grid-pips` — built dynamically by initMobileCarousels()
- `#mz-sheet`, `#mz-sheet-content`, `[data-mz-sheet-close]` —
  initSeeAllSheet() (currently dormant)
- `#contactModal`, `#evidenceModal`, `#videoModal` — modal openers
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
| `messaging.js` | `listThreads`, `getThread`, `postMessage`, `markRead` | `/api/v1/patient/messages/*` + `/api/v1/admin/messages/*` | Patient + admin endpoints share storage — schema change in `0004_phase3_messaging.sql` touches both. |
| `intake_sections.js` | Schema for 19 intake sections | `/api/v1/intake/*` endpoints + `portal/intake/*` UI | Adding section: schema migration + endpoint + UI in lock-step. |
| `intake_triage.js` | De-identify intake → call Claude → write `appointment_triage` | `/api/v1/intake/[id]/triage.js` | Per §11.7 — never send PHI to Claude until BAA. |
| `prom_*.js` | PROM scoring, AI recommender, intake orchestrator | `/api/v1/patient/proms/*` + `/admin/proms/*` | PROM definitions in `0010_phase10_*.sql` migrations. |
| `billing*.js` | Insurance + Stripe + AI advisor + invoice tax export | `/api/v1/admin/billing/*` | Schema migrations 0007-0009. |
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
  `phi/rotate`, `practice-settings`, `preview-invite`, `proms/*`,
  `snapshots/[patient_id]`, `trend-briefs/*`, `triage/*`, `visit-types`
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

---

## 8. Static surfaces

### 8.1 Root pages

`index.html` (~10K lines — see §3, §4), `about/`, `evidence/`, `trending/`,
`cv/`, `curriculum/` (`cbg-migs/`, `hospice-clerkship/`, `hospice-training/`)

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

### 8.4 Admin SPAs

14 surfaces — `analytics/`, `billing/`, `briefings/`, `carousels/`,
`cases/`, `content/`, `debug/`, `education/`, `feedback/`, `login/`,
`messages/`, `patients/`, `scheduling/`, `trend-briefs/`, `triage/`
+ `_nav.js` (shared sidebar) + `index.html`

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
| **Verification (audits)** | `verify_kb_anchoring.py` (§0.8.1 gate), `audit_live_post.py` (§3.7.1 gate), `audit_admin_drafts.py`, `audit_public_surfaces.py`, `cite_audit_*.py`, `voice_sweep_*.py` |
| **Visual VERIFY (Playwright + iPhone)** | `_verify_identity_map_*.py`, `_verify_idmap_c2_screenshot.py`, `_verify_idmap_c3_carousel.py`, `_verify_iphone_*.py`, `_verify_portal_edu_*.py`, `_audit_iphone_*.py`, `_measure_iphone_*.py`, `_remeasure_iphone.py` |
| **Stripe** | `_stripe_e2e_*.sh`, `_stripe_create_webhook.sh` |
| **Seed** | `_seed_jane_doe.sh`, `_seed_jane_meds.sh`, `_seed_blank_test_patient.sh`, `_send_jane_magic_link_email.sh` |
| **D1** | `_backup_d1_to_r2.sh` (manual; cron does it nightly), `_apply_phase14_migration.sh`, `_verify_phase14_schema.sh` |

**§0.4.1 audit lives outside this repo** at
`/Users/beans/Developer/MountZara/agent-platform/scripts/regression_audit.py`.
If `agent-platform/` moves, update `deploy-prod.sh::AUDIT` constant.

---

## 14. Known gaps + legacy patterns to retire

These are tracked separately so future sessions can prioritize:

1. **`MountZaraResearchDigest/blog_generator.py`** (SIBLING REPO) —
   still emits legacy `<div class="deepdive-modal">` instead of
   canonical `<dialog class="mz-jc-modal">`. Per CLAUDE.md v2.0 changelog.
2. **§3.10 audit grep-vs-runtime gap** — current audit grep-counts
   token byte-presence; cannot detect CSS that's bytes-present-but-
   runtime-absent (the §1.1 incident). Need to extend `regression_audit.py`
   with headless Chrome `getComputedStyle` runtime checks.
3. **§3.7 / §3.11 audit coverage** — `/curriculum/` + `/evidence/`
   wrapper pages not yet covered by KB-anchor gate (currently only
   `/education/*` + `/portal/education/*`).
4. **`agent-platform` path dependency** — deploy-prod.sh hard-codes
   `/Users/beans/Developer/MountZara/agent-platform/scripts/regression_audit.py`.
   If that repo moves, deploy breaks.
5. **Mirror drift between `education/<slug>/` and
   `portal/education/<slug>/`** — no automation enforces byte-similarity.
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
