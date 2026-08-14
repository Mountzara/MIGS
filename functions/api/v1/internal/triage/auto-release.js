// =====================================================================
// POST /api/v1/internal/triage/auto-release — the 4-hour promise, kept
// =====================================================================
// admin/triage/index.html tells him, in the panel he works from:
//
//   "Rows auto-release to the patient four hours after AI categorization
//    if not reviewed."
//
// Nothing did that. `AUTO_RELEASE_THRESHOLD_HOURS = 4` existed in
// admin/triage.js and was used only to paint a row `is_overdue` — a badge,
// not a behaviour. So a patient who submitted an intake at 7pm on a Friday
// waited until he opened the panel, however long that took, with no slots
// offered and nothing on screen explaining why. The sentence promising
// otherwise was on HIS screen, not theirs, so the gap was invisible from
// both sides.
//
// ---------------------------------------------------------------------
// WHY AUTO-RELEASE IS SAFE, AND WHERE IT STOPS
// ---------------------------------------------------------------------
// Releasing means "show this patient the booking slots that match the AI's
// categorisation". It is a SCHEDULING decision, not a clinical one — the
// visit still happens, he still sees the patient, and he can still change
// the visit type afterwards. The alternative, a patient blocked from
// booking indefinitely, is the worse clinical outcome.
//
// But it stops at urgency. A row the AI marked `urgent` is NEVER
// auto-released: urgent means something in that intake needs a human to
// look at it, and quietly opening a booking calendar is not looking at it.
// Those rows stay pending and are counted separately so they are visible
// as a backlog rather than silently handled.
//
// Every auto-release is audited with `auto_released: true` and a
// `clinician_reviewer_id` of `auto` — so the record never claims he
// reviewed something he did not.
//
// Auth: X-Pipeline-Token, same as the NPS dispatcher. Called by
// cron-worker (hourly) because Pages Functions cannot hold a cron trigger.
// =====================================================================

import { logAudit } from "../../../../_lib/audit.js";
import { notify } from "../../../../_lib/notify.js";

export const AUTO_RELEASE_THRESHOLD_HOURS = 4;

/** Urgency levels that must never be released without a human. */
export const NEVER_AUTO_RELEASE_URGENCY = new Set(["urgent"]);

function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status, headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

/**
 * Decide, for one pending row, whether the clock has run out and whether
 * it is the kind of row that may go without him. Exported so the test
 * suite exercises the same rule the cron does.
 */
export function shouldAutoRelease(row, now = Date.now(), thresholdHours = AUTO_RELEASE_THRESHOLD_HOURS) {
    if (!row) return { release: false, reason: "no_row" };
    if (row.clinician_reviewed_at) return { release: false, reason: "already_reviewed" };
    if (!row.ai_visit_type) {
        // Nothing to release. A row with no AI categorisation is a failed
        // triage, and inventing one here would be worse than waiting.
        return { release: false, reason: "no_ai_categorisation" };
    }
    const urgency = String(row.clinician_override_urgency || row.ai_urgency || "").toLowerCase();
    if (NEVER_AUTO_RELEASE_URGENCY.has(urgency)) {
        return { release: false, reason: "urgent_needs_a_human", urgency };
    }
    const created = Number(row.created_at || 0);
    if (!created) return { release: false, reason: "no_created_at" };
    const hours = (now - created) / 3600000;
    if (hours < thresholdHours) {
        return { release: false, reason: "not_yet_due", hours_pending: Math.round(hours * 10) / 10 };
    }
    return { release: true, hours_pending: Math.round(hours * 10) / 10, urgency };
}

