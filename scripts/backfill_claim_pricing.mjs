#!/usr/bin/env node
// =====================================================================
// backfill_claim_pricing.mjs — price the claims that synced before the
// alias layer existed
// =====================================================================
// The transcription app labels visits in speech ("Problem Visit") while
// the service catalog is keyed by slug, so every claim it synced landed
// at $0 and the billing queue understated the practice. New pushes now
// resolve through _lib/visit_type_alias.js; this applies the identical
// logic to the ones already stored.
//
// It ONLY touches rows where expected_collection_cents is 0 or null, so
// a figure the app actually sent is never overwritten. Idempotent.
//
//   source ~/.config/mountzara/scoped-tokens.env
//   node scripts/backfill_claim_pricing.mjs --dry
//   node scripts/backfill_claim_pricing.mjs
// =====================================================================
import alias from "../functions/_lib/visit_type_alias.js";

const DRY = process.argv.includes("--dry");
const ACCOUNT = "8fbe127f640681ddd813aaf33b95507f";
const DB = process.env.MZ_D1_ID, TOKEN = process.env.CF_D1_TOKEN;
if (!DB || !TOKEN) { console.error("source ~/.config/mountzara/scoped-tokens.env first"); process.exit(1); }

async function q(sql) {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DB}/query`, {
        method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ sql }),
    });
    const j = await r.json();
    if (!j.success) throw new Error(JSON.stringify(j.errors));
    return j.result[0].results;
}

const catalog = await q(`SELECT visit_type_key, default_unit_price_cents FROM billing_service_catalog
                          WHERE is_active = 1 AND visit_type_key IS NOT NULL`);
const keys = catalog.map((c) => c.visit_type_key);
const priceOf = (k) => (catalog.find((c) => c.visit_type_key === k) || {}).default_unit_price_cents || 0;

const claims = await q(`SELECT id, em_code, visit_type FROM billing_claims
                         WHERE COALESCE(expected_collection_cents, 0) = 0`);
console.log(`${claims.length} claim(s) with no expected collection.\n`);

let priced = 0, skipped = 0;
for (const c of claims) {
    let hit = alias.toCatalogKey(c.visit_type, keys);
    if (!hit.key) hit = alias.fromEmCode(c.em_code, keys);
    const cents = hit.key ? priceOf(hit.key) : 0;
    if (!cents) {
        skipped++;
        console.log(`  skip  ${c.id.slice(0, 8)}  ${c.em_code || "(no code)"} / ${c.visit_type || "(no visit type)"} — nothing in the catalog matches; leaving at $0 rather than inventing one`);
        continue;
    }
    console.log(`  price ${c.id.slice(0, 8)}  ${c.em_code} / ${c.visit_type || "(none)"} -> $${(cents / 100).toFixed(0)} via ${hit.via}`);
    if (!DRY) {
        await q(`UPDATE billing_claims SET expected_collection_cents = ${cents}, updated_at = ${Date.now()}
                  WHERE id = '${c.id}' AND COALESCE(expected_collection_cents, 0) = 0`);
    }
    priced++;
}
console.log(`\n${DRY ? "[dry] would price" : "priced"} ${priced}, skipped ${skipped}.`);
console.log("These are the practice's CASH prices. When a payer contract exists, the contracted rate supersedes them.");
