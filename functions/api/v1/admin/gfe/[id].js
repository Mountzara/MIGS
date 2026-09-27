// =====================================================================
// /api/v1/admin/gfe/<id> — read, validate, issue or void one estimate
// =====================================================================
// GET   → the estimate, its lines, its totals split practice vs outside,
//         and a VALIDATION listing every element 45 CFR 149.610 requires
//         that is still missing. Issuing is refused while any are.
// PATCH → { issue: true } records delivery (this is the act the
//          regulation cares about), { void_reason } voids it.
//
// Issuing an invalid estimate is refused rather than warned about: an
// estimate missing a required element is worse than none, because it
// looks like compliance.
// =====================================================================

import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../../_lib/admin_api.js";
import { logAudit } from "../../../../_lib/audit.js";
import { validateGfe, totals, DISCLAIMERS, DISCLAIMER_VERSION, gfeDueBy } from "../../../../_lib/gfe.js";

async function load(env, id) {
    const gfe = await env.DB.prepare(`
        SELECT g.*, p.first_name, p.last_name, p.dob, p.email
          FROM good_faith_estimates g LEFT JOIN patients p ON p.id = g.patient_id
         WHERE g.id = ?`).bind(id).first();
    if (!gfe) return null;
    const lines = (await env.DB.prepare(
        `SELECT * FROM gfe_line_items WHERE gfe_id = ? ORDER BY sort_order ASC`).bind(id).all())?.results || [];
    return { gfe, lines };
}

function shape(gfe) {
    return {
        patient_name: [gfe.first_name, gfe.last_name].filter(Boolean).join(" "),
        patient_dob: gfe.dob,
        primary_service: gfe.primary_service,
        service_date: gfe.service_date,
        diagnosis: (() => { try { return gfe.diagnosis_json ? JSON.parse(gfe.diagnosis_json) : []; } catch { return []; } })(),
    };
}

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env }) => {
        const data = await load(env, String(ctx.params?.id || ""));
        if (!data) return jsonError("gfe_not_found", 404);
        const { gfe, lines } = data;
        return jsonResponse({
            ok: true,
            gfe: { ...gfe, diagnosis: shape(gfe).diagnosis },
            lines, totals: totals(lines),
            validation: validateGfe(shape(gfe), lines),
            disclaimers: DISCLAIMERS,
            disclaimer_version: DISCLAIMER_VERSION,
            deadline: gfeDueBy({ trigger_kind: gfe.trigger_kind, scheduled_on: gfe.scheduled_on, service_date: gfe.service_date }),
        });
    });
}

export async function onRequestPatch(ctx) {
    return adminRoute(ctx, async ({ env, request, admin }) => {
        const id = String(ctx.params?.id || "");
        const body = await readJsonBody(request);
        if (!body) return jsonError("invalid_json_body", 400);
        const data = await load(env, id);
        if (!data) return jsonError("gfe_not_found", 404);
        const { gfe, lines } = data;
        const now = Date.now();

        if (body.issue === true) {
            const v = validateGfe(shape(gfe), lines);
            if (!v.ok) return jsonError("gfe_incomplete", 409, { missing: v.missing });
            await env.DB.prepare(`
                UPDATE good_faith_estimates
                   SET status = 'issued', issued_at = ?, issued_by = ?, delivery_method = ?,
                       practice_total_cents = ?, updated_at = ?
                 WHERE id = ?`).bind(now, admin.user || "admin",
                    String(body.delivery_method || "portal").slice(0, 40),
                    totals(lines).practice_cents, now, id).run();
            await logAudit(env, {
                user_id: admin.user, user_role: "staff", action: "gfe_issue",
                record_type: "good_faith_estimate", record_id: id, success: true,
                details: { delivery_method: body.delivery_method || "portal" },
            }, ctx);
            return jsonResponse({ ok: true, status: "issued" });
        }
        if (typeof body.void_reason === "string") {
            await env.DB.prepare(
                `UPDATE good_faith_estimates SET status = 'void', void_reason = ?, updated_at = ? WHERE id = ?`
            ).bind(body.void_reason.slice(0, 300), now, id).run();
            return jsonResponse({ ok: true, status: "void" });
        }
        return jsonError("nothing_to_update", 400);
    });
}
