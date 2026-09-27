#!/usr/bin/env node
// Deploy gate: the result-tracking safety net. Every assertion here is a
// failure mode that ends in a missed result, so a red run blocks deploy.
import o from "../functions/_lib/orders.js";

let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) pass++; else { fail++; console.error("FAIL:", name); } };
const DAY = 86400000;
const NOW = 1_800_000_000_000;

// --- due dates -------------------------------------------------------
t("stat lab due in 1 day", o.resultDueAt("lab", "stat", NOW) === NOW + DAY);
t("routine lab due in 5 days", o.resultDueAt("lab", "routine", NOW) === NOW + 5 * DAY);
t("routine imaging due in 10 days", o.resultDueAt("imaging", "routine", NOW) === NOW + 10 * DAY);
t("routine referral due in 30 days", o.resultDueAt("referral", "routine", NOW) === NOW + 30 * DAY);
t("unknown type falls back to lab", o.resultDueAt("bogus", "routine", NOW) === NOW + 5 * DAY);
t("unknown priority falls back to routine", o.resultDueAt("lab", "bogus", NOW) === NOW + 5 * DAY);

// --- overdue ---------------------------------------------------------
const open = { status: "placed", result_due_at: NOW - DAY };
t("open past-due order is overdue", o.isOverdue(open, NOW) === true);
t("days overdue counts", o.daysOverdue(open, NOW) === 1);
t("resulted order is never overdue", o.isOverdue({ ...open, resulted_at: NOW }, NOW) === false);
t("reviewed order is never overdue", o.isOverdue({ ...open, status: "reviewed" }, NOW) === false);
t("cancelled order is never overdue", o.isOverdue({ ...open, status: "cancelled" }, NOW) === false);
t("future due date is not overdue", o.isOverdue({ status: "placed", result_due_at: NOW + DAY }, NOW) === false);
t("missing due date is not overdue", o.isOverdue({ status: "placed" }, NOW) === false);

// --- critical results ------------------------------------------------
const crit = { result_status: "critical", received_at: NOW - 3600000 };
t("unacked critical flagged", o.criticalUnacknowledged(crit, NOW) === true);
t("acked critical not flagged", o.criticalUnacknowledged({ ...crit, acknowledged_at: NOW }, NOW) === false);
t("critical under 4h not yet overdue", o.criticalOverdue(crit, NOW) === false);
t("critical over 4h is overdue", o.criticalOverdue({ ...crit, received_at: NOW - 5 * 3600000 }, NOW) === true);
t("normal result never critical", o.criticalUnacknowledged({ result_status: "normal", received_at: NOW }, NOW) === false);

// --- the second duty: telling the patient ----------------------------
t("acked abnormal with no communication flags", o.needsPatientCommunication({ result_status: "abnormal", acknowledged_at: NOW }) === true);
t("communicated abnormal does not flag", o.needsPatientCommunication({ result_status: "abnormal", acknowledged_at: NOW, patient_communicated_at: NOW }) === false);
t("unacked result does not yet flag communication", o.needsPatientCommunication({ result_status: "abnormal" }) === false);
t("normal result needs no communication chase", o.needsPatientCommunication({ result_status: "normal", acknowledged_at: NOW }) === false);

// --- escalation ranking ----------------------------------------------
t("critical overdue outranks everything",
  o.escalationLevel(open, [{ result_status: "critical", received_at: NOW - 6 * 3600000 }], NOW).level === 5);
t("fresh critical is level 4",
  o.escalationLevel(open, [crit], NOW).level === 4);
t("7+ days overdue is level 3",
  o.escalationLevel({ status: "placed", result_due_at: NOW - 8 * DAY }, [], NOW).level === 3);
t("newly overdue is level 2", o.escalationLevel(open, [], NOW).level === 2);
t("resulted but unreviewed is level 1",
  o.escalationLevel({ status: "resulted", resulted_at: NOW, result_due_at: NOW + DAY }, [], NOW).level === 1);
t("closed order is level 0",
  o.escalationLevel({ status: "reviewed", reviewed_at: NOW }, [], NOW).level === 0);

// --- status machine --------------------------------------------------
t("draft -> placed allowed", o.canTransition("draft", "placed") === true);
t("draft -> reviewed refused", o.canTransition("draft", "reviewed") === false);
t("resulted -> reviewed allowed", o.canTransition("resulted", "reviewed") === true);
t("cancelled is terminal", o.canTransition("cancelled", "placed") === false);
t("reviewed reopens on a new result", o.canTransition("reviewed", "in_progress") === true);
t("unknown status refused", o.canTransition("placed", "banana") === false);

