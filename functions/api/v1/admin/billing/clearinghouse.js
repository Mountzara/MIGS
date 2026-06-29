// =====================================================================
// /api/v1/admin/billing/clearinghouse — go-live readiness + payer seed
// =====================================================================
// GET  → readiness report: selected clearinghouse, whether its credentials
//        are present, supported vendors, live/test mode, billing-provider
//        identifier completeness, payer-directory status, and a checklist.
// POST { action: "seed_payers" } → upsert the IL/CA + national payer
//        directory into billing_payers (idempotent by payer_name). Each
//        lands with verify flags; confirm the payer IDs against your
//        clearinghouse's payer list before live submission.
//
// Sets nothing secret — clearinghouse credentials + BILLING_PROVIDER_* live
// as Cloudflare env secrets (see docs/BILLING_GO_LIVE.md). Auth: adminRoute.
// =====================================================================

import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../../_lib/admin_api.js";
import { clearinghouseVendor, providerConfig, isConfigured, CLEARINGHOUSES } from "../../../../_lib/clearinghouse.js";
import { PAYERS, toPayerRow } from "../../../../_lib/payer_directory.js";
import { newId } from "../../../../_lib/db.js";

function providerReadiness(env) {
    const vendor = clearinghouseVendor(env);
    const cfg = providerConfig(env, vendor);
    return {
        selected_vendor: vendor,
        label: cfg ? cfg.label : vendor,
        credentials_configured: isConfigured(env, vendor),
        live_mode: env.CLEARINGHOUSE_LIVE === "1",           // false => claims build as usage 'T' (test)
        rest_endpoint: cfg ? !!(cfg.baseUrl && cfg.submitPath) : false,
        note: cfg && cfg.note ? cfg.note : null,
    };
}

function billingProviderReadiness(env) {
    const missing = [];
    if (!/^\d{10}$/.test(String(env.BILLING_PROVIDER_NPI || "").replace(/\D/g, ""))) missing.push("BILLING_PROVIDER_NPI");
    if (!env.BILLING_PROVIDER_TIN) missing.push("BILLING_PROVIDER_TIN");
    if (!env.BILLING_PROVIDER_NAME) missing.push("BILLING_PROVIDER_NAME (defaulting to 'Mount Zara, LLC')");
    return { complete: missing.filter((m) => !m.includes("default")).length === 0, missing };
}

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env }) => {
        let seeded = 0, needVerify = 0, total = 0;
        try {
            const row = await env.DB.prepare(`SELECT COUNT(*) n FROM billing_payers`).first();
            seeded = row?.n || 0;
        } catch {}
        try {
            const row = await env.DB.prepare(`SELECT COUNT(*) n FROM billing_payers WHERE payer_id IS NULL OR payer_id = ''`).first();
            needVerify = row?.n || 0;
        } catch {}
        total = PAYERS.length;
        const prov = providerReadiness(env);
        const bp = billingProviderReadiness(env);
        const checklist = [
            { step: "Choose a clearinghouse + select it", done: prov.selected_vendor !== "mock", detail: `CLEARINGHOUSE_VENDOR=${prov.selected_vendor}` },
            { step: "Clearinghouse credentials set", done: prov.credentials_configured && prov.selected_vendor !== "mock" },
            { step: "Billing provider identifiers (NPI/TIN/name) set", done: bp.complete, detail: bp.missing.join(", ") || "ok" },
            { step: "Payer directory seeded", done: seeded > 0, detail: `${seeded} payer(s) in billing_payers; directory has ${total}` },
            { step: "Payer IDs verified against clearinghouse list", done: seeded > 0 && needVerify === 0, detail: `${needVerify} still missing a payer_id` },
            { step: "Insurance capture in intake (member id/gender/address)", done: false, detail: "data-model gap — supply in submit body until added" },
            { step: "Test claim accepted (277CA, usage 'T')", done: false, detail: "run dry_run then a test submit" },
            { step: "Go live (CLEARINGHOUSE_LIVE=1, usage 'P')", done: prov.live_mode },
        ];
        return jsonResponse({
            clearinghouse: prov,
            supported: CLEARINGHOUSES,
            billing_provider: bp,
            payers: { in_db: seeded, directory_total: total, missing_payer_id: needVerify },
            ready_to_go_live: prov.selected_vendor !== "mock" && prov.credentials_configured && bp.complete && seeded > 0 && needVerify === 0,
            checklist,
        });
    });
}

export async function onRequestPost(ctx) {
    return adminRoute(ctx, async ({ env, request }) => {
        const body = (await readJsonBody(request)) || {};
        if (body.action !== "seed_payers") return jsonError("unknown_action — expected { action: 'seed_payers' }", 400);
        const vendor = clearinghouseVendor(env);
        const now = Date.now();
        let inserted = 0, skipped = 0;
        for (const p of PAYERS) {
            try {
                const existing = await env.DB.prepare(`SELECT id FROM billing_payers WHERE payer_name = ?`).bind(p.name).first();
                if (existing) { skipped++; continue; }
                const r = toPayerRow(p, now);
                r.clearinghouse_vendor = vendor === "mock" ? null : vendor;
                await env.DB.prepare(
                    `INSERT INTO billing_payers (id, payer_id, payer_name, payer_kind, contract_status, clearinghouse_vendor, notes, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
                ).bind(newId(), r.payer_id, r.payer_name, r.payer_kind, r.contract_status, r.clearinghouse_vendor, r.notes, r.created_at, r.updated_at).run();
                inserted++;
            } catch (e) { /* keep going; report counts */ }
        }
        return jsonResponse({
            ok: true, inserted, skipped, directory_total: PAYERS.length,
            note: "Verify each payer_id against your clearinghouse's payer list before live submission. Entries with verify:'required'/'lookup' need a confirmed ID.",
        });
    });
}
