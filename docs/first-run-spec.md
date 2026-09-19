# Mount Zara — First-Run Experience Implementation Spec

**Scope:** rewrite `functions/_lib/practice_setup.js`, add `functions/_lib/first_run.js`, rebuild the `/admin/` guided home, and replace every empty state in `/admin/*` and `/portal/*`.

**Non-negotiable invariant carried from the existing module header:** *status is computed from evidence, never remembered in a flag.* Six of the twelve existing steps violate that today (see §5). Fix them in the same change; a checklist that ticks itself is worse than no checklist.

**Deploy gate:** `scripts/check_sql_columns.mjs` rejects invented column names and has no override. Every column referenced below exists today. The only new persisted keys are two `practice_settings` rows, which are `(clinician_id, key)` — no schema change, but `key` must be added to the whitelist at `functions/api/v1/admin/practice-settings.js:14-22`.

---

## 1. SETUP CHECKLIST

### 1.1 Contract

`GET /api/v1/admin/setup-status` returns:

```jsonc
{
  "ok": true,
  "steps": [ {
    "id": "availability",
    "order": 2,
    "title": "Publish your bookable hours",
    "why": "…",                      // one sentence, physician language
    "detail": "…",                   // evidence sentence, always states what was counted
    "status": "done|todo|attention|unknown",
    "blocking": true,                // "you cannot safely see a patient without this"
    "gate": "booking",               // booking | visit | billing | none — what breaks without it
    "href": "/admin/scheduling/",
    "cta": "Add open blocks"
  } ],
  "summary": {
    "total": 15, "done": 0, "attention": 0, "todo": 15, "unknown": 0,
    "blocking_remaining": 6,
    "ready_to_see_patients": false,   // every blocking step provably done
    "doors_open": false,              // PORTAL_PUBLIC_LAUNCH === "true"
    "next": { …first blocking not-done step… },
    "mode": "setup|ready_empty|steady"
  }
}
```

Add a fourth status, **`unknown`**. `count()` returns `-1` when the query throws. Today `-1 > 0` is false so it silently reads as `todo` — an operator seeing "No availability" when the real problem is a broken query will spend an hour in the scheduling page. `unknown` renders as "Could not check — {step} status is unknown." and **counts as not-done for `ready_to_see_patients`**.

### 1.2 Shared helpers (rewrite in `practice_setup.js`)

```js
const CLINICIAN = "mabini-christopher-z";

// Seed values from schema/0002. A setting still equal to its seed has never
// been touched by the operator and MUST NOT count as configured.
const SEEDS = {
  practice_address:     "PRIME Healthcare St. Francis Hospital, Evanston, IL",
  timezone:             "America/Chicago",
  reminders_email_from: "appointments@mountzara.com",
};

// value_json is JSON-encoded. The old setting() returned the raw string
// including quotes and measured its length. Parse it.
async function setting(env, key) {
  try {
    const r = await env.DB.prepare(
      `SELECT value_json FROM practice_settings WHERE clinician_id = ? AND key = ?`
    ).bind(CLINICIAN, key).first();
    if (!r || r.value_json == null) return null;
    try { return JSON.parse(r.value_json); } catch { return null; }
  } catch { return undefined; }        // undefined = query failed = unknown
}
const touched = (val, key) => val != null && String(val).trim() !== "" && String(val).trim() !== SEEDS[key];
```

`tableExists()` stays and must wrap **every** query against `sns_confirmations`, `kb_docs`, `kb_sections`, `clearinghouse_vendors`, `clearinghouse_profile`, `baa_ledger`.

### 1.3 The steps, in order

Order is dependency-safe: nothing above requires anything below it. Blockers 1–5 are independent of each other; step 15 requires all of them.

---

**1. `licensed_states` — Set the states you are licensed in — BLOCKS (gate: booking)**

> **Why:** Telehealth happens where the patient is sitting, and every booking and intake is checked against this list — anything not on it is refused.

```sql
SELECT value_json FROM practice_settings
 WHERE clinician_id = 'mabini-christopher-z' AND key = 'licensed_states_json';
```
`JSON.parse` → `done` when the array contains ≥1 code matching `/^[A-Z]{2}$/`. Any parse failure → `attention`, not `todo` (a malformed value is a different problem from an unset one).

**Link:** `/admin/scheduling/` · **CTA:** "Set your states"
**Detail done:** `Licensed in IL, WI.`
**Detail todo:** `No states set — every booking silently falls back to Illinois only.`

---

**2. `availability` — Publish your bookable hours — BLOCKS (gate: booking)**

> **Why:** Nothing can be booked until there are hours to book, and this is the single most common reason a new practice's portal looks empty to patients.

```sql
SELECT COUNT(*) n FROM clinician_availability
 WHERE block_kind = 'open' AND date >= date('now','-1 day');
```
`block_kind = 'open'` is mandatory — `functions/_lib/scheduling.js:77` filters on exactly that, so a calendar of surgery blocks is zero bookable hours. `date('now')` is UTC; `-1 day` prevents a same-day block being called expired for a Chicago operator.

Second query, and this one is the important one:

```sql
SELECT COUNT(*) n FROM appointments WHERE status NOT IN ('cancelled','no_show');
```
If `open_blocks = 0 AND appointments > 0`, status is **`attention`**, not `todo`, with detail:
`You have 4 appointment(s) booked but zero open blocks. Admin bookings bypass the calendar; patient self-booking does not, so patients currently see no times at all.`

**Link:** `/admin/scheduling/` · **CTA:** "Add open blocks"
**Detail done:** `12 open block(s) from today forward.`
**Detail todo:** `No open hours — patients will see no appointment times, ever.`

---

**3. `telehealth_room` — Connect your telehealth room — BLOCKS (gate: visit)**

