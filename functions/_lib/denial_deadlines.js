// denial_deadlines.js — appeal/filing deadlines AS DATA, never as prose.
//
// WHY THIS EXISTS (2026-08-12): billing_appeal.js emitted
//   deadline_note: "commonly 90-180 days from the remittance date; Medicare
//                   redetermination is 120 days"
// — a sentence a human had to read, act on, and remember. A missed appeal
// window is the ONLY unrecoverable failure in the whole billing pipeline:
// a winnable claim becomes permanently unwinnable at midnight. It is also
// pure calendar math, so it is the safest thing in the system to automate.
//
// THE PROVENANCE RULE: a window is used ONLY when the payer row carries a
// source_url + verified_on. There is deliberately NO hardcoded fallback table
// of "typical" windows — guessing 90 days when the payer says 60 produces a
// confidently-computed WRONG due date, which is worse than no date at all.
// An unverified payer yields { due: null, reason: 'unverified' } and the
// watcher escalates to the physician instead of inventing a deadline.

/** Days between two ISO dates (date-only, UTC-safe). */
export function daysBetween(fromISO, toISO) {
    const a = Date.parse(`${String(fromISO).slice(0, 10)}T00:00:00Z`);
    const b = Date.parse(`${String(toISO).slice(0, 10)}T00:00:00Z`);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return Math.round((b - a) / 86400000);
}

/** Add whole days to an ISO date, returning YYYY-MM-DD. */
export function addDays(isoDate, days) {
    const t = Date.parse(`${String(isoDate).slice(0, 10)}T00:00:00Z`);
    if (!Number.isFinite(t) || !Number.isFinite(days)) return null;
    return new Date(t + days * 86400000).toISOString().slice(0, 10);
}

/**
 * Resolve the deadline row for a claim's payer: exact payer row first, then
 * the payer_kind default. Only rows WITH a source_url count as verified.
 */
export async function loadPayerDeadlines(env, { payer_id, payer_kind }) {
    if (!env || !env.DB) return null;
    const byPayer = payer_id
        ? await env.DB.prepare(
            `SELECT * FROM billing_payer_deadlines
              WHERE payer_id = ? AND source_url IS NOT NULL AND source_url <> ''
              ORDER BY verified_on DESC LIMIT 1`
        ).bind(payer_id).first().catch(() => null)
        : null;
    if (byPayer) return byPayer;
    if (!payer_kind) return null;
    return await env.DB.prepare(
        `SELECT * FROM billing_payer_deadlines
          WHERE payer_id IS NULL AND payer_kind = ?
            AND source_url IS NOT NULL AND source_url <> ''
          ORDER BY verified_on DESC LIMIT 1`
    ).bind(payer_kind).first().catch(() => null);
}

const WINDOW_COLUMN = {
    appeal: "appeal_level1_days",
    appeal_level2: "appeal_level2_days",
    external_review: "external_review_days",
    reconsideration: "appeal_level1_days",
    corrected_claim: "corrected_claim_days",
};

/**
 * Compute the due date for an action on a denial.
 * @returns {{due: string|null, days: number|null, source: string|null,
 *            reason: 'ok'|'unverified'|'no_denial_date'|'window_missing'}}
 */
export function computeDueDate({ deadlineRow, denialDate, strategy }) {
    if (!denialDate) return { due: null, days: null, source: null, reason: "no_denial_date" };
    if (!deadlineRow) return { due: null, days: null, source: null, reason: "unverified" };
    const col = WINDOW_COLUMN[strategy] || WINDOW_COLUMN.appeal;
    const days = Number(deadlineRow[col]);
    if (!Number.isFinite(days) || days <= 0) {
        return { due: null, days: null, source: deadlineRow.source_url || null, reason: "window_missing" };
    }
    return {
        due: addDays(denialDate, days),
        days,
        source: deadlineRow.source_url || null,
        reason: "ok",
    };
}

/**
 * Urgency for the watcher/queue. `null` due date is NOT "fine" — it is the
 * most urgent state, because the clock is running and we cannot see it.
 */
export function urgency(dueDate, todayISO) {
    if (!dueDate) return { level: "unknown_deadline", days_left: null };
    const left = daysBetween(todayISO, dueDate);
    if (left === null) return { level: "unknown_deadline", days_left: null };
    if (left < 0) return { level: "lapsed", days_left: left };
    if (left <= 7) return { level: "critical", days_left: left };
    if (left <= 21) return { level: "urgent", days_left: left };
    return { level: "normal", days_left: left };
}

export default { daysBetween, addDays, loadPayerDeadlines, computeDueDate, urgency };
