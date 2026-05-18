// =====================================================================
// POST /api/v1/admin/proms/seed — load PROM JSON defs into prom_definitions
// =====================================================================
// Admin-only. Reads /assets/proms/*.json from R2 or from the deploy bundle
// (fetched via the request origin) and upserts each into prom_definitions.
//
// Body: { slugs?: ['phq-2', 'gad-2', ...] }  // omit to seed all known slugs
// Returns: { ok, seeded: [...], skipped: [...], errors: [...] }
// =====================================================================

import { adminRoute, jsonResponse, jsonError } from "../../../../_lib/admin_api.js";

// Canonical slug list:
//   - Round A Tier 1 universal: phq-2, gad-2, bpi-sf
//   - Round A Tier 2 endo short form: ehp-5
//   - Round B Tier 2: pgi-i, pcs, pfdi-20
//   - Round C (this round) Tier 2 expansion: ehp-30 (gold standard endometriosis),
//     iciq-ui-sf (urinary incontinence), pfiq-7 (pelvic floor impact),
//     ufs-qol-ss (uterine fibroid symptom severity), csi (central sensitization),
//     fsfi (sexual function), menqol (menopause QoL)
const KNOWN_SLUGS = [
    "phq-2", "gad-2", "bpi-sf",
    "ehp-5", "ehp-30",
    "pgi-i", "pcs", "pfdi-20", "pfiq-7",
    "iciq-ui-sf", "ufs-qol-ss",
    "csi", "fsfi", "menqol"
];

async function fetchDef(originUrl, slug) {
    const url = `${originUrl}/assets/proms/${encodeURIComponent(slug)}.json`;
    const r = await fetch(url, { cf: { cacheTtl: 0 } });
    if (!r.ok) throw new Error(`fetch ${slug}: HTTP ${r.status}`);
    return await r.json();
}

async function upsert(env, def) {
    if (!def || !def.slug) throw new Error("def missing slug");
    const now = new Date().toISOString();
    await env.DB.prepare(`
        INSERT INTO prom_definitions
          (slug, title, short_name, tier, domain, description, estimated_minutes,
           items_json, scoring_json, thresholds_json, citation, license_note,
           version, is_active, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)
        ON CONFLICT(slug) DO UPDATE SET
          title=excluded.title,
          short_name=excluded.short_name,
          tier=excluded.tier,
          domain=excluded.domain,
          description=excluded.description,
          estimated_minutes=excluded.estimated_minutes,
          items_json=excluded.items_json,
          scoring_json=excluded.scoring_json,
          thresholds_json=excluded.thresholds_json,
          citation=excluded.citation,
          license_note=excluded.license_note,
          version=excluded.version,
          is_active=1,
          updated_at=excluded.updated_at
    `).bind(
        def.slug,
        def.title || def.slug,
        def.short_name || def.slug,
        Number.isInteger(def.tier) ? def.tier : 2,
        def.domain || null,
        def.description || null,
        def.estimated_minutes || null,
        JSON.stringify(def.items || []),
        JSON.stringify(def.scoring || {}),
        JSON.stringify(def.thresholds || []),
        def.citation || null,
        def.license_note || null,
        def.version || "1.0",
        now, now
    ).run();
}

export async function onRequestPost(ctx) {
    return adminRoute(ctx, async ({ env, request }) => {
        if (!env.DB) return jsonError("server_error", 500);

        let body = {};
        try { body = await request.json(); } catch {}
        const slugs = Array.isArray(body.slugs) && body.slugs.length ? body.slugs : KNOWN_SLUGS;

        const origin = new URL(request.url).origin;
        const seeded = [], skipped = [], errors = [];

        for (const slug of slugs) {
            try {
                const def = await fetchDef(origin, slug);
                await upsert(env, def);
                seeded.push(slug);
            } catch (e) {
                errors.push({ slug, error: String(e && e.message || e) });
            }
        }

        return jsonResponse({ ok: true, seeded, skipped, errors });
    });
}
