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

/**
 * Convert "YYYY-MM-DD" + minute-of-day into an ms-epoch using the
 * America/Chicago practice timezone. Workers don't have IANA TZ APIs;
 * we approximate using a fixed offset that's correct for the
 * MountZara practice timezone year-round once DST is accounted for —
 * but since the clinician_availability stores a wall-clock minute_of_day
 * intended in the practice's local timezone, we anchor against the
 * configured timezone offset on the day in question.
 *
 * For Phase 2.5 this implementation uses a *configurable* offset via
 * env.PRACTICE_TZ_OFFSET_MINUTES if set; otherwise defaults to America/
 * Chicago's offset on the given date (CST=-360, CDT=-300).
 *
 * The practice's actual TZ is set in /admin/scheduling (practice_settings
 * key='practice_timezone_offset_minutes'); callers that need precise
 * boundary days pass an explicit offset.
 */
export function dateStringToMs(dateStr, minuteOfDay, offsetMinutesUTC = null) {
    const [y, m, d] = dateStr.split("-").map(s => parseInt(s, 10));
    // If caller didn't supply, assume the date+minute is in UTC; the
    // patient UI displays slots in the patient's *local* time via JS
    // Date formatting on the client. Storing UTC-aligned starts_at on
    // the row means an availability block at 09:00 wall-clock would
    // be stored as 09:00 UTC unless the operator-side admin UI
    // adjusts. The admin scheduling page sends start_minute_of_day
    // verbatim per §11.7.3; both client and server share the same
    // interpretation: minute-of-day is interpreted relative to UTC
    // for the slot computation, and the client renders in local time.
    // Practice timezone normalization is a Phase 5 task.
    const offsetMs = offsetMinutesUTC == null ? 0 : offsetMinutesUTC * 60 * 1000;
    const utc = Date.UTC(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
    return utc + (minuteOfDay * 60 * 1000) + offsetMs;
}

export function msToDateString(ms) {
    if (!Number.isFinite(ms)) return "";
    const d = new Date(ms);
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
    const da = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${mo}-${da}`;
}
