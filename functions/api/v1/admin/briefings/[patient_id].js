// =====================================================================
// GET /api/v1/admin/briefings/<patient_id>
// =====================================================================
// Phase 14 Round B — single-patient pre-visit briefing on demand.
//
// Query params:
//   ?appointment_id=<uuid>   — focus on a specific appointment so the
//                              executive lede + watch_for include it
// =====================================================================

import { adminRoute, jsonResponse, jsonError } from "../../../../_lib/admin_api.js";
import { buildPatientBriefing } from "../../../../_lib/patient_briefing.js";
import { logAudit } from "../../../../_lib/audit.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env, request, admin }) => {
        const patientId = ctx.params.patient_id;
        if (!UUID_RE.test(patientId)) return jsonError("invalid patient_id", 400);

        const url = new URL(request.url);
        const appointmentId = url.searchParams.get("appointment_id") || null;
        if (appointmentId && !UUID_RE.test(appointmentId)) {
            return jsonError("invalid appointment_id", 400);
        }

        const briefing = await buildPatientBriefing(env, patientId, {
            appointment_id: appointmentId,
        });
        if (!briefing) return jsonError("patient not found", 404);

        await logAudit(env, {
            user_id: admin.user, user_role: admin.role,
            action: "patient_briefing_read",
            record_type: "patient",
            record_id: patientId,
            success: true,
            details: { appointment_id: appointmentId },
        });

        return jsonResponse(briefing);
    });
}
