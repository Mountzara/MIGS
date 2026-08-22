// =====================================================================
// /api/v1/admin/gfe — Good Faith Estimates (No Surprises Act)
// =====================================================================
// GET  → estimates, with the regulation's DEADLINE computed for each and
//        overdue drafts flagged. An unissued estimate past its deadline
//        is a compliance failure sitting in the database, so it is
//        surfaced rather than left to be remembered.
// POST → create a draft from a patient + service date + line items. The
//        deadline is computed from the scheduling date, not from today.
// =====================================================================

import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../_lib/admin_api.js";
import { newId } from "../../../_lib/db.js";
import { logAudit } from "../../../_lib/audit.js";
import { gfeDueBy, isGfeOverdue, totals, DISCLAIMER_VERSION } from "../../../_lib/gfe.js";

const todayStr = () => new Date().toISOString().slice(0, 10);

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env, request }) => {
        const url = new URL(request.url);
        const status = url.searchParams.get("status");
        const patient_id = url.searchParams.get("patient_id");
        const conds = [], binds = [];
        if (status) { conds.push("g.status = ?"); binds.push(status); }
        if (patient_id) { conds.push("g.patient_id = ?"); binds.push(patient_id); }
        const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
        const rows = (await env.DB.prepare(`
            SELECT g.*, p.first_name AS patient_first_name, p.last_name AS patient_last_name, p.email AS patient_email
              FROM good_faith_estimates g LEFT JOIN patients p ON p.id = g.patient_id
              ${where} ORDER BY g.created_at DESC LIMIT 200
        `).bind(...binds).all())?.results || [];
        const today = todayStr();
        const out = rows.map(g => ({ ...g, overdue: isGfeOverdue(g, today) }));
        return jsonResponse({
            ok: true, estimates: out,
            counts: { total: out.length, drafts: out.filter(g => g.status === "draft").length,
                      overdue: out.filter(g => g.overdue).length },
        });
    });
}

export async function onRequestPost(ctx) {
    return adminRoute(ctx, async ({ env, request, admin }) => {
        const body = await readJsonBody(request);
        if (!body || !body.patient_id) return jsonError("patient_id_required", 400);
        const scheduled_on = body.scheduled_on || todayStr();
        const due = gfeDueBy({ trigger_kind: body.trigger_kind || "scheduled", scheduled_on, service_date: body.service_date });

        const id = newId(), now = Date.now();
        const lines = Array.isArray(body.lines) ? body.lines : [];
        const sums = totals(lines);
        await env.DB.prepare(`
            INSERT INTO good_faith_estimates
                (id, patient_id, gfe_number, status, trigger_kind, scheduled_on, service_date, due_by,
                 primary_service, diagnosis_json, practice_total_cents, separate_scheduling_note,
                 disclaimer_version, created_at, updated_at)
            VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(id, body.patient_id, `GFE-${String(now).slice(-8)}`, body.trigger_kind || "scheduled",
                scheduled_on, body.service_date || null, due.due_by,
                String(body.primary_service || "").slice(0, 300), JSON.stringify(body.diagnosis || []),
                sums.practice_cents, String(body.separate_scheduling_note || "").slice(0, 1000),
                DISCLAIMER_VERSION, now, now).run();

        let sort = 0;
        for (const l of lines) {
            const qty = Number(l.quantity) || 1;
            const unit = Number(l.unit_cents) || 0;
            await env.DB.prepare(`
                INSERT INTO gfe_line_items
                    (id, gfe_id, kind, description, service_code, code_type, diagnosis_code, quantity,
                     unit_cents, total_cents, provider_name, provider_npi, provider_tin, provider_state, note, sort_order)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(newId(), id, l.kind === "outside" ? "outside" : "practice",
                    String(l.description || "").slice(0, 300), l.service_code || null, l.code_type || "CPT",
                    l.diagnosis_code || null, qty, unit, Number(l.total_cents) || qty * unit,
                    l.provider_name || null, l.provider_npi || null, l.provider_tin || null,
                    l.provider_state || null, String(l.note || "").slice(0, 300), sort++).run();
        }
        await logAudit(env, {
            user_id: admin.user, user_role: "staff", action: "gfe_create",
            record_type: "good_faith_estimate", record_id: id, success: true,
            details: { required: due.required, due_by: due.due_by },
        }, ctx);
        return jsonResponse({ ok: true, id, due_by: due.due_by, required: due.required, reason: due.reason }, { status: 201 });
    });
}
