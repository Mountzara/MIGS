// =====================================================================
// POST /api/v1/contact — native site form: waitlist signups + inquiries
// =====================================================================
// 2026-08-24 (owner directive): the practice is NOT yet accepting new
// patients, so the public CTA is "sign up to be notified", and Get-in-
// touch becomes a native form (mailto remains as a secondary path).
// Pattern cloned from cv-access-request.js (public, throttled, clipped).
// Adds best-effort D1 persistence so the waitlist itself is retrievable
// (the email is a notification, not the datastore). The form explicitly
// tells visitors NOT to include medical details; message length is
// capped and stored as plain contact correspondence, not clinical data.
// =====================================================================

import { sendDirect, isUndeliverableAddress } from "../../_lib/notify.js";

function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status, headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

const clip = (s, n) => String(s || "").replace(/[\r\n]+/g, " ").trim().slice(0, n);

async function ipHash(ip) {
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("mzc1:" + ip));
    return [...new Uint8Array(d)].slice(0, 8).map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function onRequestPost(ctx) {
    const { request, env } = ctx;

    let body;
    try { body = await request.json(); }
    catch { return json({ error: "invalid_json" }, 400); }

    // honeypot: real users never fill "website" — accept silently, do nothing
    if (clip(body.website, 10)) return json({ ok: true });

    const kind = body.kind === "inquiry" ? "inquiry" : "waitlist";
    const name = clip(body.name, 120);
    const email = clip(body.email, 200);
    const phone = clip(body.phone, 40);
    const message = kind === "inquiry" ? clip(body.message, 800) : "";

    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return json({ error: "name and a valid email are required" }, 400);
    }

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    try {
        if (env.MZ_SESSIONS) {
            const key = `contact:${ip}`;
            const n = parseInt((await env.MZ_SESSIONS.get(key)) || "0", 10);
            if (n >= 5) return json({ error: "too_many_requests" }, 429);
            await env.MZ_SESSIONS.put(key, String(n + 1), { expirationTtl: 3600 });
        }
    } catch { /* best-effort */ }

    // Persist first — the waitlist must survive even if email delivery hiccups.
    let stored = false;
    try {
        if (env.DB) {
            await env.DB.prepare(
                `CREATE TABLE IF NOT EXISTS contact_requests (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    kind TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL,
                    phone TEXT, message TEXT, ip_hash TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')))`).run();
            await env.DB.prepare(
                `INSERT INTO contact_requests (kind, name, email, phone, message, ip_hash)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
                .bind(kind, name, email, phone, message, await ipHash(ip)).run();
            stored = true;
        }
    } catch { /* storage is best-effort; the email below still carries the lead */ }

    const to = env.ALERT_EMAIL || env.NOTIFY_REPLY_TO || env.NOTIFY_FROM;
    if (!to || isUndeliverableAddress(to)) return json({ ok: true, stored, delivered: false });

    const subject = kind === "waitlist"
        ? "Patient waitlist signup — notify when accepting patients"
        : "Website inquiry (Get in touch form)";
    const text =
        `${kind === "waitlist" ? "A visitor asked to be notified when the practice starts accepting patients." : "A visitor sent a message from the website form."}\n\n` +
        `Name:  ${name}\nEmail: ${email}\nPhone: ${phone || "(none)"}\n` +
        (message ? `Message: ${message}\n` : "") +
        `\nStored in D1 contact_requests: ${stored ? "yes" : "no"}`;
    const html =
        `<p>${kind === "waitlist" ? "A visitor asked to be <b>notified when the practice starts accepting patients</b>." : "A visitor sent a message from the website form."}</p>` +
        `<table style="font-size:14px"><tr><td><b>Name</b></td><td>${name}</td></tr>` +
        `<tr><td><b>Email</b></td><td>${email}</td></tr>` +
        `<tr><td><b>Phone</b></td><td>${phone || "(none)"}</td></tr>` +
        (message ? `<tr><td><b>Message</b></td><td>${message}</td></tr>` : "") + `</table>` +
        `<p style="color:#666;font-size:12px">Stored in D1 contact_requests: ${stored ? "yes" : "no"}</p>`;

    const out = await sendDirect(env, { to, subject, text, html });
    return json({ ok: true, stored, delivered: Boolean(out?.ok) });
}

export async function onRequest(ctx) {
    if (ctx.request.method === "POST") return onRequestPost(ctx);
    return json({ error: "method_not_allowed" }, 405);
}
