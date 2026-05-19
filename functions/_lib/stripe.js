// =====================================================================
// functions/_lib/stripe.js — minimal Stripe REST wrapper (fetch-based)
// =====================================================================
// Cloudflare Workers don't ship the official `stripe` Node SDK well
// (too many Node built-ins). This module is a tight fetch wrapper around
// Stripe's REST API that supports just the calls we need: Customer,
// PaymentIntent, PaymentMethod, Invoice, Refund, Webhook signature
// verification.
//
// All money values are in CENTS per Stripe convention.
//
// Env vars expected:
//   STRIPE_SECRET_KEY        — sk_test_... or sk_live_...
//   STRIPE_PUBLISHABLE_KEY   — pk_test_... or pk_live_... (used by /portal/billing/)
//   STRIPE_WEBHOOK_SECRET    — whsec_... (for webhook signature verification)
//
// Idempotency: pass `idempotency_key` in the per-call opts to make POSTs
// retryable. Always do this for state-changing calls.
//
// Per CLAUDE.md §11 Phase 6 + §0.8 + §4.2 — no card data ever transits
// our infrastructure; Stripe.js + Stripe Elements collect cards directly
// from the browser to Stripe, returning a `pm_xxx` token we save.
// =====================================================================

const STRIPE_BASE = "https://api.stripe.com/v1";
const DEFAULT_API_VERSION = "2024-06-20"; // pin to keep webhook + response shapes stable

export class StripeError extends Error {
    constructor(message, opts = {}) {
        super(message);
        this.name = "StripeError";
        this.code = opts.code || "stripe_error";
        this.type = opts.type || null;
        this.statusCode = opts.statusCode || 0;
        this.requestId = opts.requestId || null;
        this.raw = opts.raw || null;
    }
}

// ---------- Form encoding (Stripe wants application/x-www-form-urlencoded) ----------
function encodeForm(obj, prefix = "") {
    const parts = [];
    for (const [k, v] of Object.entries(obj || {})) {
        if (v === undefined || v === null) continue;
        const key = prefix ? `${prefix}[${k}]` : k;
        if (Array.isArray(v)) {
            v.forEach((item, i) => {
                if (item && typeof item === "object") {
                    parts.push(encodeForm(item, `${key}[${i}]`));
                } else {
                    parts.push(`${encodeURIComponent(key + "[" + i + "]")}=${encodeURIComponent(String(item))}`);
                }
            });
        } else if (typeof v === "object") {
            parts.push(encodeForm(v, key));
        } else {
            parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
        }
    }
    return parts.filter(Boolean).join("&");
}

// ---------- Core request ----------
async function stripeRequest(env, method, path, body = null, opts = {}) {
    if (!env.STRIPE_SECRET_KEY) {
        throw new StripeError("STRIPE_SECRET_KEY missing in env", { code: "config_missing" });
    }
    const url = `${STRIPE_BASE}${path}`;
    const headers = {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Stripe-Version": opts.apiVersion || DEFAULT_API_VERSION,
        "Content-Type": "application/x-www-form-urlencoded",
    };
    if (opts.idempotency_key) headers["Idempotency-Key"] = opts.idempotency_key;
    if (opts.stripe_account) headers["Stripe-Account"] = opts.stripe_account;

    const init = { method, headers };
    if (body && (method === "POST" || method === "DELETE")) {
        init.body = encodeForm(body);
    }

    let resp;
    try {
        resp = await fetch(url, init);
    } catch (e) {
        throw new StripeError(`network: ${e?.message || e}`, { code: "network_error" });
    }
    const requestId = resp.headers.get("Request-Id");
    let json = null;
    try {
        json = await resp.json();
    } catch {
        throw new StripeError(`non-json response (status ${resp.status})`, { code: "bad_response", statusCode: resp.status, requestId });
    }

    if (!resp.ok || json?.error) {
        const e = json?.error || {};
        throw new StripeError(e.message || `Stripe ${resp.status}`, {
            code: e.code || "stripe_api_error",
            type: e.type || null,
            statusCode: resp.status,
            requestId,
            raw: json,
        });
    }
    return json;
}

// ---------- Customers ----------
export async function createCustomer(env, { email, name, patient_id, idempotency_key }) {
    return stripeRequest(env, "POST", "/customers", {
        email, name,
        metadata: { mountzara_patient_id: patient_id },
    }, { idempotency_key });
}

export async function updateCustomer(env, stripe_customer_id, fields) {
    return stripeRequest(env, "POST", `/customers/${encodeURIComponent(stripe_customer_id)}`, fields);
}

export async function getCustomer(env, stripe_customer_id) {
    return stripeRequest(env, "GET", `/customers/${encodeURIComponent(stripe_customer_id)}`);
}

// ---------- Payment Intents ----------
// For pay-now flows (patient clicks Pay on /portal/billing/<invoice_id>).
// Returns { id, client_secret, ... } — client_secret goes to the browser,
// where Stripe.js confirms the card payment.
export async function createPaymentIntent(env, args) {
    const {
        amount_cents, currency = "usd", customer_id, payment_method_id, off_session = false,
        confirm = false, capture_method = "automatic",
        description, statement_descriptor, statement_descriptor_suffix,
        receipt_email, metadata, idempotency_key,
    } = args;
    return stripeRequest(env, "POST", "/payment_intents", {
        amount: amount_cents, currency,
        customer: customer_id,
        payment_method: payment_method_id,
        off_session, confirm, capture_method,
        description,
        statement_descriptor, statement_descriptor_suffix,
        receipt_email,
        metadata,
    }, { idempotency_key });
}

