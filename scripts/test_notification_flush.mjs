// =====================================================================
// test_notification_flush.mjs
// =====================================================================
// The outbox was write-only. notify.js queued every failure and its own
// comment said "a later run can retry"; no later run existed. Six real
// notifications sat there — three of them magic-link SIGN-IN emails, one
// to the owner's own address — all at attempts=1, none ever retried.
//
// These tests pin the two judgements that make a retry loop safe rather
// than merely present: what is worth retrying, and when to stop.
// =====================================================================

import { backoffMinutes, isDue, isPermanent, MAX_ATTEMPTS }
    from "../functions/api/v1/internal/notifications/flush.js";
import { diagnose } from "../functions/api/v1/admin/notifications/health.js";

let pass = 0, fail = 0;
const failures = [];
const ok = (c, n) => c ? pass++ : (fail++, failures.push(n));
const eq = (a, b, n) => ok(a === b, `${n} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const NOW = Date.parse("2026-08-14T12:00:00Z");
const minsAgo = (m) => new Date(NOW - m * 60000).toISOString();

// ---- backoff ---------------------------------------------------------
ok(backoffMinutes(1) < backoffMinutes(3), "backoff grows with attempts");
ok(backoffMinutes(3) < backoffMinutes(6), "and keeps growing");
eq(backoffMinutes(1), 1, "the first retry is quick");
ok(backoffMinutes(MAX_ATTEMPTS) >= 1440, "the last retries are a day apart, not seconds");
eq(backoffMinutes(99), backoffMinutes(MAX_ATTEMPTS), "backoff is clamped, not undefined");
eq(backoffMinutes(0), backoffMinutes(1), "attempt 0 is treated as the first");

// ---- what is due -----------------------------------------------------
{
    const row = { status: "failed", attempts: 1, created_at: minsAgo(30) };
    ok(isDue(row, NOW), "a failed row past its backoff is due");
}
{
    const row = { status: "failed", attempts: 1, created_at: minsAgo(0) };
    ok(!isDue(row, NOW), "a row that just failed is not retried immediately");
}
{
    const row = { status: "failed", attempts: 4, created_at: minsAgo(30) };
    ok(!isDue(row, NOW), "a row with a long backoff waits its full interval");
}
ok(!isDue({ status: "sent", attempts: 1, created_at: minsAgo(999) }, NOW), "a sent row is never retried");
ok(!isDue({ status: "abandoned", attempts: 3, created_at: minsAgo(999) }, NOW), "an abandoned row is never retried");
ok(!isDue({ status: "failed", attempts: MAX_ATTEMPTS, created_at: minsAgo(9999) }, NOW),
   "the attempt cap stops retrying forever");
ok(isDue({ status: "failed", attempts: 1, created_at: null }, NOW), "a row with no timestamp is tried");
ok(!isDue(null, NOW), "a missing row is handled");

// ---- permanent vs transient -----------------------------------------
// THE ONE THAT MATTERS. The recorded failure on all six real rows is the
// SES sandbox refusing an unverified recipient. That reads like a
// rejection but is transient at the ACCOUNT level: production access
// flips it and every one of them succeeds unchanged. Classifying it as
// permanent would abandon exactly the notifications that are about to
// start working.
ok(!isPermanent('ses 400: {"message":"Email address is not verified. The following identities failed the check in region US-EAST-2: chris.mabini@gmail.com"}'),
   "the SES sandbox refusal is NOT permanent — production access fixes it");
ok(!isPermanent("timeout"), "a timeout is not permanent");
ok(!isPermanent("ses 500 internal error"), "a 5xx is not permanent");
ok(!isPermanent(""), "an empty error is not permanent");
ok(!isPermanent(null), "a null error is not permanent");
ok(isPermanent("invalid recipient"), "a malformed address is permanent");
ok(isPermanent("550 no such user here"), "an unknown mailbox is permanent");
ok(isPermanent("recipient is on the suppression list"), "a suppressed address is permanent");

// ---- the diagnosis he reads -----------------------------------------
{
    const d = diagnose([{ status: "sent", error: null, to_email: "a@b.com" }]);
    ok(d.healthy, "all-sent is healthy");
    eq(d.causes.length, 0, "and reports no causes");
}
{
    // Six copies of the same sandbox refusal is ONE problem, not six.
    const rows = Array.from({ length: 6 }, (_, i) => ({
        status: "failed", to_email: `p${i}@example.com`,
        error: 'ses 400: {"message":"Email address is not verified. The following identities failed the check in region US-EAST-2"}',
    }));
    const d = diagnose(rows);
    ok(!d.healthy, "undelivered mail is not healthy");
    eq(d.causes.length, 1, "six identical failures group into one cause");
    eq(d.causes[0].cause, "ses_sandbox", "and it is correctly identified as the sandbox");
    eq(d.causes[0].count, 6, "with the real count");
    ok(/production access/i.test(d.causes[0].action), "the action names the actual fix");
    ok(/us-east-2/i.test(d.causes[0].action), "and names the region, which is where people get it wrong");
    ok(/sandbox/i.test(d.headline), "the headline says what is wrong without needing to expand anything");
    ok(d.causes[0].recipients.every((r) => r.includes("***")), "recipient addresses are masked");
}
{
    const d = diagnose([
        { status: "failed", to_email: "a@b.com", error: "NOTIFY_PROVIDER not set" },
        { status: "failed", to_email: "c@d.com", error: "invalid recipient" },
    ]);
    eq(d.causes.length, 2, "different causes stay separate");
    const kinds = d.causes.map((c) => c.cause).sort();
    ok(kinds.includes("not_configured"), "a missing provider is identified");
    ok(kinds.includes("bad_address"), "a bad address is identified");
}
{
    const d = diagnose([{ status: "failed", to_email: "a@b.com", error: "something nobody predicted" }]);
    eq(d.causes[0].cause, "other", "an unrecognised error still reports rather than vanishing");
    ok(d.causes[0].sample_error.includes("nobody predicted"), "and carries the real text");
}

console.log(`\nnotification flush: ${pass} passed, ${fail} failed`);
if (fail) {
    console.log("\nFAILED:");
    for (const f of failures) console.log("  · " + f);
    process.exit(1);
}