> **Why:** The Join button on a patient's visit needs somewhere to send them, and the room link is copied onto each appointment at booking time — visits booked before you set it are permanently left with no link.

`setting(env,'doxy_room_url')` → parsed string, `done` when it parses as an `https:` URL. Seeded `'""'`, so this one is already honest.

**Escape hatch, and it must be a real setting rather than a checkbox:** a "This practice does not do telehealth" control writes `practice_settings.telehealth_enabled = false` (new whitelisted key) and that same value must gate the Join-link column in `/admin/scheduling/` and the telehealth visit types in the booker. When false, this step renders `done` with detail `Telehealth is turned off for this practice.` Never let the operator dismiss a checklist row without changing product behaviour.

**Link:** `/admin/scheduling/` · **CTA:** "Save room link"
**Detail todo:** `No room link — the Join button on every telehealth visit has no destination.`

---

**4. `email_delivery` — Get email delivering — BLOCKS (gate: booking)**

> **Why:** Sign-in links, appointment confirmations and result notices all travel by email, so until one message has actually arrived somewhere you should assume none will.

```sql
SELECT
  SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END)          AS sent,
  SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)        AS failed,
  SUM(CASE WHEN status = 'unconfigured' THEN 1 ELSE 0 END)  AS unconfigured
FROM notification_outbox;
```
- `sent > 0` → `done`
- `sent = 0 AND (failed > 0 OR unconfigured > 0)` → `attention`
- else → `todo`

Drop `'abandoned'` from the query — it is not in the CHECK constraint and cannot exist (§5.1). Add `'unconfigured'`, which the old query omitted entirely, so a mailer with no credentials at all reported as "nothing sent yet" instead of "misconfigured".

**Link:** `/admin/` (notification health card) · **CTA:** "Send a test"
**Detail attention:** `7 attempt(s) failed and none succeeded — the sending account is probably still in the SES sandbox.`

---

**5. `clinician_signature` — Upload your signature — BLOCKS (gate: visit)**

> **Why:** Every practice policy you sign and every after-visit summary a patient reads carries this image, and there is no way to release a summary without it.

```sql
SELECT COUNT(*) n FROM clinician_signatures
 WHERE clinician_id = 'mabini-christopher-z' AND retired_at IS NULL;
```
`done` at ≥1. Blocking on `gate: visit` rather than `booking` — a patient can book before this exists, but the first visit cannot be closed out.

**Link:** `/admin/compliance/` · **CTA:** "Upload signature"
**Detail todo:** `No active signature — after-visit summaries cannot be released to patients.`

---

**6. `policy_signatures` — Sign your practice policies — recommended (gate: none)**

> **Why:** Five policies ship compiled into the platform and each records the document's hash when you sign, so a later edit forces a re-sign rather than quietly leaving a stale signature in place.

```sql
SELECT COUNT(DISTINCT doc_slug) n FROM document_signatures
 WHERE clinician_id = 'mabini-christopher-z';
```
Compare against `COMPLIANCE_DOCS.length` (5, `functions/_lib/signatures.js:32`). `done` at 5, `attention` at 1–4, `todo` at 0. Depends on step 5, hence its position.

**Link:** `/admin/compliance/` · **Detail:** `2 of 5 policies signed.`

---

**7. `legal_review` — Have the legal pages reviewed — recommended (gate: none)**

> **Why:** The privacy notice, terms and telehealth consent are published and enforced at signup, but they are grounded drafts rather than attorney-reviewed documents.

Two independent facts, one row:

```sql
-- (a) current-version acknowledgment coverage
SELECT doc_key, COUNT(DISTINCT patient_id) n
  FROM patient_acknowledgments
 WHERE doc_version = ?          -- bind DOC_VERSIONS[doc_key] per key, '2026-08-14'
 GROUP BY doc_key;
SELECT COUNT(*) n FROM patients WHERE status = 'active';
```
```sql
-- (b) attorney sign-off, operator-recorded
SELECT value_json FROM practice_settings
 WHERE clinician_id='mabini-christopher-z' AND key='legal_review_completed_at';
```

`legal_review_completed_at` is a **new whitelisted key** holding an ISO date. Status:
- no date → `attention` (never `done`, never `todo` — it is a live liability, not an unstarted task)
- date present and every active patient has a current-version row for all three of `npp`, `terms`, `telehealth_consent` → `done`
- date present but coverage incomplete → `attention`, detail names the gap

The version binding is the whole point of the check — `functions/_lib/acknowledgments.js:70-84` exists to force re-acknowledgment after a bump, and counting rows regardless of version defeats it.

**Link:** `/privacy-practices/` · **CTA:** "Record review date"
**Detail attention:** `3 of 4 patients have acknowledged the current version. Attorney review not yet recorded.`

---

**8. `practice_identity` — Record your practice identifiers — recommended (gate: billing)**

> **Why:** Your NPI, tax ID and practice address print on every claim and every good faith estimate, and a mismatch here is the most common claim rejection there is.

D1 first, env only as a display fallback — env vars cannot be validated for correctness and cannot be fixed from an admin page.

```sql
SELECT npi_individual, tin_last4, practice_address_line1, practice_zip4
  FROM clearinghouse_profile LIMIT 1;   -- behind tableExists()
```
- NPI valid: `String(npi).replace(/\D/g,'')` matches `/^\d{10}$/` (same rule as `functions/api/v1/admin/billing/clearinghouse.js:36`)
- TIN: `tin_last4` non-empty
- Address: `setting('practice_address')` **and** `touched(addr,'practice_address')` — the seeded Evanston hospital address must not count (§5.2)
- Phone: `setting('phone_office')` non-empty (seeded `""`, honest)

All four → `done`; some → `attention`; none → `todo`.

