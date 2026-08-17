// =====================================================================
// acknowledgments.js — the legal acknowledgments, recorded so they exist
// =====================================================================
// "The portal asks you to acknowledge" appeared on the telehealth-consent
// page before anything did the asking, and HIPAA's NPP-acknowledgment
// duty (45 CFR 164.520(c)) was not implemented at all. This module is the
// single place both are defined, so the version string, the write, and
// the check cannot drift apart across the three call sites (signup,
// booking, admin view).
//
// DOC_VERSIONS is the effective date printed on each page. Bump it when
// the document materially changes; an acknowledgment is of a VERSION, and
// a dispute will ask what text was in force on the day.
// =====================================================================

import { newId } from "./db.js";

export const DOC_VERSIONS = {
    npp: "2026-08-14",
    terms: "2026-08-14",
    telehealth_consent: "2026-08-14",
};

export const DOC_URLS = {
    npp: "/privacy-practices/",
    terms: "/terms/",
    telehealth_consent: "/telehealth-consent/",
};

async function sha256Hex(s) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Record one acknowledgment. Idempotent in effect: re-acknowledging the
 * same version writes another row, which is correct — each row is an
 * event, and "acknowledged again at booking" is true and harmless.
 */
export async function recordAcknowledgment(env, { patient_id, doc_key, request = null }) {
    if (!env?.DB || !patient_id || !DOC_VERSIONS[doc_key]) return { ok: false };
    const ip = request?.headers?.get("CF-Connecting-IP") || "";
    const salt = env.IP_HASH_SALT || "mz";
    try {
        await env.DB.prepare(`
            INSERT INTO patient_acknowledgments
                (id, patient_id, doc_key, doc_version, acknowledged_at, ip_hash, user_agent)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(
            newId(), patient_id, doc_key, DOC_VERSIONS[doc_key], Date.now(),
            ip ? await sha256Hex(salt + ip) : null,
            (request?.headers?.get("User-Agent") || "").slice(0, 200)
        ).run();
        return { ok: true, version: DOC_VERSIONS[doc_key] };
    } catch (e) {
        // The table may predate the migration in some environment. Say so
        // loudly — a silently unrecorded acknowledgment is the exact
        // failure this module exists to prevent.
        console.error("acknowledgments: record failed", doc_key, String(e).slice(0, 200));
        return { ok: false, error: String(e).slice(0, 200) };
    }
}

/**
 * Has this patient acknowledged the CURRENT version of a document?
 * Version-sensitive on purpose: a materially revised telehealth consent
 * needs re-acknowledgment, and comparing versions is what makes the bump
 * in DOC_VERSIONS enforce that automatically.
 */
export async function hasAcknowledged(env, patient_id, doc_key) {
    if (!env?.DB || !patient_id || !DOC_VERSIONS[doc_key]) return false;
    try {
        const r = await env.DB.prepare(`
            SELECT id FROM patient_acknowledgments
             WHERE patient_id = ? AND doc_key = ? AND doc_version = ?
             LIMIT 1
        `).bind(patient_id, doc_key, DOC_VERSIONS[doc_key]).first();
        return Boolean(r);
    } catch {
        // Fail OPEN for reads: if the table is missing, blocking a booking
        // outright would take the whole flow down over bookkeeping. The
        // WRITE path logs its failure; this read path defers to it.
        return false;
    }
}

export default { DOC_VERSIONS, DOC_URLS, recordAcknowledgment, hasAcknowledged };
