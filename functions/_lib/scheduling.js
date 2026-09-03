// =====================================================================
// functions/_lib/scheduling.js — slot computation against availability
// =====================================================================
// Per CLAUDE.md §11.7.3 Schedule Block Optimization Rules. Given a
// triage decision (visit_type, duration, in_person_required, preferred
// time-of-day) and a set of clinician_availability blocks + already-
// booked appointments, produce a sorted list of bookable slots.
//
// Inputs are pure data — this module is unit-testable and is consumed
// by both the patient booking flow (Round C) and any future
// admin-side "find a slot" tooling.
//
// Slot semantics:
//   - 15-min aligned start_minute_of_day
//   - slot fits inside an 'open' block (start_minute >= block.start,
//     start_minute + duration <= block.end)
//   - 5-min buffer after slots of duration >= 45 min per §11.7.3
//     ("5-minute buffer auto-added after any visit ≥45 min")
//   - no overlap with any existing appointment in scheduled state
//   - if block.allowed_visit_types is set, the visit_type must be in it
//   - if patient.in_person_required, block.location must NOT be
//     'telehealth_only'
//   - if visit type is 'omt_treatment' or 'office_procedure', block
//     location must be 'clinic' or 'procedure_room' (no telehealth)
// =====================================================================

import { getVisitType } from "./visit_types.js";

/**
 * @param {object} args
 * @param {Array<object>} args.availabilityBlocks — clinician_availability rows
 * @param {Array<object>} args.appointments — rows from `appointments` already
 *                                            scheduled in the same window
 * @param {string} args.visit_type — visit-type key
 * @param {number} args.duration_min — desired slot length
 * @param {boolean} args.in_person_required
 * @param {string} args.preferred_time_of_day — 'morning' | 'afternoon' | 'any'
 * @param {Date} args.now — current time (for filtering past slots)
 * @param {string} args.modality — 'in_person' | 'telehealth' — patient's choice
 * @returns {Array<{date:string, start_minute_of_day:number, ends_minute_of_day:number, starts_at:number, ends_at:number, location:string, block_id:string, modality:string, score:number}>}
 */
export function computeAvailableSlots(args) {
    const {
        availabilityBlocks = [],
        appointments = [],
        visit_type,
        duration_min,
        in_person_required = false,
        preferred_time_of_day = "any",
        now = new Date(),
        modality = in_person_required ? "in_person" : "any",
    } = args || {};

    if (!visit_type || !duration_min || duration_min < 5) return [];
    const vt = getVisitType(visit_type);
    // visit-type-implied modality restrictions
    const procedureOrOmt = vt && (vt.category === "procedure" || visit_type === "omt_treatment");

    const buffer_min = duration_min >= 45 ? 5 : 0;
    const totalMin = duration_min + buffer_min;
    const STEP = 15;

    // Pre-index existing appointments by date for fast overlap checks.
    const apptsByDate = new Map();
    for (const a of appointments) {
        const dateKey = msToDateString(a.starts_at);
        if (!apptsByDate.has(dateKey)) apptsByDate.set(dateKey, []);
        apptsByDate.get(dateKey).push({
            starts_at: a.starts_at,
            ends_at: a.ends_at,
        });
    }

    const out = [];

    for (const blk of availabilityBlocks) {
        if (blk.block_kind !== "open") continue;
        if (blk.allowed_visit_types_json) {
            try {
                const allowed = JSON.parse(blk.allowed_visit_types_json);
                if (Array.isArray(allowed) && allowed.length > 0 && !allowed.includes(visit_type)) {
                    continue;
                }
            } catch { /* malformed, treat as unrestricted */ }
        }
        // modality vs location compatibility
        const loc = blk.location;
        if (procedureOrOmt) {
            if (loc === "telehealth_only") continue;
        }
        if (in_person_required && loc === "telehealth_only") continue;
        if (modality === "telehealth" && loc === "procedure_room") continue;

        // Walk 15-min steps within the block.
        for (let mod = blk.start_minute_of_day; mod + totalMin <= blk.end_minute_of_day; mod += STEP) {
            const startMs = dateStringToMs(blk.date, mod);
            const endMs   = startMs + duration_min * 60 * 1000;
            // Skip past slots.
            if (startMs < now.getTime()) continue;
            // Overlap with an existing appointment? skip.
            const dateAppts = apptsByDate.get(blk.date) || [];
            let overlap = false;
            for (const a of dateAppts) {
                if (startMs < a.ends_at && endMs > a.starts_at) {
                    overlap = true;
                    break;
                }
            }
            if (overlap) continue;

            // Compute a score so we can sort with preferred-time-of-day hint.
            // Lower score = better. Always tie-break by earliest absolute time.
            const tod = timeOfDayBucket(mod);
            let score = 1000;
            if (preferred_time_of_day === tod) score = 100;
            else if (preferred_time_of_day === "any") score = 500;
            // Earlier-in-day bonus inside the bucket: 0..60 in 15-min steps
            const slotIdxInDay = mod / STEP;
            score += slotIdxInDay * 0.1;

            // Resolve modality the slot offers.
            // If the block.location forces telehealth_only, slot is telehealth.
            // Otherwise infer from patient preference + visit_type:
            let slotModality = "in_person";
            if (loc === "telehealth_only") slotModality = "telehealth";
            else if (procedureOrOmt) slotModality = "in_person";
            else if (in_person_required) slotModality = "in_person";
            else if (modality === "telehealth") slotModality = "telehealth";
            else slotModality = "in_person";

            out.push({
                date: blk.date,
                start_minute_of_day: mod,
                ends_minute_of_day: mod + duration_min,
                starts_at: startMs,
                ends_at: endMs,
                location: loc || null,
                block_id: blk.id,
                modality: slotModality,
                score,
            });
        }
    }
    out.sort((a, b) => {
        if (a.starts_at !== b.starts_at) return a.starts_at - b.starts_at;
        return a.score - b.score;
    });
    return out;
}