**Link:** `/admin/billing/clearinghouse/` · **CTA:** "Fetch from NPI registry"
**Detail attention:** `NPI on file. Missing: tax ID, practice phone. Practice address is still the seeded default.`

---

**9. `education` — Stock the patient education library — recommended (gate: none)**

> **Why:** This is what patients read between visits, and assigning the right primer is most of the follow-up questions you would otherwise answer twice.

```sql
SELECT COUNT(*) n FROM education_materials WHERE status = 'published';
```
`published` only — the column defaults to `'draft'` and a draft is invisible to patients. Also count drafts separately so the detail can say so.

**Link:** `/admin/education/` · **CTA:** "Write your first primer"
**Detail attention:** `0 published, 3 drafts — patients see none of them until you publish.`

---

**10. `bounce_pipeline` — Turn on bounce and complaint handling — recommended (gate: none)**

> **Why:** If mail keeps going to a dead address your sending reputation degrades until nothing arrives for anyone, sign-in links included.

```sql
SELECT COUNT(*) n FROM sns_confirmations
 WHERE body LIKE '%Amazon Simple Notification Service%';   -- behind tableExists()
```
Plus `env.SES_SNS_TOPIC_ARN` non-empty. Both required for `done`; ARN set but zero events → `attention` (`Subscription configured but no bounce event has ever arrived.`). The user-agent match is deliberate and must stay — a curl probe must not satisfy this check.

**Link:** `/admin/` · **CTA:** "Check notification health"

---

**11. `cron` — Deploy the background worker — recommended (gate: none)**

> **Why:** It chases overdue results, releases triage after four hours, and sweeps message deadlines — without it those only happen when someone clicks.

The old query matched `user_id IN ('sweep','auto','cron','pipeline')`. The cron worker writes `user_id = NULL`, so it has never fired for the worker it is named after.

```sql
SELECT COUNT(*) n, MAX(ts) last_run FROM audit_log
 WHERE user_agent IN ('mountzara-cron','nps-dispatcher')
    OR (user_id = 'sweep' AND action = 'order_sweep');
```
- `n = 0` → `todo`
- `n > 0` and `last_run` within 48h → `done`
- `n > 0` and `last_run` older than 48h → **`attention`**: `Last background run was 9 days ago — the worker has stopped.`

Freshness is the signal that matters. A worker that ran once in March and died is not a working worker.

**Link:** `/admin/orders/`

---

**12. `knowledge_base` — Load your clinical knowledge base — recommended (gate: none)**

> **Why:** Every clinical AI answer is grounded in your own library and refuses to go beyond it, and loading the structured sections makes it cite the right paragraph instead of the whole document.

`kb_docs` count behind `tableExists`; `kb_sections` presence via `sqlite_master`. `done` = docs > 0 **and** sections table present; `attention` = docs > 0 only; `todo` = neither. Both tables are created at runtime and are absent from `schema/*.sql` — the existence probe is not optional, the query throws without it.

**Link:** `/admin/` · **Detail todo:** `No knowledge base loaded. Run scripts/kb_load_d1.py from the machine holding the corpus.`

---

**13. `payers` — Load the plans you bill — optional, insurance only (gate: billing)**

> **Why:** A patient's insurance card cannot be recorded until the plan exists here, and a cash-pay practice never needs this at all.

```sql
SELECT COUNT(*) n FROM billing_payers;
```
**Link:** `/admin/billing/payers/` · **Detail todo:** `No payers loaded. Skip this entirely if you are cash-pay.`

---

**14. `clearinghouse` — Connect your clearinghouse — optional, insurance only (gate: billing)**

> **Why:** This is the switchboard that forwards claims to insurers; nothing you approve on the billing board goes anywhere until it is live.

```sql
SELECT COUNT(*) n FROM clearinghouse_vendors WHERE removed_at IS NULL;
```
Reuse the go-live computation already in `functions/api/v1/admin/billing/clearinghouse.js:36-67` rather than writing a second one — import it, do not reimplement. Requires step 8 (NPI/TIN) and step 13, hence its position.

**Link:** `/admin/billing/clearinghouse/` · **CTA:** "Open the wizard"

---

**15. `launch` — Open the portal to patients — BLOCKS (gate: booking)**

> **Why:** Until this is on, the portal answers only to you — a patient reaching it gets a Coming Soon page, which is correct while you are setting up and wrong the day you open.

`String(env.PORTAL_PUBLIC_LAUNCH || "false").trim().toLowerCase() === "true"`.

This step is **blocking and last**, and the UI must refuse to present its CTA until steps 1–5 are all `done`. Rendering rules:
- any of 1–5 outstanding → row is dimmed, CTA replaced with `Finish the required steps above first.`
- 1–5 done, flag false → CTA `Open the doors` with the exact env-var command and the reminder that a redeploy is required
- flag true → `done`, detail `Open to the public. 14 patient record(s).`

Also surface `EDUCATION_PUBLIC_LAUNCH` in the same row's detail when false: `The public education surface is still gated off.`

### 1.4 Blocking summary

| Blocks seeing a patient | Recommended | Insurance only |
|---|---|---|
| licensed_states, availability, telehealth_room, email_delivery, clinician_signature, launch | policy_signatures, legal_review, practice_identity, education, bounce_pipeline, cron, knowledge_base | payers, clearinghouse |

`ready_to_see_patients = blocking.every(s => s.status === 'done')`. Six blockers, not four. A clearinghouse does not block a cash patient and never appears in that calculation.

---

## 2. EMPTY-STATE COPY

Every string below is literal and paste-ready. Where a page needs different copy for different zero states, all variants are given — one string covering both "nothing exists yet" and "your filter excluded everything" is the defect at `admin/patients/index.html:258`.

### 2.1 Admin

