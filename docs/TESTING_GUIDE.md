# Mount Zara — End-to-End Testing Guide

Walks you through every shipped surface using the two seeded test accounts on your Desktop. Designed to be run in one ~30-minute session so you exercise every module at least once.

## 0. Before you start

### 0.1 What you need

Two credential files on your Desktop (created earlier this session):

- **`~/Desktop/JaneDoe_credentials.txt`** — fully-seeded patient. Use this to test "what does an existing patient see?"
- **`~/Desktop/BlankTester_credentials.txt`** — empty-state patient. Use this to test "what does a brand-new patient see?" and to walk every flow from scratch.

Open both files and have them visible.

You also need your **admin password** (the value behind the macOS Keychain item `mountzara-admin-password`). When the browser prompts for HTTP Basic Auth, the username is `chris.mabini@gmail.com` and the password is that Keychain value.

### 0.2 The preview-gate reminder

Until you flip `PORTAL_PUBLIC_LAUNCH = true` on the Cloudflare Pages production env, every `/portal/*` URL is admin-preview-only. The first hit to any `/portal/*` page (or `/api/v1/auth/*`, `/api/v1/patient/*`, etc.) will trigger a browser Basic-Auth prompt — that's the admin auth, **not** the patient login. After you pass the admin prompt, Safari/Chrome caches the admin credential for the rest of the browser session and the patient login form appears as the next step.

You will therefore see TWO prompts when logging in as Jane or Blank:

1. Browser native prompt → enter `chris.mabini@gmail.com` + admin password.
2. Portal login form (purple Apple-glass UI) → enter Jane's or Blank's email + portal password.

If you want to skip the first prompt for general public testing, run:

```bash
source ~/.config/mountzara/cf-creds.env 2>/dev/null
npx wrangler pages secret put PORTAL_PUBLIC_LAUNCH --project-name=mountzara
# (value: true)
./scripts/deploy-prod.sh "flip portal public"
```

I do not recommend doing that until you've finished testing — the gate is what's keeping the still-rough surfaces hidden from public visitors.

### 0.3 What "verified end-to-end" means here

The check column in each step is "expected outcome." If you see what's listed, that surface is healthy. If not, note what differs and we can fix.

---

## 1. Admin sanity check (3 minutes)

Start here. Confirms admin auth + every admin page renders. **As of 2026-05-16, every `/admin/*` page carries a shared top-of-page section nav** — once you're authenticated you can click between Analytics / Patients / Scheduling / Triage / Messages / Education / Posts without ever typing another URL. The active page is highlighted in purple.

| Step | URL | Action | Expected |
|---|---|---|---|
| 1.1 | https://mountzara.com/admin/ | Open in a new tab. | Browser prompts for Basic Auth. Enter admin email + password from Keychain. Existing /admin/ dashboard renders. |
| 1.2 | https://mountzara.com/admin/patients/ | Click or paste URL. | Searchable patient list. You should see **8 patients**: Jane Doe, Blank Tester, plus six earlier test accounts from this session. Click into any name. |
| 1.3 | https://mountzara.com/admin/cases/8cc1aa63-5931-4c54-babb-e06bc196d743/ | Direct link to Jane's case. | Tabbed workspace loads. Header shows "Jane Doe · 42y · chris.mabini@gmail.com · pronouns she/her · joined ... · she/her · America/Chicago". Summary chips: Intake `in_progress 26%`, Triage `endo_pain_evaluation · released`, Messages `1 thread` (no unread because earlier verify already opened it), Diary `10 entries · last 2026-05-15`, Audit events. Click every tab — none should be blank. |
| 1.4 | https://mountzara.com/admin/analytics/ | Open. | Cross-patient dashboard. KPIs show 8 patients · 1+ upcoming visits · symptom-signal panel with avg-pain readout. Bar charts render for triage by visit type and appointments by status. Try the 14d / 30d / 90d window chips. |
| 1.5 | https://mountzara.com/admin/triage/ | Open. | Triage review queue. Jane's row (already released) shows on "Released" filter. Click into the row to confirm the override-form populates. |
| 1.6 | https://mountzara.com/admin/messages/ | Open. | Two-column inbox. Jane's thread visible. Click in — you should see the welcome message + Jane's reply about ibuprofen + your earlier ASA-hold response. Try the "+ New message to a patient" modal; type "Tester" in the patient-typeahead and Blank Tester should appear. |
| 1.7 | https://mountzara.com/admin/scheduling/ | Open. | Drag-to-set availability. Already-created blocks for Mon-Fri 09:00-12:00 next week should be visible. |
| 1.8 | https://mountzara.com/admin/education/ | Open. | "Drafts" filter shows the seed `welcome-to-the-portal` (draft). Switch to "Published" filter — should show `endometriosis-101` (created during Round C verify). Click "+ New material" and exercise the create-modal preview toggle (write some `# heading` markdown and click Preview). |

