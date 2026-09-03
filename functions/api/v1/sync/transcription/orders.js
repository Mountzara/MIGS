// =====================================================================
// POST /api/v1/sync/transcription/orders — dictated orders become tracked
// =====================================================================
// THE GAP THIS CLOSES. The transcription app already pushes the note, the
// coding analysis and the AI snapshot. What it could not push was the
// ORDERS inside the dictation — so "let's get a CBC and a ferritin, and
// send her to interventional radiology" produced a beautiful note and
// nothing that would ever notice the labs never came back. The physician
// had to re-enter each order by hand in the admin, which in practice
// means sometimes not at all, which is precisely how a missed result
// happens.
//
// Now the app posts what it parsed and each order lands in
// clinical_orders with its result clock already running (see
// _lib/orders.js). One dictation, and the safety net is armed.
//
// TWO REFUSALS, both deliberate:
//   * An order failing validation is REPORTED, never silently dropped and
//     never auto-completed with a guess. A fabricated diagnosis code on a
//     real lab order is worse than no order.
//   * `dry_run: true` returns exactly what WOULD be created without
//     writing, so the app can show the physician the orders for
//     confirmation before anything becomes real. Dictation mishears;
//     a tracked clinical order should never be the first place that shows.
// =====================================================================

import { syncRoute, syncJson, syncError } from "../../../../_lib/sync_auth.js";
import { newId } from "../../../../_lib/db.js";
import { logAudit } from "../../../../_lib/audit.js";
import { validateOrder, resultDueAt, ORDER_TYPES, PRIORITIES } from "../../../../_lib/orders.js";

export async function onRequestPost(ctx) {
    return syncRoute(ctx, "transcription", async ({ env, request }) => {
        let body;
        try { body = await request.json(); }
        catch { return syncError("invalid_json_body", 400); }
        const patient_id = String(body?.patient_id || "");
        if (!patient_id) return syncError("patient_id required", 400);
        const list = Array.isArray(body?.orders) ? body.orders : [];
        if (list.length === 0) return syncError("orders array is empty", 400);
        if (list.length > 40) return syncError("too many orders in one push", 400);

        const patient = await env.DB.prepare(`SELECT id FROM patients WHERE id = ?`).bind(patient_id).first();
        if (!patient) return syncError("patient_not_found", 404);

        const dryRun = body.dry_run === true;
        const session_id = body.transcription_session_id ? String(body.transcription_session_id).slice(0, 120) : null;
        const created = [], rejected = [];
        const now = Date.now();

        for (const raw of list) {
            const candidate = {
                patient_id,
                order_type: String(raw?.order_type || "").toLowerCase(),
                indication: String(raw?.indication || "").trim(),
                icd10: Array.isArray(raw?.icd10) ? raw.icd10.filter(Boolean) : [],
                tests: Array.isArray(raw?.tests) ? raw.tests.filter(Boolean) : [],
                specialty: raw?.specialty || null,
                consult_question: raw?.consult_question || null,
            };
            const check = validateOrder(candidate);
            if (!check.ok || !ORDER_TYPES.includes(candidate.order_type)) {
                rejected.push({
                    order_type: candidate.order_type || null,
                    summary: (candidate.tests[0]?.name) || candidate.specialty || raw?.modality || "(unnamed)",
                    missing: check.missing.length ? check.missing : ["order type"],
                });
                continue;
            }
            const priority = PRIORITIES.includes(raw?.priority) ? raw.priority : "routine";
            const due = resultDueAt(candidate.order_type, priority, now);

            if (dryRun) {
                created.push({ dry_run: true, order_type: candidate.order_type, priority,
                               tests: candidate.tests, result_due_at: due });
                continue;
            }

            const id = newId();
            await env.DB.prepare(`
                INSERT INTO clinical_orders
                    (id, patient_id, clinician_id, encounter_id, order_type, status, priority,
                     tests_json, modality, body_site, specialty, consult_question,
                     indication, icd10_json, facility_name, result_routing,
                     placed_at, result_due_at, prior_auth_status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 'placed', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'portal', ?, ?, 'unknown', ?, ?)
            `).bind(
                id, patient_id, raw?.clinician_id || null, body.encounter_id || null,
                candidate.order_type, priority,
                JSON.stringify(candidate.tests), raw?.modality || null, raw?.body_site || null,
                candidate.specialty, candidate.consult_question,
                candidate.indication.slice(0, 1000), JSON.stringify(candidate.icd10),
                raw?.facility_name || null, now, due, now, now
            ).run();

            await env.DB.prepare(
                `INSERT INTO order_events (id, order_id, at, actor, event, detail) VALUES (?, ?, ?, 'transcription', 'placed', ?)`
            ).bind(newId(), id, now, JSON.stringify({ session_id, source: "dictation" })).run();

            created.push({ id, order_type: candidate.order_type, priority, result_due_at: due,
                           tests: candidate.tests });
        }

        if (!dryRun) {
            try {
                await logAudit(env, {
                    user_id: "transcription", user_role: "app", action: "order_create",
                    record_type: "clinical_order", record_id: session_id || "dictation",
                    success: true,
                    details: { patient_id, created: created.length, rejected: rejected.length },
                }, ctx);
            } catch {}
        }

        return syncJson({
            ok: true, dry_run: dryRun,
            created: created.length, rejected: rejected.length,
            orders: created, rejected_orders: rejected,
            // Say plainly what a rejection means, so the app can show it
            // rather than swallowing it.
            note: rejected.length
                ? "Rejected orders were NOT created. Each needs the listed fields — no defaults are invented for a clinical order."
                : undefined,
        }, { status: dryRun ? 200 : 201 });
    });
}