**`/admin/patients/` — `admin/patients/index.html:258`**
- Zero patients: `This is everyone in your practice — click a name to open their whole chart. Add your first patient with + Add patient, or send a portal invite and let them register themselves.`
- Search returns nothing: `No patient matches "{query}". Clear the search to see the full roster.`
- Loading: `Loading the roster…`
- Error: `Could not load the roster: {message}. Press Refresh to try again.`

**Required change:** add a `+ Add patient` button. `POST /api/v1/admin/patients` already exists (`functions/api/v1/admin/patients.js:45`, fields `email, first_name, last_name, dob, phone`) — the page is read-only only because nobody wired the button. Also add `Send portal invite` calling `POST /api/v1/admin/preview-invite`, currently reachable only from `/admin/debug/sessions/`.

**`/admin/cases/` — new file `admin/cases/index.html`**
This URL 404s today and is a `match` regex in `_nav.js`, so the nav highlights a route that does not exist. Create the index.
- Zero patients: `Open a patient's full chart — intake, triage, visits, messages, symptoms and audit on one page. There are no patients yet, so start on the roster.`
- Has patients: `Pick a patient to open their full chart.` (render the roster inline)

**`/admin/briefings/` — `admin/briefings/index.html:600-602` and `:611-612`**
- Rail: `Nothing booked in this window.`
- Main, no appointments anywhere: `A briefing is the one page you read before walking into the room — history, prior visits, PROMs and medication flags, assembled per patient. Nothing is booked yet; publish open hours in Scheduling so patients can book.`
- Main, appointments exist but not in this window: `No visits in this window. Switch to Week, or pick another date.`
- Main, placeholder with rows present: `Select a patient on the left to load their briefing.`

**Delete** the phrase "or loading a single patient by ID" — no such input exists. Replace with a link to `/admin/patients/`.

**`/admin/triage/` — `admin/triage/index.html:811-816`**
- Pending: `New intakes land here for you to confirm or override the visit type before booking slots are released. Nothing is waiting — a row appears within seconds of a patient submitting their intake.`
- Released: `Nothing released yet. Rows appear here once you confirm one, or automatically four hours after the AI categorises it if you have not.`
- All: `No intake has been submitted yet. Invite a patient to the portal and their completed intake arrives here.`

**`/admin/orders/` — `admin/orders/index.html:184`**
- Has patients: `Nothing here — that is the good outcome for this board. Place a lab, imaging study or referral with + New order.`
- Zero patients: `Nothing here — that is the good outcome for this board. You can place orders once at least one patient is on the roster.`

**Required change:** when the patient list is empty, **disable** `+ New order`. Today the dialog opens with a blank `<select>` and the POST sends `patient_id=""`. Re-wording an empty state while leaving a button that creates a corrupt row is worse than the blank box.

**`/admin/referrals/` — `admin/referrals/index.html:158`**
Keep the existing copy verbatim; it is the best in the console. **Delete lines 71-77** — the duplicated, truncated "Orders & results" breadcrumb and `<h1>` that paint above the real header on every load.

**`/admin/visits/` — `admin/visits/index.html:201-202`**
`After-visit summaries wait here for your signature — a patient cannot read one until you approve it. Encounters arrive automatically from the Transcription app, so there is nothing to do here until your first visit is recorded.`

Add the missing breadcrumb bar back to `/admin/`.

**`/admin/scheduling/`**
- Availability: `No bookable hours yet — with none, no patient can ever book. Add at least one block of kind "open" for each day you will see patients.`
- Appointments: `No appointments in this window. Patients can book as soon as an open block exists and their triage has been released.`
- Patients panel: `No patients yet — add one with the form above, or send a portal invite.`
- Licensed states, unset: `No states set yet. Until you set them, every booking is restricted to Illinois.`
- **New warning banner**, rendered whenever `appointments > 0 AND open_blocks = 0`: `You have {n} appointment(s) but no open blocks. Admin bookings bypass the calendar; patient self-booking does not, so patients currently see no times at all.`

**`/admin/messages/`**
- Thread list: `Patients' secure messages arrive here. Nothing yet — the inbox fills the first time someone writes to you.`
- Reader: `Select a thread to read it.`
- Patient search, no match: `No patient matches that. Type at least two letters of a first or last name.`

**`/admin/billing/`**
`Claims arrive here from the Transcription app's coding pass for you to correct and approve. None yet — and nothing you approve can be submitted until the clearinghouse setup is finished.`

**`/admin/billing/clearinghouse/`** — keep all existing copy. It is the model the rest of the console should follow: it says what the page is, where you are in it, and exactly what to type.

**`/admin/billing/insurance/` — currently has no empty state at all**
- First load: `Record a patient's insurance card once and every future claim for them fills itself in. Pick a patient below to start, or open this page from a claim and it prefills automatically.`
- No payers seeded: `No payers loaded yet, so there is nothing to select. Add the plans you bill on the Payers page first.`

**Required change:** replace the raw "Patient ID" text box with a name search against `/api/v1/admin/patients`. Requiring the operator to know a UUID is not an empty-state problem, and no copy fixes it.

**`/admin/gfe/`**
- Has patients: `No estimates yet. Create one the moment a self-pay patient schedules — the deadline counts backwards from the service date, so a late start cannot be recovered.`
- Zero patients: `No estimates yet, and no patients to write one for. Add a patient on the roster first.`

**Delete lines 70-75** — the stray "Orders & results" breadcrumb, `<h1>` and unclosed `<p class="lede">`. Disable `+ New estimate` when the patient list is empty, same reason as orders.

**`/admin/membership/`**
`No signups yet — nothing here is broken. The waitlist is live on the public portal page; the compliance checklist below is worth reading before you open a tier.`