If any of those steps fail, stop and capture the broken URL + the response — I'll fix before proceeding.

---

## 2. Jane Doe — fully-seeded patient experience (10 minutes)

Use the Jane credentials from `~/Desktop/JaneDoe_credentials.txt`. **Open a fresh private/incognito window** so the admin Basic Auth cache from §1 doesn't carry over and you get the real first-visit experience.

| Step | URL | Action | Expected |
|---|---|---|---|
| 2.1 | https://mountzara.com/portal/login | Open in private window. | Browser prompts for admin Basic Auth (preview gate). Enter admin email + password. Then the portal login form renders. |
| 2.2 | (same page) | Enter Jane's email + password from her credentials file. | Redirects to `/portal/` dashboard. Greeting reads "Hi, Jane." Six live module cards render. |
| 2.3 | Dashboard | Inspect each card. | **Appointment**: badge "ready to book" · "Complex Pelvic Pain / Endometriosis Evaluation · 45 min · In person · Tap to choose a time…" **Messages**: "1 thread · all read" (or "1 new" if you haven't opened it yet). **Symptom diary**: "5 tracked today" or similar with last entry time. **Intake**: "in progress" badge · "5 sections saved so far". **Documents**: 0 files (Jane hasn't uploaded any). **Education**: "1 assigned" badge — the endometriosis-101 primer Dr. Mabini assigned during seeding. |
| 2.4 | Click Appointment card | | `/portal/appointments/book/`. Triage summary renders at top (visit type, duration, urgency, modality). Date strip shows the next 5 weekdays with slot counts. Pick a day, pick a time slot — confirmation card renders. Click "Confirm and book". Should land on "Booked — you're all set" success state. |
| 2.5 | Hit `/portal/` again | | Appointment card should now read something like "Today at 9:00 AM · …" or whatever date you picked. |
| 2.6 | Click Messages card | | Thread "Welcome — quick pre-visit checklist" visible. Click in. Read history. Send a new reply ("Got it, see you then."). Click back — thread is now top-most. |
| 2.7 | Click Symptom diary card | | `/portal/symptoms/`. Today's diary shows the 5 values seeded. Try clicking the previous-day arrow (◀) — the pain trajectory was 8 → 4 over 10 days; you should see entries for each. Modify any field — the save-bar pulse should go amber → green within ~1 second. Drag the pelvic pain slider for today; it autosaves. |
| 2.8 | Scroll down on symptoms page | | "30-day trend" panel. Pick `pelvic_pain_0_10` from the dropdown — chart should show 8 → 4 line over the last 10 days. Pick `sleep_quality_0_10` — different trajectory. |
| 2.9 | Click Education card from dashboard | | `/portal/education/`. Filter chips at top reflect topic tags. The endometriosis-101 card should have an "Assigned" badge in the corner. Click into it — full markdown body renders. Click "Mark complete" — button toggles to "Mark not done" and complete badge appears. |
| 2.10 | Click Intake card | | Multi-step intake wizard at `/portal/intake/`. Saved sections (1, 4, 5, 12, 17) should preserve their values when you click into each step. Other sections empty. Navigate but don't submit (submitting triggers triage which re-runs and could overwrite Jane's released state). |
| 2.11 | Click Documents card | | Empty state. Try uploading a small image or PDF from your Mac — verify it appears in the list with size + thumbnail. |
| 2.12 | Click Sign out (top right) | | Returns to `/portal/login`. Re-login required to see Jane again. |

