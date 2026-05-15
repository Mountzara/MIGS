// GET /api/v1/admin/visit-types — return the canonical visit type catalog.
import { adminRoute, jsonResponse } from "../../../_lib/admin_api.js";
import { visitTypeOptions } from "../../../_lib/visit_types.js";

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async () => {
        return jsonResponse({ visit_types: visitTypeOptions() });
    });
}
