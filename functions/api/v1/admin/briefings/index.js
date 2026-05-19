// =====================================================================
// GET /api/v1/admin/briefings
// =====================================================================
// Phase 14 Round B — schedule-window pre-visit briefings.
//
// Query params:
//   ?date=YYYY-MM-DD          — single day (default: today in clinic TZ)
//   ?range=week               — week starting <date> (Mon–Sun)
//   ?starts_at_min=<ms epoch> — explicit window override
//   ?starts_at_max=<ms epoch> — explicit window override
//   ?clinician_id=<uuid>      — limit to one clinician (default: all)
//
// Returns: { window, appointments, briefings, generated_at }
//   where briefings[] is one entry per unique patient in the window,
//   each fully composed per functions/_lib/patient_briefing.js.
// =====================================================================

import { adminRoute, jsonResponse, jsonError } from "../../../../_lib/admin_api.js";
import { buildScheduleBriefings } from "../../../../_lib/patient_briefing.js";
import { logAudit } from "../../../../_lib/audit.js";

const PRACTICE_TZ = "America/Chicago";   // matches patients.timezone default

function parseISODate(s) {
    if (!s) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
    if (!m) return null;
    return { y: +m[1], mo: +m[2], d: +m[3] };
}

/**
 * Resolve a date string + range mode into [starts_at_min, starts_at_max] ms epoch.
 * Naively uses UTC midnight bounds — adjust here if we ever need TZ-aware
 * boundaries. For our single-clinician practice the half-day spillover is
 * acceptable.
 */
function resolveWindow(dateStr, range) {
    let target;
    if (dateStr) {
        const parts = parseISODate(dateStr);
        if (!parts) return { error: "invalid date — expected YYYY-MM-DD" };
        target = new Date(Date.UTC(parts.y, parts.mo - 1, parts.d, 0, 0, 0));
    } else {
        const now = new Date();
        target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
    }
    const min = target.getTime();
    let max = min + 24 * 60 * 60 * 1000;
    if (range === "week") {
        max = min + 7 * 24 * 60 * 60 * 1000;
    }
    return { starts_at_min: min, starts_at_max: max };
}


export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env, request, admin }) => {
        const url = new URL(request.url);
        const dateStr = url.searchParams.get("date");
        const range = url.searchParams.get("range");
        const clinicianId = url.searchParams.get("clinician_id");

        let starts_at_min, starts_at_max;
        const explicitMin = url.searchParams.get("starts_at_min");
        const explicitMax = url.searchParams.get("starts_at_max");
        if (explicitMin && explicitMax) {
            starts_at_min = parseInt(explicitMin, 10);
            starts_at_max = parseInt(explicitMax, 10);
            if (!Number.isFinite(starts_at_min) || !Number.isFinite(starts_at_max) || starts_at_max <= starts_at_min) {
                return jsonError("invalid starts_at_min / starts_at_max", 400);
            }
        } else {
            const win = resolveWindow(dateStr, range);
            if (win.error) return jsonError(win.error, 400);
            starts_at_min = win.starts_at_min;
            starts_at_max = win.starts_at_max;
        }

        const opts = { starts_at_min, starts_at_max };
        if (clinicianId) opts.clinician_id = clinicianId;

        const out = await buildScheduleBriefings(env, opts);

        await logAudit(env, {
            user_id: admin.user, user_role: admin.role,
            action: "schedule_briefings_read",
            record_type: "briefing_window",
            success: true,
            details: {
                starts_at_min, starts_at_max,
                appointment_count: out.appointments.length,
                patient_count: out.briefings.length,
                clinician_id: clinicianId || null,
            },
        });

        return jsonResponse(out);
    });
}