---

## 2.5. Brand-new patient — the public sign-up journey (15 minutes)

This is the experience a real first-time prospective patient would have. Two ways to test it depending on whether the portal is publicly launched.

### 2.5.A Pre-launch — admin-preview only (current state)

Right now the portal is still gated by `PORTAL_PUBLIC_LAUNCH` so an anonymous visitor sees the Coming Soon page when they hit `/portal/*`. To test the new-patient flow, you bypass the gate by visiting any `/admin/*` URL first (which caches your Basic Auth credential in the browser session) — then everything `/portal/*` behaves as if the gate were open.

| Step | Where | What you do | What you should see |
|---|---|---|---|
| 2.5.1 | Open a fresh incognito/private window | Visit https://mountzara.com/ | The real public homepage — every visitor sees this. Hero, OMT section, AI/Apps bento, footer. Click around: About, Trending, Evidence. None of these prompt for login. |
| 2.5.2 | (still in the incognito window) | https://mountzara.com/admin/ | Browser prompts for Basic Auth (Mount Zara Admin realm). Enter admin email + Keychain password. The admin dashboard renders. **At this point your incognito session has the admin credential cached so the preview gate is unlocked for /portal/* too.** |
| 2.5.3 | (same window) | https://mountzara.com/portal/login | Portal login form renders (no second Basic Auth prompt because the cache is still warm). |
| 2.5.4 | Click "Sign up" | | https://mountzara.com/portal/signup with form: email, password, first name, last name, DOB, phone. |
| 2.5.5 | Fill in with a fresh test email | e.g. `new-test-${date}@example.test`, password something rememberable, DOB any past date | On submit, a new patient row writes to D1, session cookie sets, redirects to `/portal/`. |
| 2.5.6 | Land on dashboard | | Greeting "Hi, FirstName." Every card shows the brand-new-patient empty state — same as Blank Tester. |
| 2.5.7 | Click "Begin your intake" | | The 19-section intake wizard at `/portal/intake/new` — wizard starts on section 1. Autosaves as you go. |
| 2.5.8 | Walk through 2-3 sections | Section 1 (patient info), section 2 (consent), section 4 (chief complaint with at least one pain symptom). | After section 2 is saved, you can technically submit the intake even with the other sections empty — but more sections = better triage. |
| 2.5.9 | Hit `/portal/` while intake is partial | | Intake card now reads "In progress · 11%" or so. Other cards still empty. |
| 2.5.10 | Finish intake and submit | Last step → "Submit my intake" | Submit response. Because `ANTHROPIC_API_KEY` is not provisioned, triage runs the fallback path: writes `appointment_triage` row with `ai_visit_type = manual_review_required`. |
| 2.5.11 | Hit `/portal/` after submit | | Appointment card flips to "Manual review needed — Dr. Mabini will reach out directly." |
| 2.5.12 | Switch to admin tab | https://mountzara.com/admin/triage/ | The new triage row appears on Pending review. Click in, set visit_type (e.g. `new_patient_complex`), set duration, optional override reason, click "Release". |
| 2.5.13 | Back in patient tab | Refresh `/portal/` | Appointment card now shows "Ready to book · New Patient — Complex · 60 min". |
| 2.5.14 | Click into booking | | Slot picker. Pick any available time → confirm → success state. |
| 2.5.15 | Send a message + log a symptom + open the education primer | (use the rest of the dashboard cards) | Each empty state flips populated. |
| 2.5.16 | Sign out | Top-right "Sign out" link | Returns to /portal/login. |

