# Billing go-live runbook

The outbound rail (scrub → X12 837P → clearinghouse) is built. Going live is
mostly **configuration + enrollment**, not code. Work the checklist at
`GET /api/v1/admin/billing/clearinghouse` top-to-bottom; it reports each step's
state.

> You connect to **ONE** clearinghouse. It forwards your claims to **every**
> payer (BCBS, Aetna, Cigna, UHC, Humana, Medicare, Medi-Cal, Blue Shield,
> Health Net, Molina, Centene…). You do not connect to each insurer.

## 1. Pick + select a clearinghouse
Supported adapters (`functions/_lib/clearinghouse.js`): `stedi`,
`change_healthcare` (Optum), `availity`, `claim_md`, `office_ally`, `waystar`.
For an API-driven build like this, **Stedi** or **Claim.MD** are the smoothest;
**Office Ally** is cheapest but batch/SFTP. Set:
```
CLEARINGHOUSE_VENDOR = stedi   # (or change_healthcare | availity | claim_md | waystar | office_ally)
```

## 2. Set clearinghouse credentials (Cloudflare Pages secrets)
Only the selected vendor's keys are needed:
| Vendor | Secrets |
|---|---|
| stedi | `STEDI_API_KEY` |
| change_healthcare | `CHC_CLIENT_ID`, `CHC_CLIENT_SECRET` |
| availity | `AVAILITY_CLIENT_ID`, `AVAILITY_CLIENT_SECRET` |
| claim_md | `CLAIMMD_ACCOUNT_KEY` |
| waystar | `WAYSTAR_API_KEY` |
| office_ally | `OFFICEALLY_USER`, `OFFICEALLY_PASS` (REST where enabled; else SFTP) |

Endpoints can be overridden if a vendor changes them:
`<VENDOR>_BASE_URL`, `<VENDOR>_SUBMIT_PATH`, `<VENDOR>_ELIGIBILITY_PATH`,
`<VENDOR>_STATUS_PATH`. **Confirm the submit path against the vendor's current
API docs at enrollment** — the defaults are starting values.

Set via the CF API (per CLAUDE.md "Set/change a Pages env var") as
`type: secret_text`, then redeploy.

## 3. Set billing-provider identifiers (secrets)
```
BILLING_PROVIDER_NPI       = <10-digit type-2 org NPI>
BILLING_PROVIDER_TIN       = <EIN, e.g. 12-3456789>
BILLING_PROVIDER_NAME      = Mount Zara, LLC
BILLING_PROVIDER_TAXONOMY  = 207V00000X        # OB/GYN (override per specialty)
BILLING_PROVIDER_ADDR1/CITY/STATE/ZIP          # defaults to the seeded practice address
SUBMITTER_ID / RECEIVER_ID / BILLING_CONTACT_PHONE  # as your clearinghouse assigns
```

## 4. Seed + verify payers
```
POST /api/v1/admin/billing/clearinghouse   { "action": "seed_payers" }
```
Loads the IL/CA + national directory (`functions/_lib/payer_directory.js`) into
`billing_payers`. **Then verify every `payer_id` against your clearinghouse's
payer list** (each clearinghouse uses its own IDs). Entries flagged
`verify:'required'`/`'lookup'` (Blues, Medicare MAC, Medicaid + MCOs, Molina,
Centene, Kaiser) ship without an ID on purpose — fill them from the
clearinghouse list. **A wrong payer ID = guaranteed rejection.**

Per-payer **EDI enrollment** (some payers, esp. Medicare/Medicaid/Blues, require
an enrollment/EDI agreement before they accept electronic claims) is done in
the clearinghouse portal — paperwork, not code.

## 5. Close the insurance-capture gap
Member ID, gender, and billing address aren't modeled in our schema yet (they
live in intake JSON). Until an intake insurance-capture step lands, pass them in
the submit body:
```
POST /api/v1/admin/billing/claims/:id/submit
{ "insurance": { "member_id":"…", "group_number":"…", "gender":"F",
                 "dob":"YYYY-MM-DD", "address": {"line1":"…","city":"…","state":"…","zip":"…"} } }
```
The scrubber **blocks** any claim missing required fields — nothing half-formed ships.

## 6. Dry-run, then test, then go live
1. **Dry run** (no submission, returns the 837 to inspect):
   `POST …/claims/:id/submit { "dry_run": true, "insurance": {…} }`
2. **Test submit** — with a real vendor selected but `CLEARINGHOUSE_LIVE` unset,
   claims build with usage indicator **`T`** (test). Submit one and confirm a
   **277CA "accepted"** in the clearinghouse portal.
3. **Go live:** set `CLEARINGHOUSE_LIVE = 1` (usage flips to **`P`** production)
   and redeploy. The readiness endpoint's `ready_to_go_live` turns true when
   vendor≠mock, creds present, provider IDs set, payers seeded + all verified.

## Still TODO (inbound rail — next build)
- **835 ERA** ingestion → auto-post payments, flip claims to `paid`/`denied`.
- **276/277** claim-status polling.
- **270/271** eligibility folded into the scrub (interface stubbed in
  `clearinghouse.checkEligibility`).
- **Denial management:** CARC/RARC triage + appeal drafting (corrected-claim
  frequency-7 resubmission is already supported by the submit endpoint).
