// =====================================================================
// GET /api/v1/patient/appointments/available — slot picker
// =====================================================================
// Per CLAUDE.md §11.7.4 Patient-Facing Booking Flow. Returns slots that
// match the patient's released triage, filtered by:
//   - visit_type matches block.allowed_visit_types (if set)
//   - duration_min fits inside the open block (+5min buffer if ≥45min)
//   - block.location respects in_person_required / modality
//   - no overlap with already-booked appointments
//   - in the future
//
// Query params:
//   from:    YYYY-MM-DD (default = today)
//   to:      YYYY-MM-DD (default = from + 14 days)
//   modality: 'in_person' | 'telehealth' (default = patient's modality
//            from the triage). Overrides AI's in_person_required only
//            if the triage allows it (visit type not procedure/OMT).
//
// Response:
//   {
//     triage: { id, visit_type, duration_min, urgency, in_person_required,
//               preferred_time_of_day },
//     slots_by_date: {
//       "2026-05-18": [ { start_minute_of_day, starts_at, ends_at, modality,
//                         location, block_id, score }, ... ],
//       ...
//     },
//     count: <total slots>,
//     window: { from, to }
//   }
//
// Auth: patient session required. Preview gate honored.
// =====================================================================

import { previewAccess, preLaunchNotFound } from "../../../../_lib/preview_gate.js";
import { requireRole } from "../../../../_lib/auth.js";
import { computeAvailableSlots } from "../../../../_lib/scheduling.js";
import { getVisitType } from "../../../../_lib/visit_types.js";

const CLINICIAN_ID = "mabini-christopher-z";
const DEFAULT_WINDOW_DAYS = 14;
const MAX_WINDOW_DAYS = 28;

