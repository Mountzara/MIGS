// =====================================================================
// /api/v1/admin/compliance/docs/[slug]
//   GET  → return doc metadata + body + active signature record.
//   POST → sign the doc. Body: {signature_id, typed_attestation,
//          typed_initials, notes?}. Returns the new sign event.
//
// Auth: admin Basic Auth via readAdminIdentity. Conforms to the existing
// functions/_lib/signatures.js API (signDocument, getComplianceDoc,
// getActiveSignaturesByDoc, loadComplianceDocBody). Falls back to
// fetching the doc body from the static deploy if the build-time bundle
// (_lib/compliance_docs/index.js) isn't present.
// =====================================================================

import {
    jsonResponse, jsonError, readAdminIdentity, unauthorizedAdminJson,
} from "../../../../../_lib/admin_api.js";
import {
    getComplianceDoc,
    signDocument,
    getActiveSignaturesByDoc,
    loadComplianceDocBody,
} from "../../../../../_lib/signatures.js";
import { logAudit } from "../../../../../_lib/audit.js";

// Try the bundled compliance-doc body first (signatures.js exports that),
// then fall back to fetching the raw .md from the live deploy. The
// fallback lets the build succeed before the bundle script has been wired.
async function loadDocBody(slug, request) {
    try {
        const body = await loadComplianceDocBody(slug);
        if (body) return body;
    } catch {}
    const doc = getComplianceDoc(slug);
    if (!doc) return null;
    try {
        const origin = new URL(request.url).origin;
        const res = await fetch(`${origin}/${doc.path}`, {
            headers: { "user-agent": "mountzara-admin-compliance/1.0" },
        });
        if (!res.ok) return null;
        return await res.text();
    } catch {
        return null;
    }
}

export async function onRequestGet(ctx) {
    const { request, env, params } = ctx;
    const identity = await readAdminIdentity(request, env);
    if (!identity) return unauthorizedAdminJson();

    const slug = String(params?.slug || "").toLowerCase();
    const doc = getComplianceDoc(slug);
    if (!doc) return jsonError("unknown_compliance_doc", 404);

    const [body, activeMap] = await Promise.all([
        loadDocBody(slug, request),
        getActiveSignaturesByDoc(env).catch(() => ({})),
    ]);

    return jsonResponse({
        ok: true,
        doc: {
            slug: doc.slug,
            title: doc.title,
            path: doc.path,
            public_url: "/" + doc.path,
            review_interval_months: doc.review_interval_months,
            counsel_review_recommended: !!doc.counsel_review_recommended,
        },
        body,
        body_present: !!body,
        active_signature: activeMap?.[slug] || null,
    });
}

export async function onRequestPost(ctx) {
    const { request, env, params } = ctx;
    const identity = await readAdminIdentity(request, env);
    if (!identity) return unauthorizedAdminJson();
    if (!env.DB) return jsonError("server_error", 500, { reason: "DB not bound" });

    const slug = String(params?.slug || "").toLowerCase();
    const doc = getComplianceDoc(slug);
    if (!doc) return jsonError("unknown_compliance_doc", 404);

    let body;
    try { body = await request.json(); } catch { return jsonError("invalid_json_body", 400); }

    const signature_id = String(body.signature_id || "").trim();
    const typed_attestation = String(body.typed_attestation || "").trim();
    const typed_initials = String(body.typed_initials || "").trim();
    const notes = body.notes ? String(body.notes).slice(0, 500) : null;

    if (!signature_id) return jsonError("missing_signature_id", 400);
    if (typed_attestation.length < 16) return jsonError("typed_attestation_too_short", 400, { min_chars: 16 });
    if (!/^[A-Za-z]{2,6}$/.test(typed_initials)) return jsonError("typed_initials_invalid", 400, { rules: "2-6 letters only" });

    const document_body = await loadDocBody(slug, request);
    if (!document_body) return jsonError("doc_body_fetch_failed", 502, { hint: "deploy not yet propagated, or compliance-docs bundle missing" });

    let result;
    try {
        result = await signDocument(env, {
            slug,
            document_body,
            signature_id,
            signed_by_user_id: identity.user_id || identity.username || "admin",
            signed_by_display_name: identity.display_name || identity.username || "Mount Zara Admin",
            typed_attestation,
            typed_initials,
            request,
            notes,
        });
    } catch (e) {
        const msg = String(e?.message || e);
        if (msg === "signature_not_found") return jsonError("signature_not_found", 404);
        if (msg === "signature_retired") return jsonError("signature_retired", 409);
        if (msg === "unknown_compliance_doc") return jsonError("unknown_compliance_doc", 404);
        console.error("compliance sign threw", { slug, error: msg });
        return jsonError("server_error", 500, { reason: msg });
    }

    ctx.waitUntil(logAudit(env, {
        user_id: identity.user_id || identity.username || "admin",
        user_role: "clinician",
        action: "compliance_doc_signed",
        record_type: "document_signature",
        record_id: String(result.id || ""),
        ip: request.headers.get("CF-Connecting-IP") || "",
        user_agent: (request.headers.get("User-Agent") || "").slice(0, 400),
        success: true,
        details: {
            doc_slug: slug,
            doc_path: doc.path,
            doc_sha256: result.document_sha256,
            signature_id,
            typed_initials: result?.typed_initials || typed_initials.toUpperCase(),
            next_review_date: result.next_review_date,
        },
    }, ctx));

    return jsonResponse({ ok: true, signed_event: result, doc_slug: slug, signature_id }, { status: 201 });
}
