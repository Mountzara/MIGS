// =====================================================================
// portal_headers.js — security headers for /portal/*, set where they work
// =====================================================================
// WHY THIS FILE EXISTS, rather than four more lines in `_headers`.
//
// `_headers` APPENDS. It does not replace. A path-specific rule does not
// override the site-wide `/*` rule for the same header name — Pages emits
// BOTH header lines, and the browser then applies its own rule for
// duplicates. For the two headers that matter here, that rule is not
// "the more specific one wins":
//
//   * Permissions-Policy — when a feature is listed more than once, the
//     FIRST occurrence wins and every later one is ignored. Site-wide
//     `camera=()` is emitted first, so a later `camera=(self)` on
//     /portal/tech-check/ changes nothing at all. The header was there,
//     it looked right in curl, and the camera stayed off.
//
//   * Content-Security-Policy — multiple policies are each enforced in
//     full, so the effective policy is their INTERSECTION. Adding a
//     second, more permissive CSP naming js.stripe.com cannot unblock
//     anything: the strict site-wide policy is still enforced alongside
//     it, and it has no js.stripe.com and no frame-src.
//
// Only `!` (unset) genuinely removes an inherited header. That is why the
// COEP removal on /portal/billing/ worked while the Permissions-Policy and
// CSP edits in the same block were inert.
//
// SECOND PROBLEM, SAME PLACE. `_headers` is applied by the static-asset
// layer. Every response a Pages Function CONSTRUCTS bypasses it entirely:
// the pre-launch Coming Soon page, the /portal/visit/<id>/launch
// interstitial and the /portal/nps/<token> survey were all being served
// with three headers and nothing else — no HSTS, no CSP, no frame-ancestors,
// no X-Frame-Options, and `cache-control: public, max-age=60` on a surface
// whose whole posture is no-store.
//
// So headers are applied HERE, in code, on the way out of the portal
// middleware — which sits in front of every /portal/* response, static or
// Function-generated. `Headers.set()` replaces rather than appends, so
// there is exactly one Permissions-Policy and one CSP on the wire and the
// browser's duplicate-handling rules never come into play.
// =====================================================================

/** The site-wide policy, restated so the portal does not silently drift. */
export const BASE_CSP = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://static.cloudflareinsights.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' https://*.mountzara.com https://mountzara.com data:",
    "media-src 'self' https://*.mountzara.com https://mountzara.com blob:",
    "connect-src 'self' https://*.mountzara.com https://mountzara.com https://cloudflareinsights.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
].join("; ");

/**
 * Billing needs Stripe, and Stripe needs four separate allowances that the
 * base policy denies:
 *   1. js.stripe.com in script-src — without it the loader never runs,
 *      `window.Stripe` is undefined, and pressing Pay puts the raw string
 *      "Stripe is not defined" in front of the patient.
 *   2. frame-src — the Payment Element is a cross-origin iframe, and with
 *      no frame-src it falls back to default-src 'self' and dies.
 *   3. api.stripe.com in connect-src — tokenisation is an XHR.
 *   4. COEP off (see BILLING_REMOVE) — Stripe serves no
 *      Cross-Origin-Resource-Policy, so require-corp blocks it
 *      independently of CSP.
 * Scoped to this one path; every other portal page keeps the strict policy,
 * and those are the ones carrying PHI.
 */
export const BILLING_CSP = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://js.stripe.com https://static.cloudflareinsights.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' https://*.mountzara.com https://mountzara.com data:",
    "connect-src 'self' https://*.mountzara.com https://mountzara.com https://api.stripe.com https://cloudflareinsights.com",
    "frame-src https://js.stripe.com https://hooks.stripe.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
].join("; ");

const PP = (over = {}) => {
    const f = {
        camera: "()", microphone: "()", geolocation: "()", payment: "()",
        usb: "()", magnetometer: "()", gyroscope: "()", accelerometer: "()",
        ...over,
    };
    return Object.entries(f).map(([k, v]) => `${k}=${v}`).join(", ");
};

export const PERMISSIONS_DEFAULT = PP();

/**
 * `camera=()` is an EMPTY allowlist — it disables the feature for every
 * origin INCLUDING this one, so getUserMedia rejects with NotAllowedError
 * before the browser shows a prompt. The device check, whose entire job is
 * proving the camera and microphone work, therefore reported both FAILED
 * for every patient and then advised them to "allow camera access for this
 * site in your browser settings". No browser setting can override a
 * response header, so that advice could never work: a patient about to
 * have their first video visit was told their equipment was broken.
 */
export const PERMISSIONS_TECH_CHECK = PP({ camera: "(self)", microphone: "(self)" });

/** The Payment Request API needs payment=(self); camera and mic stay off. */
export const PERMISSIONS_BILLING = PP({ payment: "(self)" });

/** Headers every /portal/* response carries, whatever produced it. */
export const PORTAL_BASE = {
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
    "X-Robots-Tag": "noindex, nofollow, noai, noimageai, nosnippet, noarchive",
    "Cache-Control": "no-store, max-age=0",
    "Permissions-Policy": PERMISSIONS_DEFAULT,
    "Content-Security-Policy": BASE_CSP,
};

const BILLING_REMOVE = ["Cross-Origin-Embedder-Policy"];

function normalise(pathname) {
    const p = String(pathname || "").split("?")[0];
    return p.replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/";
}

export function isTechCheckPath(pathname) {
    const p = normalise(pathname);
    return p === "/portal/tech-check" || p.startsWith("/portal/tech-check/");
}

export function isBillingPath(pathname) {
    const p = normalise(pathname);
    return p === "/portal/billing" || p.startsWith("/portal/billing/");
}

/**
 * The exact header set for one portal path.
 * @returns {{set: Record<string,string>, remove: string[]}}
 */
export function portalHeaders(pathname) {
    const set = { ...PORTAL_BASE };
    const remove = [];

    if (isTechCheckPath(pathname)) {
        set["Permissions-Policy"] = PERMISSIONS_TECH_CHECK;
    } else if (isBillingPath(pathname)) {
        set["Permissions-Policy"] = PERMISSIONS_BILLING;
        set["Content-Security-Policy"] = BILLING_CSP;
        delete set["Cross-Origin-Embedder-Policy"];
        remove.push(...BILLING_REMOVE);
    }
    return { set, remove };
}

/**
 * Apply them. Returns a NEW Response, because headers on a response that
 * came back from `next()` or `env.ASSETS.fetch()` are immutable — mutating
 * them in place throws, and a throw inside the middleware takes the whole
 * portal down.
 *
 * `set` (not `append`) is the point of this function: it collapses the
 * duplicate `_headers` emits, so the browser sees one policy per header.
 *
 * Content-Type and Content-Encoding are never touched.
 */
export function applyPortalHeaders(response, pathname) {
    const { set, remove } = portalHeaders(pathname);
    const out = new Response(response.body, response);
    for (const [k, v] of Object.entries(set)) out.headers.set(k, v);
    for (const k of remove) out.headers.delete(k);
    return out;
}

export default {
    BASE_CSP, BILLING_CSP,
    PERMISSIONS_DEFAULT, PERMISSIONS_TECH_CHECK, PERMISSIONS_BILLING,
    PORTAL_BASE, isTechCheckPath, isBillingPath, portalHeaders, applyPortalHeaders,
};
