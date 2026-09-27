#!/usr/bin/env node
// =====================================================================
// check_internal_links.mjs — every internal link must resolve
// =====================================================================
// A console whose own navigation points at a 404 reads as broken
// software no matter how well the rest works. /admin/cases/ sat like
// that for weeks while _nav.js highlighted it. This walks every href in
// every page and checks the target exists — as a file on disk, or as a
// Pages Function route, or as a known parameterised route.
//
//   node scripts/check_internal_links.mjs          # report
//   node scripts/check_internal_links.mjs --strict # exit 1 on any break
// =====================================================================
import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

const ROOT = dirname(new URL(import.meta.url).pathname).replace(/\/scripts$/, "");
const STRICT = process.argv.includes("--strict");

function walk(dir, out = []) {
    for (const e of readdirSync(dir)) {
        if (["node_modules", ".git", "cite_audit", "docs", "schema"].includes(e)) continue;
        const p = join(dir, e);
        const s = statSync(p);
        if (s.isDirectory()) walk(p, out);
        else if (e.endsWith(".html")) out.push(p);
    }
    return out;
}

// A route resolves if a static file backs it, or a Function does.
function resolves(route) {
    const clean = route.split("#")[0].split("?")[0];
    if (!clean.startsWith("/")) return true;                   // external/relative
    const asDir = join(ROOT, clean, "index.html");
    const asFile = join(ROOT, clean);
    if (existsSync(asDir) || (existsSync(asFile) && statSync(asFile).isFile())) return true;

    // Pages Functions: /functions/<path>.js or /functions/<path>/index.js,
    // plus [param] and [[catchall]] segments.
    const segs = clean.replace(/^\/|\/$/g, "").split("/").filter(Boolean);
    const tryFn = (parts) => {
        const base = join(ROOT, "functions", ...parts);
        return existsSync(base + ".js") || existsSync(join(base, "index.js"));
    };
    if (tryFn(segs)) return true;
    // Substitute each segment with a param/catchall directory that exists.
    for (let i = 0; i < segs.length; i++) {
        const dir = join(ROOT, "functions", ...segs.slice(0, i));
        if (!existsSync(dir)) break;
        const entries = readdirSync(dir).filter((e) => e.startsWith("["));
        for (const e of entries) {
            const alt = [...segs.slice(0, i), e, ...segs.slice(i + 1)];
            if (tryFn(alt)) return true;
            if (e.startsWith("[[")) return true;                // catchall swallows the rest
        }
    }
    return false;
}

const files = walk(ROOT);
const breaks = [];
const seen = new Set();
for (const f of files) {
    const html = readFileSync(f, "utf8");
    const rel = f.replace(ROOT + "/", "");
    for (const m of html.matchAll(/href=["'](\/[^"'#][^"']*)["']/g)) {
        const route = m[1];
        if (route.startsWith("//")) continue;                   // protocol-relative
        if (/\.(css|js|png|jpg|jpeg|svg|webp|ico|mp4|webm|pdf|txt|xml|json|woff2?)$/i.test(route)) continue;
        if (route.startsWith("/api/")) continue;                // exercised by the API tests
        const key = `${rel}|${route}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!resolves(route)) breaks.push({ file: rel, route });
    }
}

const byRoute = new Map();
for (const b of breaks) {
    if (!byRoute.has(b.route)) byRoute.set(b.route, []);
    byRoute.get(b.route).push(b.file);
}
console.log(`internal links: ${files.length} pages scanned, ${seen.size} distinct links, ${byRoute.size} unresolved route(s)`);
for (const [route, from] of [...byRoute.entries()].sort()) {
    console.log(`  ${route}`);
    for (const f of from.slice(0, 4)) console.log(`      linked from ${f}`);
    if (from.length > 4) console.log(`      …and ${from.length - 4} more`);
}
process.exit(STRICT && byRoute.size ? 1 : 0);
