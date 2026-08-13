// =====================================================================
// functions/_lib/messaging.js — shared messaging primitives
// =====================================================================
// Used by both /api/v1/patient/messages/* and /api/v1/admin/messages/*.
// Centralizes:
//   * thread row write + bump on every new message
//   * envelope-encrypted body persistence via _lib/phi.js
//   * read-state transitions
//   * audit logging (action='message_send' | 'message_read' | 'thread_create')
//
// PHI safety: body plaintext NEVER touches D1. Only the wrapped DEK +
// the R2 key are in D1. The `last_message_preview` field on
// message_threads is a 120-char snippet stored in plaintext for fast
// thread-list rendering — it is PHI but is access-scoped (admin sees
// only their patients; patient sees only their own threads).
// =====================================================================

import { putPhiObject, getPhiObject } from "./phi.js";
import { logAudit } from "./audit.js";
import { newId } from "./db.js";
import { notify } from "./notify.js";

export const ALLOWED_FROM_ROLES = new Set(["patient", "clinician", "staff"]);
export const MAX_BODY_BYTES = 32 * 1024;       // 32 KB plaintext message — abundant
export const MAX_SUBJECT_LEN = 140;
export const PREVIEW_LEN = 120;
export const CLINICIAN_ID = "mabini-christopher-z";

export function r2KeyForMessage(message_id, patient_id) {
    return `message/${patient_id}/${message_id}.bin`;
}

export function aadForMessage(message_id) {
    return `msg/${message_id}`;
}

function clipPreview(s) {
    if (typeof s !== "string") return "";
    const trimmed = s.replace(/\s+/g, " ").trim();
    return trimmed.length > PREVIEW_LEN ? trimmed.slice(0, PREVIEW_LEN - 1) + "…" : trimmed;
}

// ---------------------------------------------------------------------
// Phase 18 R8 — response-window SLA (Joshi & Welch 2023).
// Windows (America/Chicago business days, Mon–Fri, close-of-business
// 17:00 CT): URGENT = close of the NEXT business day; NON_URGENT = within
// 48 business hours = close of the SECOND business day after the message.
// Patient-originated messages start the clock; a clinician reply clears
// it. The 15-minute mountzara-cron sweep flips sla_breached.
// ---------------------------------------------------------------------
export const ALLOWED_URGENCIES = new Set(["urgent", "non_urgent"]);
const SLA_TZ = "America/Chicago";
const SLA_CLOSE_HOUR = 17; // 5:00 pm local

function tzParts(ms) {
    const fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: SLA_TZ, year: "numeric", month: "2-digit",
        day: "2-digit", hour: "2-digit", weekday: "short", hour12: false,
    });
    const p = {};
    for (const part of fmt.formatToParts(new Date(ms))) p[part.type] = part.value;
    return {
        y: parseInt(p.year, 10), m: parseInt(p.month, 10), d: parseInt(p.day, 10),
        h: parseInt(p.hour, 10) % 24, wd: p.weekday, // 'Mon'..'Sun'
    };
}

// UTC ms for 17:00 America/Chicago on the local date that `ms` falls on,
// shifted forward by `addDays` calendar days. Offset (CST -6 / CDT -5) is
// derived from the formatter itself, so DST transitions are handled.
function chicagoCloseOnDate(ms, addDays) {
    const base = tzParts(ms);
    // Walk forward in 24h steps from local noon to dodge DST edge hours.
    let probe = Date.UTC(base.y, base.m - 1, base.d, 18, 0, 0); // ~local noon
    probe += addDays * 24 * 60 * 60 * 1000;
    const target = tzParts(probe);
    // Find the UTC hour that renders as SLA_CLOSE_HOUR local on the target date.
    const guess = Date.UTC(target.y, target.m - 1, target.d, SLA_CLOSE_HOUR + 6, 0, 0); // assume CST
    const seen = tzParts(guess);
    const drift = (SLA_CLOSE_HOUR - seen.h) * 60 * 60 * 1000; // 0 (CST) or +1h (CDT)
    return { dueMs: guess + drift, wd: target.wd };
}

