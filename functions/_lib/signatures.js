// =====================================================================
// functions/_lib/signatures.js — clinician e-signature helpers
// =====================================================================
// Per the Mount Zara Telehealth Audit Implementation Specs §B.1-B.5:
// every compliance policy doc (controlled-substances.md, licensure.md,
// standard-of-care.md, doxy-config.md, webside-standard.md) carries a
// signature page. This module is the producer/consumer pair for:
//
//   1. Uploading a clinician's signature PNG (envelope-encrypted in
//      mountzara-phi R2 bucket per _lib/phi.js posture).
//   2. Retrieving the decrypted PNG bytes for admin-side render.
//   3. Hashing a compliance document's body to capture an integrity
//      checkpoint at the moment of signing.
//   4. Recording a sign event in document_signatures with the typed
//      attestation, typed initials, and next-review-date.
//   5. Listing compliance docs + their current signature state.
//
// Auth posture: every public entry point is admin-only (clinician role).
// The admin route wrapper (_lib/admin_api.js::adminRoute) does the
// Basic Auth dance + clinician-role check.
// =====================================================================

import { encryptPhi, decryptPhi } from "./phi.js";

// The single clinician id used across the practice today. If a future
// multi-clinician model is adopted, this becomes an argument.
export const CLINICIAN_ID = "mabini-christopher-z";

// The canonical list of compliance documents that participate in the
// signature workflow. New docs are added here AND in the corresponding
// path on disk. The slug is what the admin UI uses in URLs.
export const COMPLIANCE_DOCS = [
    {
        slug: "controlled-substances",
        path: "docs/compliance/controlled-substances.md",
        title: "Controlled Substances Prescribing Policy",
        review_interval_months: 12,
        counsel_review_recommended: true,
    },
    {
        slug: "licensure",
        path: "docs/compliance/licensure.md",
        title: "State Licensure Policy and Tracker",
        review_interval_months: 12,
        counsel_review_recommended: false,
    },
    {
        slug: "standard-of-care",
        path: "docs/compliance/standard-of-care.md",
        title: "Standard of Care Statement",
        review_interval_months: 12,
        counsel_review_recommended: false,
    },
    {
        slug: "doxy-config",
        path: "docs/compliance/doxy-config.md",
        title: "Doxy.me Configuration Baseline",
        review_interval_months: 12,
        counsel_review_recommended: false,
    },
    {
        slug: "webside-standard",
        path: "docs/clinician/webside-standard.md",
        title: "Webside Manner Standard",
        review_interval_months: 12,
        counsel_review_recommended: false,
    },
];

export function getComplianceDoc(slug) {
    return COMPLIANCE_DOCS.find((d) => d.slug === slug) || null;
}

// ---------------------------------------------------------------------
// id + hash helpers
// ---------------------------------------------------------------------

function newSignatureId() {
    return "sig_" + crypto.randomUUID();
}

function bytesToBase64(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
}

function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

function toHex(buf) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let h = "";
    for (let i = 0; i < bytes.length; i++) {
        h += bytes[i].toString(16).padStart(2, "0");
    }
    return h;
}

export async function sha256Hex(bytesOrString) {
    const data = typeof bytesOrString === "string"
        ? new TextEncoder().encode(bytesOrString)
        : (bytesOrString instanceof Uint8Array ? bytesOrString : new Uint8Array(bytesOrString));
    const digest = await crypto.subtle.digest("SHA-256", data);
    return toHex(digest);
}

// ---------------------------------------------------------------------
// PNG validation + dimension probe
// ---------------------------------------------------------------------

// Validate that the bytes start with the PNG magic header and parse the
// first IHDR chunk to extract width + height. Throws on malformed input.
export function parsePngHeader(bytes) {
    if (!(bytes instanceof Uint8Array)) {
        throw new Error("parsePngHeader expects Uint8Array");
    }
    // PNG magic: 89 50 4E 47 0D 0A 1A 0A
    const MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (bytes.length < 24) throw new Error("not_a_png:too_short");
    for (let i = 0; i < 8; i++) {
        if (bytes[i] !== MAGIC[i]) throw new Error("not_a_png:bad_magic");
    }
    // IHDR starts at byte 8: 4 bytes length (0x0d), 4 bytes type "IHDR",
    // then width (4 bytes BE), height (4 bytes BE).
    if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) {
        throw new Error("not_a_png:missing_ihdr");
    }
    const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
    const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
    if (width <= 0 || height <= 0 || width > 8192 || height > 8192) {
        throw new Error("not_a_png:bad_dimensions");
    }
    return { width, height };
}

// ---------------------------------------------------------------------
// Upload — envelope-encrypt + R2 put + D1 row
// ---------------------------------------------------------------------

const MAX_SIG_BYTES = 1_500_000; // 1.5 MB — typical signature scans are < 200 KB

