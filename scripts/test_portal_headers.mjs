// =====================================================================
// test_portal_headers.mjs
// =====================================================================
// The bug this guards was not "the header was missing". The header was
// present, and visible in curl, and had no effect — because `_headers`
// appends and the browser resolves duplicate Permissions-Policy features
// first-wins and duplicate CSPs by intersection.
//
// So these tests assert the property that actually matters: after
// applyPortalHeaders, there is exactly ONE value for each of those two
// headers, and it is the right one for the path.
// =====================================================================

import {
    BASE_CSP, BILLING_CSP,
    PERMISSIONS_DEFAULT, PERMISSIONS_TECH_CHECK, PERMISSIONS_BILLING,
    isTechCheckPath, isBillingPath, portalHeaders, applyPortalHeaders,
} from "../functions/_lib/portal_headers.js";

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name) {
    if (cond) { pass++; } else { fail++; failures.push(name); }
}
function eq(a, b, name) { ok(a === b, `${name} — got ${JSON.stringify(a)}`); }

// ---------------------------------------------------------------------
// Path matching
// ---------------------------------------------------------------------
for (const p of ["/portal/tech-check", "/portal/tech-check/", "/portal/tech-check/index.html", "/portal//tech-check/"]) {
    ok(isTechCheckPath(p), `tech-check matches ${p}`);
}
for (const p of ["/portal/tech-checker/", "/portal/", "/portal/billing/", "/tech-check/"]) {
    ok(!isTechCheckPath(p), `tech-check does not match ${p}`);
}
for (const p of ["/portal/billing", "/portal/billing/", "/portal/billing/invoice/9"]) {
    ok(isBillingPath(p), `billing matches ${p}`);
}
for (const p of ["/portal/billings/", "/portal/bill", "/portal/messages/"]) {
    ok(!isBillingPath(p), `billing does not match ${p}`);
}

// ---------------------------------------------------------------------
// The camera bug, stated as a test
// ---------------------------------------------------------------------
{
    const h = portalHeaders("/portal/tech-check/").set;
    eq(h["Permissions-Policy"], PERMISSIONS_TECH_CHECK, "tech-check gets the camera policy");
    ok(/(^|,\s*)camera=\(self\)/.test(h["Permissions-Policy"]), "tech-check allows camera=(self)");
    ok(/(^|,\s*)microphone=\(self\)/.test(h["Permissions-Policy"]), "tech-check allows microphone=(self)");
    ok(!/camera=\(\)/.test(h["Permissions-Policy"]), "tech-check never emits an empty camera allowlist");
    ok(/geolocation=\(\)/.test(h["Permissions-Policy"]), "tech-check still denies geolocation");
    ok(/payment=\(\)/.test(h["Permissions-Policy"]), "tech-check still denies payment");
    eq(h["Content-Security-Policy"], BASE_CSP, "tech-check keeps the strict CSP");
    eq(h["Cross-Origin-Embedder-Policy"], "require-corp", "tech-check keeps COEP");
}

// ---------------------------------------------------------------------
// The Stripe bug, stated as a test
// ---------------------------------------------------------------------
{
    const { set, remove } = portalHeaders("/portal/billing/");
    const csp = set["Content-Security-Policy"];
    ok(/script-src[^;]*https:\/\/js\.stripe\.com/.test(csp), "billing CSP allows the Stripe loader");
    ok(/frame-src https:\/\/js\.stripe\.com https:\/\/hooks\.stripe\.com/.test(csp), "billing CSP allows the Payment Element iframes");
    ok(/connect-src[^;]*https:\/\/api\.stripe\.com/.test(csp), "billing CSP allows tokenisation XHR");
    ok(!("Cross-Origin-Embedder-Policy" in set), "billing does not set COEP");
    ok(remove.includes("Cross-Origin-Embedder-Policy"), "billing explicitly removes an inherited COEP");
    eq(set["Permissions-Policy"], PERMISSIONS_BILLING, "billing gets payment=(self)");
    ok(/payment=\(self\)/.test(set["Permissions-Policy"]), "billing allows the Payment Request API");
    ok(/camera=\(\)/.test(set["Permissions-Policy"]), "billing still denies the camera");
    ok(/frame-ancestors 'none'/.test(csp), "billing is still not embeddable");
    ok(!/unsafe-eval/.test(csp), "billing CSP does not allow eval");
}

// ---------------------------------------------------------------------
// Every other portal page keeps the strict posture
// ---------------------------------------------------------------------
for (const p of ["/portal/", "/portal/messages/", "/portal/intake/", "/portal/visit/abc/launch", "/portal/nps/tok"]) {
    const h = portalHeaders(p).set;
    eq(h["Permissions-Policy"], PERMISSIONS_DEFAULT, `${p} keeps the default permissions policy`);
    eq(h["Content-Security-Policy"], BASE_CSP, `${p} keeps the strict CSP`);
    eq(h["Cross-Origin-Embedder-Policy"], "require-corp", `${p} keeps COEP`);
    eq(h["Cache-Control"], "no-store, max-age=0", `${p} is never cached`);
    eq(h["X-Frame-Options"], "DENY", `${p} is not framable`);
    ok(/noindex/.test(h["X-Robots-Tag"]), `${p} is not indexed`);
}

