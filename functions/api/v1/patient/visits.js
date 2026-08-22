// =====================================================================
// GET /api/v1/patient/visits — the member's own visit summaries
// =====================================================================
// THE ONE RULE THIS FILE EXISTS TO ENFORCE
//
// A patient may only ever read a summary whose status is 'approved'. Not
// pending, not rejected, not one that was regenerated after approval and
// is waiting to be read again. The portal promises "reviewed and signed
// off by Dr. Mabini" — that is a clinical safety claim, and an unreviewed
// AI summary of a medical visit reaching a patient is the exact harm the
// sentence is there to prevent.
//
// So the filter is in the WHERE clause. Not applied afterwards in
// JavaScript, where a future refactor could drop it and nothing would
// visibly break — the rows would simply start appearing.
// =====================================================================

import { requireRole } from "../../../_lib/auth.js";
import { previewAccess, preLaunchNotFound } from "../../../_lib/preview_gate.js";
import { getPhiObject } from "../../../_lib/phi.js";
import { STATUS, patientMayRead } from "../../../_lib/visit_summary.js";

function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
}

export async function onRequestGet(ctx) {
    const { env, request } = ctx;

    // Pre-launch cloak, matching every other /api/v1/patient/* route.
    const { allow } = await previewAccess(request, env);
    if (!allow) return preLaunchNotFound();

    let session;
    try { session = await requireRole(ctx, ["patient"]); }
    catch (resp) { return resp; }

    const patientId = session.patient_id || session.user_id;
    if (!patientId) return json({ ok: false, error: "no patient on this session" }, 403);

    const url = new URL(request.url);
    const wantId = url.searchParams.get("id");

    // status = 'approved' is in the SQL on purpose. See the header.
    const rows = await env.DB.prepare(
        `SELECT s.id, s.encounter_id, s.plan_summary, s.next_step_summary,
                s.medications_list_json, s.patient_visible_r2_key,
                s.patient_visible_wrapped_dek, s.status, s.updated_at,
                s.patient_first_viewed_at,
                e.visit_date, e.visit_type_actual
           FROM encounter_ai_summaries s
           JOIN encounters e ON e.id = s.encounter_id
          WHERE s.patient_id = ? AND s.status = ?
          ORDER BY e.visit_date DESC, s.created_at DESC
          LIMIT 50`
    ).bind(patientId, STATUS.APPROVED).all();

    const list = (rows?.results || []).filter(patientMayRead);   // belt and braces

    // The list view needs no decryption — that is what the denormalised
    // columns are for. Only an explicitly requested summary is opened.
    const summaries = list.map((r) => ({
        id: r.id,
        visit_date: r.visit_date,
        visit_type: r.visit_type_actual,
        plan: r.plan_summary,
        next_step: r.next_step_summary,
        medications: (() => { try { return JSON.parse(r.medications_list_json || "[]"); } catch { return []; } })(),
        new_for_you: !r.patient_first_viewed_at,
    }));

    if (!wantId) return json({ ok: true, visits: summaries });

    const one = list.find((r) => r.id === wantId);
    if (!one) return json({ ok: false, error: "not found" }, 404);

    // TWO sealing conventions exist for the same column, because two
    // writers were built a phase apart:
    //   * the admin generate/edit path seals with visit_summary_patient:<id>
    //   * the transcription-app sync path seals with
    //     encounter/<encounter_id>/summary_patient
    // The reader knew only the first, so every summary the app pushed was
    // approved, marked visible — and permanently unopenable, with a 500
    // presented to the patient. AAD is authenticated data: the wrong string
    // simply fails decryption, so trying the second convention on failure
    // is safe and cannot open anything that was not legitimately written.
    let text = "";
    const aads = [`visit_summary_patient:${one.id}`, `encounter/${one.encounter_id}/summary_patient`];
    for (const aad of aads) {
        try {
            const got = await getPhiObject(env, one.patient_visible_r2_key,
                one.patient_visible_wrapped_dek, aad);
            text = typeof got === "string" ? got : new TextDecoder().decode(got?.plaintext || got || new Uint8Array());
            if (text) break;
        } catch { /* try the next convention */ }
    }
    if (!text) {
        return json({ ok: false, error: "that summary could not be opened" }, 500);
    }

    // The reading Dr. Mabini attached to THIS visit, with the reason in
    // her words. Assignments are written at approval time; this only
    // reads them, so a patient can never see material for a summary that
    // was never approved.
    let reading = [];
    try {
        const rs = await env.DB.prepare(`
            SELECT m.slug, m.title, m.summary, a.reason
              FROM patient_education_assignments a
              JOIN education_materials m ON m.id = a.material_id
             WHERE a.patient_id = ? AND m.status = 'published'
             ORDER BY a.assigned_at DESC LIMIT 3
        `).bind(patientId).all();
        reading = (rs?.results || []).map((r) => ({
            slug: r.slug, title: r.title, summary: r.summary, reason: r.reason,
            href: `/portal/education/${r.slug}/`,
        }));
    } catch { reading = []; }

    // First view is recorded once, so the portal can mark what is new and
    // the practice can see whether summaries are actually being read.
    if (!one.patient_first_viewed_at) {
        try {
            await env.DB.prepare(
                `UPDATE encounter_ai_summaries SET patient_first_viewed_at = ? WHERE id = ? AND patient_first_viewed_at IS NULL`
            ).bind(Date.now(), one.id).run();
        } catch { /* never fail a read because a view counter did */ }
    }

    return json({
        ok: true,
        visit: {
            id: one.id, visit_date: one.visit_date, visit_type: one.visit_type_actual,
            text,
            medications: (() => { try { return JSON.parse(one.medications_list_json || "[]"); } catch { return []; } })(),
            reading,
        },
        note: "This summary was written by Dr. Mabini's system and reviewed and approved by him before you saw it. If anything here does not match what you remember, message the practice — that is worth knowing about.",
    });
}