export async function onRequestPost(ctx) {
    const { request, env } = ctx;

    const token = request.headers.get("X-Pipeline-Token") || "";
    if (!env.PIPELINE_TOKEN || token !== env.PIPELINE_TOKEN) {
        return json({ error: "unauthorized" }, 401);
    }
    if (!env.DB) return json({ error: "db_not_bound" }, 500);

    const url = new URL(request.url);
    const dryRun = url.searchParams.get("dry_run") === "1";
    const now = Date.now();
    const cutoff = now - AUTO_RELEASE_THRESHOLD_HOURS * 3600000;

    const res = await env.DB.prepare(`
        SELECT id, patient_id, intake_id, created_at,
               ai_visit_type, ai_duration_min, ai_urgency,
               clinician_override_visit_type, clinician_override_duration_min,
               clinician_override_urgency, clinician_reviewed_at
          FROM appointment_triage
         WHERE clinician_reviewed_at IS NULL
           AND created_at IS NOT NULL
           AND created_at <= ?
         ORDER BY created_at ASC
         LIMIT 200
    `).bind(cutoff).all();

    const rows = res?.results || [];
    let released = 0, held = 0;
    const holds = [];

    for (const row of rows) {
        const decision = shouldAutoRelease(row, now);
        if (!decision.release) {
            held++;
            holds.push({ id: row.id, reason: decision.reason, urgency: decision.urgency || null,
                         hours_pending: decision.hours_pending });
            continue;
        }
        if (dryRun) { released++; continue; }

        const finalVisit = row.clinician_override_visit_type || row.ai_visit_type;
        const finalDuration = row.clinician_override_duration_min || row.ai_duration_min;

        try {
            // `clinician_reviewer_id = 'auto'` is the honest record. The
            // release columns are the same ones the manual path writes, so
            // every downstream reader (slot availability, the patient's
            // booking page, the admin list) behaves identically — this is
            // the same event, reached a different way.
            await env.DB.prepare(`
                UPDATE appointment_triage
                   SET clinician_reviewed_at = ?,
                       clinician_reviewer_id = 'auto',
                       final_visit_type = ?,
                       final_duration_min = ?,
                       updated_at = ?
                 WHERE id = ? AND clinician_reviewed_at IS NULL
            `).bind(now, finalVisit, finalDuration, now, row.id).run();

            await logAudit(env, {
                user_id: null, user_role: "app",
                action: "triage_review",
                record_type: "triage",
                record_id: row.id,
                ip: "", user_agent: "mountzara-cron",
                success: true,
                details: {
                    op: "auto_release",
                    auto_released: true,
                    threshold_hours: AUTO_RELEASE_THRESHOLD_HOURS,
                    hours_pending: decision.hours_pending,
                    final_visit_type: finalVisit,
                    final_duration_min: finalDuration,
                    ai_urgency: row.ai_urgency,
                    note: "Released without clinician review because the 4-hour window elapsed. Scheduling only — the visit type remains editable.",
                },
            });

            // Tell the patient they can book. Without this the release is
            // invisible to the person waiting on it, which is most of the
            // point of having a deadline at all.
            try {
                const p = await env.DB.prepare(
                    "SELECT email FROM patients WHERE id = ? LIMIT 1"
                ).bind(row.patient_id).first();
                if (p?.email) {
                    await notify(env, {
                        to: p.email, template: "triage_released",
                        patient_id: row.patient_id, data: {},
                    });
                }
            } catch (e) {
                console.error("auto-release: notify failed", row.id, String(e).slice(0, 160));
            }

            released++;
        } catch (e) {
            console.error("auto-release: row failed", row.id, String(e).slice(0, 200));
            held++;
            holds.push({ id: row.id, reason: "update_failed" });
        }
    }

    const urgentHeld = holds.filter((h) => h.reason === "urgent_needs_a_human").length;

    return json({
        ok: true,
        dry_run: dryRun,
        scanned: rows.length,
        released,
        held,
        // Surfaced deliberately: urgent rows past four hours are a backlog
        // he needs to see, not a quiet exception the job absorbs.
        urgent_awaiting_review: urgentHeld,
        holds: holds.slice(0, 50),
        threshold_hours: AUTO_RELEASE_THRESHOLD_HOURS,
        ran_at: new Date(now).toISOString(),
    });
}

export async function onRequest(ctx) {
    if (ctx.request.method === "POST") return onRequestPost(ctx);
    return json({ error: "method_not_allowed" }, 405);
}
