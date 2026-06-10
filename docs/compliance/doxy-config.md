# Mount Zara — Doxy.me Admin-Panel Configuration Baseline (R14)

**Status:** SKELETON — awaiting Dr. Mabini's admin-panel walkthrough (open decision D8: Doxy.me credentials/panel access are operator-held)
**Document owner:** Chris Mabini, DO
**Created:** 2026-06-10
**Next review:** annually, and at every Doxy.me product-update announcement that touches settings

**Why this document exists (Implementation Specs R14):** the Doxy.me admin
panel carries settings that materially affect clinical workflow and HIPAA
posture (recording defaults, waiting-room messaging, chat retention, group
calls, BAA status). Recording the configuration setting-by-setting makes the
baseline survive staff turnover and platform updates.

---

## Section 1 — Walkthrough checklist (operator: Dr. Mabini)

Complete in one sitting in the Doxy.me admin panel; record every setting in
Section 2 as you go.

- [ ] 1. Log in to the Doxy.me admin panel.
- [ ] 2. Walk EVERY setting; record each in Section 2 as `Setting → Mount Zara value (+ rationale where non-default)`.
- [ ] 3. Confirm **no recording by default** (Joshi & Welch 2023 p. 142 — preserves the HIPAA conduit exception).
- [ ] 4. Confirm waiting-room message is customized: practice name + "Dr. Mabini will join shortly — please don't close this window."
- [ ] 5. Confirm **group-call enabled** (p. 28 — chronic-disease and family-included visits).
- [ ] 6. Confirm BAA status is current; download and file the BAA PDF alongside this doc as `doxy-baa.pdf`.
- [ ] 7. Confirm session-encryption defaults meet HIPAA requirements.
- [ ] 8. Create a separate test "patient" account for periodic end-to-end testing (record its label here, never real PHI).

## Section 2 — Setting-by-setting baseline

| Area | Setting | Mount Zara value | Notes |
|---|---|---|---|
| Recording | Default recording | _[expect: OFF]_ | Conduit-exception preservation |
| Waiting room | Welcome message | _[to fill]_ | Practice name + "don't close this window" |
| Waiting room | Patient check-in notifications | _[to fill]_ | |
| Calls | Group calls | _[expect: ENABLED]_ | Family-included visits |
| Chat | In-session chat retention | _[to fill]_ | |
| Branding | Room URL / clinic name | _[to fill]_ | Matches `practice_settings.doxy_room_url` |
| Security | Session encryption | _[to fill]_ | |
| Security | BAA status | _[to fill]_ | File PDF alongside |
| Accounts | Test patient account | _[label only]_ | For periodic E2E checks |
| _[add rows for every remaining panel setting]_ | | | |

## Section 3 — Annual review log

| Date | Reviewer | Changes found / made |
|---|---|---|
| _[first review pending]_ | | |
