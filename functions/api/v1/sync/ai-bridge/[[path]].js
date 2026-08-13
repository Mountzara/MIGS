// =====================================================================
// /api/v1/sync/ai-bridge/*  — the local Claude CLI bridge
// =====================================================================
// The owner runs this practice alone and pays for a Claude CLI
// subscription. His rule: "I only will use the API key for actual billing
// sent to clearinghouses." So non-billing AI work is queued here and
// executed by a bridge process on his own machine, at no per-token cost.
//
// ROUTES (all authenticated with AI_BRIDGE_TOKEN via _lib/sync_auth):
//   GET  /api/v1/sync/ai-bridge/next            claim the oldest pending job
//   POST /api/v1/sync/ai-bridge/<id>/result     return the finished work
//   POST /api/v1/sync/ai-bridge/heartbeat       "the bridge is alive"
//   GET  /api/v1/sync/ai-bridge/status          queue depth + bridge liveness
//
// PHI: job rows carry references only. Results ARE clinical text, so they
// are written to R2 under the same envelope encryption as message bodies
// (_lib/phi.js) — D1 stores the key material and non-clinical metadata,
// exactly as the `messages` table does.
//
// ---------------------------------------------------------------------
// THE RULE THAT GOVERNS THIS FILE
// ---------------------------------------------------------------------
// The bridge runs `claude -p` against the owner's PERSONAL Claude
// subscription. The Anthropic BAA covers the API. It does NOT cover a
// consumer CLI subscription. Everything this endpoint hands the bridge
// has therefore left BAA-covered infrastructure, and must contain no PHI.
//
// The bridge is an UNTRUSTED CLIENT. It holds a token and runs on a
// laptop whose script anyone at that keyboard can edit. So this endpoint
// does not hand over raw text and trust the bridge to scrub it. It
// scrubs, it VERIFIES the scrub by re-scanning, and it REFUSES to answer
// when verification fails. There is no parameter, header or flag that
// returns un-scrubbed content — changing that requires changing this file
// and _lib/bridge_context.js.
//
// Names and dates survive as indexed tokens so the work is still
// possible; the server rehydrates them on the way back, so the physician
// reads a normal draft that the model never saw in the clear. Every
// disclosure — and every refusal — is recorded in bridge_disclosure_log
// with the rule counts, never the matched values.
// =====================================================================

import { syncRoute, syncJson, syncError } from "../../../../_lib/sync_auth.js";
import { putPhiObject, getPhiObject, encryptPhi, decryptPhi } from "../../../../_lib/phi.js";
import {
    BRIDGE_KINDS, bridgeKindAllowed, deidentifyForBridge,
    rehydrate, unresolvedTokens,
} from "../../../../_lib/bridge_context.js";
import { newId } from "../../../../_lib/db.js";

// A claim older than this is considered abandoned and may be re-claimed,
// so a bridge that is killed mid-job does not strand work forever.
const LEASE_SECONDS = 600;

function nowIso() { return new Date().toISOString(); }

async function claimNext(env, bridge_id) {
    const stale = new Date(Date.now() - LEASE_SECONDS * 1000).toISOString();

    // Pending, or claimed-but-abandoned. Oldest first so nothing starves.
    // Only kinds we have decided how to de-identify may be dispatched to
    // the bridge. A kind outside BRIDGE_KINDS stays queued rather than
    // going to a non-BAA processor by default.
    const allowed = Object.keys(BRIDGE_KINDS);
    const placeholders = allowed.map(() => "?").join(",");
    const row = await env.DB.prepare(
        `SELECT id, kind, payload_json, patient_id, attempts, max_attempts
           FROM ai_jobs
          WHERE kind IN (${placeholders})
            AND ((status = 'pending')
              OR (status = 'claimed' AND claimed_at < ?))
          ORDER BY created_at ASC
          LIMIT 1`
    ).bind(...allowed, stale).first();
    if (!row) return null;

    if (row.attempts >= row.max_attempts) {
        await env.DB.prepare(
            `UPDATE ai_jobs SET status='failed', error='max attempts exceeded',
                    completed_at=? WHERE id=?`
        ).bind(nowIso(), row.id).run();
        return null;
    }

    // Conditional update = the lock. If another bridge claimed it between
    // our SELECT and here, meta.changes is 0 and we simply return nothing
    // rather than handing the same job to two workers.
    const res = await env.DB.prepare(
        `UPDATE ai_jobs
            SET status='claimed', claimed_at=?, attempts=attempts+1
          WHERE id=? AND (status='pending' OR (status='claimed' AND claimed_at < ?))`
    ).bind(nowIso(), row.id, stale).run();
    if (!res?.meta?.changes) return null;

    let payload = {};
    try { payload = JSON.parse(row.payload_json || "{}"); } catch { /* keep {} */ }
    return { id: row.id, kind: row.kind, payload, patient_id: row.patient_id, attempt: row.attempts + 1 };
}


