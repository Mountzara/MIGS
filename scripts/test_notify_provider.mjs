#!/usr/bin/env node
// =====================================================================
// test_notify_provider.mjs — the Cloudflare provider and the retry path
// =====================================================================
// What this guards, and why each item earned its place:
//
//  1. PAYLOAD SHAPE. The Cloudflare REST API uses `from.address` and
//     `reply_to` — NOT `from.email` / `replyTo`, which are the Workers-
//     binding names for the same fields. Mixing them up produces a 400
//     with "invalid_request_schema" and no hint which field. Asserted
//     byte-for-byte here so it cannot regress silently.
//
//  2. SYNCHRONOUS BOUNCE SUPPRESSION. `permanent_bounces` in the send
//     response must write an email_suppression row AND fail the send.
//     This replaces the entire SES/SNS webhook pipeline; if it breaks,
//     hard-bounced addresses keep getting mail and reputation burns.
//
//  3. THE RETRY PATH IS GUARDED. sendDirect() is what the outbox flush
//     calls. Before 2026-08-20 it skipped the reserved-domain and
//     suppression guards, so the first flush after a working provider
//     went live would have replayed six @mountzara.test rows as
//     guaranteed hard bounces. The guards and their exact error strings
//     (which flush.js's isPermanent() classifies on) are pinned here.
//
//  4. THE BAA GATE STILL GATES. "cloudflare" must NOT pass
//     providerPermitted without the explicit non-BAA acknowledgement —
//     its BAA status is undocumented, and silently treating it as
//     HIPAA-eligible is exactly the drift the gate exists to stop.
// =====================================================================
import {
    notifyConfigured, sendDirect, isUndeliverableAddress,
} from "../functions/_lib/notify.js";
import { isPermanent } from "../functions/api/v1/internal/notifications/flush.js";

let failures = 0;
const ck = (name, cond, detail = "") => {
    if (!cond) { console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); failures++; }
};

// ---- a D1 stand-in good enough for the suppression paths -------------
function fakeDB() {
    const rows = new Map();          // email -> suppression row
    const calls = [];
    return {
        calls, rows,
        prepare(sql) {
            return {
                bind(...args) {
                    return {
                        async first() {
                            if (/FROM email_suppression/.test(sql)) {
                                const r = rows.get(String(args[0]));
                                return r && r.suppressed ? r : null;
                            }
                            return null;
                        },
                        async run() {
                            calls.push({ sql, args });
                            if (/INSERT INTO email_suppression/.test(sql)) {
                                rows.set(String(args[0]), {
                                    reason: "hard_bounce", detail: "cloudflare permanent_bounce at send",
                                    suppressed: 1,
                                });
                            }
                            return { success: true };
                        },
                    };
                },
                async run() { calls.push({ sql, args: [] }); return { success: true }; },
            };
        },
    };
}

const BASE_ENV = () => ({
    NOTIFY_PROVIDER: "cloudflare",
    NOTIFY_FROM: "no-reply@mountzara.com",
    NOTIFY_REPLY_TO: "privacy@mountzara.com",
    CF_EMAIL_TOKEN: "tok_test",
    CF_EMAIL_ACCOUNT_ID: "acct_test",
    NOTIFY_ALLOW_NON_BAA: "yes",
    DB: fakeDB(),
});

const realFetch = globalThis.fetch;
function mockFetch(handler) { globalThis.fetch = handler; }
function restoreFetch() { globalThis.fetch = realFetch; }

// ---------------------------------------------------------------------
// 1. Configuration detection
// ---------------------------------------------------------------------
ck("cloudflare counts as configured with token+account",
   notifyConfigured(BASE_ENV()));
ck("cloudflare NOT configured without token",
   !notifyConfigured({ ...BASE_ENV(), CF_EMAIL_TOKEN: "" }));
ck("cloudflare NOT configured without account id",
   !notifyConfigured({ ...BASE_ENV(), CF_EMAIL_ACCOUNT_ID: "" }));
ck("ses branch unaffected",
   notifyConfigured({ NOTIFY_PROVIDER: "ses", NOTIFY_FROM: "x@y.com",
                      SES_REGION: "r", SES_ACCESS_KEY_ID: "a", SES_SECRET_ACCESS_KEY: "s" }));

// ---------------------------------------------------------------------
// 2. Payload shape + endpoint
// ---------------------------------------------------------------------
{
    const env = BASE_ENV();
    let captured = null;
    mockFetch(async (url, opts) => {
        captured = { url: String(url), opts };
        return new Response(JSON.stringify({
            success: true, result: { delivered: ["chris.mabini@gmail.com"], permanent_bounces: [], queued: [] },
        }), { status: 200 });
    });
    const out = await sendDirect(env, {
        to: "chris.mabini@gmail.com", subject: "s", text: "t", html: "<p>t</p>",
    });
    restoreFetch();
    ck("send succeeds on delivered response", out.ok === true, JSON.stringify(out));
    ck("hits the account-scoped send endpoint",
       captured && captured.url === "https://api.cloudflare.com/client/v4/accounts/acct_test/email/sending/send",
       captured && captured.url);
    const body = captured ? JSON.parse(captured.opts.body) : {};
    ck("REST field: from.address (not from.email)",
       body.from && body.from.address === "no-reply@mountzara.com" && !("email" in (body.from || {})));
    ck("REST field: reply_to (snake_case)", body.reply_to === "privacy@mountzara.com" && !("replyTo" in body));
    ck("bearer token attached",
       captured.opts.headers.Authorization === "Bearer tok_test");
    ck("text and html both present", body.text === "t" && body.html === "<p>t</p>");
}