**Required change:** remove the early return on the zero-signup branch so the "Before this opens" checklist actually renders. It is the only useful thing on the page on day one and it is currently unreachable.

**`/admin/content/`**
- Sidebar buckets: `Nothing pending.` / `Nothing published.` / `Nothing rejected.`
- Main: `Drafts from the writing pipeline land here to approve, edit or reject before they go public. Nothing is waiting — the pipeline posts new drafts on its Monday and Tuesday runs.`

**`/admin/education/`**
`The condition primers you write here are exactly what patients read in their portal. Click + New material to write your first — this page works on a brand-new install with no patients and no schedule.`

**`/admin/carousels/`**
`Generated social slide decks wait here for your approval before anything publishes. None queued — run the carousel generator and publisher, then approve any card badged READY.`

**`/admin/trend-briefs/`**
`When a trending claim fails only the clinical-verdict gate, the brief comes here for your ruling. Nothing queued — and note that approving a brief writes an override rather than publishing, so the Mac puller still has to run.`

**`/admin/analytics/` — currently no page-level empty state**
Add one above the board, rendered when total patients = 0:
`Nothing to measure yet. These numbers start moving after your first patient books a visit — add a patient and publish open hours, then come back.`

Per-panel, when the board is otherwise live:
- Charts: `No data in this window.`
- Next 5: `No upcoming visits.`
- Alerts: `No high-pain patients in the last 7 days.`
- NPS: `No responses yet. Surveys go out the morning after each completed visit.`

**`/admin/compliance/`**
- Signatures: `No signature stored yet. Upload a transparent-background PNG at least 400×100 — every policy you sign and every after-visit summary a patient reads uses this image.`
- Documents, none signed: `Five practice policies ship with the platform and none are signed yet. Start with the Controlled Substances Prescribing Policy — signing records the document's hash, so a later edit forces a re-sign.`
- Documents, partially signed: `{n} of 5 policies signed.`
- Delete the unreachable `No compliance docs registered.` string.

**`/admin/feedback/`**
- Cards: `Bug reports and suggestions from beta testers land here paired with an AI-drafted fix. Nothing submitted yet — issue a portal preview invite and have someone click the Feedback button on any portal page.`
- Filter hint, always visible: `Showing Actionable only. Switch the filter to see Closed items.`
- Un-analysed card: `Not analysed yet. This gets processed the next time you open a Cowork session and ask to run the feedback queue.`

**`/admin/debug/sessions/`**
- Trace: `A PHI-free live trace of portal requests, for watching a signup or intake happen step by step. Nothing yet — open /portal/ in another tab and rows appear within five seconds.`
- Invitations: `No invitations issued yet. Use Mint preview invite above to create one.`

**Required change:** add a `Mint preview invite` button calling `POST /api/v1/admin/preview-invite`. Telling a browser-based operator to run a shell script on a Mac is a dead end, and this is the only surfaced path to the single most important action in the whole console.

### 2.2 Portal

Warm, plain, second person. No clinical terms, no words like "triage", "intake row", "PROM", "categorization". A patient who just signed up should never see a blank box or a term they would have to look up.

**`/portal/` dashboard**

Header, no intake: `Welcome, {first_name}. One thing to do: your health history.`
Header, intake in progress: `Welcome back, {first_name}. Your health history is {pct}% done.`
Header, steady state: `Welcome back, {first_name}.`

Render tile titles from static markup so they never flash "Loading…" — only the tile *body* shows a skeleton.

| Tile | Title | Zero-state body |
|---|---|---|
| Appointments (no history yet) | `Book a visit` | `Your health history comes first — it's how we know what kind of visit you need. It takes about twenty minutes.` CTA `Start now →` |
| Appointments (history submitted) | `Book a visit` | `Your history is in and Dr. Mabini is reviewing it. Your times will appear here, usually within a few hours.` |
| Messages | `Messages` | `No messages yet. Write to us anytime about anything that isn't urgent — you'll usually hear back within one business day.` |
| Symptom diary | `Symptom diary` | `Nothing logged today. A minute a day here is what makes a visit about the details instead of a summary.` |
| Check-ins | `Check-ins` | `Nothing to fill in yet. Once your history is in, we'll send short questionnaires here between visits.` |
| Health history | `Your health history` | `Not started. Eighteen short sections, saved as you type — stop whenever you like and come back.` |
| Visit summaries | `Visit summaries` | `Nothing here yet. After each appointment Dr. Mabini writes up what you talked about and the plan, and it appears here.` |
| Reading | `Reading` | `Twelve guides ready to read now — endometriosis, fibroids, heavy bleeding, menopause and more.` |
| Tests & results | `Tests & results` | `Nothing ordered yet. Any blood work, scan or referral shows up here with its result.` |
| Your records | `Your records` | `Nothing uploaded. Old imaging reports and operative notes are the most useful thing you can send us before a first visit.` |
| Billing | `Billing` | `Nothing owed. Any bill after a visit appears here and you can pay it by card.` |
| Profile | `Your profile` | `Your name, photo, phone and what matters to you about your care.` |

**Delete the "Latest evidence / Subscribing soon…" tile.** A permanently dead tile badged "coming soon" on the front door of a paid product is worse than one fewer tile.

**The Reading tile must stop counting D1 rows.** It says "Library opening soon" while twelve complete guides sit one click away — the front door contradicts the room behind it.

**`/portal/signup/`**
- Pre-launch (HTTP 404 from the API): `The portal isn't open to new members yet. Join the waitlist and we'll email you the moment it opens.`
- Validation failure: `We couldn't create your account with those details. Check your email address and date of birth, then try again.`

**`/portal/login/`**
- Wrong credentials: `That email and password don't match. Try again, or get a one-time sign-in link by email instead.`
- Pre-launch: `Sign-in isn't open to the public yet. If you were sent a preview invitation, use the link in that email.`
- Network: `We couldn't reach the server. Check your connection and try again.`