export function timeOfDayBucket(minuteOfDay) {
    if (minuteOfDay < 12 * 60) return "morning";
    if (minuteOfDay < 17 * 60) return "afternoon";
    return "evening";
}

export const PRACTICE_TZ = "America/Chicago";

/**
 * The practice's UTC offset ON A GIVEN DATE, in minutes.
 *
 * Per-date, not a constant. A fixed -300 is correct from March to
 * November and wrong for the rest of the year, so a constant silently
 * moves every appointment by an hour on 1 November. Workers ship full
 * ICU, so Intl resolves the real rule including the DST transition.
 *
 * Returns the value in the sense `dateStringToMs` needs: the number of
 * minutes to ADD to a wall-clock time to reach UTC. Chicago in summer is
 * UTC-5, so this returns +300.
 */
export function practiceOffsetMinutes(dateStr, tz = PRACTICE_TZ) {
    try {
        const probe = new Date(`${dateStr}T12:00:00Z`);
        if (Number.isNaN(probe.getTime())) return 0;
        const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" })
            .formatToParts(probe).find((p) => p.type === "timeZoneName")?.value || "";
        // "GMT-5", "GMT-5:30", or bare "GMT" at UTC.
        const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
        if (!m) return 0;
        const sign = m[1] === "-" ? -1 : 1;
        const utcOffset = sign * (parseInt(m[2], 10) * 60 + parseInt(m[3] || "0", 10));
        return -utcOffset;          // wall-clock + this = UTC
    } catch {
        return 0;
    }
}

/**
 * Convert "YYYY-MM-DD" + minute-of-day (WALL CLOCK, practice timezone)
 * into an ms-epoch.
 *
 * ---------------------------------------------------------------------
 * THIS WAS OFF BY FIVE HOURS FOR EVERY SLOT EVER OFFERED. Fixed 2026-08-14.
 * ---------------------------------------------------------------------
 * `offsetMinutesUTC` defaulted to null, which became a zero offset, and
 * NEITHER caller passed it. So a 9:00 a.m. availability block was stored
 * and offered as 09:00 UTC — 4:00 a.m. in Chicago. A live probe of
 * /api/v1/patient/appointments/available returned 197 slots whose first
 * `starts_at` was 2026-08-14T09:45:00Z, i.e. 4:45 a.m. practice time, and
 * the one booked appointment sat at 4:00 a.m.
 *
 * It stayed invisible because the two surfaces disagree BY CONSTRUCTION:
 * the admin scheduling page formats minute-of-day arithmetically, so it
 * read a correct "09:00", while the patient's page formats the epoch and
 * read "4:45 AM". Neither could see the other's number.
 *
 * The offset now defaults to the practice timezone resolved for THAT
 * DATE, so callers get the right answer without having to know to ask.
 * The old comment here advertised an `env.PRACTICE_TZ_OFFSET_MINUTES`
 * override that no code has ever read; it is gone rather than left to
 * mislead the next reader.
 */
export function dateStringToMs(dateStr, minuteOfDay, offsetMinutesUTC = null) {
    const [y, m, d] = dateStr.split("-").map((x) => parseInt(x, 10));
    const offset = offsetMinutesUTC == null ? practiceOffsetMinutes(dateStr) : offsetMinutesUTC;
    const utc = Date.UTC(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
    return utc + (minuteOfDay * 60 * 1000) + (offset * 60 * 1000);
}

export function msToDateString(ms) {
    if (!Number.isFinite(ms)) return "";
    const d = new Date(ms);
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
    const da = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${mo}-${da}`;
}
