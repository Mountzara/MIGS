// =====================================================================
// /api/v1/admin/referral-directory — who we refer to, and who covers them
// =====================================================================
// GET  → the directory. Pass ?payer_name= and ?plan_type= and every row
//        comes back RANKED with a coverage verdict, so an out-of-network
//        HMO destination cannot be picked by accident.
// POST → add a destination. PATCH → edit one (including re-verifying its
//        network list, which is the entry that goes stale and costs the
//        patient money).
// =====================================================================

import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../_lib/admin_api.js";
import { newId } from "../../../_lib/db.js";
import { rankDestinations } from "../../../_lib/referrals.js";

const KINDS = ["specialist", "lab", "imaging"];

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env, request }) => {
        const url = new URL(request.url);
        const kind = url.searchParams.get("kind");
        const payer_name = url.searchParams.get("payer_name") || "";
        const plan_type = url.searchParams.get("plan_type") || "unknown";
        const conds = ["active = 1"], binds = [];
        if (kind && KINDS.includes(kind)) { conds.push("kind = ?"); binds.push(kind); }
        const rows = (await env.DB.prepare(
            `SELECT * FROM referral_directory WHERE ${conds.join(" AND ")} ORDER BY name ASC`
        ).bind(...binds).all())?.results || [];
        const parsed = rows.map(r => ({
            ...r,
            networks: (() => { try { return r.networks_json ? JSON.parse(r.networks_json) : []; } catch { return []; } })(),
        }));
        // Only rank when we were told who the patient is insured by —
        // otherwise every row would carry a meaningless "verify".
        const out = payer_name ? rankDestinations(parsed, { payer_name, plan_type }) : parsed;
        return jsonResponse({ ok: true, destinations: out, count: out.length, ranked: !!payer_name });
    });
}

export async function onRequestPost(ctx) {
    return adminRoute(ctx, async ({ env, request }) => {
        const body = await readJsonBody(request);
        if (!body || !body.name) return jsonError("name_required", 400);
        const kind = KINDS.includes(body.kind) ? body.kind : "specialist";
        const id = newId(), now = Date.now();
        await env.DB.prepare(`
            INSERT INTO referral_directory
                (id, name, org_name, kind, specialty, npi, phone, fax, address, city, state, zip,
                 networks_json, networks_verified_at, accepts_cash, cash_price_note, notes, active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        `).bind(id, String(body.name).slice(0, 200), body.org_name || null, kind, body.specialty || null,
                body.npi || null, body.phone || null, body.fax || null, body.address || null,
                body.city || null, body.state || null, body.zip || null,
                JSON.stringify(body.networks || []), body.networks_verified_at || null,
                body.accepts_cash ? 1 : 0, body.cash_price_note || null,
                String(body.notes || "").slice(0, 1000), now, now).run();
        return jsonResponse({ ok: true, id }, { status: 201 });
    });
}

export async function onRequestPatch(ctx) {
    return adminRoute(ctx, async ({ env, request }) => {
        const body = await readJsonBody(request);
        if (!body || !body.id) return jsonError("id_required", 400);
        const row = await env.DB.prepare(`SELECT id FROM referral_directory WHERE id = ?`).bind(body.id).first();
        if (!row) return jsonError("destination_not_found", 404);
        const now = Date.now();
        const sets = ["updated_at = ?"], binds = [now];
        for (const k of ["name", "org_name", "specialty", "npi", "phone", "fax", "address", "city", "state", "zip", "cash_price_note", "notes"]) {
            if (typeof body[k] === "string") { sets.push(`${k} = ?`); binds.push(body[k].slice(0, 500)); }
        }
        if (Array.isArray(body.networks)) {
            sets.push("networks_json = ?", "networks_verified_at = ?");
            binds.push(JSON.stringify(body.networks), body.networks_verified_at || new Date().toISOString().slice(0, 10));
        }
        if (typeof body.accepts_cash === "boolean") { sets.push("accepts_cash = ?"); binds.push(body.accepts_cash ? 1 : 0); }
        if (typeof body.active === "boolean") { sets.push("active = ?"); binds.push(body.active ? 1 : 0); }
        await env.DB.prepare(`UPDATE referral_directory SET ${sets.join(", ")} WHERE id = ?`).bind(...binds, body.id).run();
        return jsonResponse({ ok: true });
    });
}