const MAP_TTL_MINUTES = 120;

async function logDisclosure(env, row) {
    try {
        await env.DB.prepare(
            `INSERT INTO bridge_disclosure_log
               (id, at, job_id, kind, bridge_id, verified, findings_json,
                residual_json, chars_sent, refused, refuse_reason)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`
        ).bind(newId(), nowIso(), row.job_id || null, row.kind, row.bridge_id || null,
               row.verified ? 1 : 0, JSON.stringify(row.findings || []),
               row.residual?.length ? JSON.stringify(row.residual) : null,
               row.chars_sent ?? null, row.refused ? 1 : 0,
               row.refuse_reason ? String(row.refuse_reason).slice(0, 400) : null).run();
    } catch (e) {
        // A disclosure record that fails to write is itself a problem, but
        // it must not become a reason to send anyway.
        console.error("bridge_disclosure_log write failed", String(e));
    }
}

/** Seal the reverse map. It is a literal list of names and dates. */
async function sealMap(env, jobId, map) {
    const enc = await encryptPhi(env, JSON.stringify(map), `bridge_map:${jobId}`);
    let ct = "";
    const bytes = enc.ciphertext instanceof Uint8Array ? enc.ciphertext : new Uint8Array(enc.ciphertext);
    for (let i = 0; i < bytes.length; i++) ct += String.fromCharCode(bytes[i]);
    return {
        ciphertext: btoa(ct),
        dek_wrapped: enc.wrapped_dek,
        iv_data: enc.iv_data,
        iv_dek: enc.iv_dek,
    };
}

async function openMap(env, jobId, row) {
    if (!row?.deid_map_ciphertext) return {};
    try {
        const bin = atob(row.deid_map_ciphertext);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        // decryptPhi returns BYTES — decode before parsing.
        const plain = new TextDecoder().decode(
            await decryptPhi(env, bytes, row.deid_map_dek_wrapped,
                             row.deid_map_iv_data, row.deid_map_iv_dek,
                             `bridge_map:${jobId}`));
        return JSON.parse(plain);
    } catch (e) {
        // Surface the real reason. "could not be decrypted" with no cause
        // is the kind of message that costs an hour.
        console.error("bridge map decrypt failed", String(e));
        return { __error: String(e && e.message ? e.message : e).slice(0, 200) };
    }
}

/**
 * Assemble the RAW context for a job, plus the names to tokenise.
 * Nothing here goes over the wire — deidentifyForBridge() runs on the
 * result and only its output is returned to the caller.
 */