**`/portal/intake/`**
- Section 1 header: `Section 1 of 18 · Answer as much as you can. Anything you skip, we'll ask about at your visit.`
- Boot failure — replace the 2.4-second toast, which currently lets a patient type for twenty minutes into a form that saves nothing: `We couldn't start your history just now, so nothing you type will be saved. Please reload this page — if it happens again, message us and we'll sort it out.` Render it as a **persistent banner and disable every input.**
- First autosave confirmation: `Saved.`

**`/portal/appointments/` — new file `portal/appointments/index.html`**
This 404s today for anyone who trims the URL or bookmarks it, and nothing in the codebase links to it, so the gap is invisible until a patient hits it.
- No history submitted: `You don't have any appointments yet. Finish your health history and we'll open the right times for you to book.` CTA `Continue your history →`
- Awaiting review: `Nothing booked yet. Dr. Mabini is reviewing your history now and your times will appear here, usually within a few hours.`
- Ready to book: `Nothing booked yet.` CTA `Pick a time →`
- Steady state: upcoming list, then `No past visits yet.`

**`/portal/appointments/book/`**
- No history: `Your health history comes first — it's how we know which kind of visit you need.` CTA `Start your history →`
- Awaiting review: `Your history is in. Dr. Mabini is reviewing it now, and your times will appear here as soon as he's done — usually within a few hours.`
- Released, empty day: `No times on this day. Try another date — new times open regularly.`
- Released, no times on any date in range: `There aren't any times open right now. Send us a message and we'll find you one.` CTA `Message the practice →`

Add a three-dot progress indicator at the top — **History → Review → Book** — so the three sequential gates are visible instead of implied.

**`/portal/messages/`**
`No messages yet. Use + New message for anything that isn't urgent — you'll usually hear back within one business day.`

**`/portal/orders/`**
`Nothing has been ordered for you yet. If Dr. Mabini orders blood work, a scan or a referral, it appears here along with the result as soon as it's back.` CTA `Message the practice →`

**`/portal/documents/`**
`Nothing uploaded yet. If you have prior imaging reports, operative notes or outside labs, drop them here — it's the most useful thing you can do before a first visit.`

**`/portal/billing/`**
`No bills yet. Anything you owe after a visit appears here, and you can pay it by card.`

**`/portal/proms/`**
`No check-ins yet. Once your health history is in, we'll send short questionnaires here about pain, mood and sleep.` **CTA `Continue your history →` linking to `/portal/intake/`** — naming the prerequisite in prose without linking to it makes the patient navigate back to the dashboard to find it.

**`/portal/symptoms/`**
- Entry meta: `Nothing logged today.`
- Under the grid: `Move any slider that applies and press Save. Even one number a day gives Dr. Mabini something real to look at.`
- Trend, nothing picked: `Pick a symptom to chart it.`
- Trend, no data: `Nothing logged for this in the last 30 days. Start logging and a trend appears here.`

**`/portal/visits/`**
Keep verbatim. It correctly sets an expectation including the email notification instead of inventing an action.

**`/portal/education/`**
- Filter excludes everything: `No guides match that topic. Clear the filter to see all twelve.`
- **API error — must not wipe the twelve static guides, which is what the current catch does:** show a dismissible strip above the grid reading `We couldn't load the guides your care team picked for you. Everything below is still here to read.` and leave the grid intact.

**`/portal/profile/`**
- Load failure: `We couldn't load your details just now. Reload the page, or message us if it keeps happening.` — **and hide `#identityLoading`**, which the current code never does, leaving the card on "Loading…" forever.
- Photo placeholder: `Add a photo`
- Rename the card headed `Editable` to `Your details`.
- Account status: map the raw enum — `active` → `Active`, `suspended` → `On hold — message us`, `closed` → `Closed`.
- Replace the free-text time zone box with a select defaulting to `America/Chicago`.
- Care goals: `What matters most to you about your care? Anything you write here, Dr. Mabini reads before your visit.`

---

## 3. GUIDED HOME

`/admin/` has three modes. **Mode is computed on every load from `summary`, never remembered.** The only thing in `localStorage` is the operator's explicit expand/collapse of the collapsed bar (`mz_setup_collapsed`), and that key is ignored in SETUP mode — an unfinished practice must not be able to hide the thing it still has to do.

```js
const mode =
  summary.blocking_remaining > 0                 ? "setup"
: (activePatients === 0 || activity30d === 0)    ? "ready_empty"
:                                                  "steady";
// activity30d: appointments, messages or intakes touched in the last 30 days
```

### SETUP mode — `blocking_remaining > 0`

The checklist **is** the page. Everything else — AI window, trend-brief badge, quick links — collapses below the fold.

- **H1:** `Set up your practice`
- **Headline:** `{n} things still stand between you and seeing a patient. Start with {next.title}.`
- **Progress:** `{done} of {total} done · {blocking_remaining} required`
- **List:** every step, blockers first with a `required` chip, each showing title / why / detail / `Open →`. Done steps collapse to a single ticked line.
- **Foot:** `Everything above is checked against your actual data every time this page loads. Nothing here is a box you tick yourself.`

Never show the notification-health card, KPI tiles, or any per-page count in this mode. Twelve zeroes next to an unfinished checklist reads as broken software; the checklist alone reads as software that knows where it is.

### READY_EMPTY mode — no blockers left, no patients or no recent activity

- **H1:** `Ready to see patients`
- **Headline:** `Everything required is in place. The remaining items below are improvements, not blockers.`
- **Body — exactly three cards, nothing else:**
  1. `Add your first patient` → `/admin/patients/` — `Create a record yourself, or send a portal invite and let them register.`
  2. `Check what a patient sees` → `/portal/` — `Open the portal in a preview session and walk the signup, history and booking path once before anyone else does.`
  3. `Write one education primer` → `/admin/education/` — `The one thing you can finish today that a patient will read tomorrow.`
