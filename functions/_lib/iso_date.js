// =====================================================================
// iso_date.js — a date check that actually checks the date
// =====================================================================
// Three endpoints each carried their own copy of
//
//     function isDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s); }
//
// which is a check on the SHAPE of the string and nothing else.
// `2026-02-31`, `2026-13-45` and `2026-00-00` all pass it. SQLite stores
// dates as TEXT and compares them lexicographically, so an impossible date
// is accepted, saved, and then sorts into the middle of the diary — and
// `2026-02-31` will never be returned by any query for February, because
// nothing else in the table has that value and no calendar produces it.
// The entry is written, acknowledged, and effectively lost.
//
// A diary date also cannot be in the future: symptoms are logged for a day
// that has happened. Without that rule a mistyped year files an entry in
// 2062, where it silently drops out of every window the portal shows.
//
// The window bound exists for a different reason — a range query with no
// ceiling is a denial-of-service on our own database and on the patient's
// phone. `?from=1900-01-01` was a 46,000-point series in a 1.6 MB JSON
// response, rendered into a chart 300 pixels wide.
// =====================================================================

const SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * True only for a real calendar date in ISO form.
 * Rejects 2026-02-31, 2026-13-01, 2026-00-10 and anything mis-shaped.
 */
export function isIsoDate(s) {
    const m = SHAPE.exec(String(s ?? ""));
    if (!m) return false;
    const [, y, mo, d] = m;
    const year = +y, month = +mo, day = +d;
    if (month < 1 || month > 12 || day < 1) return false;
    // Round-tripping through Date catches leap years without a table:
    // Date.UTC(2026, 1, 31) normalises to 2026-03-03, so the day comes
    // back different and we reject it.
    const dt = new Date(Date.UTC(year, month - 1, day));
    return dt.getUTCFullYear() === year
        && dt.getUTCMonth() === month - 1
        && dt.getUTCDate() === day;
}

/** Today, UTC, as YYYY-MM-DD. */
export function todayIso() {
    return new Date().toISOString().slice(0, 10);
}

/**
 * A diary date: real, and not in the future.
 *
 * `graceDays` allows one day ahead by default, because a patient in a
 * timezone west of UTC can legitimately be on "tomorrow" by our clock at
 * 8pm local. Rejecting that would tell them their own date is invalid.
 */
export function isLoggableDate(s, graceDays = 1) {
    if (!isIsoDate(s)) return false;
    const limit = new Date(Date.now() + graceDays * 86400000).toISOString().slice(0, 10);
    return s <= limit;
}

/** Inclusive day count between two ISO dates. */
export function daysBetween(from, to) {
    return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
}

/**
 * Validate a query window. Returns { ok, error?, days? }.
 * `maxDays` is a ceiling on what one request may ask for, not on what may
 * be stored — a patient with five years of entries can still read all of
 * it, a window at a time.
 */
export function checkWindow(from, to, maxDays = 400) {
    if (!isIsoDate(from)) return { ok: false, error: "invalid_from" };
    if (!isIsoDate(to)) return { ok: false, error: "invalid_to" };
    if (to < from) return { ok: false, error: "invalid_window" };
    const days = daysBetween(from, to);
    if (days > maxDays) {
        return { ok: false, error: "window_too_large", days, max_days: maxDays };
    }
    return { ok: true, days };
}

export default { isIsoDate, todayIso, isLoggableDate, daysBetween, checkWindow };
