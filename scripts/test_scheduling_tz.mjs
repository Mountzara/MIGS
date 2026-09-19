// =====================================================================
// test_scheduling_tz.mjs — appointment times mean what the clinic means
// =====================================================================
// EVERY SLOT EVER OFFERED WAS FIVE HOURS EARLY.
//
// dateStringToMs() took an `offsetMinutesUTC` that defaulted to null →
// zero, and neither caller passed it. A 9:00 a.m. availability block was
// therefore stored and offered as 09:00 UTC — 4:00 a.m. in Chicago. A live
// probe of /api/v1/patient/appointments/available returned 197 slots whose
// first starts_at was 09:45Z, and the one booked appointment sat at 4:00 am.
//
// It survived because the two surfaces disagree BY CONSTRUCTION: the admin
// page formats minute-of-day arithmetically and read a correct "09:00",
// while the patient's page formats the epoch and read "4:45 AM". Neither
// could see the other's number, so nothing looked wrong to anyone.
//
// These tests pin the conversion in both directions and across the DST
// boundary, which is the case a fixed -300 constant gets wrong twice a year.
// =====================================================================

import { dateStringToMs, practiceOffsetMinutes, msToDateString, PRACTICE_TZ }
    from "../functions/_lib/scheduling.js";

let pass = 0, fail = 0;
const failures = [];
const ok = (c, n) => c ? pass++ : (fail++, failures.push(n));
const eq = (a, b, n) => ok(a === b, `${n} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const iso = (ms) => new Date(ms).toISOString();

eq(PRACTICE_TZ, "America/Chicago", "the practice timezone is stated, not implied");

// ---- the assertion the audit named -----------------------------------
eq(iso(dateStringToMs("2026-08-18", 540)), "2026-08-18T14:00:00.000Z",
   "9:00 a.m. on an August weekday is 14:00Z (CDT, UTC-5)");

// ---- DST, both sides and both transitions ----------------------------
eq(iso(dateStringToMs("2026-01-15", 540)), "2026-01-15T15:00:00.000Z",
   "9:00 a.m. in January is 15:00Z (CST, UTC-6)");
eq(iso(dateStringToMs("2026-07-04", 540)), "2026-07-04T14:00:00.000Z",
   "9:00 a.m. in July is 14:00Z");
// 2026: DST starts Mar 8, ends Nov 1. A fixed -300 breaks on both.
eq(iso(dateStringToMs("2026-03-07", 540)), "2026-03-07T15:00:00.000Z",
   "the day BEFORE DST starts is still CST");
eq(iso(dateStringToMs("2026-03-09", 540)), "2026-03-09T14:00:00.000Z",
   "the day AFTER DST starts is CDT");
eq(iso(dateStringToMs("2026-10-31", 540)), "2026-10-31T14:00:00.000Z",
   "the day BEFORE DST ends is still CDT");
eq(iso(dateStringToMs("2026-11-02", 540)), "2026-11-02T15:00:00.000Z",
   "the day AFTER DST ends is CST — the case a fixed -300 constant gets wrong");

// ---- offsets -----------------------------------------------------------
eq(practiceOffsetMinutes("2026-08-18"), 300, "summer offset is +300 (wall clock + 300 = UTC)");
eq(practiceOffsetMinutes("2026-01-15"), 360, "winter offset is +360");
ok(practiceOffsetMinutes("2026-08-18") !== practiceOffsetMinutes("2026-01-15"),
   "the offset is per-date, not a constant");

// ---- business hours land where a human expects -------------------------
{
    // The practice's real blocks: 9-12 and 13-17 wall clock.
    const day = "2026-08-18";
    const checks = [[540, 14], [720, 17], [780, 18], [1020, 22]];   // 17:00 CDT = 22:00Z
    for (const [minute, expectUtcHour] of checks) {
        const d = new Date(dateStringToMs(day, minute));
        eq(d.getUTCHours(), expectUtcHour,
           `minute ${minute} (${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")} local) is ${expectUtcHour}:00Z`);
    }
    // And none of them lands before dawn, which is the bug's signature.
    for (const [minute] of checks) {
        const local = new Date(dateStringToMs(day, minute))
            .toLocaleTimeString("en-US", { timeZone: PRACTICE_TZ, hour: "numeric", hour12: false });
        const h = parseInt(local, 10);
        ok(h >= 8 && h <= 18, `minute ${minute} renders at ${h}:00 practice time — inside business hours`);
    }
}

// ---- an explicit offset still wins -------------------------------------
eq(iso(dateStringToMs("2026-08-18", 540, 0)), "2026-08-18T09:00:00.000Z",
   "an explicitly-passed offset is honoured, so callers with their own timezone still work");
eq(iso(dateStringToMs("2026-08-18", 540, 360)), "2026-08-18T15:00:00.000Z",
   "an explicit non-practice offset is honoured");

// ---- round trip --------------------------------------------------------
{
    const ms = dateStringToMs("2026-08-18", 540);
    eq(msToDateString(ms), "2026-08-18", "the UTC date of a morning slot is still the same calendar day");
    // 5:00 p.m. CDT is 22:00Z — still the same UTC day. 7pm would not be,
    // which is why the booking page pins its DATE formatting to the
    // practice zone too.
    eq(msToDateString(dateStringToMs("2026-08-18", 1020)), "2026-08-18",
       "the last business-hours slot has not rolled into the next UTC day");
}

// ---- malformed input ---------------------------------------------------
ok(Number.isFinite(dateStringToMs("2026-08-18", 0)), "midnight is a finite instant");
eq(practiceOffsetMinutes("not-a-date"), 0, "an unparseable date yields 0 rather than NaN");

console.log(`\nscheduling timezone: ${pass} passed, ${fail} failed`);
if (fail) {
    console.log("\nFAILED:");
    for (const f of failures) console.log("  · " + f);
    process.exit(1);
}