- Remaining recommended/optional steps render below, collapsed, headed `{n} improvements available`.
- **If `doors_open` is false, the H1 becomes `Ready — but the doors are still shut`** and a banner reads: `Everything required is in place, but the portal is still in preview. Patients reaching it get a Coming Soon page until you set PORTAL_PUBLIC_LAUNCH=true and redeploy.` The words "Ready to see patients" must never appear while the public cannot reach the portal.

### STEADY mode — blockers clear, patients with recent activity

Today's board, in priority order, each row hidden entirely when its count is zero — never rendered as `0`:

1. `{n} intakes waiting on you` → `/admin/triage/` (highest — auto-releases in 4h whether you look or not)
2. `{n} visit summaries to sign` → `/admin/visits/`
3. `{n} messages past their response window` → `/admin/messages/`
4. `{n} abnormal results not yet told to the patient` → `/admin/orders/`
5. `{n} appointments today` → `/admin/briefings/`
6. `{n} good faith estimates due` → `/admin/gfe/`

If all six are zero: `Nothing needs you right now. {n} visits booked this week.`

Setup checklist collapses to a single line: `Practice setup · {done} of {total} · {n} improvements available` with a disclosure caret.

**Regression guard:** STEADY mode must re-check blockers every load, not cache readiness. If the licence list is cleared or the last open block expires, the page drops back to SETUP the same minute — the operator finds out from the dashboard rather than from a patient who could not book.

---

## 4. PATIENT FIRST-RUN

### The landing redirect is wrong today

`/api/v1/auth/signup` redirects new accounts to `/portal/profile/` while the signup page promises "you'll be guided through the comprehensive intake." The promise and the destination disagree, and profile is the one page a new patient has no reason to visit.

**Change the post-signup redirect to `/portal/intake/?welcome=1`.**

### What they see, in order

**1. Signup confirmation, inline, before the redirect fires (1.5s):**
> `You're in, {first_name}. Taking you to your health history now.`

**2. `/portal/intake/?welcome=1` — a one-time welcome panel above section 1, dismissed by starting to type:**
> **Let's start with your history.**
> Eighteen short sections about your symptoms, your history and what you've already tried. It saves as you type, so stop whenever you like and pick up on any device.
> Most people take about twenty minutes. Nothing you write here is shared outside the practice.
>
> `Start section 1 →`   ·   `I'll do this later`

**3. `I'll do this later` → `/portal/` with a single persistent card pinned above the tile grid:**
> **Your health history — 0% done**
> This is the one thing that has to happen before you can book. Everything else in here can wait.
> `Continue →`

That card stays pinned on the dashboard until the intake is submitted. It is the only pinned element the portal is allowed to have.

### The single pushed action

**Finish the health history.** It is the sole gate on booking, triage, PROMs and the education assignments, it is the one thing the patient can complete unilaterally on day one, and it is the only action that changes what the rest of the portal can do.

Everything else is offered, never pushed. The two secondary things worth doing during the intake — reading a guide and uploading old records — are surfaced as quiet inline suggestions inside the intake sidebar, not as competing calls to action:

> `Waiting on something? Twelve guides are ready to read, and if you have old imaging or operative notes you can upload them now.`

### Supporting changes

- **Progress must be visible from the first keystroke.** The first blur autosaves; the only current signal is the progress bar moving. Add an explicit `Saved.` confirmation on each successful section save — a twenty-minute form with no save feedback is a form people abandon.
- **`/portal/appointments/` must exist** before first-run ships. A patient told "you'll be able to book" who trims the URL currently gets the site 404.
- **Acknowledgments are captured at signup** against `DOC_VERSIONS` (`2026-08-14`). Show the three documents as links, not a blind tick-box.

---

## 5. RISKS

Ordered by how badly each one misleads someone.

**5.1 `notification_outbox` cannot store `'abandoned'` — the insert throws and the sends vanish.**
`schema/0028` has `CHECK (status IN ('sent','failed','unconfigured'))`. `functions/_lib/notify.js:514` writes `status: "abandoned"` for suppressed recipients and `functions/api/v1/internal/notifications/flush.js:91` reads it back. The insert violates the constraint, throws, and the suppressed send is silently lost — while the `email_delivery` step, counting only `sent`, reports the mailer healthy. **Pick one: add `'abandoned'` to the CHECK (SQLite cannot alter a CHECK; it needs a table rebuild migration) or stop writing it.** Do not ship the readiness checklist on top of this without fixing it, because "email delivering: done" while messages disappear is precisely the lie the module exists to prevent.

**5.2 Five of seven practice settings are pre-seeded, so any check for non-emptiness ticks itself.**
`practice_address`, `timezone`, `reminders_email_from`, `business_hours_json` and `workflow_rules_json` all ship with real values. `practice_setup.js:129` treats truthiness as done, so "Record your practice identifiers" reports the seeded Evanston hospital address as the operator's address — and it will print on a good faith estimate. **Every setting-backed signal compares against the `SEEDS` constant, not against emptiness.** Only `doxy_room_url` and `phone_office` are seeded `""` and are honest as-is.

**5.3 `baa_ledger` is seeded with Cloudflare as `signed`.**
`schema/0001_phase0_foundation.sql:369` inserts it. Any `COUNT(*) WHERE status='signed'` check reports BAA coverage complete on a bare install, with Stripe, Twilio, Doxy.me and the mail provider entirely uncovered. **If a BAA step is added at all, compute it per-vendor against a hardcoded required-vendor list and report `2 of 5 vendors covered`, never a bare count.** Given no admin page writes this table, the honest move for now is to leave BAA off the checklist rather than ship a step that is green by seed.

