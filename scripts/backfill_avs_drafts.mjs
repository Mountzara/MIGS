#!/usr/bin/env node
// =====================================================================
// backfill_avs_drafts.mjs — draft the summaries for notes already synced
// =====================================================================
// Auto-drafting was added after the app had already pushed several
// notes, so those encounters sit as "not drafted": nothing waiting for
// him, nothing for the patient. This walks them through the same path a
// new note takes, by re-posting each note's own content through the
// admin generate/draft route.
//
// It is read-then-write against production and is idempotent: an
// encounter that already has a summary row is skipped.
//
//   node scripts/backfill_avs_drafts.mjs --dry
//   node scripts/backfill_avs_drafts.mjs
// =====================================================================
const DRY = process.argv.includes("--dry");
const ACCOUNT = "8fbe127f640681ddd813aaf33b95507f";
const DB = process.env.MZ_D1_ID;
const TOKEN = process.env.CF_D1_TOKEN;
if (!DB || !TOKEN) { console.error("source ~/.config/mountzara/scoped-tokens.env first"); process.exit(1); }

async function q(sql) {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DB}/query`, {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ sql }),
    });
    const j = await r.json();
    if (!j.success) throw new Error(JSON.stringify(j.errors));
    return j.result[0].results;
}

const rows = await q(`
    SELECT e.id, e.chief_complaint, e.visit_date
      FROM encounters e
      LEFT JOIN encounter_ai_summaries s ON s.encounter_id = e.id
     WHERE e.note_source = 'transcription_app'
       AND e.note_wrapped_dek IS NOT NULL
       AND s.id IS NULL
     ORDER BY e.created_at DESC`);

console.log(`${rows.length} synced encounter(s) with no summary draft.`);
for (const r of rows) {
    console.log(`  ${r.id.slice(0, 8)}  ${r.visit_date}  ${(r.chief_complaint || "(no chief complaint)").slice(0, 46)}`);
}
if (DRY) { console.log("\n--dry: nothing written."); process.exit(0); }
if (rows.length === 0) process.exit(0);

// The note body is encrypted at rest and only the Worker holds the key,
// so drafting must happen server-side: ask the admin endpoint to draft.
const ADMIN = process.env.MZ_ADMIN_BASIC;
if (!ADMIN) { console.error("Set MZ_ADMIN_BASIC='user:pass' to run the write pass."); process.exit(1); }
let done = 0, failed = 0;
for (const r of rows) {
    const resp = await fetch(`https://mountzara.com/api/v1/admin/encounters/${r.id}/summary`, {
        method: "POST",
        headers: { authorization: "Basic " + Buffer.from(ADMIN).toString("base64"), "content-type": "application/json" },
        body: JSON.stringify({ action: "draft_from_note" }),
    });
    const j = await resp.json().catch(() => ({}));
    if (resp.ok && j.ok) { done++; console.log(`  drafted ${r.id.slice(0, 8)}`); }
    else { failed++; console.log(`  FAILED  ${r.id.slice(0, 8)} — ${j.error || resp.status}`); }
}
console.log(`\ndrafted ${done}, failed ${failed}`);