async function rawContextFor(env, kind, refId) {
    if (kind === "message_draft") {
        const msgs = await env.DB.prepare(
            `SELECT m.id, m.from_role, m.created_at, m.subject, m.body_r2_key, m.patient_id
               FROM messages m
              WHERE m.thread_id = ? AND m.deleted_at IS NULL
              ORDER BY m.created_at ASC LIMIT 40`
        ).bind(refId).all();
        const rows = msgs?.results || [];
        if (!rows.length) return null;

        const names = new Set();
        try {
            const p = await env.DB.prepare(
                `SELECT first_name, last_name, preferred_name FROM patients WHERE id = ? LIMIT 1`
            ).bind(rows[0].patient_id).first();
            for (const n of [p?.first_name, p?.last_name, p?.preferred_name]) if (n) names.add(n);
        } catch { /* patient row optional — the scrubber still runs */ }

        const parts = [];
        for (const m of rows) {
            let body = "";
            try {
                const got = await getPhiObject(env, m.body_r2_key, null, null);
                body = typeof got === "string" ? got : new TextDecoder().decode(got?.plaintext || got || new Uint8Array());
            } catch { body = "(message body unavailable)"; }
            parts.push(`${m.from_role === "patient" ? "PATIENT" : "PRACTICE"}: ${body}`);
        }
        return { text: parts.join("\n\n"), knownNames: [...names] };
    }

    if (kind === "intake_summary") {
        // The triage decision. runTriage() de-identifies the intake before
        // the model ever sees it, so what leaves here is already
        // structurally safe — this path re-verifies it anyway, because the
        // guarantee is meant to hold regardless of who calls it.
        const row = await env.DB.prepare(
            `SELECT i.id, i.patient_id, p.dob
               FROM intake_responses i LEFT JOIN patients p ON p.id = i.patient_id
              WHERE i.id = ? LIMIT 1`
        ).bind(refId).first();
        if (!row) return null;
        const secs = await env.DB.prepare(
            `SELECT section_number, data_json FROM intake_section_data
              WHERE intake_id = ? ORDER BY section_number ASC`
        ).bind(refId).all();
        const parts = [];
        for (const sec of (secs?.results || [])) {
            let d = {};
            try { d = JSON.parse(sec.data_json || "{}"); } catch { /* skip */ }
            const body = Object.entries(d)
                .filter(([, v]) => v !== null && v !== "" && v !== undefined)
                .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
                .join("\n");
            if (body) parts.push(`--- SECTION ${sec.section_number} ---\n${body}`);
        }
        if (!parts.length) return null;

        const names = new Set();
        try {
            const pt = await env.DB.prepare(
                `SELECT first_name, last_name, preferred_name FROM patients WHERE id = ? LIMIT 1`
            ).bind(row.patient_id).first();
            for (const n of [pt?.first_name, pt?.last_name, pt?.preferred_name]) if (n) names.add(n);
        } catch { /* the scrubber still runs */ }

        // Ship the REAL visit-type catalog with the context. The first
        // version of the bridge prompt hard-coded a list of visit types
        // from memory; several did not exist. The model returned
        // "complex_pelvic_pain", the applier wrote it to the triage row,
        // and the booking endpoint then crashed on an unknown key —
        // Cloudflare error 1102, no slots, no explanation.
        //
        // Deriving it here means the prompt cannot drift from the catalog,
        // because there is only one copy.
        const { VISIT_TYPES } = await import("../../../../_lib/visit_types.js");
        const catalog = VISIT_TYPES.map((v) =>
            `  ${v.key} — ${v.label || v.key}${v.default_duration_min ? ` (usually ${v.default_duration_min} min)` : ""}`
        ).join("\n");

        return {
            text: parts.join("\n\n"),
            knownNames: [...names],
            catalog,
        };
    }

    if (kind === "visit_summary") {
        const enc = await env.DB.prepare(
            `SELECT id, patient_id, visit_date, visit_type_actual, chief_complaint, note_r2_key
               FROM encounters WHERE id = ? LIMIT 1`
        ).bind(refId).first();
        if (!enc?.note_r2_key) return null;
        let note = "";
        try {
            const got = await getPhiObject(env, enc.note_r2_key, null, null);
            note = typeof got === "string" ? got : new TextDecoder().decode(got?.plaintext || got || new Uint8Array());
        } catch { return null; }
        if (!note.trim()) return null;

        const names = new Set();
        try {
            const pt = await env.DB.prepare(
                `SELECT first_name, last_name, preferred_name FROM patients WHERE id = ? LIMIT 1`
            ).bind(enc.patient_id).first();
            for (const n of [pt?.first_name, pt?.last_name, pt?.preferred_name]) if (n) names.add(n);
        } catch { /* scrubber still runs */ }

        return {
            text: `VISIT: ${enc.visit_type_actual || "office visit"} on ${enc.visit_date}\n`
                + `REASON: ${enc.chief_complaint || "not recorded"}\n\nNOTE:\n${note}`,
            knownNames: [...names],
        };
    }

    if (kind === "enrollment_extract") {
        // The practice's own paperwork, already admitted by
        // enrollment_extract.looksLikePatientDocument() at upload time.
        const doc = await env.DB.prepare(
            `SELECT id, doc_type, r2_key, dek_wrapped FROM clearinghouse_documents WHERE id = ? LIMIT 1`
        ).bind(refId).first();
        if (!doc?.r2_key) return null;
        let text = "";
        try {
            const got = await getPhiObject(env, doc.r2_key, doc.dek_wrapped, `ch_doc:${doc.id}`);
            text = typeof got === "string" ? got : new TextDecoder().decode(got?.plaintext || got || new Uint8Array());
        } catch { return null; }
        return { text, knownNames: [], nonPhi: true, doc_type: doc.doc_type };
    }

    return null;
}

