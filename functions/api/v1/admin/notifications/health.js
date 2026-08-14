// =====================================================================
// GET /api/v1/admin/notifications/health — is email actually working?
// =====================================================================
// On 2026-08-14 six notifications had failed and nothing anywhere said so.
// Three of them were magic-link SIGN-IN emails — one to the owner's own
// address. A patient requesting a link sees "if an account exists, a
// sign-in link has been issued", and then nothing arrives, and no screen
// in the system reports it. From the patient's side it is indistinguishable
// from having no account; from the practice's side it is invisible.
//
// The cause was not a bug in the code. It is that AWS SES is still in the
// SANDBOX, which refuses any recipient that is not a verified identity:
//
//   "Email address is not verified. The following identities failed the
//    check in region US-EAST-2: chris.mabini@gmail.com"
//
// That is an account-level condition, fixed in the AWS console and nowhere
// else. What the CODE can do is refuse to let it be silent — which is what
// this endpoint is for. It answers, in one call: can this practice send
// email to a patient right now, and if not, what is the specific reason.
//
// Read-only. No PHI: addresses are masked.
// =====================================================================

import { adminRoute, jsonResponse, jsonError } from "../../../../_lib/admin_api.js";

const SANDBOX_HINT = /not verified|identities failed the check/i;

function maskEmail(e) {
    const s = String(e || "");
    return s.replace(/^(.{2}).*?@/, "$1***@");
}

/**
 * Turn the outbox's raw errors into the one sentence he needs. Grouped by
 * cause rather than listed row by row: six copies of the same SES sandbox
 * refusal is one problem, not six.
 */
export function diagnose(rows) {
    const failed = rows.filter((r) => r.status !== "sent");
    if (!failed.length) {
        return { healthy: true, headline: "Email is delivering.", causes: [] };
    }
    const buckets = new Map();
    for (const r of failed) {
        const err = String(r.error || "unknown");
        let key, explain, action;
        if (SANDBOX_HINT.test(err)) {
            key = "ses_sandbox";
            explain = "AWS SES is still in the sandbox, so it will only deliver to addresses you have verified individually. Every patient email fails until production access is granted.";
            action = "In the AWS console: Amazon SES → Account dashboard → Request production access (region us-east-2). Until it is granted, no patient can receive a sign-in link, an appointment confirmation, or a message alert.";
        } else if (/NOTIFY_PROVIDER|not set|not configured/i.test(err)) {
            key = "not_configured";
            explain = "No mail provider is configured for this deployment.";
            action = "Set NOTIFY_PROVIDER, the provider credentials and NOTIFY_FROM as Pages secrets, then redeploy.";
        } else if (/BAA/i.test(err)) {
            key = "baa";
            explain = "The configured provider does not sign a BAA, and patient notifications require one.";
            action = "Use NOTIFY_PROVIDER=ses.";
        } else if (/invalid recipient/i.test(err)) {
            key = "bad_address";
            explain = "One or more stored addresses are not valid email addresses.";
            action = "Correct the address on the patient record; these are abandoned rather than retried forever.";
        } else {
            key = "other";
            explain = "Delivery failed for a reason not recognised here.";
            action = "Read the error text below.";
        }
        const b = buckets.get(key) || { cause: key, explain, action, count: 0, sample_error: err.slice(0, 300), recipients: [] };
        b.count++;
        if (b.recipients.length < 5) b.recipients.push(maskEmail(r.to_email));
        buckets.set(key, b);
    }
    const causes = [...buckets.values()].sort((a, b) => b.count - a.count);
    return {
        healthy: false,
        headline: causes[0].cause === "ses_sandbox"
            ? `Email is NOT reaching patients: SES is still in the sandbox (${failed.length} undelivered).`
            : `${failed.length} notification(s) have not been delivered.`,
        causes,
    };
}

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env }) => {
        if (!env.DB) return jsonError("D1 not bound", 500);

        const res = await env.DB.prepare(`
            SELECT id, to_email, template, status, error, attempts, created_at, sent_at
              FROM notification_outbox
             ORDER BY created_at DESC
             LIMIT 500
        `).all().catch(() => null);

        if (!res) {
            return jsonResponse({
                ok: true, healthy: false,
                headline: "The notification outbox table does not exist — nothing is recording whether email is delivering.",
                causes: [], counts: {},
            });
        }
        const rows = res.results || [];
        const counts = rows.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
        const d = diagnose(rows);

        // The most recent SUCCESSFUL send is the honest liveness signal:
        // "0 failures" means nothing if nothing has been attempted.
        const lastSent = rows.find((r) => r.status === "sent");

        return jsonResponse({
            ok: true,
            ...d,
            counts,
            total_recorded: rows.length,
            undelivered: rows.filter((r) => r.status !== "sent").length,
            last_successful_send: lastSent
                ? { at: lastSent.sent_at || lastSent.created_at, template: lastSent.template }
                : null,
            never_delivered_anything: !lastSent,
            recent: rows.slice(0, 20).map((r) => ({
                id: r.id, template: r.template, to: maskEmail(r.to_email),
                status: r.status, attempts: r.attempts, created_at: r.created_at,
                error: r.error ? String(r.error).slice(0, 200) : null,
            })),
        });
    });
}