function isWeekendWd(wd) { return wd === "Sat" || wd === "Sun"; }

/**
 * Compute the SLA deadline (ms epoch) for a patient message sent at fromMs.
 * urgent     -> close of the next business day.
 * non_urgent -> close of the second business day after fromMs.
 */
export function computeSlaDueAt(urgency, fromMs) {
    const wanted = urgency === "urgent" ? 1 : 2;
    let found = 0;
    for (let add = 1; add <= 10; add++) {
        const { dueMs, wd } = chicagoCloseOnDate(fromMs, add);
        if (!isWeekendWd(wd)) {
            found += 1;
            if (found === wanted) return dueMs;
        }
    }
    // Unreachable for sane inputs; fail open with +3 calendar days.
    return fromMs + 3 * 24 * 60 * 60 * 1000;
}

/**
 * Create a brand-new thread + its first message.
 *
 * @returns { ok: true, thread_id, message_id, created_at } or
 *          { ok: false, error }
 */
export async function startThread(env, args) {
    const { patient_id, from_role, from_user_id, subject, body,
            related_appointment_id, related_intake_id } = args;
    // R8 — urgency is meaningful on patient-originated threads (the SLA
    // tracks the clinician's response). Clinician/staff threads default
    // non_urgent with no running clock.
    const urgency = ALLOWED_URGENCIES.has(args.urgency) ? args.urgency : "non_urgent";
    if (!patient_id) return { ok: false, error: "missing_patient_id" };
    if (!ALLOWED_FROM_ROLES.has(from_role)) return { ok: false, error: "invalid_from_role" };
    if (!from_user_id) return { ok: false, error: "missing_from_user_id" };
    const cleanSubject = (subject || "").toString().trim();
    if (!cleanSubject || cleanSubject.length > MAX_SUBJECT_LEN) {
        return { ok: false, error: "invalid_subject", detail: `1..${MAX_SUBJECT_LEN}` };
    }
    const cleanBody = (body || "").toString();
    if (!cleanBody.trim()) return { ok: false, error: "empty_body" };
    const bodyBytes = new TextEncoder().encode(cleanBody).length;
    if (bodyBytes > MAX_BODY_BYTES) {
        return { ok: false, error: "body_too_large", detail: `${MAX_BODY_BYTES} bytes` };
    }

    const t = Date.now();
    const thread_id = newId();
    const message_id = newId();
    const r2_key = r2KeyForMessage(message_id, patient_id);
    const aad = aadForMessage(message_id);
    let putRes;
    try {
        putRes = await putPhiObject(env, r2_key, cleanBody, aad);
    } catch (e) {
        return { ok: false, error: "phi_encrypt_failed", detail: String(e && e.message || e) };
    }

    const preview = clipPreview(cleanBody);
    const patient_unread = from_role === "patient" ? 0 : 1;
    const clinician_unread = from_role === "patient" ? 1 : 0;

    // R8 — patient-originated thread starts the response clock.
    const sla_due_at = from_role === "patient" ? computeSlaDueAt(urgency, t) : null;

    try {
        await env.DB.prepare(`
            INSERT INTO message_threads
                (id, patient_id, clinician_id, subject,
                 last_message_at, last_message_from_role, last_message_preview,
                 patient_unread_count, clinician_unread_count,
                 status, related_appointment_id, related_intake_id,
                 urgency, sla_due_at, sla_breached,
                 created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, 0, ?, ?)
        `).bind(
            thread_id, patient_id, CLINICIAN_ID, cleanSubject,
            t, from_role, preview,
            patient_unread, clinician_unread,
            related_appointment_id || null, related_intake_id || null,
            urgency, sla_due_at,
            t, t
        ).run();

        await env.DB.prepare(`
            INSERT INTO messages
                (id, thread_id, patient_id, from_role, from_user_id,
                 body_r2_key, subject, envelope_dek_wrapped,
                 has_attachments, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
        `).bind(
            message_id, thread_id, patient_id, from_role, from_user_id,
            r2_key, cleanSubject, putRes.wrapped_dek, t
        ).run();
    } catch (e) {
        return { ok: false, error: "db_insert_failed", detail: String(e && e.message || e) };
    }

    await notifyPatientOfNewMessage(env, patient_id, from_role, "startThread");

    return { ok: true, thread_id, message_id, created_at: t };
}