That sequence proves the entire fresh-patient lifecycle: anonymous visitor → admin reviews the surface in preview → user signs up → intake → triage → admin releases → booking → ongoing care.

### 2.5.B Post-launch — flip the public-launch flag

Once you're ready for real patients to find the portal on their own:

```bash
# Provision the flag (value: "true").
source ~/.config/mountzara/cf-creds.env 2>/dev/null
curl -X PATCH \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/mountzara" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"deployment_configs":{"production":{"env_vars":{"PORTAL_PUBLIC_LAUNCH":{"value":"true","type":"plain_text"}}}}}'
./scripts/deploy-prod.sh "flip portal public launch"
```

After that:
- Any visitor can hit `/portal/login` directly — no Basic Auth prompt.
- The "Patient Portal — Coming Soon" link in the homepage nav now goes to the real portal.
- `/portal/signup` is publicly reachable.
- The exact same 2.5.A flow above works without you needing to pass admin Basic Auth first.

To take it back down (e.g. during emergency maintenance): set `PORTAL_PUBLIC_LAUNCH` to anything other than the literal string `true` (delete it, or set to `false`, or set to `paused`) and redeploy. The Coming Soon page returns.

### 2.5.C Cleaning up your test patients

After you've created a few `new-test-*@example.test` accounts, you can purge them from D1:

```bash
npx wrangler d1 execute mountzara-clinical --remote --command="
  DELETE FROM intake_section_data WHERE intake_id IN (
    SELECT id FROM intake_responses
    WHERE patient_id IN (SELECT id FROM patients WHERE email LIKE 'new-test-%@example.test')
  );
  DELETE FROM intake_responses WHERE patient_id IN (SELECT id FROM patients WHERE email LIKE 'new-test-%@example.test');
  DELETE FROM appointment_triage WHERE patient_id IN (SELECT id FROM patients WHERE email LIKE 'new-test-%@example.test');
  DELETE FROM appointments WHERE patient_id IN (SELECT id FROM patients WHERE email LIKE 'new-test-%@example.test');
  DELETE FROM message_threads WHERE patient_id IN (SELECT id FROM patients WHERE email LIKE 'new-test-%@example.test');
  DELETE FROM messages WHERE patient_id IN (SELECT id FROM patients WHERE email LIKE 'new-test-%@example.test');
  DELETE FROM symptom_diary_entries WHERE patient_id IN (SELECT id FROM patients WHERE email LIKE 'new-test-%@example.test');
  DELETE FROM patient_education_assignments WHERE patient_id IN (SELECT id FROM patients WHERE email LIKE 'new-test-%@example.test');
  DELETE FROM auth_sessions WHERE patient_id IN (SELECT id FROM patients WHERE email LIKE 'new-test-%@example.test');
  DELETE FROM patients WHERE email LIKE 'new-test-%@example.test';
"
```

audit_log rows persist by design (6-year HIPAA retention) — that's intentional and not a cleanup target.

---

## 3. Blank Tester — empty-state walkthrough (10 minutes)

Use the Blank Tester credentials. Continue in the same private window OR open a new private window if you want a totally clean cookie state.

