#!/usr/bin/env node
// =====================================================================
// test_undeliverable_domains.mjs
// =====================================================================
// Guards the rule that kept six guaranteed hard bounces out of a young
// SES account: never send to a reserved name.
//
// RFC 2606 / RFC 6761 set aside .test, .invalid, .localhost, .example and
// the example.com/net/org domains precisely so fixtures cannot reach a real
// mailbox. That guarantee is only worth anything if the sender refuses to
// try — otherwise every seeded demo address becomes a hard bounce the
// moment the account leaves the sandbox.
// =====================================================================
import { isUndeliverableAddress } from "../functions/_lib/notify.js";

const CASES = [
    // reserved — must refuse
    ["demo@mountzara.test", true],
    ["e2e-probe@mountzara.test", true],
    ["flow-1787112333@mountzara.test", true],
    ["someone@anything.invalid", true],
    ["root@localhost", true],
    ["a@b.localhost", true],
    ["x@example.com", true],
    ["x@example.net", true],
    ["x@example.org", true],
    ["x@whatever.example", true],
    ["MixedCase@MOUNTZARA.TEST", true],
    ["trailing@mountzara.test.", true],      // trailing dot is a valid FQDN form
    // real — must pass through
    ["chris.mabini@gmail.com", false],
    ["patient@mountzara.com", false],
    ["someone@testing.co.uk", false],        // "test" inside a label is not the TLD
    ["someone@example.company", false],      // not a reserved TLD
    ["someone@invalid-clinic.com", false],
    ["", false],
    ["no-at-sign", false],
];

let bad = 0;
for (const [email, want] of CASES) {
    const got = isUndeliverableAddress(email);
    if (got !== want) {
        console.error(`  ✗ ${JSON.stringify(email)} → ${got}, expected ${want}`);
        bad++;
    }
}
if (bad) { console.error(`undeliverable-domain gate: ${bad} failure(s)`); process.exit(2); }
console.log(`undeliverable-domain gate: ${CASES.length} case(s) pass — reserved names refused, real addresses untouched`);