/**
 * Tell the patient a message is waiting.
 *
 * 2026-08-12 — the owner tested messaging and reported "it doesn't notify
 * members via their email of the message to login - they would never
 * know". A secure message the recipient never learns about is not a
 * message.
 *
 * 2026-08-13 — the fix for that was written INSIDE startThread, at the
 * bottom, with a comment and a catch label that both said `replyInThread`.
 * So only the first message of a brand-new thread ever notified anyone.
 * Every subsequent clinician reply — which is nearly all of them, because
 * a conversation continues in the thread it started in — went out silently
 * for a day. Extracted here so the two call sites cannot drift again.
 *
 * Only the PATIENT is emailed: the clinician works the queue in the admin
 * console. The email carries NO clinical content (see the templates in
 * notify.js) — it says a message is waiting and links to the portal,
 * because email is not a secure channel.
 *
 * Never throws. Delivery failure must not fail the message that was
 * already written: notify() resolves rather than rejecting, and queues to
 * notification_outbox on any failure.
 */
async function notifyPatientOfNewMessage(env, patient_id, from_role, where) {
    if (from_role === "patient") return;          // nothing to tell them; they sent it
    try {
        const p = await env.DB.prepare(
            "SELECT email FROM patients WHERE id = ? LIMIT 1"
        ).bind(patient_id).first();
        if (p && p.email) {
            await notify(env, { to: p.email, template: "new_message", patient_id, data: {} });
        }
    } catch (e) {
        console.error(`${where}: notification failed`, String(e).slice(0, 200));
    }
}

/**
 * Append a reply to an existing thread. Bumps the thread row and updates
 * unread counts for the OTHER side.
 */