function err(status, code, message, extra = {}) {
    return new Response(JSON.stringify({ error: code, message, ...extra }), {
        status,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

function isDate(s) {
    return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function todayDateString() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${da}`;
}

function addDaysToDateString(dateStr, days) {
    const [y, m, d] = dateStr.split("-").map(s => parseInt(s, 10));
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + days);
    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(dt.getUTCDate()).padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
}

export async function onRequestGet(ctx) {
    const { request, env } = ctx;
    const { allow } = await previewAccess(request, env);
    if (!allow) return preLaunchNotFound();

    let session;
    try { session = await requireRole(ctx, ["patient"]); }
    catch (resp) { return resp; }
    if (!session.patient_id || !env.DB) {
        return err(500, "server_error", "DB not bound");
    }

    const url = new URL(request.url);
    const from = url.searchParams.get("from") || todayDateString();
    const to = url.searchParams.get("to") || addDaysToDateString(from, DEFAULT_WINDOW_DAYS);
    const modalityParam = url.searchParams.get("modality");
    if (!isDate(from)) return err(400, "invalid_from", "YYYY-MM-DD");
    if (!isDate(to)) return err(400, "invalid_to", "YYYY-MM-DD");
    if (to < from) return err(400, "invalid_window", "to < from");
    // Cap window length so a malicious caller can't request the whole year.
    const fromDt = Date.parse(from + "T00:00:00Z");
    const toDt = Date.parse(to + "T00:00:00Z");
    if ((toDt - fromDt) / (24 * 3600 * 1000) > MAX_WINDOW_DAYS) {
        return err(400, "window_too_large", `max ${MAX_WINDOW_DAYS} days`);
    }

    // Load patient's most recent released triage.
    const triage = await env.DB.prepare(`
        SELECT id, ai_visit_type, ai_duration_min, ai_urgency,
               ai_in_person_required, ai_preferred_time_of_day,
               clinician_override_visit_type, clinician_override_duration_min,
               clinician_override_urgency, clinician_override_in_person_required,
               clinician_override_preferred_time_of_day,
               final_visit_type, final_duration_min, clinician_reviewed_at
        FROM appointment_triage
        WHERE patient_id = ? AND clinician_reviewed_at IS NOT NULL
        ORDER BY created_at DESC LIMIT 1
    `).bind(session.patient_id).first();

    if (!triage) {
        return err(409, "no_released_triage",
            "Your intake is awaiting clinician review. We'll release slots once the triage is reviewed.");
    }

    const visit_type = triage.final_visit_type || triage.clinician_override_visit_type || triage.ai_visit_type;
    const duration_min = triage.final_duration_min || triage.clinician_override_duration_min || triage.ai_duration_min;
    // His override wins over the AI, when he made one. The line this
    // replaces read only ai_in_person_required with the comment "overrides
    // not persisted" — and it was accurate: release.js validated the
    // in-person checkbox, wrote it to the audit log, and dropped it. Every
    // live triage row has ai_in_person_required = 1, so the checkbox could
    // never open a visit to telehealth; it flipped, the toast said
    // released, and the patient stayed hard-blocked. Both halves are fixed
    // together: release.js now persists the override columns, and this
    // reads them. NULL means "he did not touch it", so ?? not ||, or an
    // override TO false would be indistinguishable from no override.
    const in_person_required = !!(triage.clinician_override_in_person_required
        ?? triage.ai_in_person_required);
    const preferred_time_of_day = triage.clinician_override_preferred_time_of_day
        || triage.ai_preferred_time_of_day || "any";

    if (visit_type === "manual_review_required") {
        return err(409, "manual_review_required",
            "Your triage requires manual review. You'll be notified once the clinician confirms your visit type.");
    }

    // Resolve modality. Patient's choice can downgrade in_person_required
    // only if the visit type permits (i.e., not procedure / OMT / annual).
    const vt = getVisitType(visit_type);
    let modality = modalityParam || (in_person_required ? "in_person" : "any");
    if (modalityParam === "telehealth") {
        if (in_person_required || (vt && (vt.category === "procedure" || vt.modality_preferred === "in_person"))) {
            // Cap their override silently — they can't go telehealth on a
            // visit that requires in-person.
            modality = "in_person";
        } else {
            modality = "telehealth";
        }
    }

    // Pull availability blocks in the window for the clinician.
    const blocksRes = await env.DB.prepare(`
        SELECT id, date, start_minute_of_day, end_minute_of_day, block_kind,
               allowed_visit_types_json, location, notes
        FROM clinician_availability
        WHERE clinician_id = ? AND date >= ? AND date <= ?
          AND block_kind = 'open'
        ORDER BY date, start_minute_of_day
    `).bind(CLINICIAN_ID, from, to).all();

    // Pull already-booked appointments (status='scheduled') in the window for
    // overlap detection.
    const fromMs = Date.parse(from + "T00:00:00Z");
    const toMsExclusive = Date.parse(to + "T23:59:59Z");
    const apptsRes = await env.DB.prepare(`
        SELECT starts_at, ends_at
        FROM appointments
        WHERE clinician_id = ? AND status = 'scheduled'
          AND starts_at >= ? AND starts_at <= ?
    `).bind(CLINICIAN_ID, fromMs, toMsExclusive).all();

    // Defence in depth. The applier now refuses to write a visit type that
    // is not in the catalog, but this endpoint must not DIE if one ever
    // gets in another way — an unknown key made getVisitType() return
    // undefined and the request failed with Cloudflare 1102, which the
    // patient saw as "no slots" with no explanation and no way forward.
    if (!vt) {
        return err(409, "unknown_visit_type",
            "Your triage recorded a visit type this scheduler does not recognise, so slots cannot be offered yet. " +
            "Dr. Mabini has been notified and will set the visit type by hand.");
    }

    const slots = computeAvailableSlots({
        availabilityBlocks: blocksRes?.results || [],
        appointments: apptsRes?.results || [],
        visit_type,
        duration_min,
        in_person_required,
        preferred_time_of_day,
        modality,
        now: new Date(),
    });

    // Group by date.
    const slots_by_date = {};
    for (const s of slots) {
        if (!slots_by_date[s.date]) slots_by_date[s.date] = [];
        slots_by_date[s.date].push({
            start_minute_of_day: s.start_minute_of_day,
            ends_minute_of_day: s.ends_minute_of_day,
            starts_at: s.starts_at,
            ends_at: s.ends_at,
            modality: s.modality,
            location: s.location,
            block_id: s.block_id,
        });
    }

    return new Response(JSON.stringify({
        triage: {
            id: triage.id,
            visit_type,
            duration_min,
            urgency: triage.ai_urgency,
            in_person_required,
            preferred_time_of_day,
            // Phase 17 R1 — surface the chaperone policy so the booking UI can
            // prompt the patient before a telehealth booking of a
            // chaperone-required visit type (book.js enforces it server-side).
            requires_chaperone: !!(vt && vt.requires_chaperone),
            chaperone_rationale: (vt && vt.chaperone_rationale) || null,
        },
        modality_effective: modality,
        window: { from, to },
        count: slots.length,
        slots_by_date,
    }), {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}
