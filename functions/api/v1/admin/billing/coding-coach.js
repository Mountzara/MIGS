// =====================================================================
// GET /api/v1/admin/billing/coding-coach?window=mtd|qtd|ytd|l30d|l90d|l365d
// =====================================================================
// Cross-encounter CODING COACH. Aggregates the per-encounter coding
// analysis the MountZaraMedicalTranscription app syncs in (see
// api/v1/sync/transcription/coding.js) into a coaching view: where you
// under-coded relative to what your note documents, the recurring
// compliance flags / documentation gaps you keep hitting, the modifiers
// you keep missing, your E/M mix, override rate, month-over-month trend,
// and deterministic coaching actions.
//
// Output (all de-identified aggregates — no PHI):
//   { coach: <CodingCoach>, cached: <bool>, generated_at }
//
// Cached 5 min in MZ_SESSIONS KV (deterministic — purely to spare D1 on
// dashboard loads). Force fresh with ?fresh=1.
// =====================================================================

import { adminRoute, jsonResponse } from "../../../../_lib/admin_api.js";
import { computeCodingCoach } from "../../../../_lib/coding_coach.js";

const CACHE_TTL_SECONDS = 300;
const WINDOWS = new Set(["mtd", "qtd", "ytd", "l30d", "l90d", "l365d"]);

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env, request }) => {
        const url = new URL(request.url);
        let window = url.searchParams.get("window") || "ytd";
        if (!WINDOWS.has(window)) window = "ytd";
        const fresh = url.searchParams.get("fresh") === "1";
        const cacheKey = `mz:coding_coach:${window}`;

        if (!fresh && env.MZ_SESSIONS) {
            try {
                const cached = await env.MZ_SESSIONS.get(cacheKey, { type: "json" });
                if (cached && cached.coach) return jsonResponse({ ...cached, cached: true });
            } catch {}
        }

        const coach = await computeCodingCoach(env, { window });
        const payload = { coach, cached: false, generated_at: coach.generated_at };

        if (env.MZ_SESSIONS) {
            try {
                await env.MZ_SESSIONS.put(cacheKey, JSON.stringify(payload), { expirationTtl: CACHE_TTL_SECONDS });
            } catch {}
        }
        return jsonResponse(payload);
    });
}
