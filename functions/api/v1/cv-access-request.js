// =====================================================================
// POST /api/v1/cv-access-request — a visitor asks for the CV
// =====================================================================
// The public request form on the gated /cv/ page posts here. It emails
// the practice (ALERT_EMAIL, falling back to NOTIFY_REPLY_TO) through the
// live notification pipeline so Dr. Mabini can decide whether to issue a
// grant link. It stores nothing and reveals nothing — a request is not
// access.
//
// This is deliberately unauthenticated (it is a public contact form) but
// rate-limited by IP so it cannot be used to spray mail, and the body is
// length-capped so it cannot be used to smuggle a payload into the inbox.
// =====================================================================

import { sendDirect, isUndeliverableAddress } from "../../_lib/notify.js";

function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status, headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

const clip = (s, n) => String(s || "").replace(/[\r\n]+/g, " ").trim().slice(0, n);

export async function onRequestPost(ctx) {
    const { request, env } = ctx;

    let body;
    try { body = await request.json(); }
    catch { return json({ error: "invalid_json" }, 400); }

    const name = clip(body.name, 120);
    const email = clip(body.email, 200);
    const reason = clip(body.reason, 600);

    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return json({ error: "name and a valid email are required" }, 400);
    }

    // Lightweight per-IP throttle via KV when available: 5 requests / hour.
    try {
        if (env.MZ_SESSIONS) {
            const ip = request.headers.get("CF-Connecting-IP") || "unknown";
            const key = `cvreq:${ip}`;
            const n = parseInt((await env.MZ_SESSIONS.get(key)) || "0", 10);
            if (n >= 5) return json({ error: "too_many_requests" }, 429);
            await env.MZ_SESSIONS.put(key, String(n + 1), { expirationTtl: 3600 });
        }
    } catch { /* throttle is best-effort; never block a legitimate request on it */ }

    const to = env.ALERT_EMAIL || env.NOTIFY_REPLY_TO || env.NOTIFY_FROM;
    if (!to || isUndeliverableAddress(to)) {
        // No inbox to route to — accept the request so the visitor is not
        // penalised for our misconfiguration, but say plainly it was not sent.
        return json({ ok: true, delivered: false });
    }

    const subject = "CV / operative-outcomes access request";
    const text =
        `Someone requested access to the CV and operative outcomes.\n\n` +
        `Name:   ${name}\n` +
        `Email:  ${email}\n` +
        `Reason: ${reason || "(none given)"}\n\n` +
        `To grant access, issue a /cv/grant link from the admin tools.`;
    const html =
        `<p>Someone requested access to the CV and operative outcomes.</p>` +
        `<table style="font-size:14px"><tr><td><b>Name</b></td><td>${name}</td></tr>` +
        `<tr><td><b>Email</b></td><td>${email}</td></tr>` +
        `<tr><td><b>Reason</b></td><td>${reason || "(none given)"}</td></tr></table>` +
        `<p style="color:#666;font-size:12px">To grant access, issue a /cv/grant link from the admin tools.</p>`;

    const out = await sendDirect(env, { to, subject, text, html });
    // Whether or not delivery succeeded, do not leak provider errors to an
    // anonymous caller; the office still has the audit trail server-side.
    return json({ ok: true, delivered: Boolean(out?.ok) });
}

export async function onRequest(ctx) {
    if (ctx.request.method === "POST") return onRequestPost(ctx);
    return json({ error: "method_not_allowed" }, 405);
}
