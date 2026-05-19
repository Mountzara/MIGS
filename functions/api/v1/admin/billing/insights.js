// =====================================================================
// GET /api/v1/admin/billing/insights?window=mtd|qtd|ytd|l30d|l90d|l365d
// =====================================================================
// Returns: { insights: <KPIs>, narrative: <AI narrative>, cached: <bool>, generated_at }
//
// Caches results in MZ_SESSIONS KV for 5 minutes to avoid burning
// Anthropic quota on every dashboard load. Force-bypass with ?fresh=1.
// =====================================================================

import { adminRoute, jsonResponse } from "../../../../_lib/admin_api.js";
import { computeBillingInsights } from "../../../../_lib/billing_insights.js";
import { generateBillingNarrative } from "../../../../_lib/billing_ai_advisor.js";

const CACHE_TTL_SECONDS = 300; // 5 minutes

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env, request }) => {
        const url = new URL(request.url);
        const window = url.searchParams.get("window") || "mtd";
        const fresh  = url.searchParams.get("fresh") === "1";
        const cacheKey = `mz:billing_insights:${window}`;

        // 1. Try cache
        if (!fresh && env.MZ_SESSIONS) {
            try {
                const cached = await env.MZ_SESSIONS.get(cacheKey, { type: "json" });
                if (cached && cached.insights && cached.narrative) {
                    return jsonResponse({ ...cached, cached: true });
                }
            } catch {}
        }

        // 2. Compute KPIs
        const insights = await computeBillingInsights(env, { window });

        // 3. Narrate (Claude or rule-based fallback)
        const narrative = await generateBillingNarrative(env, insights);

        const payload = {
            insights,
            narrative,
            generated_at: new Date().toISOString(),
            cached: false,
        };

        // 4. Cache
        if (env.MZ_SESSIONS) {
            try {
                await env.MZ_SESSIONS.put(cacheKey, JSON.stringify(payload), { expirationTtl: CACHE_TTL_SECONDS });
            } catch {}
        }

        return jsonResponse(payload);
    });
}
