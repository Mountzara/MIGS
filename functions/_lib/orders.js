// =====================================================================
// orders.js — lab / imaging / referral orders and the result-tracking loop
// =====================================================================
// THE POINT OF THIS FILE. An independent telehealth practice does not get
// sued because it lacks a hospital affiliation. It gets sued because an
// order was placed and the result never came back, and nothing anywhere
// said so. Everything here exists to make that silence LOUD:
//
//   * every order carries result_due_at from the moment it is placed;
//   * `isOverdue()` is a pure function of the clock, so the sweep cannot
//     drift from what the UI shows;
//   * a critical result has its OWN clock, separate from the order's;
//   * acknowledging a result and COMMUNICATING it to the patient are two
//     different duties with two different timestamps, because clinicians
//     conflate them and plaintiffs do not.
//
// Pure functions only — no DB, no fetch — so the escalation rules are
// unit-testable without a network. scripts/test_orders.mjs is a deploy
// gate over exactly these.
// =====================================================================

export const ORDER_TYPES = ["lab", "imaging", "referral"];
export const PRIORITIES = ["routine", "urgent", "stat"];

// Lifecycle. `resulted` means something came back; `reviewed` means the
// clinician looked at it. An order is NOT closed until it is reviewed —
// a result sitting unread in an inbox is the classic failure.
export const ORDER_STATUSES = [
    "draft", "placed", "in_progress", "resulted", "reviewed", "cancelled",
];

const ALLOWED_TRANSITIONS = {
    draft:       ["placed", "cancelled"],
    placed:      ["in_progress", "resulted", "cancelled"],
    in_progress: ["resulted", "cancelled"],
    resulted:    ["reviewed", "in_progress"],   // back to in_progress: addendum/repeat
    reviewed:    ["in_progress"],               // a later result reopens it
    cancelled:   [],
};

export function canTransition(from, to) {
    if (!ORDER_STATUSES.includes(to)) return false;
    return (ALLOWED_TRANSITIONS[from] || []).includes(to);
}

// How long before an unresulted order is considered overdue. These are
// TURNAROUND expectations, not clinical claims: a routine outpatient
// chemistry panel resulting in a day, advanced imaging in a few, a
// specialist consult note in a few weeks. They are deliberately generous
// — the goal is to catch the order that fell on the floor, not to nag.
const DUE_DAYS = {
    lab:      { stat: 1, urgent: 2, routine: 5 },
    imaging:  { stat: 1, urgent: 3, routine: 10 },
    referral: { stat: 3, urgent: 7, routine: 30 },
};
const DAY_MS = 86400000;

export function resultDueAt(orderType, priority, placedAtMs) {
    const t = DUE_DAYS[orderType] ? orderType : "lab";
    const p = PRIORITIES.includes(priority) ? priority : "routine";
    const base = Number(placedAtMs) || 0;
    return base + DUE_DAYS[t][p] * DAY_MS;
}

export function isOpen(order) {
    return order && !["reviewed", "cancelled"].includes(String(order.status || ""));
}

export function isOverdue(order, nowMs) {
    if (!isOpen(order)) return false;
    if (order.resulted_at) return false;            // it arrived; the clock stops
    const due = Number(order.result_due_at) || 0;
    return due > 0 && nowMs > due;
}

export function daysOverdue(order, nowMs) {
    if (!isOverdue(order, nowMs)) return 0;
    return Math.floor((nowMs - Number(order.result_due_at)) / DAY_MS);
}

// A critical result that nobody has acknowledged is the most dangerous
// row in the database. It escalates on a clock measured in HOURS, and it
// outranks every other signal in the UI.
const CRITICAL_ACK_HOURS = 4;

export function criticalUnacknowledged(result, nowMs) {
    if (!result || String(result.result_status) !== "critical") return false;
    if (result.acknowledged_at) return false;
    return nowMs >= Number(result.received_at || 0);
}

export function criticalOverdue(result, nowMs) {
    if (!criticalUnacknowledged(result, nowMs)) return false;
    return nowMs - Number(result.received_at || 0) > CRITICAL_ACK_HOURS * 3600000;
}

// An acknowledged result whose patient was never told is a second, quieter
// failure — the clinician "handled" it and the patient still does not know.
export function needsPatientCommunication(result) {
    if (!result) return false;
    if (!result.acknowledged_at) return false;
    if (result.patient_communicated_at) return false;
    return ["abnormal", "critical"].includes(String(result.result_status));
}

