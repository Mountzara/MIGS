# mountzara.com — for the coworking Claude session

This archive is the complete site: the static pages, the Cloudflare Pages
Functions that serve every API, the D1 schema, the deploy gate chain, and
the test suites. 1,474 files.

## Read these first, in this order

1. **`SYSTEM_MAP.md`** — the master atlas. Every library, what depends on
   it, and what must be touched in the same change. It is required
   reading before any non-trivial edit, and it is where the reasoning
   behind the load-bearing decisions lives.
2. **`CLAUDE.md`** — the operating rules for this project (deploy path,
   hard rules, anti-patterns).
3. **`docs/first-run-spec.md`** — the out-of-the-box experience spec.
4. **`docs/TRANSCRIPTION_APP_HANDOFF.md`** — the contract with the
   Mac/iOS transcription app.
5. **`docs/legal-attorney-review-checklist.md`** — what is settled in the
   legal surface and what is still for counsel.

## What is NOT in this archive, on purpose

* **`node_modules/`** and **`.git/`** — clone the repo instead if you
  want history (branch
  `claude/setup-mountzara-landing-01M5e6zmrBbv1hX9jmgH6xz8`).
* **Every credential.** Cloudflare API tokens, the SES keys, the sync
  tokens and the admin password live in `~/.config/mountzara/` on the
  owner's operations machine, outside any repo, and are auto-loaded by
  the session-start hook. Nothing in this archive can deploy or read
  patient data on its own.
* **`cite_audit/`** — bulk citation artefacts, excluded for size.

## How this project deploys

`./scripts/deploy-prod.sh "what changed"` — that is the only supported
path. It runs the full gate chain (syntax, SQL columns, inline scripts,
portal headers, clinical grounding, orders, estimates, referrals,
education matching, visit-type aliases, note extraction, timezone,
triage, notifications, route render, contrast, visual) and refuses to
publish if any gate fails. Do not deploy through the Cloudflare
dashboard and do not push to a branch expecting it to publish.

## The rules that are not negotiable here

* **Clinical content comes from the owner's curated knowledge base**, or
  from his own words. Never from a model's general knowledge. This is
  enforced in code (`_lib/clinical_grounding.js`) and gated on deploy.
* **Nothing reaches a patient unreviewed.** The after-visit summary is
  `pending_clinician_review` until he approves it; the patient read path
  filters on `approved` in the WHERE clause, not afterwards in JS.
* **A readiness signal must be provable.** If a check can be satisfied by
  a test or by configuration rather than evidence, it is a lie — see the
  header of `_lib/practice_setup.js` for the several times that was
  caught.
* **`docs/` never deploys publicly** (anchored excludes plus a stage
  assertion in the deploy script).

## Where things stand

One item blocks seeing patients and it is the owner's decision:
`PORTAL_PUBLIC_LAUNCH`. Outstanding on his side: SES production access
(AWS review), attorney review of the legal pages, redeploying the cron
worker to pick up the overdue-result sweep, and loading the structured
KB sections. Everything else on the platform side is built, deployed and
verified against production.
