// =====================================================================
// /api/v1/admin/compliance/docs/[slug]
//   GET  → return the doc body (from /docs/compliance/<slug>.md via a
//          static-asset fetch) + the active document_signatures row
//          (latest non-superseded).
//   POST → sign the doc.  Body:
//            {
//              signature_id: <clinician_signatures.id>,
//              typed_attestation: "<verbatim affirmation prose>",
//              typed_initials: "<<=8 chars>",
//              next_review_date: "YYYY-MM-DD" | null,
//              notes: "<<=500 chars>" | null
//            }
//          Writes a document_signatures row + supersedes the prior
//          active row for this slug.  Returns the new row.
//
// Auth: admin Basic Auth (readAdminIdentity).  Audit row written on POST.
// =====================================================================

import { jsonResponse, jsonError, readAdminIdentity, unauthorizedAdminJson } from "../../../../../_lib/admin_api.js";
import { getActiveDocumentSignature, signDocument } from "../../../../../_lib/signatures.js";
import { logAudit } from "../../../../../_lib/audit.js";

const KNOWN_DOCS = {
    "controlled-substances": {
        slug: "controlled-substances",
        title: "Controlled Substances Prescribing Policy",
        path: "docs/compliance/controlled-substances.md",
        public_url: "/docs/compliance/controlled-substances.md",
        annual_review: true,
    },
    "licensure": {
        slug: "licensure",
        title: "State Licensure Policy and Tracker",
        path: "docs/compliance/licensure.md",
        public_url: "/docs/compliance/licensure.md",
        annual_review: true,
    },
};

const ALLOWED_DOC_SLUGS = new Set(Object.keys(KNOWN_DOCS));

function hashIpHex(ip, salt) {
    // Simple SHA-256 hex of ip + salt; matches §10.4 session_trace pattern.
    // Synchronous-feeling wrapper for ctx-less caller.
    return (async () => {
        const data = new TextEncoder().encode(String(ip || "") + "|" + String(salt || ""));
        const hash = await crypto.subtle.digest("SHA-256", data);
        return Array.from(new Uint8Array(hash))
            .map(b => b.toString(16).padStart(2, "0"))
            .join("");
    })();
}

async function fetchDocBody(env, request, doc) {
    // Pages Functions can fetch the rendered static asset by issuing a
    // sub-request to the site origin. We use request.url's origin so the
    // fetch works both in production and preview environments.
    try {
        const origin = new URL(request.url).origin;
        const res = await fetch(`${origin}${doc.public_url}`, {
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
    const doc = KNOWN_DOCS[slug];
    if (!doc) return jsonError("doc_not_in_known_compliance_set", 404, { known: Array.from(ALLOWED_DOC_SLUGS) });

    const [body, active] = await Promise.all([
        fetchDocBody(env, request, doc),
        getActiveDocumentSignature(env, slug),
    ]);

    return jsonResponse({
        ok: true,
        doc: {
            slug: doc.slug,
            title: doc.title,
            path: doc.path,
            public_url: doc.public_url,
            annual_review: doc.annual_review,
        },
        body,                  // raw markdown text (null if fetch failed)
        body_present: !!body,
        active_signature: active,
    });
}

export async function onRequestPost(ctx) {
    const { request, env, params } = ctx;
    const identity = await readAdminIdentity(request, env);
    if (!identity) return unauthorizedAdminJson();
    if (!env.DB) return jsonError("server_error", 500, { reason: "DB not bound" });

    const slug = String(params?.slug || "").toLowerCase();
    const doc = KNOWN_DOCS[slug];
    if (!doc) return jsonError("doc_not_in_known_compliance_set", 404);

    let body;
    try { body = await request.json(); } catch { return jsonError("invalid_json_body", 400); }

    const signature_id = String(body.signature_id || "").trim();
    const typed_attestation = String(body.typed_attestation || "").trim();
    const typed_initials = String(body.typed_initials || "").trim();
    const next_review_date = body.next_review_date ? String(body.next_review_date).slice(0, 10) : null;
    const notes = body.notes ? String(body.notes).slice(0, 500) : null;

    if (!signature_id) return jsonError("missing_signature_id", 400);
    if (typed_attestation.length < 10) return jsonError("typed_attestation_too_short", 400, { min_chars: 10 });
    if (!/^[A-Za-z .'-]{1,8}$/.test(typed_initials)) return jsonError("typed_initials_invalid", 400, { rules: "1-8 chars, letters / spaces / . ' - only" });
    if (next_review_date && !/^\d{4}-\d{2}-\d{2}$/.test(next_review_date)) return jsonError("next_review_date_must_be_YYYY-MM-DD", 400);

    // Re-fetch the document body so the integrity hash recorded with the
    // signature reflects what the signer actually agreed to at sign time.
    const docBody = await fetchDocBody(env, request, doc);
    if (!docBody) return jsonError("doc_body_fetch_failed", 502, { hint: "deploy not yet propagated?" });

    const ipHashSalt = env.IP_HASH_SALT || "";
    const ipHash = await hashIpHex(request.headers.get("CF-Connecting-IP") || "", ipHashSalt);
    const userAgent = String(request.headers.get("User-Agent") || "").slice(0, 500);

    let result;
    try {
        result = await signDocument(env, {
            documentSlug: slug,
            documentPath: doc.path,
            documentBody: docBody,
            signatureId: signature_id,
            signedByUserId: identity.user_id || identity.username || "admin",
            signedByDisplayName: identity.display_name || identity.username || "Mount Zara Admin",
            typedAttestation: typed_attestation,
            typedInitials: typed_initials,
            nextReviewDate: next_review_date,
            ipHash, userAgent, notes,
        });
    } catch (e) {
        const msg = String(e?.message || e);
        if (msg === "signature_not_found") return jsonError("signature_not_found", 404);
        if (msg === "signature_retired") return jsonError("signature_retired", 409);
        console.error("compliance sign threw", { slug, error: msg });
        return jsonError("server_error", 500, { reason: msg });
    }

    // Audit row (fire-and-forget per §10.10).
    ctx.waitUntil(logAudit(env, {
        user_id: identity.user_id || identity.username || "admin",
        user_role: "clinician",
        action: "compliance_doc_signed",
        record_type: "document_signature",
        record_id: String(result.id || ""),
        ip: request.headers.get("CF-Connecting-IP") || "",
        user_agent: userAgent,
        success: true,
        details: {
            doc_slug: slug,
            doc_path: doc.path,
            doc_sha256: result.document_sha256,
            signature_id,
            typed_initials,
            next_review_date,
        },
    }, ctx));

    return jsonResponse({
        ok: true,
        signed_event: result,
        doc_slug: slug,
        signature_id,
    }, { status: 201 });
}
