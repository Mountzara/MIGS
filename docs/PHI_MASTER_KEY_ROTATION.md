# PHI_MASTER_KEY — Offline Backup + Annual Rotation Ritual

Per CLAUDE.md §11 Tier 7 (HIPAA hardening). This document defines the operator
ritual for the master key that wraps every per-record DEK protecting PHI in
`mountzara-phi` R2.

**Why this matters.** The master key is the single point of failure for every
PHI ciphertext in the system. If it leaks → patient data is compromised. If it
is lost → patient data is permanently unreadable (R2-side encryption alone is
not sufficient to recover from a master-key loss; that protection layer is
defense-in-depth, not replacement). HIPAA risk register flags this as residual
HIGH #4 — these procedures bring it down to LOW.

The rotation script + escrow ritual close that register entry.

---

## Key files

- `functions/_lib/phi.js` — envelope encryption library (encrypt / decrypt /
  putPhiObject / getPhiObject).
- `functions/api/v1/admin/phi/rotate.js` — Worker that re-wraps every DEK in
  D1 + R2 against a new master key. Admin-gated. Requires a single-use
  confirm token issued by the operator script.
- `scripts/phi_master_key_rotate.sh` — operator-side rotation driver. Handles
  generation of the new key, prompts the escrow ritual, sets/removes
  Cloudflare Pages secrets, drives the Worker through paginated batches, and
  syncs the macOS Keychain copy of the current key.

---

## Initial escrow ritual (one-time, at first deploy)

When the system is first stood up, generate the master key once and seal it
**before** any patient data is encrypted with it.

```
# On the operator's Mac, with Cloudflare creds already in env or
# ~/.config/mountzara/cf-creds.env:

# 1. Generate the key.
KEY=$(openssl rand -base64 32 | tr -d '\n')

# 2. PRINT IT. The page must show the full base64 string.
echo "$KEY"

# 3. Print this page to paper. Use a printer that does NOT cache pages.
#    (Most modern multifunction printers cache jobs — use a dedicated
#    USB-attached printer with no internal storage, or a printer that is
#    factory-reset after printing.)

# 4. Optionally generate a QR code for redundancy (a base64 32-byte key
#    fits comfortably in a single QR):
echo "$KEY" | qrencode -o /tmp/phikey.png -s 8

# 5. Seal one printout in a tamper-evident envelope. Sign + date across
#    the seal. Store in a fireproof safe at the practice premises.

# 6. Seal a second printout in a second tamper-evident envelope. Send to
#    your attorney for off-site escrow with written instructions on when
#    they may open it (e.g. "in the event of operator incapacitation").

# 7. Verify the key is recoverable: ask a second trusted person to read
#    the key off the printout into a fresh terminal and confirm the value
#    matches by hashing both copies:
echo -n "$KEY"          | shasum -a 256  # this terminal
echo -n "<read from print>" | shasum -a 256  # second terminal
# Hashes MUST match.

# 8. Now publish the key to Cloudflare Pages:
echo "$KEY" | npx wrangler pages secret put PHI_MASTER_KEY \
    --project-name=mountzara

# 9. Cache the key locally in macOS Keychain so the rotation script can
#    use it next year as the "old" key:
security add-generic-password \
    -a "mountzara-phi-master-key" \
    -s "mountzara-phi-master-key" \
    -w "$KEY"

# 10. Wipe the shell history that contains the key:
history -d $(history | tail -20 | grep -n KEY | tail -1 | cut -d: -f1)
unset KEY

# 11. Burn the paper draft you used while typing the key (not the sealed
#     escrow envelopes — those stay). Do NOT email, message, or commit
#     the key anywhere.
```

After step 11 the master key exists in exactly three places:

1. Cloudflare Pages encrypted secret (`PHI_MASTER_KEY`).
2. macOS Keychain on the operator's Mac (under `mountzara-phi-master-key`).
3. The two sealed paper escrow envelopes (one at the practice, one with
   the attorney).

That redundancy is the floor. Any single failure point is recoverable.

---

## Annual rotation