**5.4 `setting()` measures the wrong string.**
It returns raw `value_json` and `practice_setup.js:132` runs `String(room).length > 6` on JSON *including its quotes*. It passes today only because the seed `'""'` happens to be 2 characters. A five-character garbage URL would pass the check and produce a Join button that goes nowhere. **Parse, then validate as a URL.**

**5.5 The availability count calls blocked time bookable.**
No `block_kind` filter and no date filter. A calendar containing only surgery and lunch blocks, or one whose hours all expired last year, reports "bookable hours: done" while `functions/_lib/scheduling.js:77` returns zero slots and the patient booker blames the date: *"No slots available on this day. Try another date."* The operator sees green, the patient sees nothing, and nobody can see the other's screen. This is the single most damaging false-green in the current implementation.

**5.6 Admin bookings bypass availability, so the operator's own testing confirms the wrong thing.**
`functions/api/v1/admin/appointments.js` `onRequestPost` never queries `clinician_availability`. The operator books a test appointment against a completely empty schedule, it succeeds, and they conclude scheduling works. The `attention` branch in step 2 exists specifically to catch this, and the scheduling-page banner must state the asymmetry in plain terms.

**5.7 Empty states must not promise gated features.**
While `PORTAL_PUBLIC_LAUNCH` is `"false"`, `functions/portal/_middleware.js` serves Coming Soon over every portal URL and `/api/v1/auth/signup` returns 404. Any admin copy saying "send a portal invite" is only true for a **preview** invite. **All such strings switch on the flag:** pre-launch reads `send a portal preview invite`; post-launch reads `send a portal invite`. Equally, no portal-facing copy describing signup may render while the flag is false — the middleware already prevents it, and nothing new may route around it.

**5.8 A checklist that links to a 404 destroys the credibility of every other row.**
`/admin/cases/` and `/portal/appointments/` do not exist today, and `_nav.js` already highlights a Patients group on `/admin/cases/*`. Both files must land in the same change as the checklist. Verify every `href` in the steps array resolves before shipping.

**5.9 Re-wording an empty state does not fix a broken control.**
`/admin/orders/` and `/admin/gfe/` both open dialogs whose patient `<select>` is empty on a fresh install and both submit `patient_id=""`. Copy saying "add a patient first" next to a live button that creates a corrupt row is a worse outcome than the blank box, because the operator now trusts the page. **Disable the buttons.** Same for `/admin/billing/insurance/`, where the fix is a name search, not a sentence.

**5.10 The `-1` sentinel must never surface as data.**
`count()` returns `-1` on a thrown query. `-1 > 0` is false, so today a broken query is indistinguishable from an empty table and the operator is sent to configure something that is already configured. Route it to the new `unknown` status, render `Could not check`, and count it as not-done.

**5.11 Runtime-created tables throw if probed directly.**
`sns_confirmations` (created by `functions/api/v1/internal/ses/feedback.js:138`) and `kb_sections` (created by `scripts/kb_load_d1.py:215`) are absent from `schema/*.sql`. Query either without `tableExists()` and `computeSetup` throws, the dashboard fetch returns non-OK, and the panel hides itself — a fully working install renders as if setup does not exist.

**5.12 The cron step has never once detected the cron worker.**
It matches `user_id IN ('sweep','auto','cron','pipeline')`, but the worker writes `user_id = NULL` and stamps `user_agent = 'mountzara-cron'` (`cron-worker/index.js:135`, `:214`, `functions/api/v1/internal/triage/auto-release.js:167`, `functions/api/v1/internal/nps/dispatch.js:112`). It reports "not deployed" forever regardless of truth, which trains the operator to ignore the row. Match on `user_agent`, and check `MAX(ts)` freshness — existence proves it ran once, not that it is running.

**5.13 Version-blind acknowledgment counting silently defeats the versioning.**
`functions/_lib/acknowledgments.js:70-84` was built to force re-acknowledgment after a document bump. `practice_setup.js:139` counts all rows regardless of `doc_version`, so the moment the operator revises the privacy notice the checklist keeps reporting full coverage while every patient is out of date. Bind `DOC_VERSIONS[doc_key]`.

**5.14 "Ready to see patients" while the doors are shut.**
`ready_to_see_patients` currently ignores `PORTAL_PUBLIC_LAUNCH`. An operator reading that headline while every patient hitting the portal gets a Coming Soon page will discover the gap from a phone call. Step 15 is blocking, and READY_EMPTY mode carries the shut-doors banner.

**5.15 Env-only signals cannot be validated or repaired from the console.**
`BILLING_PROVIDER_NPI` / `_TIN` can only be checked for presence, never correctness, and nothing in the admin UI can change them. Read `clearinghouse_profile.npi_individual` and `.tin_last4` as the source of truth — they are operator-editable and validated against `/^\d{10}$/` — and treat env vars as a display fallback only.

**5.16 Draft education counted as stocked.**
`education_materials.status` defaults to `'draft'` and drafts are invisible to patients. Counting them tells the operator the library is stocked while the portal shows nothing. Filter to `published`, and report drafts separately so the near-miss is visible.

**5.17 The dashboard tile and the education page contradict each other today.**
`/portal/` counts D1 rows and says "Library opening soon" while `/portal/education/` renders twelve complete hardcoded guides. A paying patient is told at the front door that the thing one click away does not exist. Fix the tile in the same change as the copy, or the new warm copy just makes a confident lie sound better.

**5.18 Do not let the first-run panel become a flag.**
The pinned "Your health history — 0% done" card must be computed from intake progress on every load, not dismissed into `localStorage`. A patient who dismisses it and forgets is a patient who never books.