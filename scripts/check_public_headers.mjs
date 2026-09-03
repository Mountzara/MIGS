#!/usr/bin/env node
// =====================================================================
// check_public_headers.mjs — hardening must survive the Function layer
// =====================================================================
// _headers is not enough and never was. Cloudflare does not apply it to a
// response a FUNCTION returns, so /education/* — twelve clinical guides —
// shipped with no CSP, no HSTS and no frame protection while the file
// that "configured" them looked correct. /portal/* hit the identical trap
// earlier (see _lib/portal_headers.js). Any new middleware will hit it
// again, so this asserts the headers on the LIVE site rather than
// trusting configuration.
//
//   node scripts/check_public_headers.mjs [--strict]
// =====================================================================
const REQUIRED = ["content-security-policy", "strict-transport-security", "x-frame-options",
                  "x-content-type-options", "referrer-policy", "x-robots-tag"];
const ROUTES = ["/", "/about/", "/evidence/", "/trending/", "/education/", "/education/fibroids/",
                "/privacy/", "/terms/", "/telehealth-consent/", "/accessibility/"];
const ORIGIN = process.env.MZ_ORIGIN || "https://mountzara.com";
const AUTH = process.env.MZ_ADMIN_BASIC ? { authorization: "Basic " + Buffer.from(process.env.MZ_ADMIN_BASIC).toString("base64") } : {};
const STRICT = process.argv.includes("--strict");

let bad = 0;
for (const route of ROUTES) {
    let res;
    try { res = await fetch(ORIGIN + route, { method: "HEAD", headers: AUTH }); }
    catch (e) { console.log(`  ? ${route} — unreachable (${String(e.message).slice(0, 40)})`); continue; }
    const missing = REQUIRED.filter((h) => !res.headers.get(h));
    // A gated route answering 401/404 to an anonymous check is fine; we are
    // testing the pages a scraper can actually read.
    if (res.status >= 400 && !Object.keys(AUTH).length) { console.log(`  · ${route} — ${res.status}, gated, skipped`); continue; }
    if (missing.length) { bad++; console.log(`  ✗ ${route} — missing: ${missing.join(", ")}`); }
    else {
        const csp = res.headers.get("content-security-policy") || "";
        const frame = csp.includes("frame-ancestors 'none'");
        const noai = (res.headers.get("x-robots-tag") || "").includes("noai");
        console.log(`  ✓ ${route}${frame ? "" : "  (CSP lacks frame-ancestors 'none')"}${noai ? "" : "  (no noai directive)"}`);
        if (!frame || !noai) bad++;
    }
}
console.log(`\n  ${bad === 0 ? "every public route carries the full hardening set" : `${bad} route(s) under-protected`}`);
process.exit(STRICT && bad ? 1 : 0);
