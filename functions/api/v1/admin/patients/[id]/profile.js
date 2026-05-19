// =====================================================================
// PATCH /api/v1/admin/patients/<id>/profile
// =====================================================================
// Phase 14 Round A — update the humanization fields on a patient row:
//   nickname            (plain text, demographic level)
//   care_goals_json     (structured JSON of patient-stated goals/preferences)
//
// The patient's photo + clinician-side personal_notes live in separate
// endpoints because their bodies are PHI-grade and envelope-encrypted.
// =====================================================================

import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../../../_lib/admin_api.js";
import { logAudit } from "../../../../../_lib/audit.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Sanity bounds on the nickname — keep it human-length, no embedded HTML.
const MAX_NICKNAME = 60;

// Sanity bounds on care_goals_json — capped so we can't DOS the row.
const MAX_CARE_GOALS_BYTES = 8 * 1024;

function validateCareGoals(value) {
    if (value === null || value === undefined) return null;
    if (typeof value !== "object") {
        throw new Error("care_goals must be a JSON object");
    }
    // Coerce to safe shape. Unknown keys are dropped to keep the schema stable.
    const safe = {
        goals: Array.isArray(value.goals) ? value.goals.map(String).slice(0, 20) : [],
        preferences: Array.isArray(value.preferences) ? value.preferences.map(String).slice(0, 20) : [],
        avoid: Array.isArray(value.avoid) ? value.avoid.map(String).slice(0, 20) : [],
        notes: typeof value.notes === "string" ? value.notes.slice(0, 1200) : "",
    };
    // Truncate any individual entry to 240 chars so the row stays modest.
    for (const k of ["goals", "preferences", "avoid"]) {
        safe[k] = safe[k].map((s) => String(s).slice(0, 240));
    }
    const encoded = JSON.stringify(safe);
    if (new TextEncoder().encode(encoded).length > MAX_CARE_GOALS_BYTES) {
        throw new Error(`care_goals_json exceeds ${MAX_CARE_GOALS_BYTES} bytes`);
    }
    return encoded;
}


export async function onRequestPatch(ctx) {
    return adminRoute(ctx, async ({ env, request, admin }) => {
        const patientId = ctx.params.id;
        if (!UUID_RE.test(patientId)) return jsonError("invalid patient_id", 400);

        const row = await env.DB.prepare("SELECT id FROM patients WHERE id = ?")
            .bind(patientId).first();
        if (!row) return jsonError("patient not found", 404);

        const body = await readJsonBody(request);
        if (!body || (body.nickname === undefined && body.care_goals === undefined)) {
            return jsonError("nothing to update — pass nickname and/or care_goals", 400);
        }

        const updates = [];
        const binds = [];

        if (body.nickname !== undefined) {
            const nick = body.nickname === null ? null : String(body.nickname).trim().slice(0, MAX_NICKNAME);
            // strip any embedded HTML tag chars to keep this safe-to-render in cards
            const clean = nick === null ? null : nick.replace(/[<>]/g, "");
            updates.push("nickname = ?");
            binds.push(clean);
        }
        if (body.care_goals !== undefined) {
            let encoded;
            try {
                encoded = body.care_goals === null ? null : validateCareGoals(body.care_goals);
            } catch (e) {
                return jsonError(e.message, 400);
            }
            updates.push("care_goals_json = ?", "care_goals_updated_at = ?");
            binds.push(encoded, Date.now());
        }

        updates.push("updated_at = ?");
        binds.push(Date.now());
        binds.push(patientId);

        await env.DB.prepare(
            `UPDATE patients SET ${updates.join(", ")} WHERE id = ?`
        ).bind(...binds).run();

        await logAudit(env, {
            user_id: admin.user,
            user_role: admin.role,
            action: "patient_profile_update",
            record_type: "patient",
            record_id: patientId,
            ip: request.headers.get("CF-Connecting-IP") || "",
            user_agent: request.headers.get("User-Agent") || "",
            success: true,
            details: {
                fields: Object.keys(body).filter((k) => k === "nickname" || k === "care_goals"),
            },
        });

        // Return the refreshed row (PHI-free fields only)
        const refreshed = await env.DB.prepare(
            "SELECT id, nickname, care_goals_json, care_goals_updated_at, updated_at " +
            "FROM patients WHERE id = ?"
        ).bind(patientId).first();
        let careGoals = null;
        if (refreshed && refreshed.care_goals_json) {
            try { careGoals = JSON.parse(refreshed.care_goals_json); } catch { careGoals = null; }
        }
        return jsonResponse({
            ok: true,
            patient: {
                id: refreshed.id,
                nickname: refreshed.nickname || null,
                care_goals: careGoals,
                care_goals_updated_at: refreshed.care_goals_updated_at || null,
                updated_at: refreshed.updated_at,
            },
        });
    });
}