| Step | URL | Action | Expected |
|---|---|---|---|
| 3.1 | https://mountzara.com/portal/login | Log in as Blank Tester. | Dashboard greets "Hi, Blank." Every card shows the empty/coming-soon state. **Appointment** card reads "Start with your intake" with a CTA pointing to `/portal/intake/`. **Messages** "No messages yet." **Symptom diary** "Today's diary is empty." **Intake** "No intake started." **Documents** zero. **Education** library available (Jane's `endometriosis-101` primer + the welcome seed). |
| 3.2 | Start intake | Click Intake card. | Step 1 patient information form. Fill in. Click "Next." |
| 3.3 | Section 4 chief complaint | Pick anything — try "Pelvic pain x 2 years, worse with periods" and pain 7/10 with a couple of triggers. Click "Save." | Autosave indicator. Move forward / back works. |
| 3.4 | After 2–3 sections done | Hit `/portal/` | Intake card now reads "In progress · 11%" or so. |
| 3.5 | Submit intake | Last step → Submit. | Submit response carries a `triage` sub-object. Because `ANTHROPIC_API_KEY` is not provisioned (BAA pending), `triage.ai_used: false` and a `manual_review_required` placeholder row writes. |
| 3.6 | Hit `/portal/` | | Appointment card flips to "Manual review needed — Dr. Mabini will reach out directly." |
| 3.7 | In a SEPARATE admin tab | https://mountzara.com/admin/triage/ | New triage row visible on "Pending review" filter for Blank Tester. Open it. Override `visit_type` to anything (e.g. `new_patient_complex`), add an override reason, click "Release as-is" or "Save override (don't release)". |
| 3.8 | Back in Blank's portal tab | Refresh `/portal/` | Appointment card now shows "Ready to book" with the visit type you set. |
| 3.9 | Book a slot, exchange a message, log a symptom, complete an education primer | | Each empty-state flips to a populated state. |

This proves the entire patient lifecycle works: intake → triage → admin review → patient booking → ongoing care.

---

## 4. App sync layer — verify the four endpoints respond (3 minutes)

You won't have the external apps (Transcription, Clinical AI, etc.) integrated yet, but you can prove the endpoints accept real payloads with the per-app tokens from your Keychain.

```bash
# Look up Jane's patient_id from the transcription side.
JANE_TOKEN=$(security find-generic-password -s 'mountzara-transcription-sync-token' -w)
curl -sS -H "Authorization: Bearer $JANE_TOKEN" \
  'https://mountzara.com/api/v1/sync/patients/lookup?app=transcription&email=chris.mabini@gmail.com&dob=1983-12-15' | python3 -m json.tool

# Push a fake transcription note for Jane. Use a unique session id each time
# (idempotency guard rejects duplicates).
JANE_ID='8cc1aa63-5931-4c54-babb-e06bc196d743'
curl -sS -X POST -H "Authorization: Bearer $JANE_TOKEN" \
  -H 'content-type: application/json' \
  -d "{\"patient_id\":\"$JANE_ID\",\"transcription_session_id\":\"test-$(date +%s)\",\"visit_date\":\"2026-05-16\",\"note_body\":\"Test SOAP note.\",\"patient_visible_summary\":\"We talked about your pain.\"}" \
  'https://mountzara.com/api/v1/sync/transcription/notes' | python3 -m json.tool

# Confirm the encounter shows up on Jane's case page.
# Visit https://mountzara.com/admin/cases/$JANE_ID/ → Audit tab → look for
# a phi_write row with action=phi_write record_type=encounter.
```

If any of those return 401, the matching `*_SYNC_TOKEN` Pages secret is missing or out of sync with Keychain — re-issue via `wrangler pages secret put`.

---

## 5. Auth rate-limit verification (1 minute)

Try logging in as Jane with the wrong password 10 times. After the 10th wrong attempt, even your correct-password attempt returns 429 with `retry-after`. Wait 15 minutes for the soft-lockout to clear, OR delete the KV key:

```bash
# Hash for the (email|ip) identifier:
KEYHASH=$(python3 -c "import hashlib; print(hashlib.sha256('chris.mabini@gmail.com|$(curl -sS -4 ifconfig.me)'.lower().encode()).hexdigest())")
npx wrangler kv key delete --binding=MZ_SESSIONS --remote "rl:login:$KEYHASH"
```

Same lockout applies to admin Basic Auth (key prefix `rl:admin_login:`).

---

## 6. Cron worker — wait + verify (overnight)

The standalone `mountzara-cron` Worker fires at 09:00 UTC nightly. Tomorrow morning Central time, confirm the snapshot landed:

