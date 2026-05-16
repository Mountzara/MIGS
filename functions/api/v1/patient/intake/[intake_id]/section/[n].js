// =====================================================================
// PATCH /api/v1/patient/intake/<intake_id>/section/<n> — autosave a section
// =====================================================================
// Per §11.6. The wizard autosaves on every field change (debounced
// ~800ms on the frontend). This endpoint upserts intake_section_data
// for (intake_id, section_number=n) with the payload sent in the body.
//
// Auth + ownership: the intake_id must belong to the calling patient.
// We deliberately do NOT echo the intake details on error — just 404 —
// so an attacker cannot enumerate other patients' intake ids.
//
// Patients cannot write to section 3 (Office Use Only). Returns 403.
//
// Patients cannot write to a submitted/reviewed intake. Returns 409.
//
// Body: any JSON object — gets stringified and stored as data_json.
//       Caller-provided keys are NOT schema-enforced here (the section
//       structure is a moving target as the form evolves); the
//       data_json column accepts any shape. The clinician dashboard
//       renders whatever was saved.
// =====================================================================

import { previewAccess, preLaunchNotFound } from "../../../../../../_lib/preview_gate.js";
import { requireRole, nowMs } from "../../../../../../_lib/auth.js";
import { logAudit } from "../../../../../../_lib/audit.js";
import { newId } from "../../../../../../_lib/db.js";
import { sectionByNumber, TOTAL_PATIENT_SECTIONS } from "../../../../../../_lib/intake_sections.js";

function err(status, code, message) {
    return new Response(JSON.stringify({ error: code, message }), {
        status,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

export async function onRequestPatch(ctx) {
    const { request, env, params } = ctx;
    const { allow } = await previewAccess(request, env);
    if (!allow) return preLaunchNotFound();

    let session;
    try { session = await requireRole(ctx, ["patient"]); }
    catch (resp) { return resp; }
    if (!session.patient_id || !env.DB) {
        return err(500, "server_error", "DB not bound");
    }

    const intake_id = String(params?.intake_id || "");
    const n = parseInt(String(params?.n || ""), 10);
    if (!intake_id || !Number.isFinite(n) || n < 1 || n > 19) {
        return err(400, "bad_params", "intake_id and section number 1-19 required");
    }

    const def = sectionByNumber(n);
    if (!def) return err(400, "bad_section", `section ${n} not in catalog`);
    if (!def.patient) return err(403, "section_not_patient_writable", `section ${n} is clinician-only`);

    let body;
    try { body = await request.json(); } catch { return err(400, "bad_json", "expected JSON body"); }
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
        return err(400, "bad_payload", "payload must be a JSON object");
    }

    // Confirm the intake belongs to this patient and is editable.
    const intake = await env.DB.prepare(`
        SELECT id, status FROM intake_responses
        WHERE id = ? AND patient_id = ?
    `).bind(intake_id, session.patient_id).first();
    if (!intake) return err(404, "intake_not_found", "no such intake for this patient");
    if (intake.status !== "in_progress") {
        return err(409, "intake_locked", `intake is ${intake.status} — sections cannot be edited`);
    }

    const now = nowMs();
    let row_id;
    try {
        const existing = await env.DB.prepare(`
            SELECT id FROM intake_section_data
            WHERE intake_id = ? AND section_number = ?
        `).bind(intake_id, n).first();

        if (existing) {
            row_id = existing.id;
            await env.DB.prepare(`
                UPDATE intake_section_data
                SET section_key = ?, data_json = ?, last_updated_at = ?
                WHERE id = ?
            `).bind(def.key, JSON.stringify(body), now, existing.id).run();
        } else {
            row_id = newId();
            await env.DB.prepare(`
                INSERT INTO intake_section_data
                    (id, intake_id, section_number, section_key, data_json, last_updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `).bind(row_id, intake_id, n, def.key, JSON.stringify(body), now).run();
        }

        // Recompute completion_pct = filled patient sections / total patient sections.
        const filled = await env.DB.prepare(`
            SELECT COUNT(*) AS n FROM intake_section_data
            WHERE intake_id = ? AND section_number != 3
        `).bind(intake_id).first();
        const pct = Math.min(100, Math.round(((filled?.n || 0) / TOTAL_PATIENT_SECTIONS) * 100));
        await env.DB.prepare(`
            UPDATE intake_responses
            SET completion_pct = ?, updated_at = ? WHERE id = ?
        `).bind(pct, now, intake_id).run();

        await logAudit(env, {
            user_id: session.patient_id,
            user_role: "patient",
            action: "intake_section_save",
            record_type: "intake",
            record_id: intake_id,
            ip: request.headers.get("CF-Connecting-IP") || "",
            user_agent: request.headers.get("User-Agent") || "",
            success: true,
            details: { section_number: n, section_key: def.key, completion_pct: pct },
        });

        return new Response(JSON.stringify({
            ok: true,
            section_number: n,
            section_key: def.key,
            last_updated_at: now,
            completion_pct: pct,
        }), {
            status: 200,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
    } catch (e) {
        console.error("intake section PATCH threw", { error: String(e), intake_id, n });
        return err(500, "server_error", "could not save section");
    }
}
