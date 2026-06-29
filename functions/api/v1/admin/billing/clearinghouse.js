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
        // Per-vendor credential status — for practices routing payers across MULTIPLE clearinghouses.
        const vendorsConfigured = CLEARINGHOUSES.filter((c) => c.vendor !== "mock").map((c) => ({ vendor: c.vendor, label: c.label, configured: isConfigured(env, c.vendor) }));
        const anyVendorConfigured = vendorsConfigured.some((v) => v.configured);
        const checklist = [
            { step: "Choose a clearinghouse + select it", done: prov.selected_vendor !== "mock", detail: `CLEARINGHOUSE_VENDOR=${prov.selected_vendor}` },
            { step: "Clearinghouse credentials set", done: prov.credentials_configured && prov.selected_vendor !== "mock" },
            { step: "Billing provider identifiers (NPI/TIN/name) set", done: bp.complete, detail: bp.missing.join(", ") || "ok" },
            { step: "Payer directory seeded", done: seeded > 0, detail: `${seeded} payer(s) in billing_payers; directory has ${total}` },
            { step: "Payer IDs verified against clearinghouse list", done: seeded > 0 && needVerify === 0, detail: `${needVerify} still missing a payer_id` },
            { step: "Patient insurance captured (member id/gender/address)", done: true, detail: "per-patient at /admin/billing/insurance/ → auto-fills every claim (scrub blocks if a patient's is missing)" },
            { step: "Test claim accepted (277CA, usage 'T')", done: false, detail: "run dry_run then a test submit" },
            { step: "Go live (CLEARINGHOUSE_LIVE=1, usage 'P')", done: prov.live_mode },
        ];
        return jsonResponse({
            clearinghouse: prov,
            supported: CLEARINGHOUSES,
            vendors_configured: vendorsConfigured,   // per-vendor creds (multi-clearinghouse routing by payer.clearinghouse_vendor)
            billing_provider: bp,
            payers: { in_db: seeded, directory_total: total, missing_payer_id: needVerify },
            ready_to_go_live: (prov.credentials_configured || anyVendorConfigured) && bp.complete && seeded > 0 && needVerify === 0 && prov.live_mode,
            checklist,
        });
    });
}

export async function onRequestPost(ctx) {
    return adminRoute(ctx, async ({ env, request }) => {
        const body = (await readJsonBody(request)) || {};

        // Route payer categories to clearinghouses in one shot (minimal go-live setup).
        // { action:"route_by_kind", map:{ commercial:"availity", medicare:"claim_md", medicaid:"claim_md" } }
        // or per-payer: { action:"route", assignments:[{ payer_id, vendor }] }  (payer_id = billing_payers.id)
        if (body.action === "route_by_kind" || body.action === "route") {
            const now = Date.now();
            let updated = 0;
            if (body.action === "route_by_kind") {
                for (const [kind, vendor] of Object.entries(body.map || {})) {
                    const r = await env.DB.prepare(`UPDATE billing_payers SET clearinghouse_vendor = ?, updated_at = ? WHERE payer_kind = ?`)
                        .bind(vendor || null, now, kind).run().catch(() => null);
                    updated += (r && r.meta && r.meta.changes) || 0;
                }
            } else {
                for (const a of (body.assignments || [])) {
                    const r = await env.DB.prepare(`UPDATE billing_payers SET clearinghouse_vendor = ?, updated_at = ? WHERE id = ?`)
                        .bind(a.vendor || null, now, a.payer_id).run().catch(() => null);
                    updated += (r && r.meta && r.meta.changes) || 0;
                }
            }
            return jsonResponse({ ok: true, updated });
        }

        if (body.action !== "seed_payers") return jsonError("unknown_action — expected 'seed_payers' | 'route_by_kind' | 'route'", 400);
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
