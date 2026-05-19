// =====================================================================
// /api/v1/admin/debug/sessions — live view of recent session_trace events
// =====================================================================
// Powers the /admin/debug/sessions/ UI. Returns the most recent N events
// from session_trace, filterable by invite_label, patient_id, outcome,
// or since_ts. PHI-free (the trace table itself is PHI-conservative).
//
// Query params:
//   ?label=ally          - filter by invite_label
//   ?patient_id=<id>
//   ?outcome=error       - filter by outcome
//   ?since_ts=<ms>       - rows newer than this ms epoch (for incremental polls)
//   ?limit=200           - default 200, capped 500
// =====================================================================

import { adminRoute, jsonResponse } from "../../../../_lib/admin_api.js";
import { listRecentTraces } from "../../../../_lib/session_trace.js";

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env, request }) => {
        const url = new URL(request.url);
        const filters = {
            invite_label: url.searchParams.get("label") || undefined,
            patient_id:   url.searchParams.get("patient_id") || undefined,
            outcome:      url.searchParams.get("outcome") || undefined,
            since_ts:     url.searchParams.get("since_ts") ? parseInt(url.searchParams.get("since_ts"), 10) : undefined,
            limit:        url.searchParams.get("limit") ? parseInt(url.searchParams.get("limit"), 10) : 200,
        };
        const events = await listRecentTraces(env, filters);
        // Roll up a tiny per-label summary so the UI can show counts.
        const summary = {};
        for (const e of events) {
            const k = e.invite_label || "anon";
            if (!summary[k]) summary[k] = { count: 0, errors: 0, blocked: 0 };
            summary[k].count += 1;
            if (e.outcome === "error") summary[k].errors += 1;
            else if (e.outcome === "blocked") summary[k].blocked += 1;
        }
        return jsonResponse({
            ok: true,
            count: events.length,
            server_ts: Date.now(),
            summary,
            events,
        });
    });
}
