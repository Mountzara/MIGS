// =====================================================================
// /api/v1/admin/patients/<id>/id-verify — Phase 18 Sprint 2 R6
// =====================================================================
// Identity verification at first visit (Joshi & Welch 2023 — video photo-ID
// check at the first encounter). Clinician-side one-tap action from the
// /admin/cases/<id>/ view.
//
//   GET  — returns { verified, identity_verified_at, identity_verified_method,
//                    identity_verification_notes } (drives the banner/badge).
//   POST — body { method, notes? } where method is one of:
//            drivers_license_video | passport_video | state_id_video |
//            two_factor_information | deferred
//          Stamps patients.identity_verified_at (NULL for "deferred" so the
//          banner re-surfaces on the next visit), records method + notes,
//          and audit-logs {action: "patient_id_verified", ...}.
//
// "deferred" semantics: the clinician acknowledged the step but could not
// complete it (no ID at hand). identity_verified_method='deferred' with
// identity_verified_at left NULL — the cases banner keeps showing until a
// real verification lands. notes is REQUIRED for deferred (reason).
// =====================================================================

import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../../../_lib/admin_api.js";
import { logAudit } from "../../../../../_lib/audit.js";

const VALID_METHODS = new Set([
    "drivers_license_video",
    "passport_video",
    "state_id_video",
    "two_factor_information",
    "deferred",
]);
const MAX_NOTES = 500;

async function loadPatient(env, patient_id) {
    return env.DB.prepare(`
        SELECT id, identity_verified_at, identity_verified_method,
               identity_verification_notes
        FROM patients WHERE id = ?
    `).bind(patient_id).first();
}

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env }) => {
        const patient_id = String(ctx.params?.id || "");
        if (!patient_id) return jsonError("missing_patient_id", 400);
        const p = await loadPatient(env, patient_id);
        if (!p) return jsonError("patient_not_found", 404);
        return jsonResponse({
            patient_id: p.id,
            verified: !!p.identity_verified_at,
            identity_verified_at: p.identity_verified_at,
            identity_verified_method: p.identity_verified_method,
            identity_verification_notes: p.identity_verification_notes,
        });
    });
}

export async function onRequestPost(ctx) {
    return adminRoute(ctx, async ({ env, request, admin }) => {
        const patient_id = String(ctx.params?.id || "");
        if (!patient_id) return jsonError("missing_patient_id", 400);

        const body = await readJsonBody(request);
        const method = String(body?.method || "");
        const notes = typeof body?.notes === "string"
            ? body.notes.slice(0, MAX_NOTES) : null;

        if (!VALID_METHODS.has(method)) {
            return jsonError("invalid_method", 400, {
                allowed_methods: Array.from(VALID_METHODS),
            });
        }
        if (method === "deferred" && !(notes && notes.trim())) {
            return jsonError("deferred_requires_notes", 400);
        }

        const p = await loadPatient(env, patient_id);
        if (!p) return jsonError("patient_not_found", 404);

        // A real verification stamps the timestamp; a deferral records the
        // method + reason but leaves identity_verified_at NULL so the banner
        // persists on the next visit (spec acceptance criterion #3).
        const verified_at = method === "deferred" ? null : new Date().toISOString();
        try {
            await env.DB.prepare(`
                UPDATE patients
                SET identity_verified_at = ?,
                    identity_verified_method = ?,
                    identity_verification_notes = ?,
                    updated_at = ?
                WHERE id = ?
            `).bind(verified_at, method, notes, Date.now(), patient_id).run();
        } catch (e) {
            console.error("id-verify UPDATE threw", { error: String(e), patient_id });
            return jsonError("server_error", 500);
        }

        await logAudit(env, {
            user_id: admin.user,
            user_role: admin.role,
            action: "patient_id_verified",
            record_type: "patient",
            record_id: patient_id,
            ip: request.headers.get("CF-Connecting-IP") || "",
            user_agent: request.headers.get("User-Agent") || "",
            success: true,
            details: { method, deferred: method === "deferred", notes_present: !!notes },
        });

        return jsonResponse({
            ok: true,
            patient_id,
            verified: !!verified_at,
            identity_verified_at: verified_at,
            identity_verified_method: method,
        });
    });
}