export async function getPaymentIntent(env, pi_id, opts = {}) {
    const expand = opts.expand ? `?expand[]=${opts.expand.join("&expand[]=")}` : "";
    return stripeRequest(env, "GET", `/payment_intents/${encodeURIComponent(pi_id)}${expand}`);
}

// ---------- Payment Methods ----------
export async function attachPaymentMethod(env, pm_id, customer_id) {
    return stripeRequest(env, "POST", `/payment_methods/${encodeURIComponent(pm_id)}/attach`, { customer: customer_id });
}

export async function detachPaymentMethod(env, pm_id) {
    return stripeRequest(env, "POST", `/payment_methods/${encodeURIComponent(pm_id)}/detach`, {});
}

export async function listPaymentMethods(env, customer_id, type = "card") {
    return stripeRequest(env, "GET", `/customers/${encodeURIComponent(customer_id)}/payment_methods?type=${encodeURIComponent(type)}`);
}

// ---------- Refunds ----------
export async function createRefund(env, args) {
    const { payment_intent_id, charge_id, amount_cents, reason, metadata, idempotency_key } = args;
    const body = { amount: amount_cents, metadata };
    if (payment_intent_id) body.payment_intent = payment_intent_id;
    if (charge_id) body.charge = charge_id;
    if (reason) body.reason = reason;
    return stripeRequest(env, "POST", "/refunds", body, { idempotency_key });
}

export async function getRefund(env, refund_id) {
    return stripeRequest(env, "GET", `/refunds/${encodeURIComponent(refund_id)}`);
}

// ---------- Balance Transactions (for fee/net reconciliation → QB) ----------
export async function getBalanceTransaction(env, txn_id) {
    return stripeRequest(env, "GET", `/balance_transactions/${encodeURIComponent(txn_id)}`);
}

// =====================================================================
// Webhook signature verification (Stripe v1 spec)
// =====================================================================
// Stripe-Signature header format:
//   t=<timestamp>,v1=<sig1>,v1=<sig2>,...
//
// Signed payload: `${t}.${raw_request_body}`
// HMAC-SHA-256 using STRIPE_WEBHOOK_SECRET.
//
// Constant-time compare, then reject anything older than TOLERANCE_SECONDS
// (default 300 = 5 minutes). Returns parsed event on success.
//
// Throws StripeError with code 'signature_invalid' or 'timestamp_too_old'.
//
// Reference: https://stripe.com/docs/webhooks/signatures
// =====================================================================
const TOLERANCE_SECONDS = 300;

function constantTimeEqual(a, b) {
    if (a.length !== b.length) return false;
    let r = 0;
    for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return r === 0;
}

async function hmacSha256Hex(key, message) {
    const enc = new TextEncoder();
    const k = await crypto.subtle.importKey(
        "raw", enc.encode(key),
        { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", k, enc.encode(message));
    const bytes = new Uint8Array(sig);
    let hex = "";
    for (const b of bytes) hex += b.toString(16).padStart(2, "0");
    return hex;
}

export async function verifyWebhookSignature(env, rawBody, signatureHeader) {
    if (!env.STRIPE_WEBHOOK_SECRET) {
        throw new StripeError("STRIPE_WEBHOOK_SECRET missing in env", { code: "config_missing" });
    }
    if (!signatureHeader) {
        throw new StripeError("Missing Stripe-Signature header", { code: "signature_invalid" });
    }
    // Parse: t=...,v1=...,v1=...
    const parts = {};
    for (const seg of signatureHeader.split(",")) {
        const [k, v] = seg.split("=", 2);
        if (k === "t") parts.t = v;
        else if (k === "v1") {
            parts.v1 = parts.v1 || [];
            parts.v1.push(v);
        }
    }
    if (!parts.t || !parts.v1 || !parts.v1.length) {
        throw new StripeError("Malformed Stripe-Signature header", { code: "signature_invalid" });
    }
    const timestamp = parseInt(parts.t, 10);
    if (!Number.isFinite(timestamp)) {
        throw new StripeError("Bad timestamp in Stripe-Signature", { code: "signature_invalid" });
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - timestamp) > TOLERANCE_SECONDS) {
        throw new StripeError(`Timestamp outside tolerance (delta=${nowSec - timestamp}s)`, { code: "timestamp_too_old" });
    }
    const signedPayload = `${parts.t}.${rawBody}`;
    const expected = await hmacSha256Hex(env.STRIPE_WEBHOOK_SECRET, signedPayload);
    const matched = parts.v1.some((s) => constantTimeEqual(s, expected));
    if (!matched) {
        throw new StripeError("Webhook signature did not match", { code: "signature_invalid" });
    }
    let event;
    try { event = JSON.parse(rawBody); }
    catch { throw new StripeError("Invalid JSON body", { code: "bad_response" }); }
    return event;
}
