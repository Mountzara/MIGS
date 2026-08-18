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

console.log(`orders: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