Run once per year (calendar reminder in operator's task list).

```
./scripts/phi_master_key_rotate.sh
```

The script walks through every step end-to-end. It will:

1. Pull the current key from Keychain (uses it as `PHI_MASTER_KEY_OLD`).
2. Generate a new 32-byte key.
3. Print the new key + STOP. Operator must run the escrow ritual on the
   new key (print + seal + verify, same as initial escrow) before
   proceeding.
4. Stage three Cloudflare Pages secrets:
   - `PHI_MASTER_KEY_OLD` — the current value (to unwrap existing DEKs).
   - `PHI_MASTER_KEY`     — the new value (to re-wrap them).
   - `PHI_ROTATION_CONFIRM_TOKEN` — single-use random token gating the
     rotation endpoint.
5. Hit `/api/v1/admin/phi/rotate?confirm=<token>` repeatedly in batches of
   100 until 0 rows remain. The Worker logs every rotation event to
   `audit_log`.
6. Remove `PHI_MASTER_KEY_OLD` + `PHI_ROTATION_CONFIRM_TOKEN`. The system
   now runs only with the new key.
7. Replace the Keychain entry with the new key.

After the script completes, **destroy the previous-year escrow envelope** —
its contents are now superseded and any leak would still constitute a
HIPAA-relevant secret exposure. Keep the new envelope.

---

## Recovery scenarios

### Lost operator Mac (Keychain destroyed)

The current key still lives in Cloudflare Pages secrets AND the sealed
envelopes. To restore the operator workstation:

```
# 1. Open the sealed envelope (note: this is a one-time event — the
#    envelope is now broken-seal evidence of operator-station compromise).
# 2. Restore to Keychain:
security add-generic-password \
    -a "mountzara-phi-master-key" \
    -s "mountzara-phi-master-key" \
    -w "<base64 key from envelope>"

# 3. Immediately rotate the master key (the previous one is now considered
#    paper-exposed). Run scripts/phi_master_key_rotate.sh.
# 4. After rotation, re-seal a fresh envelope with the new key per the
#    standard ritual.
```

### Cloudflare Pages secret lost / cleared

If `PHI_MASTER_KEY` is accidentally deleted from Cloudflare Pages, the
production system will stop being able to decrypt PHI immediately. To
restore:

```
KEY=$(security find-generic-password -a "mountzara-phi-master-key" \
        -s "mountzara-phi-master-key" -w)
echo "$KEY" | npx wrangler pages secret put PHI_MASTER_KEY \
    --project-name=mountzara
unset KEY
```

Then redeploy (Workers reload secrets on the next deploy) and verify a
known-PHI document decrypts via the patient portal.

### Operator incapacitation

Per the written instructions accompanying the attorney's escrow envelope,
the attorney is authorized to release the envelope to the named clinical
successor. The successor:

1. Re-establishes Cloudflare account access (separate procedure, not in
   scope of this document — see `docs/business-continuity-plan.md`).
2. Restores the master key to Cloudflare Pages secrets per the
   "Cloudflare Pages secret lost" recovery above.
3. Immediately rotates the master key per the annual procedure (since
   it has now been paper-exposed during the recovery).
4. Re-seals fresh escrow envelopes.

### Master key compromise suspected

If the master key is reasonably believed to have been exposed
(printer compromise, envelope broken-seal not initiated by the operator,
Keychain breach on the Mac):

1. **Do NOT panic-delete** the key — that would orphan every PHI
   ciphertext. Both old + new must coexist during rotation.
2. Run `./scripts/phi_master_key_rotate.sh` to rotate to a new key
   under the same procedure as annual rotation.
3. Audit the `audit_log` table for any decrypt operations during the
   suspected-exposure window.
4. File a breach-notification assessment per
   `docs/compliance/breach-notification-template.md`.

---

## Cron reminder

Add a calendar entry on the operator's Mac that fires once per year, two
weeks before the rotation due date, with the rotation script path
pre-filled.

```
# One-shot install of an annual calendar reminder:
cat <<EOF | osascript
tell application "Calendar"
    tell calendar 1
        make new event with properties {summary:"Rotate PHI_MASTER_KEY", start date:date "12/15/$(date +%Y) 9:00 AM", end date:date "12/15/$(date +%Y) 9:30 AM", description:"Run ./scripts/phi_master_key_rotate.sh from the MountZara/MIGS repo. Have a printer + envelopes ready. See docs/PHI_MASTER_KEY_ROTATION.md."}
    end tell
end tell
EOF
```

---

## What this closes in the HIPAA risk register

- **Residual HIGH #4 — long-lived master key.** Annual rotation now
  scheduled + scripted. Compromise-recovery path documented.
- Implicitly hardens the "Cloudflare insider gains read access to R2"
  threat — each rotation reduces the value window for any historical
  compromise.

After running this script for the first time, update
`docs/compliance/hipaa-risk-assessment.md` row #4 from `residual HIGH`
to `residual LOW (closed by rotation procedure: docs/PHI_MASTER_KEY_ROTATION.md)`.