// --- order validation ------------------------------------------------
const goodLab = { patient_id: "p1", order_type: "lab", indication: "pelvic pain", icd10: ["R10.2"], tests: [{ code: "80053", name: "CMP" }] };
t("complete lab order validates", o.validateOrder(goodLab).ok === true);
t("missing indication caught", o.validateOrder({ ...goodLab, indication: "" }).missing.includes("clinical indication"));
t("missing dx code caught", o.validateOrder({ ...goodLab, icd10: [] }).missing.includes("diagnosis code"));
t("missing test caught", o.validateOrder({ ...goodLab, tests: [] }).missing.includes("test"));
t("imaging with no study caught", o.validateOrder({ ...goodLab, order_type: "imaging", tests: [] }).missing.includes("study"));
const ref = { patient_id: "p1", order_type: "referral", indication: "fibroids", icd10: ["D25.9"], specialty: "IR", consult_question: "UAE candidacy?" };
t("complete referral validates", o.validateOrder(ref).ok === true);
t("referral without consult question caught", o.validateOrder({ ...ref, consult_question: "" }).missing.includes("consult question"));
t("referral without specialty caught", o.validateOrder({ ...ref, specialty: "" }).missing.includes("specialty"));
t("empty order rejected", o.validateOrder(null).ok === false);

// --- the sweep: what the cron job should act on ----------------------
const mk = (id, over, notified) => ({ id, status: "placed", result_due_at: over ? NOW - 2 * DAY : NOW + DAY,
                                      overdue_notified_at: notified ? NOW - DAY : null });
const rmap = new Map();
const plan1 = o.sweepPlan([mk("a", true, false), mk("b", true, true), mk("c", false, false)], rmap, NOW);
t("newly overdue separated from already-flagged", plan1.counts.newly_overdue === 1 && plan1.counts.still_overdue === 1);
t("not-yet-due order is not swept", plan1.counts.newly_overdue + plan1.counts.still_overdue === 2);
t("a newly overdue order triggers notification", plan1.notify === true);

const plan2 = o.sweepPlan([mk("b", true, true)], new Map(), NOW);
t("only already-flagged overdue does NOT re-notify", plan2.notify === false);
t("but it is still reported", plan2.counts.still_overdue === 1);

const critMap = new Map([["a", [{ id: "r1", result_status: "critical", received_at: NOW - 3600000 }]]]);
const plan3 = o.sweepPlan([mk("a", false, false)], critMap, NOW);
t("unacknowledged critical always notifies", plan3.notify === true);
t("critical counted even when the order is not overdue", plan3.counts.critical_unacknowledged === 1);

const toldMap = new Map([["a", [{ id: "r1", result_status: "abnormal", acknowledged_at: NOW }]]]);
const plan4 = o.sweepPlan([mk("a", false, false)], toldMap, NOW);
t("un-communicated result is reported", plan4.counts.awaiting_patient_communication === 1);
t("but does not alone trigger an alert email", plan4.notify === false);
t("closed orders are excluded from the sweep",
  o.sweepPlan([{ id: "z", status: "reviewed", result_due_at: NOW - 5 * DAY }], new Map(), NOW).counts.newly_overdue === 0);
t("empty input is safe", o.sweepPlan(null, null, NOW).notify === false);

// --- digest copy: counts only, never content -------------------------
const dig = o.digestText({ critical_unacknowledged: 1, newly_overdue: 2, still_overdue: 3, awaiting_patient_communication: 4 });
t("digest names each category", dig.length === 4);
t("digest leads with the critical line", /critical/.test(dig[0]));
t("digest carries no patient identifiers", dig.every(l => !/@|patient_|[A-Z][a-z]+ [A-Z][a-z]+/.test(l)));
t("digest omits empty categories", o.digestText({ critical_unacknowledged: 0, newly_overdue: 1, still_overdue: 0, awaiting_patient_communication: 0 }).length === 1);
t("nothing to say is an empty digest", o.digestText({ critical_unacknowledged: 0, newly_overdue: 0, still_overdue: 0, awaiting_patient_communication: 0 }).length === 0);

console.log(`orders: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
