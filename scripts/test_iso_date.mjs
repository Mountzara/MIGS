// =====================================================================
// test_iso_date.mjs
// =====================================================================
// The bug: three endpoints each carried
//     /^\d{4}-\d{2}-\d{2}$/
// and called it a date check. These assert the cases that regex waves
// through — impossible days, impossible months, and a window with no
// ceiling.
// =====================================================================

import { isIsoDate, isLoggableDate, daysBetween, checkWindow, todayIso }
    from "../functions/_lib/iso_date.js";

let pass = 0, fail = 0;
const failures = [];
const ok = (c, n) => c ? pass++ : (fail++, failures.push(n));
const eq = (a, b, n) => ok(a === b, `${n} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

// ---- real dates ------------------------------------------------------
for (const d of ["2026-01-01", "2026-12-31", "2024-02-29", "2000-02-29", "1999-06-15"]) {
    ok(isIsoDate(d), `accepts real date ${d}`);
}

// ---- the ones the old regex accepted --------------------------------
for (const d of ["2026-02-31", "2026-02-30", "2026-04-31", "2026-13-01", "2026-00-10",
                 "2026-01-00", "2026-01-32", "2025-02-29", "1900-02-29"]) {
    ok(!isIsoDate(d), `rejects impossible date ${d}`);
}
ok(!isIsoDate("2023-02-29"), "rejects Feb 29 in a non-leap year");
ok(isIsoDate("2020-02-29"), "accepts Feb 29 in a leap year");
ok(!isIsoDate("2100-02-29"), "rejects Feb 29 in a century non-leap year");

// ---- mis-shaped ------------------------------------------------------
for (const d of ["", null, undefined, 20260101, "2026-1-1", "26-01-01", "2026/01/01",
                 "2026-01-01T00:00:00Z", "2026-01-01 ", " 2026-01-01", "not-a-date"]) {
    ok(!isIsoDate(d), `rejects mis-shaped ${JSON.stringify(d)}`);
}

// ---- future dates ----------------------------------------------------
const today = todayIso();
ok(isLoggableDate(today), "today is loggable");
ok(isLoggableDate("2020-05-05"), "the past is loggable");
{
    const far = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);
    ok(!isLoggableDate(far), "40 days out is not loggable");
    const nextYear = `${new Date().getUTCFullYear() + 1}-06-01`;
    ok(!isLoggableDate(nextYear), "next year is not loggable");
    ok(!isLoggableDate("2062-03-14"), "a mistyped year is not loggable");
    // One day of grace for patients west of UTC.
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    ok(isLoggableDate(tomorrow), "tomorrow is allowed (timezone grace)");
    ok(!isLoggableDate("2026-02-31"), "an impossible date is never loggable");
}

// ---- day arithmetic --------------------------------------------------
eq(daysBetween("2026-01-01", "2026-01-01"), 1, "one day is inclusive");
eq(daysBetween("2026-01-01", "2026-01-31"), 31, "January is 31 days");
eq(daysBetween("2024-02-01", "2024-03-01"), 30, "leap February spans correctly");

// ---- windows ---------------------------------------------------------
{
    const w = checkWindow("2026-01-01", "2026-01-30");
    ok(w.ok, "a 30-day window is fine");
    eq(w.days, 30, "30-day window counted");
}
eq(checkWindow("2026-02-31", "2026-03-05").error, "invalid_from", "impossible from is rejected");
eq(checkWindow("2026-01-01", "2026-02-31").error, "invalid_to", "impossible to is rejected");
eq(checkWindow("2026-03-05", "2026-01-01").error, "invalid_window", "reversed window is rejected");
{
    // The reported case: ?from=1900-01-01 → 46k points, 1.6MB.
    const w = checkWindow("1900-01-01", "2026-08-13");
    eq(w.ok, false, "a 126-year window is refused");
    eq(w.error, "window_too_large", "and says why");
    ok(w.days > 46000, `and reports the size (${w.days} days)`);
    eq(w.max_days, 400, "and states the limit so the client can page");
}
{
    const w = checkWindow("2026-01-01", "2027-02-04", 400);
    eq(w.ok, true, "exactly 400 days is allowed");
    eq(w.days, 400, "400 counted");
}
{
    const w = checkWindow("2026-01-01", "2027-02-05", 400);
    eq(w.ok, false, "401 days is refused");
}

console.log(`\niso date: ${pass} passed, ${fail} failed`);
if (fail) {
    console.log("\nFAILED:");
    for (const f of failures) console.log("  · " + f);
    process.exit(1);
}