/**
 * Turn a finished bridge result into the state change it was computed for.
 *
 * Returns { applied, ... } and NEVER throws past its caller — a job whose
 * result cannot be applied must still be recorded as returned, so the
 * failure is visible rather than looking like the bridge never ran.
 */
async function applyJobResult(env, job, text) {
    if (job.kind === "intake_summary") {
        // Triage. Parse the decision, write it onto the row that is
        // currently blocking this patient's booking, and let slots open.
        let d = null;
        try {
            const start = text.indexOf("{"), end = text.lastIndexOf("}");
            if (start >= 0 && end > start) d = JSON.parse(text.slice(start, end + 1));
        } catch { /* fall through to not-applied */ }
        if (!d || !d.visit_type) return { applied: false, reason: "no usable triage decision in the result" };

        // Validate against the catalog BEFORE writing. An unknown visit
        // type is not a cosmetic problem: booking looks it up, gets
        // undefined, and the whole endpoint dies with a resource-limit
        // error the patient sees as "no slots".
        const { VISIT_TYPES: CATALOG } = await import("../../../../_lib/visit_types.js");
        const known = CATALOG.find((v) => v.key === String(d.visit_type));
        if (!known) {
            return { applied: false,
                     reason: `"${d.visit_type}" is not a visit type in the catalog — refused rather than written, because booking would crash on it`,
                     valid_types: CATALOG.map((v) => v.key) };
        }

        let payload = {};
        try { payload = JSON.parse(job.payload_json || "{}"); } catch { /* {} */ }
        const intakeId = payload.intake_id;
        if (!intakeId) return { applied: false, reason: "job carried no intake_id" };

        const res = await env.DB.prepare(
            `UPDATE appointment_triage
                SET ai_visit_type = ?, ai_duration_min = ?, ai_urgency = ?,
                    ai_in_person_required = ?, ai_preferred_time_of_day = ?,
                    ai_rationale = ?, ai_secondary_concerns_json = ?, updated_at = ?
              WHERE intake_id = ? AND ai_visit_type = 'manual_review_required'`
        ).bind(
            String(d.visit_type),
            Number(d.duration_min) || 45,
            ["routine", "soon", "urgent"].includes(d.urgency) ? d.urgency : "routine",
            d.in_person_required ? 1 : 0,
            ["any", "morning", "afternoon"].includes(d.preferred_time_of_day) ? d.preferred_time_of_day : "any",
            String(d.rationale || "").slice(0, 500),
            JSON.stringify(Array.isArray(d.secondary_concerns) ? d.secondary_concerns.slice(0, 20) : []),
            Date.now(), intakeId
        ).run();

        return {
            applied: Boolean(res?.meta?.changes),
            kind: "triage",
            visit_type: d.visit_type,
            urgency: d.urgency,
            // Said plainly: an urgent triage is not something to discover
            // in a log, and the clinician release step still stands.
            note: res?.meta?.changes
                ? "Triage decided. It still awaits your release before slots open."
                : "The triage row was already decided or released — left untouched.",
        };
    }

    if (job.kind === "visit_summary") {
        // Deliberately NOT applied automatically. A visit summary must be
        // read and approved by him; writing it straight into the patient's
        // portal would defeat the sign-off gate that feature exists for.
        return { applied: false, kind: "visit_summary",
                 reason: "held for clinician review — by design, not a failure" };
    }

    return { applied: false, reason: `no applier for kind ${job.kind}` };
}

