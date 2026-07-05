// =====================================================================
// POST /api/v1/auth/magic-link/issue — issue a single-use sign-in link
// =====================================================================
// Body (JSON): { email }
//
// Behavior:
//   * Always returns 200 with a generic "if an account exists, a link
//     has been sent" message — DO NOT leak whether the email is on file
//     (defense against enumeration).
//   * Internally: if the email matches an existing active patient,
//     calls issueMagicLink (functions/_lib/auth.js) with purpose='login'
//     and writes audit_log magic_link_issue.
//   * If no patient or status != active, we deliberately still pretend
//     to succeed but issue no token.
//   * Console-logs the redeem URL prominently (the wrangler tail picks
//     it up so the admin can read the link until SendGrid BAA lands).
//   * If env.MAGIC_LINK_DEV_RETURN === "yes", also returns the URL in
//     the response body — admin-only test convenience.
//
// Email delivery (SendGrid/Mailgun/etc.) is wired in Phase 2 once
// Twilio + SendGrid BAA is signed (per §11.4 BAA-ledger).
// =====================================================================

import { previewAccess, preLaunchNotFound } from "../../../../_lib/preview_gate.js";
import { issueMagicLink, normalizeEmail } from "../../../../_lib/auth.js";
import { checkLockout, recordFailure, tooManyRequests } from "../../../../_lib/rate_limit.js";

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Same soft-lockout policy as password login: 10 requests per (email|ip)
// per 15 min. Every request counts as a "failure" — the endpoint always
// pretends to succeed, so there is no success to clear on; this throttles
// link-flooding an inbox and enumeration probing alike.
const RL_THRESHOLD = 10;
const RL_WINDOW_SECONDS = 15 * 60;

function genericOk(extra) {
    return new Response(JSON.stringify(Object.assign({
        ok: true,
        message: "If an account exists for that email, a sign-in link has been issued.",
    }, extra || {})), {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

export async function onRequestPost(ctx) {
    const { request, env } = ctx;
    const { allow } = await previewAccess(request, env);
    if (!allow) return preLaunchNotFound();

    if (!env.DB) return genericOk();

    let body;
    try { body = await request.json(); } catch { return genericOk(); }
    const email = normalizeEmail(body?.email);
    if (!EMAIL_RX.test(email)) return genericOk();

    const ip = request.headers.get("CF-Connecting-IP") || "";
    const rlIdentifier = `${email}|${ip}`;
    const lock = await checkLockout({
        env, prefix: "magic_issue", identifier: rlIdentifier,
        threshold: RL_THRESHOLD, windowSeconds: RL_WINDOW_SECONDS,
    });
    if (lock.locked) return tooManyRequests(lock.retry_after_seconds);
    await recordFailure({
        env, prefix: "magic_issue", identifier: rlIdentifier,
        threshold: RL_THRESHOLD, windowSeconds: RL_WINDOW_SECONDS,
    });

    const row = await env.DB.prepare(
        "SELECT id, status FROM patients WHERE email = ? LIMIT 1"
    ).bind(email).first();

    if (!row || row.status !== "active") {
        // Same shape, same timing-ish — issue a dummy delay maybe later.
        return genericOk();
    }

    let issued;
    try {
        issued = await issueMagicLink({
            env, email, patient_id: row.id, purpose: "login", request,
        });
    } catch (e) {
        console.error("magic-link/issue threw", { error: String(e), email: email.slice(0, 4) + "***" });
        return genericOk();
    }

    const url = new URL(request.url);
    const redeemUrl = `${url.protocol}//${url.host}/portal/magic-link/redeem/?token=${encodeURIComponent(issued.token)}`;

    // The wrangler tail will surface this so the admin can read the link
    // until real email delivery is wired in Phase 2.
    console.log("magic-link issued (DEV / pre-launch):", {
        patient_id: row.id,
        email_prefix: email.slice(0, 4) + "***",
        redeem_url: redeemUrl,
        expires_at: issued.expires_at,
    });

    const extra = (env.MAGIC_LINK_DEV_RETURN || "").toLowerCase() === "yes"
        ? { _dev_url: redeemUrl, _dev_expires_at: issued.expires_at }
        : {};
    return genericOk(extra);
}
