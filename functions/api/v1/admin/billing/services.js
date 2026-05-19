// GET /api/v1/admin/billing/services — list catalog (for invoice builder UI)
import { adminRoute, jsonResponse } from "../../../../_lib/admin_api.js";
import { listServiceCatalog } from "../../../../_lib/billing.js";

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env }) => {
        const services = await listServiceCatalog(env, { activeOnly: true });
        return jsonResponse({ services });
    });
}