// One ranked signal for the board, so the most dangerous row sorts first
// and nothing depends on a human scanning a list.
export function escalationLevel(order, results, nowMs) {
    const rs = Array.isArray(results) ? results : [];
    if (rs.some(r => criticalOverdue(r, nowMs))) return { level: 5, label: "CRITICAL unacknowledged" };
    if (rs.some(r => criticalUnacknowledged(r, nowMs))) return { level: 4, label: "critical result in" };
    if (isOverdue(order, nowMs) && daysOverdue(order, nowMs) >= 7) return { level: 3, label: "no result — 7+ days" };
    if (isOverdue(order, nowMs)) return { level: 2, label: "no result — overdue" };
    if (rs.some(needsPatientCommunication)) return { level: 2, label: "patient not told" };
    if (isOpen(order) && order.resulted_at && !order.reviewed_at) return { level: 1, label: "awaiting review" };
    return { level: 0, label: "" };
}

// What a sweep should do about the current state, as a pure decision so
// the cron job and the board can never disagree about what is wrong.
//
// The digest is deliberately CONTENT-FREE — counts and a link, no patient
// names, no test names, no results. It goes to the practice inbox, which
// is ordinary email; the detail lives behind admin authentication. An
// alert that leaks the finding it is alerting about is a breach with a
// good excuse.
export function sweepPlan(orders, resultsByOrder, nowMs) {
    const list = Array.isArray(orders) ? orders : [];
    const get = (id) => (resultsByOrder && resultsByOrder.get ? (resultsByOrder.get(id) || []) : []);

    const newlyOverdue = [];      // overdue and never yet flagged
    const stillOverdue = [];      // overdue, already flagged once
    const criticalUnacked = [];
    const awaitingCommunication = [];

    for (const o of list) {
        if (!isOpen(o)) continue;
        const rs = get(o.id);
        if (isOverdue(o, nowMs)) {
            (o.overdue_notified_at ? stillOverdue : newlyOverdue).push(o);
        }
        for (const r of rs) {
            if (criticalUnacknowledged(r, nowMs)) criticalUnacked.push({ order: o, result: r });
            else if (needsPatientCommunication(r)) awaitingCommunication.push({ order: o, result: r });
        }
    }
    // Escalate only when something is NEW or dangerous. A daily email that
    // repeats yesterday's numbers gets filtered, and then the one that
    // matters gets filtered with it.
    const notify = criticalUnacked.length > 0 || newlyOverdue.length > 0;
    return {
        notify,
        newly_overdue: newlyOverdue,
        still_overdue: stillOverdue,
        critical_unacknowledged: criticalUnacked,
        awaiting_patient_communication: awaitingCommunication,
        counts: {
            newly_overdue: newlyOverdue.length,
            still_overdue: stillOverdue.length,
            critical_unacknowledged: criticalUnacked.length,
            awaiting_patient_communication: awaitingCommunication.length,
        },
    };
}

// The digest wording. Separated from the sweep so the copy is testable and
// so nothing patient-identifying can drift into it later.
export function digestText(counts) {
    const lines = [];
    if (counts.critical_unacknowledged > 0) {
        lines.push(`${counts.critical_unacknowledged} critical result(s) have not been acknowledged.`);
    }
    if (counts.newly_overdue > 0) {
        lines.push(`${counts.newly_overdue} order(s) have passed their expected result date with nothing back.`);
    }
    if (counts.still_overdue > 0) {
        lines.push(`${counts.still_overdue} previously flagged order(s) are still waiting.`);
    }
    if (counts.awaiting_patient_communication > 0) {
        lines.push(`${counts.awaiting_patient_communication} reviewed result(s) have not yet been discussed with the patient.`);
    }
    return lines;
}

// An order that cannot be acted on. The performing facility rejects an
// order missing any of these, and an order without an indication is not
// defensible in the record even when the facility accepts it.
export function validateOrder(o) {
    const missing = [];
    if (!o || !o.patient_id) missing.push("patient");
    if (!ORDER_TYPES.includes(String(o?.order_type))) missing.push("order type");
    if (!o?.indication || String(o.indication).trim().length < 3) missing.push("clinical indication");
    const icd = Array.isArray(o?.icd10) ? o.icd10.filter(Boolean) : [];
    if (icd.length === 0) missing.push("diagnosis code");
    if (o?.order_type === "referral") {
        if (!o?.specialty) missing.push("specialty");
        if (!o?.consult_question) missing.push("consult question");
    } else {
        const tests = Array.isArray(o?.tests) ? o.tests.filter(Boolean) : [];
        if (tests.length === 0) missing.push(o?.order_type === "imaging" ? "study" : "test");
    }
    return { ok: missing.length === 0, missing };
}

export default {
    ORDER_TYPES, PRIORITIES, ORDER_STATUSES, canTransition, resultDueAt,
    isOpen, isOverdue, daysOverdue, criticalUnacknowledged, criticalOverdue,
    needsPatientCommunication, escalationLevel, validateOrder, sweepPlan, digestText,
};