// ---------------------------------------------------------------------
// applyPortalHeaders: SET, not APPEND. This is the whole point.
// ---------------------------------------------------------------------
{
    // Simulate exactly what Pages hands us: the `/*` rule already applied,
    // so the inherited (wrong) values are on the response.
    const inherited = new Response("<html></html>", {
        headers: {
            "content-type": "text/html; charset=utf-8",
            "Permissions-Policy": PERMISSIONS_DEFAULT,
            "Content-Security-Policy": BASE_CSP,
            "Cross-Origin-Embedder-Policy": "require-corp",
            "Cache-Control": "public, max-age=60",
        },
    });
    const out = applyPortalHeaders(inherited, "/portal/tech-check/");

    // getSetCookie is the only multi-value accessor; for everything else a
    // duplicate shows up as a comma-joined value. That is precisely the
    // shape that made the original fix inert, so assert it cannot recur.
    const pp = out.headers.get("Permissions-Policy");
    eq(pp, PERMISSIONS_TECH_CHECK, "applied tech-check permissions policy is the ONLY value");
    ok(!pp.includes("camera=(), "), "no leftover empty camera allowlist");
    eq((pp.match(/camera=/g) || []).length, 1, "camera appears exactly once");
    eq((pp.match(/microphone=/g) || []).length, 1, "microphone appears exactly once");
    eq(out.headers.get("Cache-Control"), "no-store, max-age=0", "portal cache posture replaces a public cache header");
    eq(out.headers.get("content-type"), "text/html; charset=utf-8", "content-type is untouched");
}

{
    const inherited = new Response("<html></html>", {
        headers: {
            "Content-Security-Policy": BASE_CSP,
            "Cross-Origin-Embedder-Policy": "require-corp",
            "Permissions-Policy": PERMISSIONS_DEFAULT,
        },
    });
    const out = applyPortalHeaders(inherited, "/portal/billing/");
    const csp = out.headers.get("Content-Security-Policy");
    eq(csp, BILLING_CSP, "applied billing CSP is the ONLY policy");
    eq((csp.match(/script-src/g) || []).length, 1, "one script-src, not an intersection of two");
    ok(csp.includes("js.stripe.com"), "Stripe survives the merge");
    eq(out.headers.get("Cross-Origin-Embedder-Policy"), null, "inherited COEP is removed on billing");
    ok(out.headers.get("Permissions-Policy").includes("payment=(self)"), "payment allowed after merge");
}

{
    // A Function-constructed response with almost no headers — the Coming
    // Soon page, the visit-launch interstitial, the NPS survey. These
    // bypass `_headers` entirely, which is how they ended up on the wire
    // with three headers and no CSP at all.
    const bare = new Response("<html></html>", {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60, s-maxage=60" },
    });
    const out = applyPortalHeaders(bare, "/portal/");
    for (const h of ["Strict-Transport-Security", "Content-Security-Policy", "X-Frame-Options",
                     "Referrer-Policy", "X-Content-Type-Options", "Cross-Origin-Opener-Policy",
                     "Cross-Origin-Resource-Policy", "Cross-Origin-Embedder-Policy", "X-Robots-Tag"]) {
        ok(out.headers.get(h), `Function-generated response gains ${h}`);
    }
    eq(out.headers.get("Cache-Control"), "no-store, max-age=0", "Function-generated response loses the public cache");
    ok(out.headers.get("Content-Security-Policy").includes("frame-ancestors 'none'"), "Coming Soon is not framable");
}

{
    // Non-HTML responses (the SPA's JS, JSON from a portal Function) go
    // through the same seal — a JS file served without CSP is still a
    // response an attacker can frame or sniff.
    const js = new Response("console.log(1)", { headers: { "content-type": "application/javascript" } });
    const out = applyPortalHeaders(js, "/portal/_wizard.js");
    eq(out.headers.get("content-type"), "application/javascript", "content-type preserved for assets");
    eq(out.headers.get("X-Frame-Options"), "DENY", "assets sealed too");
    eq(out.status, 200, "status preserved");
}

{
    const redirect = new Response(null, { status: 302, headers: { location: "/portal/login/" } });
    const out = applyPortalHeaders(redirect, "/portal/messages/");
    eq(out.status, 302, "redirect status preserved");
    eq(out.headers.get("location"), "/portal/login/", "redirect target preserved");
}

// ---------------------------------------------------------------------
// The CSPs must stay in sync on the parts that are not about Stripe
// ---------------------------------------------------------------------
{
    const baseDirs = Object.fromEntries(BASE_CSP.split("; ").map((d) => [d.split(" ")[0], d]));
    const billDirs = Object.fromEntries(BILLING_CSP.split("; ").map((d) => [d.split(" ")[0], d]));
    for (const d of ["frame-ancestors", "base-uri", "form-action", "object-src", "default-src", "style-src", "font-src", "img-src"]) {
        eq(billDirs[d], baseDirs[d], `billing CSP keeps the base ${d}`);
    }
}

console.log(`\nportal headers: ${pass} passed, ${fail} failed`);
if (fail) {
    console.log("\nFAILED:");
    for (const f of failures) console.log("  · " + f);
    process.exit(1);
}