export async function replyInThread(env, args) {
    const { thread_id, patient_id, from_role, from_user_id, body } = args;
    if (!thread_id) return { ok: false, error: "missing_thread_id" };
    if (!patient_id) return { ok: false, error: "missing_patient_id" };
    if (!ALLOWED_FROM_ROLES.has(from_role)) return { ok: false, error: "invalid_from_role" };
    const cleanBody = (body || "").toString();
    if (!cleanBody.trim()) return { ok: false, error: "empty_body" };
    const bodyBytes = new TextEncoder().encode(cleanBody).length;
    if (bodyBytes > MAX_BODY_BYTES) return { ok: false, error: "body_too_large" };

    // Verify the thread exists and is accessible to this patient_id.
    const thread = await env.DB.prepare(`
        SELECT id, patient_id, status, subject, urgency FROM message_threads WHERE id = ?
    `).bind(thread_id).first();
    if (!thread) return { ok: false, error: "thread_not_found" };
    if (thread.patient_id !== patient_id) return { ok: false, error: "thread_not_owned" };
    if (thread.status === "closed") return { ok: false, error: "thread_closed" };

    const t = Date.now();
    const message_id = newId();
    const r2_key = r2KeyForMessage(message_id, patient_id);
    const aad = aadForMessage(message_id);
    let putRes;
    try {
        putRes = await putPhiObject(env, r2_key, cleanBody, aad);
    } catch (e) {
        return { ok: false, error: "phi_encrypt_failed", detail: String(e && e.message || e) };
    }

    const preview = clipPreview(cleanBody);
    try {
        await env.DB.prepare(`
            INSERT INTO messages
                (id, thread_id, patient_id, from_role, from_user_id,
                 body_r2_key, subject, envelope_dek_wrapped,
                 has_attachments, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
        `).bind(
            message_id, thread_id, patient_id, from_role, from_user_id,
            r2_key, thread.subject, putRes.wrapped_dek, t
        ).run();

        // Bump thread: update last_message + increment the OTHER side's unread.
        // R8 SLA clock: a patient reply (re)starts the response clock at the
        // thread's urgency window; a clinician/staff reply clears it (met).
        if (from_role === "patient") {
            const sla_due_at = computeSlaDueAt(thread.urgency || "non_urgent", t);
            await env.DB.prepare(`
                UPDATE message_threads
                SET last_message_at = ?, last_message_from_role = ?,
                    last_message_preview = ?,
                    clinician_unread_count = clinician_unread_count + 1,
                    sla_due_at = ?, sla_breached = 0,
                    updated_at = ?
                WHERE id = ?
            `).bind(t, from_role, preview, sla_due_at, t, thread_id).run();
        } else {
            await env.DB.prepare(`
                UPDATE message_threads
                SET last_message_at = ?, last_message_from_role = ?,
                    last_message_preview = ?,
                    patient_unread_count = patient_unread_count + 1,
                    sla_due_at = NULL,
                    updated_at = ?
                WHERE id = ?
            `).bind(t, from_role, preview, t, thread_id).run();
        }
    } catch (e) {
        return { ok: false, error: "db_insert_failed", detail: String(e && e.message || e) };
    }

    // The call this function was always supposed to have. See
    // notifyPatientOfNewMessage — the original fix landed in startThread by
    // mistake, so replies never reached anyone.
    await notifyPatientOfNewMessage(env, patient_id, from_role, "replyInThread");

    return { ok: true, thread_id, message_id, created_at: t };
}

/**
 * Fetch + decrypt every undeleted message in a thread, in chronological order.
 * Caller is responsible for ownership checks BEFORE calling this — we trust
 * the patient_id passed in.
 */
export async function loadThreadMessages(env, thread_id) {
    const rows = await env.DB.prepare(`
        SELECT id, thread_id, from_role, from_user_id,
               body_r2_key, envelope_dek_wrapped, subject,
               has_attachments, created_at, read_at
        FROM messages
        WHERE thread_id = ? AND deleted_at IS NULL
        ORDER BY created_at ASC
    `).bind(thread_id).all();

    const messageIds = (rows?.results || []).map(m => m.id);
    const attachmentsByMessage = new Map();
    if (messageIds.length > 0) {
        const ph = messageIds.map(() => "?").join(",");
        const ar = await env.DB.prepare(`
            SELECT id, message_id, filename, mime_type, size_bytes, created_at
            FROM message_attachments WHERE message_id IN (${ph})
            ORDER BY created_at ASC
        `).bind(...messageIds).all();
        for (const a of (ar?.results || [])) {
            if (!attachmentsByMessage.has(a.message_id)) attachmentsByMessage.set(a.message_id, []);
            attachmentsByMessage.get(a.message_id).push({
                id: a.id,
                filename: a.filename,
                mime_type: a.mime_type,
                size_bytes: a.size_bytes,
                created_at: a.created_at,
            });
        }
    }

    const out = [];
    for (const m of (rows?.results || [])) {
        let body = "";
        try {
            const ptBytes = await getPhiObject(env, m.body_r2_key, m.envelope_dek_wrapped, aadForMessage(m.id));
            body = ptBytes ? new TextDecoder().decode(ptBytes) : "";
        } catch (e) {
            console.error("messaging.loadThreadMessages decrypt threw", {
                error: String(e && e.message || e),
                message_id: m.id,
            });
            body = "[message body unavailable]";
        }
        out.push({
            id: m.id,
            thread_id: m.thread_id,
            from_role: m.from_role,
            from_user_id: m.from_user_id,
            body,
            subject: m.subject,
            has_attachments: !!m.has_attachments,
            attachments: attachmentsByMessage.get(m.id) || [],
            created_at: m.created_at,
            read_at: m.read_at,
        });
    }
    return out;
}

