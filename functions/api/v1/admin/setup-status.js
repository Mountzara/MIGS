// =====================================================================
// GET /api/v1/admin/setup-status — what still stands between this
// practice and seeing patients
// =====================================================================
// Backs the guided home screen. Every step's status is computed from
// real data by _lib/practice_setup.js; nothing here is remembered in a
// flag, because a checklist that ticks itself is a checklist that lies.
// =====================================================================

import { adminRoute, jsonResponse } from "../../../_lib/admin_api.js";
import { computeSetup } from "../../../_lib/practice_setup.js";

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env }) => {
        const setup = await computeSetup(env);
        return jsonResponse({ ok: true, ...setup });
    });
}