// ---------------------------------------------------------------------
// 3. permanent_bounces → suppression + failure
// ---------------------------------------------------------------------
{
    const env = BASE_ENV();
    mockFetch(async () => new Response(JSON.stringify({
        success: true, result: { delivered: [], permanent_bounces: ["Gone@Nowhere.com"], queued: [] },
    }), { status: 200 }));
    const out = await sendDirect(env, { to: "gone@nowhere.com", subject: "s", text: "t", html: "h" });
    restoreFetch();
    ck("bounced send reports failure", out.ok === false, JSON.stringify(out));
    ck("bounce failure is classified permanent by flush", isPermanent(out.error), out.error);
    ck("suppression row written for the bounced address",
       env.DB.rows.get("gone@nowhere.com")?.suppressed === 1);
    // and the NEXT send to that address must be refused without any fetch
    let fetched = false;
    mockFetch(async () => { fetched = true; return new Response("{}", { status: 200 }); });
    const again = await sendDirect(env, { to: "gone@nowhere.com", subject: "s", text: "t", html: "h" });
    restoreFetch();
    ck("suppressed address refused on retry", again.ok === false && /suppressed/.test(again.error), JSON.stringify(again));
    ck("…without touching the provider", !fetched);
    ck("suppression refusal is permanent for flush", isPermanent(again.error), again.error);
}

// ---------------------------------------------------------------------
// 4. The retry path refuses undeliverable + role addresses
// ---------------------------------------------------------------------
{
    const env = BASE_ENV();
    let fetched = false;
    mockFetch(async () => { fetched = true; return new Response("{}", { status: 200 }); });
    const t1 = await sendDirect(env, { to: "demo@mountzara.test", subject: "s", text: "t", html: "h" });
    const t2 = await sendDirect(env, { to: "abuse@gmail.com", subject: "s", text: "t", html: "h" });
    restoreFetch();
    ck("reserved .test refused on the retry path", t1.ok === false && /undeliverable domain/.test(t1.error), JSON.stringify(t1));
    ck(".test refusal is permanent for flush", isPermanent(t1.error), t1.error);
    ck("role alias refused on the retry path", t2.ok === false, JSON.stringify(t2));
    ck("role refusal is permanent for flush", isPermanent(t2.error), t2.error);
    ck("neither refusal reached the provider", !fetched);
    ck("sandbox 'not verified' stays recoverable",
       !isPermanent("Error: ses 400: Email address is not verified."));
}

// ---------------------------------------------------------------------
// 5. The BAA gate
// ---------------------------------------------------------------------
{
    const env = { ...BASE_ENV(), NOTIFY_ALLOW_NON_BAA: "" };
    let fetched = false;
    mockFetch(async () => { fetched = true; return new Response("{}", { status: 200 }); });
    const out = await sendDirect(env, { to: "chris.mabini@gmail.com", subject: "s", text: "t", html: "h" });
    restoreFetch();
    ck("cloudflare without the non-BAA acknowledgement is refused",
       out.ok === false && /BAA/.test(out.error), JSON.stringify(out));
    ck("…without touching the provider", !fetched);
}

// ---------------------------------------------------------------------
// 6. Provider errors surface with their body
// ---------------------------------------------------------------------
{
    const env = BASE_ENV();
    mockFetch(async () => new Response(JSON.stringify({
        success: false, errors: [{ code: 10203, message: "email.sending.error.email.sending_disabled" }],
    }), { status: 403 }));
    const out = await sendDirect(env, { to: "chris.mabini@gmail.com", subject: "s", text: "t", html: "h" });
    restoreFetch();
    ck("API error carried through with code", out.ok === false && /10203|403/.test(out.error), out.error);
}

// ---------------------------------------------------------------------
// 7. NOTIFY_FROM display-form parsing
// ---------------------------------------------------------------------
// The secret predates this provider and holds the SES-era display form
// "Mount Zara <no-reply@…>". Cloudflare's from.address 400s (10202) on
// that; the sender must be split into address + name. Both shapes pinned.
{
    for (const [rawFrom, wantAddr, wantName] of [
        ["Mount Zara <no-reply@mountzara.com>", "no-reply@mountzara.com", "Mount Zara"],
        ['"Mount Zara" <no-reply@mountzara.com>', "no-reply@mountzara.com", "Mount Zara"],
        ["no-reply@mountzara.com", "no-reply@mountzara.com", "Mount Zara"],
        ["<no-reply@mountzara.com>", "no-reply@mountzara.com", "Mount Zara"],
    ]) {
        const env = { ...BASE_ENV(), NOTIFY_FROM: rawFrom };
        let body = null;
        mockFetch(async (url, opts) => {
            body = JSON.parse(opts.body);
            return new Response(JSON.stringify({ success: true,
                result: { delivered: ["x@y.com"], permanent_bounces: [], queued: [] } }), { status: 200 });
        });
        await sendDirect(env, { to: "chris.mabini@gmail.com", subject: "s", text: "t", html: "h" });
        restoreFetch();
        ck(`NOTIFY_FROM ${JSON.stringify(rawFrom)} → bare address`,
           body && body.from.address === wantAddr, JSON.stringify(body && body.from));
        ck(`NOTIFY_FROM ${JSON.stringify(rawFrom)} → name preserved`,
           body && body.from.name === wantName, JSON.stringify(body && body.from));
    }
}

if (failures) { console.error(`notify-provider gate: ${failures} failure(s)`); process.exit(2); }
console.log("notify-provider gate: 32 checks pass — payload shape, synchronous bounce suppression, guarded retry path, BAA gate");