/**
 * Mark every message in a thread as read by the given side ('patient' or
 * 'clinician'). Resets the side's unread_count to 0. Sets read_at on
 * individual message rows that have no read_at yet AND were written by
 * the OTHER side.
 */
export async function markThreadRead(env, thread_id, side) {
    if (side !== "patient" && side !== "clinician") return { ok: false, error: "invalid_side" };
    const t = Date.now();
    const otherSide = side === "patient" ? "clinician" : "patient";
    await env.DB.prepare(`
        UPDATE messages SET read_at = ?
        WHERE thread_id = ? AND read_at IS NULL AND from_role = ?
    `).bind(t, thread_id, otherSide).run();
    const col = side === "patient" ? "patient_unread_count" : "clinician_unread_count";
    await env.DB.prepare(`
        UPDATE message_threads SET ${col} = 0, updated_at = ? WHERE id = ?
    `).bind(t, thread_id).run();
    return { ok: true };
}

/**
 * List threads visible to a patient_id (when side='patient'), or list
 * threads for the clinician (when side='clinician').
 */
export async function listThreads(env, args) {
    const { side, patient_id, limit = 50 } = args;
    if (side === "patient") {
        if (!patient_id) return { ok: false, error: "missing_patient_id" };
        const r = await env.DB.prepare(`
            SELECT id, patient_id, clinician_id, subject,
                   last_message_at, last_message_from_role, last_message_preview,
                   patient_unread_count AS unread_count,
                   status, related_appointment_id, related_intake_id,
                   urgency, sla_due_at, sla_breached,
                   created_at, updated_at
            FROM message_threads
            WHERE patient_id = ?
            ORDER BY last_message_at DESC
            LIMIT ?
        `).bind(patient_id, Math.min(Math.max(limit, 1), 100)).all();
        return { ok: true, threads: r?.results || [] };
    }
    if (side === "clinician") {
        const r = await env.DB.prepare(`
            SELECT t.id, t.patient_id, t.clinician_id, t.subject,
                   t.last_message_at, t.last_message_from_role, t.last_message_preview,
                   t.clinician_unread_count AS unread_count,
                   t.status, t.related_appointment_id, t.related_intake_id,
                   t.urgency, t.sla_due_at, t.sla_breached,
                   t.created_at, t.updated_at,
                   p.first_name AS patient_first_name,
                   p.last_name  AS patient_last_name,
                   p.email      AS patient_email
            FROM message_threads t
            LEFT JOIN patients p ON p.id = t.patient_id
            WHERE t.clinician_id = ?
            ORDER BY t.last_message_at DESC
            LIMIT ?
        `).bind(CLINICIAN_ID, Math.min(Math.max(limit, 1), 100)).all();
        return { ok: true, threads: r?.results || [] };
    }
    return { ok: false, error: "invalid_side" };
}

/**
 * Audit helper — every message send/read writes a row with NO body content,
 * only thread + message ids + role.
 */
export async function auditMessage(env, request, args) {
    const { user_id, user_role, action, thread_id, message_id, success = true, detail } = args;
    try {
        await logAudit(env, {
            user_id, user_role,
            action,
            record_type: "message",
            record_id: message_id || thread_id || "",
            ip: request?.headers?.get("CF-Connecting-IP") || "",
            user_agent: request?.headers?.get("User-Agent") || "",
            success,
            details: { thread_id, message_id, ...(detail || {}) },
        });
    } catch (e) {
        console.warn("messaging.auditMessage logAudit threw", { error: String(e) });
    }
}