export async function uploadSignature(env, {
    png_bytes,                 // Uint8Array
    display_name,              // e.g. "Chris Mabini, DO, FMIGS"
    uploaded_by_user_id,       // admin.user from readAdminIdentity
    notes = null,
}) {
    if (!(png_bytes instanceof Uint8Array)) {
        throw new Error("png_bytes must be Uint8Array");
    }
    if (png_bytes.length === 0 || png_bytes.length > MAX_SIG_BYTES) {
        throw new Error("png_bytes size out of range");
    }
    const { width, height } = parsePngHeader(png_bytes);
    const sha = await sha256Hex(png_bytes);

    const id = newSignatureId();
    const r2_key = `signatures/${id}.png.enc`;
    const aad = `signature/${id}`;

    // Envelope-encrypt + write to R2.
    if (!env.PHI) throw new Error("PHI R2 bucket not bound");
    const { ciphertext, wrapped_dek, iv_data, iv_dek } = await encryptPhi(env, png_bytes, aad);
    await env.PHI.put(r2_key, ciphertext, {
        httpMetadata: { contentType: "application/octet-stream" },
        customMetadata: {
            "mz-record-kind": "signature",
            "mz-signature-id": id,
            "mz-iv-data": iv_data,
            "mz-iv-dek": iv_dek,
            "mz-content-sha256": sha,
        },
    });

    // Persist the metadata row in D1.
    if (!env.DB) throw new Error("DB not bound");
    await env.DB.prepare(`
        INSERT INTO clinician_signatures (
            id, clinician_id, display_name, r2_key,
            wrapped_dek, iv_data, iv_dek,
            width_px, height_px, bytes_size, sha256_hex,
            uploaded_by_user_id, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
        id, CLINICIAN_ID, display_name, r2_key,
        wrapped_dek, iv_data, iv_dek,
        width, height, png_bytes.length, sha,
        uploaded_by_user_id || null, notes
    ).run();

    return {
        id, display_name, width, height,
        bytes_size: png_bytes.length, sha256_hex: sha,
        created_at: new Date().toISOString(),
    };
}

// ---------------------------------------------------------------------
// List + fetch + retire
// ---------------------------------------------------------------------

export async function listSignatures(env, { include_retired = false } = {}) {
    if (!env.DB) throw new Error("DB not bound");
    const sql = include_retired
        ? `SELECT id, clinician_id, display_name, width_px, height_px, bytes_size,
                  sha256_hex, created_at, retired_at, notes
           FROM clinician_signatures WHERE clinician_id = ?
           ORDER BY created_at DESC`
        : `SELECT id, clinician_id, display_name, width_px, height_px, bytes_size,
                  sha256_hex, created_at, retired_at, notes
           FROM clinician_signatures WHERE clinician_id = ? AND retired_at IS NULL
           ORDER BY created_at DESC`;
    const rs = await env.DB.prepare(sql).bind(CLINICIAN_ID).all();
    return rs.results || [];
}

export async function getSignatureMetadata(env, sig_id) {
    if (!env.DB) throw new Error("DB not bound");
    return env.DB.prepare(`
        SELECT * FROM clinician_signatures WHERE id = ?
    `).bind(sig_id).first();
}

// Returns the decrypted PNG bytes for inline render in the admin UI.
// Caller is responsible for streaming back to the admin via a Response
// with content-type: image/png. NEVER returned over a non-admin endpoint.
export async function fetchSignaturePng(env, sig_id) {
    const row = await getSignatureMetadata(env, sig_id);
    if (!row) throw new Error("signature_not_found");
    if (!env.PHI) throw new Error("PHI R2 bucket not bound");
    const obj = await env.PHI.get(row.r2_key);
    if (!obj) throw new Error("signature_r2_missing");
    const ciphertext = new Uint8Array(await obj.arrayBuffer());
    const aad = `signature/${sig_id}`;
    const png = await decryptPhi(env, ciphertext,
        row.wrapped_dek, row.iv_data, row.iv_dek, aad);
    // Integrity check: SHA-256 must match what was recorded at upload time.
    const sha = await sha256Hex(png);
    if (sha !== row.sha256_hex) {
        throw new Error("signature_integrity_failed");
    }
    return { png_bytes: png, row };
}

export async function retireSignature(env, sig_id) {
    if (!env.DB) throw new Error("DB not bound");
    const now = new Date().toISOString();
    const r = await env.DB.prepare(`
        UPDATE clinician_signatures
        SET retired_at = ?
        WHERE id = ? AND retired_at IS NULL
    `).bind(now, sig_id).run();
    return { retired_at: now, success: !!(r?.success ?? true) };
}

// ---------------------------------------------------------------------
// Compliance doc body fetch + hash
// ---------------------------------------------------------------------

// Read the compliance doc body from the deploy artifacts. Pages Functions
// don't have direct filesystem access at runtime — we ship the doc bodies
// as part of the `_lib/compliance_docs/` bundle (one .md per slug) so the
// runtime can read them via dynamic import. Caller must catch.
export async function loadComplianceDocBody(slug) {
    const doc = getComplianceDoc(slug);
    if (!doc) throw new Error("unknown_compliance_doc");
    // Pages bundles import-time string assets via raw imports. We use a
    // map keyed by slug so an unknown slug never reaches the import call.
    // Bodies are bundled at build time by the deploy script (see
    // scripts/bundle_compliance_docs.sh — produces _lib/compliance_docs/
    // index.js exporting { [slug]: body_string }). For local dev where
    // the bundle isn't present, fall through to a fetch from the local
    // /docs/ path the Pages Function may serve as static.
    try {
        const mod = await import("./compliance_docs/index.js");
        if (mod.DOC_BODIES && typeof mod.DOC_BODIES[slug] === "string") {
            return mod.DOC_BODIES[slug];
        }
    } catch (e) {
        // bundle not present; fall through
    }
    throw new Error("compliance_doc_body_not_bundled");
}

// ---------------------------------------------------------------------
// Sign + supersede + list document signatures
// ---------------------------------------------------------------------

const TYPED_INITIALS_MIN = 2;
const TYPED_INITIALS_MAX = 6;

function calcNextReviewDate(months) {
    const d = new Date();
    d.setMonth(d.getMonth() + Number(months || 12));
    return d.toISOString().slice(0, 10);
}

export async function signDocument(env, {
    slug,
    document_body,      // string; SHA-256'd to capture integrity at-sign
    signature_id,       // FK -> clinician_signatures.id
    signed_by_user_id,  // admin.user
    signed_by_display_name,
    typed_attestation,
    typed_initials,
    request,            // optional — for ip_hash + user_agent
    notes = null,
}) {
    const doc = getComplianceDoc(slug);
    if (!doc) throw new Error("unknown_compliance_doc");
    if (typeof document_body !== "string" || document_body.length === 0) {
        throw new Error("document_body required");
    }
    if (!signature_id) throw new Error("signature_id required");
    if (typeof typed_attestation !== "string" || typed_attestation.length < 16) {
        throw new Error("typed_attestation too short");
    }
    if (typeof typed_initials !== "string"
        || typed_initials.length < TYPED_INITIALS_MIN
        || typed_initials.length > TYPED_INITIALS_MAX) {
        throw new Error("typed_initials out of range");
    }
    if (!signed_by_user_id || !signed_by_display_name) {
        throw new Error("signer identity missing");
    }

    // Confirm the signature exists and is active.
    const sig = await getSignatureMetadata(env, signature_id);
    if (!sig) throw new Error("signature_not_found");
    if (sig.retired_at) throw new Error("signature_retired");

    const doc_sha = await sha256Hex(document_body);
    const next_review = calcNextReviewDate(doc.review_interval_months);

    let ip_hash = null, user_agent = null;
    if (request) {
        // Soft hash of CF-Connecting-IP using the existing ip-hash salt.
        const ip = request.headers.get("CF-Connecting-IP") || "";
        const salt = env.IP_HASH_SALT || "";
        if (ip && salt) {
            try {
                ip_hash = await sha256Hex(salt + "|" + ip);
            } catch {}
        }
        user_agent = (request.headers.get("User-Agent") || "").slice(0, 400);
    }

    if (!env.DB) throw new Error("DB not bound");

    // Mark any prior active signature on this doc as superseded.
    const now = new Date().toISOString();
    await env.DB.prepare(`
        UPDATE document_signatures
        SET superseded_at = ?
        WHERE document_slug = ? AND superseded_at IS NULL
    `).bind(now, slug).run();

    // Insert the new sign event.
    const insert = await env.DB.prepare(`
        INSERT INTO document_signatures (
            document_slug, document_path, document_sha256,
            signature_id, signed_by_user_id, signed_by_display_name,
            typed_attestation, typed_initials,
            ip_hash, user_agent, next_review_date, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING id, signed_at
    `).bind(
        slug, doc.path, doc_sha,
        signature_id, signed_by_user_id, signed_by_display_name,
        typed_attestation.slice(0, 4000), typed_initials.toUpperCase(),
        ip_hash, user_agent, next_review, notes
    ).first();

    return {
        id: insert?.id,
        signed_at: insert?.signed_at,
        document_slug: slug,
        document_sha256: doc_sha,
        next_review_date: next_review,
        signature_id,
    };
}

// Return the active (non-superseded) signature event for each doc.
// Returns a map keyed by slug; missing slugs mean the doc has never
// been signed.
export async function getActiveSignaturesByDoc(env) {
    if (!env.DB) throw new Error("DB not bound");
    const rs = await env.DB.prepare(`
        SELECT ds.*, cs.display_name AS signature_display_name,
               cs.sha256_hex AS signature_sha256
        FROM document_signatures ds
        LEFT JOIN clinician_signatures cs ON cs.id = ds.signature_id
        WHERE ds.superseded_at IS NULL
        ORDER BY ds.signed_at DESC
    `).all();
    const map = {};
    for (const r of (rs.results || [])) {
        if (!map[r.document_slug]) map[r.document_slug] = r;
    }
    return map;
}