```bash
source ~/.config/mountzara/cf-creds.env 2>/dev/null
DATE=$(date -u +%Y-%m-%d)
curl -sS \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets/mountzara-backups/objects/d1/$DATE.ndjson.gz" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -o /tmp/last_backup.ndjson.gz
ls -la /tmp/last_backup.ndjson.gz
gunzip -c /tmp/last_backup.ndjson.gz | head -2
```

If you want to force a manual run right now (instead of waiting), the verify path I used earlier is still operative: re-enable `workers_dev = true` in `cron-worker/wrangler.toml`, `wrangler deploy`, POST to `https://mountzara-cron.mountzara.workers.dev/backup` with the `MANUAL_BACKUP_TOKEN` Bearer (Keychain item `mountzara-backup-manual-token`), then flip back to `workers_dev = false` and redeploy.

---

## 7. Re-seed Jane Doe from a clean slate (if you want)

If your testing puts the data into a state you don't like and you want Jane back to the canonical seed:

```bash
# Delete Jane's existing portal data (audit_log entries persist for HIPAA — that's intentional).
npx wrangler d1 execute mountzara-clinical --remote --command="
  DELETE FROM intake_section_data WHERE intake_id IN (SELECT id FROM intake_responses WHERE patient_id='8cc1aa63-5931-4c54-babb-e06bc196d743');
  DELETE FROM intake_responses WHERE patient_id='8cc1aa63-5931-4c54-babb-e06bc196d743';
  DELETE FROM appointment_triage WHERE patient_id='8cc1aa63-5931-4c54-babb-e06bc196d743';
  DELETE FROM appointments WHERE patient_id='8cc1aa63-5931-4c54-babb-e06bc196d743';
  DELETE FROM messages WHERE patient_id='8cc1aa63-5931-4c54-babb-e06bc196d743';
  DELETE FROM message_threads WHERE patient_id='8cc1aa63-5931-4c54-babb-e06bc196d743';
  DELETE FROM symptom_diary_entries WHERE patient_id='8cc1aa63-5931-4c54-babb-e06bc196d743';
  DELETE FROM patient_education_assignments WHERE patient_id='8cc1aa63-5931-4c54-babb-e06bc196d743';
  UPDATE patients SET password_hash=NULL, password_set_at=NULL WHERE id='8cc1aa63-5931-4c54-babb-e06bc196d743';
"

# Re-seed.
./scripts/_seed_jane_doe.sh
```

Blank Tester reseeds the same way via `scripts/_seed_blank_test_patient.sh`.

---

## 8. What to do if something is broken

1. Note the exact URL.
2. Open Chrome DevTools → Network tab → repeat the broken action.
3. Find the failing request, grab the response body.
4. Share the URL + response body + which test patient you were logged in as. I can usually triage in under a minute.

Common gotchas:
- **"Coming Soon" page even though you're admin** — browser is sending the request without the cached admin credentials (incognito session, or you used a different domain). Just visit `/admin/` first to reset the Basic Auth cache.
- **429 "rate_limited"** — you hit the auth lockout. See §5 to clear it.
- **401 on a `/api/v1/sync/...` endpoint** — Bearer token from Keychain doesn't match the Pages env_var. Re-issue.
- **D1 row says "no_such_email" on Jane login** — Jane's password_hash got cleared somehow. Re-run `scripts/_seed_jane_doe.sh` (after wiping per §7).

---

## 9. When you're satisfied

Two things to flip:

1. **Confirm Anthropic BAA** — once Anthropic signs and you provision `ANTHROPIC_API_KEY` on Pages, intake submissions trigger real Claude triage (not the manual-review fallback). Test by having Blank Tester re-submit her intake — the appointment card should flip from "Manual review needed" to "ready to book" with a real visit type.
2. **Flip `PORTAL_PUBLIC_LAUNCH = true`** — patient-facing surfaces go public. Public visitors get the real portal login instead of the Coming Soon page. No more browser Basic-Auth prompt.

Then the portal is **live for real patients**, not just for you testing.

---

*Last updated: 2026-05-16. If something diverges from this guide in the future, update this doc in the same PR that lands the behavior change.*