export async function onRequest(ctx) {
    return syncRoute(ctx, "ai_bridge", async ({ env, request }) => {
        const url = new URL(request.url);
        const parts = url.pathname.split("/").filter(Boolean);
        // .../v1/sync/ai-bridge/<seg>[/<sub>]
        const i = parts.indexOf("ai-bridge");
        const seg = parts[i + 1] || "";
        const sub = parts[i + 2] || "";
        const method = request.method.toUpperCase();

        // ---- GET /context/<kind>/<id> ---------------------------------
        // The ONLY way the bridge obtains content, and it never returns
        // raw text. Scrub -> verify -> refuse-or-send. A kind not in
        // BRIDGE_KINDS is refused outright, because we have not decided
        // what de-identified means for it and "allow and hope" is how PHI
        // escapes.
        if (method === "GET" && seg === "context") {
            const kind = sub;
            const refId = parts[i + 3] || "";
            const bridge_id = url.searchParams.get("bridge_id") || "unknown";
            const job_id = url.searchParams.get("job_id") || null;

            if (!bridgeKindAllowed(kind)) {
                await logDisclosure(env, { job_id, kind, bridge_id, verified: false,
                    refused: 1, refuse_reason: "kind not permitted on the bridge" });
                return syncError(`"${kind}" may not run on the bridge. Permitted: ${Object.keys(BRIDGE_KINDS).join(", ")}`, 403);
            }
            if (!refId) return syncError("missing reference id", 400);

            let raw;
            try {
                raw = await rawContextFor(env, kind, refId);
            } catch (e) {
                return syncError(`could not assemble context: ${String(e).slice(0, 160)}`, 500);
            }
            if (!raw) return syncError("nothing found for that reference", 404);

            // Practice paperwork is not PHI and was already gated at upload.
            if (raw.nonPhi) {
                await logDisclosure(env, { job_id, kind, bridge_id, verified: true,
                    findings: [], chars_sent: raw.text.length, refused: 0 });
                return syncJson({ ok: true, kind, phi: false, text: raw.text,
                                  doc_type: raw.doc_type || null, deid: { applied: false, reason: "practice document, not patient data" } });
            }

            const deid = deidentifyForBridge(raw.text, { knownNames: raw.knownNames });

            if (!deid.ok) {
                // FAIL CLOSED. Refuse, record why, send nothing.
                await logDisclosure(env, { job_id, kind, bridge_id, verified: false,
                    findings: deid.findings, residual: deid.residual, refused: 1,
                    refuse_reason: `residual: ${deid.residual.map((r) => r.key).join(", ")}` });
                if (job_id) {
                    await env.DB.prepare(
                        `UPDATE ai_jobs SET status='failed', error=?, deid_verified=0, completed_at=? WHERE id=?`
                    ).bind(`de-identification could not be verified (residual: ${deid.residual.map((r) => r.key).join(", ")}) — refused to disclose`,
                           nowIso(), job_id).run();
                }
                return syncError(
                    "De-identification could not be VERIFIED for this content, so nothing was sent. " +
                    `Residual high-risk patterns: ${deid.residual.map((r) => r.key).join(", ")}.`,
                    409
                );
            }

            // Keep the reverse map server-side, encrypted, so the result can
            // be rehydrated. The bridge never receives it.
            if (job_id && Object.keys(deid.map).length) {
                const sealed = await sealMap(env, job_id, deid.map);
                await env.DB.prepare(
                    `UPDATE ai_jobs SET deid_map_ciphertext=?, deid_map_dek_wrapped=?,
                            deid_map_iv_data=?, deid_map_iv_dek=?, map_expires_at=?,
                            deid_findings_json=?, deid_verified=1
                      WHERE id=?`
                ).bind(sealed.ciphertext, sealed.dek_wrapped, sealed.iv_data, sealed.iv_dek,
                       new Date(Date.now() + MAP_TTL_MINUTES * 60000).toISOString(),
                       JSON.stringify(deid.findings), job_id).run();
            }

            await logDisclosure(env, { job_id, kind, bridge_id, verified: true,
                findings: deid.findings, chars_sent: deid.text.length, refused: 0 });

            return syncJson({
                ok: true, kind, phi: false,
                text: deid.text,
                catalog: raw.catalog || null,
                deid: {
                    applied: true, verified: true,
                    removed: deid.findings,
                    tokens: Object.keys(deid.map),
                    note: "Names and dates are indexed tokens. The server puts the real values back before the physician sees the result — do not try to guess them.",
                },
            });
        }

        // ---- GET /next ------------------------------------------------
        if (method === "GET" && seg === "next") {
            const bridge_id = url.searchParams.get("bridge_id") || "unknown";
            const job = await claimNext(env, bridge_id);
            return syncJson({ ok: true, job: job || null });
        }

        // ---- POST /heartbeat ------------------------------------------
        if (method === "POST" && seg === "heartbeat") {
            let b = {};
            try { b = await request.json(); } catch { /* tolerate empty */ }
            const bridge_id = String(b.bridge_id || "default");
            await env.DB.prepare(
                `INSERT INTO ai_bridge_heartbeat (bridge_id, last_seen_at, version, jobs_done, jobs_failed, note)
                 VALUES (?, ?, ?, COALESCE(?,0), COALESCE(?,0), ?)
                 ON CONFLICT(bridge_id) DO UPDATE SET
                    last_seen_at=excluded.last_seen_at,
                    version=excluded.version,
                    jobs_done=excluded.jobs_done,
                    jobs_failed=excluded.jobs_failed,
                    note=excluded.note`
            ).bind(bridge_id, nowIso(), b.version || null,
                   b.jobs_done ?? 0, b.jobs_failed ?? 0, b.note || null).run();
            return syncJson({ ok: true });
        }

        // ---- GET /status ----------------------------------------------
        if (method === "GET" && seg === "status") {
            const q = await env.DB.prepare(
                `SELECT status, COUNT(*) AS n FROM ai_jobs GROUP BY status`
            ).all();
            const hb = await env.DB.prepare(
                `SELECT bridge_id, last_seen_at, jobs_done, jobs_failed
                   FROM ai_bridge_heartbeat ORDER BY last_seen_at DESC LIMIT 5`
            ).all();
            return syncJson({
                ok: true,
                queue: (q?.results || []).reduce((a, r) => (a[r.status] = r.n, a), {}),
                bridges: hb?.results || [],
            });
        }

        // ---- POST /<id>/result ----------------------------------------
        if (method === "POST" && seg && sub === "result") {
            const job_id = seg;
            let b;
            try { b = await request.json(); } catch { return syncError("invalid json", 400); }

            const job = await env.DB.prepare(
                `SELECT id, kind, patient_id, status, payload_json FROM ai_jobs WHERE id = ? LIMIT 1`
            ).bind(job_id).first();
            if (!job) return syncError("job not found", 404);

            if (b?.error) {
                await env.DB.prepare(
                    `UPDATE ai_jobs SET status='failed', error=?, completed_at=? WHERE id=?`
                ).bind(String(b.error).slice(0, 800), nowIso(), job_id).run();
                return syncJson({ ok: true, status: "failed" });
            }

            let text = String(b?.result || "");
            if (!text) return syncError("result or error required", 400);

            // Put the real names and dates back. The model worked on
            // tokens; the physician reads a normal draft.
            const mapRow = await env.DB.prepare(
                `SELECT deid_map_ciphertext, deid_map_dek_wrapped, deid_map_iv_data, deid_map_iv_dek
                   FROM ai_jobs WHERE id = ? LIMIT 1`
            ).bind(job_id).first();
            let rehydrated = false;
            if (mapRow?.deid_map_ciphertext) {
                const map = await openMap(env, job_id, mapRow);
                if (!map || map.__error) {
                    return syncError(`the de-identification map could not be decrypted (${map?.__error || "unknown"}); the draft cannot be restored and was not stored`, 500);
                }
                text = rehydrate(text, map);
                rehydrated = true;
            }

            // A token that survived rehydration means the model invented a
            // reference we cannot resolve. Showing that as a finished draft
            // is worse than showing nothing.
            const left = unresolvedTokens(text);
            if (left.length) {
                await env.DB.prepare(
                    `UPDATE ai_jobs SET status='failed', error=?, completed_at=? WHERE id=?`
                ).bind(`the draft referenced ${left.join(", ")}, which do not correspond to anything real — discarded rather than shown`,
                       nowIso(), job_id).run();
                return syncJson({ ok: true, status: "failed",
                    reason: `unresolved tokens: ${left.join(", ")}` });
            }

            // Clinical text -> R2, envelope-encrypted. Same discipline as
            // message bodies; D1 never holds the plaintext.
            const r2_key = `ai-jobs/${job_id}.txt`;
            let wrapped;
            try {
                const put = await putPhiObject(env, r2_key, new TextEncoder().encode(text), `ai_job:${job_id}`);
                wrapped = put?.wrapped_dek || put?.envelope_dek_wrapped || null;
            } catch (e) {
                return syncError(`could not store result: ${String(e).slice(0, 160)}`, 500);
            }

            // APPLY THE RESULT, do not merely store it.
            //
            // A triage decision sitting in an R2 blob is still a dead end:
            // the patient's slots stay closed and someone has to notice.
            // The whole point of routing the work to the bridge is that it
            // COMPLETES. So the result is applied to the row it was
            // computed for, and only then is the job marked done.
            let applied = null;
            try { applied = await applyJobResult(env, job, text); }
            catch (e) {
                console.error("bridge result apply failed", String(e).slice(0, 200));
                applied = { applied: false, error: String(e).slice(0, 160) };
            }

            await env.DB.prepare(
                `UPDATE ai_jobs
                    SET status='done', result_r2_key=?, result_dek_wrapped=?,
                        result_meta_json=?, completed_at=?, error=NULL,
                        deid_map_ciphertext=NULL, deid_map_dek_wrapped=NULL,
                        deid_map_iv_data=NULL, deid_map_iv_dek=NULL, map_expires_at=NULL
                  WHERE id=?`
            ).bind(
                r2_key, wrapped,
                JSON.stringify({ ...(b?.meta || {}), rehydrated, applied }),
                nowIso(), job_id
            ).run();

            return syncJson({ ok: true, status: "done", rehydrated, applied });
        }

        // ---- GET /disclosures -----------------------------------------
        // The artifact that answers "prove no PHI was disclosed". Counts
        // and rule names only — never a matched value.
        if (method === "GET" && seg === "disclosures") {
            const rows = await env.DB.prepare(
                `SELECT at, job_id, kind, bridge_id, verified, findings_json,
                        residual_json, chars_sent, refused, refuse_reason
                   FROM bridge_disclosure_log ORDER BY at DESC LIMIT 100`
            ).all();
            const list = (rows?.results || []).map((r) => ({
                ...r,
                verified: r.verified === 1,
                refused: r.refused === 1,
                findings: (() => { try { return JSON.parse(r.findings_json || "[]"); } catch { return []; } })(),
            }));
            return syncJson({
                ok: true,
                total: list.length,
                refused: list.filter((r) => r.refused).length,
                unverified_sends: list.filter((r) => !r.refused && !r.verified).length,
                disclosures: list,
            });
        }

        return syncError("unknown ai-bridge route", 404);
    });
}
