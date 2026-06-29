// =====================================================================
// GET / PUT  /api/v1/admin/patients/:id/insurance
// =====================================================================
// Per-patient insurance for the billing pipeline (member id / group /
// subscriber / gender / billing address). Entered once; the claim submit
// endpoint auto-populates from it → zero per-claim manual entry.
//   GET → { insurance: [ <row>, ... ] }  (primary first)
//   PUT body → upsert by rank: { rank, payer_id, member_id, group_number,
//              relationship, subscriber_first_name, subscriber_last_name,
//              subscriber_dob, patient_gender, address:{line1,city,state,zip} }
// Auth: adminRoute.
// =====================================================================

import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../../../_lib/admin_api.js";
import { logAudit } from "../../../../../_lib/audit.js";
import { newId } from "../../../../../_lib/db.js";

const COLS = "id, patient_id, rank, payer_id, member_id, group_number, relationship, subscriber_first_name, subscriber_last_name, subscriber_dob, patient_gender, address_line1, address_city, address_state, address_zip, active, created_at, updated_at";

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env, params }) => {
        const pid = params && params.id ? String(params.id) : "";
        if (!pid) return jsonError("missing_patient_id", 400);
        const rows = await env.DB.prepare(`SELECT ${COLS} FROM patient_insurance WHERE patient_id = ? AND active = 1 ORDER BY (rank='primary') DESC, updated_at DESC`)
            .bind(pid).all().then((r) => r.results || []).catch(() => []);
        return jsonResponse({ insurance: rows });
    });
}

export async function onRequestPut(ctx) {
    return adminRoute(ctx, async ({ env, params, request, admin }) => {
        const pid = params && params.id ? String(params.id) : "";
        if (!pid) return jsonError("missing_patient_id", 400);
        const b = (await readJsonBody(request)) || {};
        const rank = b.rank === "secondary" ? "secondary" : "primary";
        const a = b.address || {};
        const now = Date.now();
        const fields = {
            payer_id: b.payer_id || null,
            member_id: (b.member_id || "").trim() || null,
            group_number: (b.group_number || "").trim() || null,
            relationship: ["self", "spouse", "child", "other"].includes(b.relationship) ? b.relationship : "self",
            subscriber_first_name: (b.subscriber_first_name || "").trim() || null,
            subscriber_last_name: (b.subscriber_last_name || "").trim() || null,
            subscriber_dob: (b.subscriber_dob || "").trim() || null,
            patient_gender: ["M", "F", "U"].includes((b.patient_gender || "").toUpperCase()) ? b.patient_gender.toUpperCase() : null,
            address_line1: (a.line1 || "").trim() || null,
            address_city: (a.city || "").trim() || null,
            address_state: (a.state || "").trim().toUpperCase() || null,
            address_zip: (a.zip || "").trim() || null,
        };

        const existing = await env.DB.prepare(`SELECT id FROM patient_insurance WHERE patient_id = ? AND rank = ? AND active = 1`).bind(pid, rank).first().catch(() => null);
        if (existing) {
            await env.DB.prepare(
                `UPDATE patient_insurance SET payer_id=?, member_id=?, group_number=?, relationship=?, subscriber_first_name=?, subscriber_last_name=?, subscriber_dob=?, patient_gender=?, address_line1=?, address_city=?, address_state=?, address_zip=?, updated_at=? WHERE id=?`
            ).bind(fields.payer_id, fields.member_id, fields.group_number, fields.relationship, fields.subscriber_first_name, fields.subscriber_last_name, fields.subscriber_dob, fields.patient_gender, fields.address_line1, fields.address_city, fields.address_state, fields.address_zip, now, existing.id).run();
        } else {
            await env.DB.prepare(
                `INSERT INTO patient_insurance (id, patient_id, rank, payer_id, member_id, group_number, relationship, subscriber_first_name, subscriber_last_name, subscriber_dob, patient_gender, address_line1, address_city, address_state, address_zip, active, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
            ).bind(newId(), pid, rank, fields.payer_id, fields.member_id, fields.group_number, fields.relationship, fields.subscriber_first_name, fields.subscriber_last_name, fields.subscriber_dob, fields.patient_gender, fields.address_line1, fields.address_city, fields.address_state, fields.address_zip, now, now).run();
        }
        try {
            await logAudit(env, {
                user_id: (admin && admin.user) || "admin", user_role: "staff", action: "insurance_update",
                record_type: "patient_insurance", record_id: pid, success: true,
                ip: request.headers.get("CF-Connecting-IP"), user_agent: request.headers.get("user-agent"),
                details: { rank, payer_id: fields.payer_id, has_member_id: !!fields.member_id },
            }, ctx);
        } catch {}
        return jsonResponse({ ok: true, rank });
    });
}
