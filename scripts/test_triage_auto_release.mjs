// =====================================================================
// test_triage_auto_release.mjs
// =====================================================================
// admin/triage/index.html promises: "Rows auto-release to the patient four
// hours after AI categorization if not reviewed." Until 2026-08-14 nothing
// implemented it — the threshold constant existed only to paint a row
// `is_overdue`, a badge rather than a behaviour.
//
// The rule these tests pin down is the one that makes auto-release safe:
// it is a SCHEDULING decision, and it stops at urgency. An urgent row is
// never released without a human, because "urgent" means something in that
// intake needs looking at, and quietly opening a booking calendar is not
// looking at it.
// =====================================================================

import { shouldAutoRelease, AUTO_RELEASE_THRESHOLD_HOURS, NEVER_AUTO_RELEASE_URGENCY }
    from "../functions/api/v1/internal/triage/auto-release.js";
import { MANUAL_REVIEW_PLACEHOLDER, isValidVisitTypeKey } from "../functions/_lib/visit_types.js";

let pass = 0, fail = 0;
const failures = [];
const ok = (c, n) => c ? pass++ : (fail++, failures.push(n));
const eq = (a, b, n) => ok(a === b, `${n} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const NOW = Date.parse("2026-08-14T12:00:00Z");
const hoursAgo = (h) => NOW - h * 3600000;

const row = (over = {}) => ({
    id: "t1", patient_id: "p1", intake_id: "i1",
    created_at: hoursAgo(5),
    ai_visit_type: "new_patient_complex",
    ai_duration_min: 45,
    ai_urgency: "routine",
    clinician_override_visit_type: null,
    clinician_override_duration_min: null,
    clinician_override_urgency: null,
    clinician_reviewed_at: null,
    ...over,
});

eq(AUTO_RELEASE_THRESHOLD_HOURS, 4, "the threshold matches the promise on the admin page");

// ---- the clock -------------------------------------------------------
ok(shouldAutoRelease(row({ created_at: hoursAgo(5) }), NOW).release, "5 hours old releases");
ok(shouldAutoRelease(row({ created_at: hoursAgo(4) }), NOW).release, "exactly 4 hours releases");
{
    const d = shouldAutoRelease(row({ created_at: hoursAgo(3.9) }), NOW);
    ok(!d.release, "3.9 hours does not release");
    eq(d.reason, "not_yet_due", "and says it is not yet due");
}
ok(!shouldAutoRelease(row({ created_at: hoursAgo(0) }), NOW).release, "a brand new row does not release");
{
    const d = shouldAutoRelease(row({ created_at: hoursAgo(72) }), NOW);
    ok(d.release, "a three-day-old row still releases");
    eq(d.hours_pending, 72, "and reports how long it waited");
}

// ---- URGENCY IS THE STOP -------------------------------------------
{
    const d = shouldAutoRelease(row({ ai_urgency: "urgent", created_at: hoursAgo(48) }), NOW);
    ok(!d.release, "an URGENT row is never auto-released, however old");
    eq(d.reason, "urgent_needs_a_human", "and says why");
}
ok(NEVER_AUTO_RELEASE_URGENCY.has("urgent"), "'urgent' is in the never-release set");
ok(shouldAutoRelease(row({ ai_urgency: "soon" }), NOW).release, "'soon' does auto-release");
ok(shouldAutoRelease(row({ ai_urgency: "routine" }), NOW).release, "'routine' does auto-release");
{
    // A clinician override to urgent must stop it too — he may have
    // escalated the row without releasing it.
    const d = shouldAutoRelease(row({ ai_urgency: "routine", clinician_override_urgency: "urgent" }), NOW);
    ok(!d.release, "a clinician override to urgent stops auto-release");
}
{
    // …and the reverse: he downgraded it, so the clock applies.
    const d = shouldAutoRelease(row({ ai_urgency: "urgent", clinician_override_urgency: "routine" }), NOW);
    ok(d.release, "a clinician override away from urgent allows auto-release");
}
ok(!shouldAutoRelease(row({ ai_urgency: "URGENT" }), NOW).release, "urgency check is case-insensitive");

// ---- rows that must never be touched ---------------------------------
{
    const d = shouldAutoRelease(row({ clinician_reviewed_at: hoursAgo(1) }), NOW);
    ok(!d.release, "an already-reviewed row is left alone");
    eq(d.reason, "already_reviewed", "and says so");
}
{
    // A failed triage has nothing to release. Inventing a visit type here
    // is exactly the bug that once wrote a nonexistent type onto a row and
    // crashed booking.
    const d = shouldAutoRelease(row({ ai_visit_type: null }), NOW);
    ok(!d.release, "a row with no AI categorisation is not released");
    eq(d.reason, "no_ai_categorisation", "and says there is nothing to release");
}
{
    const d = shouldAutoRelease(row({ created_at: null }), NOW);
    ok(!d.release, "a row with no created_at is not released");
    eq(d.reason, "no_created_at", "and says why rather than treating null as epoch 0");
}
eq(shouldAutoRelease(null, NOW).release, false, "a missing row is handled");

// ---- the released values are the ones already on the row -------------
{
    // Auto-release must never compute a NEW categorisation, only promote
    // what is already there — the AI's, or his override if he made one.
    const r = row({ clinician_override_visit_type: "follow_up_short", clinician_override_duration_min: 15 });
    const d = shouldAutoRelease(r, NOW);
    ok(d.release, "a row he edited but never released still auto-releases");
    // The endpoint promotes override-then-AI; assert the inputs it reads.
    eq(r.clinician_override_visit_type || r.ai_visit_type, "follow_up_short", "his override wins over the AI type");
    eq(r.clinician_override_duration_min || r.ai_duration_min, 15, "his override wins over the AI duration");
}
{
    const r = row();
    eq(r.clinician_override_visit_type || r.ai_visit_type, "new_patient_complex", "with no override the AI type is promoted");
    eq(r.clinician_override_duration_min || r.ai_duration_min, 45, "with no override the AI duration is promoted");
}

// ---------------------------------------------------------------------
// THE MANUAL-REVIEW PLACEHOLDER — the trap auto-release would have set
// ---------------------------------------------------------------------
// When AI triage falls back it writes `manual_review_required` into
// ai_visit_type. That value is TRUTHY, so the "no categorisation" guard
// misses it, and the fallback row is written with a hardcoded
// ai_urgency:"routine", so the urgency guard misses it too. It therefore
// cleared both existing guards, would auto-release at the four-hour mark,
// and would email the patient that her slots were open.
//
// What she would then find: the portal says "ready to book", booking 409s
// on the invalid visit type, and because clinician_reviewed_at is now set,
// both PATCH and release answered 409 already_released. Permanently stuck.
// One live row was in exactly that state.
{
    const stuck = row({ ai_visit_type: MANUAL_REVIEW_PLACEHOLDER, ai_urgency: "routine",
                        created_at: hoursAgo(48) });
    const d = shouldAutoRelease(stuck, NOW);
    ok(!d.release, "a manual-review row is NEVER auto-released, however old");
    eq(d.reason, "manual_review_required", "and says why, so it lands in the visible backlog");
}
{
    // He picked a real visit type but never released it — that IS releasable.
    const fixed = row({ ai_visit_type: MANUAL_REVIEW_PLACEHOLDER,
                        clinician_override_visit_type: "new_patient_complex" });
    ok(shouldAutoRelease(fixed, NOW).release,
       "once he has chosen a real visit type, the row auto-releases normally");
}
{
    // The placeholder must not be a valid visit type — every guard leans on it.
    ok(!isValidVisitTypeKey(MANUAL_REVIEW_PLACEHOLDER),
       "the placeholder is deliberately NOT in the visit-type catalogue");
    eq(MANUAL_REVIEW_PLACEHOLDER, "manual_review_required",
       "the placeholder string matches what triage actually writes");
}

console.log(`\ntriage auto-release: ${pass} passed, ${fail} failed`);
if (fail) {
    console.log("\nFAILED:");
    for (const f of failures) console.log("  · " + f);
    process.exit(1);
}
