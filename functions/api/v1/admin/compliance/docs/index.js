// =====================================================================
// /api/v1/admin/compliance/docs
//   GET → list every compliance doc with its current signature state
//         (signed / unsigned / superseded / needs-review).
// =====================================================================

import { adminRoute, jsonResponse, jsonError } from "../../../../../_lib/admin_api.js";
import { COMPLIANCE_DOCS, getActiveSignaturesByDoc } from "../../../../../_lib/signatures.js";

export async function onRequest(ctx) {
    return adminRoute(ctx, async ({ env, request }) => {
        if (request.method !== "GET") return jsonError("method_not_allowed", 405);
        const activeByDoc = await getActiveSignaturesByDoc(env);
        const today = new Date().toISOString().slice(0, 10);
        const docs = COMPLIANCE_DOCS.map((d) => {
            const sig = activeByDoc[d.slug] || null;
            let status = "unsigned";
            let due_in_days = null;
            if (sig) {
                status = "signed";
                if (sig.next_review_date) {
                    const due = new Date(sig.next_review_date).getTime();
                    const now = new Date(today).getTime();
                    due_in_days = Math.round((due - now) / (24 * 3600 * 1000));
                    if (due_in_days < 0) status = "review_overdue";
                    else if (due_in_days <= 60) status = "review_due_soon";
                }
            }
            return {
                slug: d.slug,
                path: d.path,
                title: d.title,
                review_interval_months: d.review_interval_months,
                counsel_review_recommended: !!d.counsel_review_recommended,
                status,
                signed_at: sig?.signed_at || null,
                signed_by: sig?.signed_by_display_name || null,
                next_review_date: sig?.next_review_date || null,
                due_in_days,
                signature_id: sig?.signature_id || null,
                signature_display_name: sig?.signature_display_name || null,
                document_sha256_at_signing: sig?.document_sha256 || null,
            };
        });
        return jsonResponse({ ok: true, docs });
    });
}
