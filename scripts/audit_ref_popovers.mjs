#!/usr/bin/env node
// =====================================================================
// scripts/audit_ref_popovers.mjs — the deploy-side citation-popover gate
// =====================================================================
// THE RULES DO NOT LIVE HERE. Owner directive (2026-09-01): the popover
// requirements apply uniformly to the ENTIRE website and must live in ONE
// place so an update propagates everywhere. That place is
// functions/_lib/post_format.js (auditPopoverSurface) — the same module
// the production publish gate runs on every POST/PUT/approve. This script
// is only the WALKER: it derives the surfaces, assembles each surface's
// curated-source map, and feeds them to the canonical audit.
//
// Surfaces are DERIVED, never listed (SYSTEM_MAP §8.0.0):
//   * education pages from the tree (education/*/ + portal/education/*/)
//   * published posts from the live API — failing LOUD if unreachable,
//     because a scan that covered zero posts would report clean.
//
// The metadata + verbatim-dump checks compare each popover against the
// paper's REAL PubMed record (title, journal, year, abstract), which lives
// in the committed corpus scripts/popover_meta_corpus.json so the audit is
// a pure function of the repo: same input, same result, no network flake.
//   node scripts/audit_ref_popovers.mjs             # audit (offline corpus)
//   node scripts/audit_ref_popovers.mjs --refresh   # re-fetch the corpus
// A cited PMID missing from the corpus FAILS the audit (run --refresh and
// commit the diff) — coverage is part of the contract, an uncovered
// citation must never silently shrink the audit.
//
// BLOCKING vs ADVISORY (same split as always):
//   BLOCKING — broken structure, a missing summary whose curated text
//   exists on the same surface, dumps, wrong metadata. Plumbing/facts.
//   ADVISORY — a citation with no curated summary anywhere. Writing "what
//   a paper shows" is clinical content for the clinician, never for a gate.
// =====================================================================
import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import pf from "../functions/_lib/post_format.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CORPUS = join(ROOT, "scripts", "popover_meta_corpus.json");
const REFRESH = process.argv.includes("--refresh");
const KEY = process.env.NCBI_API_KEY || "";
const UA = { headers: { "User-Agent": "mz-operator-tools/1.0 (ref-popover-gate)" } };
const BASE = "https://mountzara.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// strip() also decodes XML numeric/named entities so the corpus stores clean
// text — efetch serves titles like "on&#xa0;BNIP3", which would otherwise
// defeat every downstream comparison.
const strip = (s) => String(s || "").replace(/<[^>]*>/g, " ")
    .replace(/&#(\d+);/g, (m, n) => { try { return String.fromCodePoint(Number(n)); } catch { return m; } })
    .replace(/&#x([0-9a-fA-F]+);/g, (m, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return m; } })
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/\s+/g, " ").trim();

async function getJson(url) {
    const r = await fetch(url, UA);
    if (!r.ok) throw new Error(`HTTP ${r.status} on ${url}`);
    return r.json();
}

// ---- derive the education surfaces from the tree ---------------------
function educationPages() {
    const pages = [];
    for (const base of ["education", "portal/education"]) {
        const dir = join(ROOT, base);
        if (!existsSync(dir)) continue;
        for (const d of readdirSync(dir, { withFileTypes: true })) {
            if (!d.isDirectory() || d.name.startsWith("_")) continue;
            const p = join(dir, d.name, "index.html");
            if (existsSync(p)) pages.push({ name: `${base}/${d.name}`, path: p });
        }
    }
    return pages;
}

// ref-N -> { pmid, what } from a page's own reference list
function pageRefs(html) {
    const refs = {};
    for (const m of html.matchAll(/<li id="(ref-\d+)">([\s\S]*?)<\/li>/g)) {
        const body = m[2];
        refs[m[1]] = {
            pmid: (body.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d{5,9})/) || [])[1] || null,
            what: strip((body.match(/<div class="ref-what">([\s\S]*?)<\/div>/) || [])[1] || ""),
        };
    }
    return refs;
}

// ---- gather every surface + every cited PMID -------------------------
const surfaces = [];   // { name, html, curated, keymap: auditKey -> pmid }
const wanted = new Set();

for (const p of educationPages()) {
    const html = readFileSync(p.path, "utf8");
    const refs = pageRefs(html);
    const curatedMap = {}, keymap = {};
    for (const [rid, r] of Object.entries(refs)) {
        curatedMap[rid] = r.what.length >= 30;
        if (r.pmid) { curatedMap[r.pmid] = r.what.length >= 30; keymap[rid] = r.pmid; wanted.add(r.pmid); }
    }
    for (const pm of html.matchAll(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d{5,9})/g)) wanted.add(pm[1]);
    surfaces.push({ name: p.name, html, curated: (k) => !!curatedMap[k], keymap });
}

let postsScanned = 0;
try {
    const ids = [];
    for (const kind of ["evidence", "blog"]) {
        for (const p of (await getJson(`${BASE}/api/posts?kind=${kind}&status=published`)).posts || []) {
            if (!ids.includes(p.id)) ids.push(p.id);
        }
    }
    for (const pid of ids) {
        const doc = await getJson(`${BASE}/api/posts/${encodeURIComponent(pid)}`);
        const post = doc.post || doc;
        const html = post.body_html || post.body || "";
        const src = pf.groundedSummarySources(html);
        for (const pm of html.matchAll(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d{5,9})/g)) wanted.add(pm[1]);
        surfaces.push({ name: `post ${pid}`, html, curated: (k) => !!src[k], keymap: {} });
        postsScanned++;
    }
    if (postsScanned === 0) throw new Error("posts API returned zero published posts");
} catch (e) {
    console.error(`\n🛑 REF-POPOVER GATE FAILED — published posts could not be scanned: ${String(e && e.message || e).slice(0, 140)}`);
    console.error("   A scan that covered zero posts would report clean; that is not a pass.");
    process.exit(1);
}

// ---- the committed PubMed corpus (title/journal/year/abstract) -------
let corpus = {};
if (existsSync(CORPUS)) {
    try { corpus = JSON.parse(readFileSync(CORPUS, "utf8")).records || {}; } catch {}
}

if (REFRESH) {
    const ids = [...wanted].sort((a, b) => Number(a) - Number(b));
    process.stderr.write(`  refreshing ${ids.length} PubMed record(s)…\n`);
    const fresh = {};
    for (let i = 0; i < ids.length; i += 100) {
        const batch = ids.slice(i, i + 100);
        const url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&retmode=xml&rettype=abstract"
            + "&id=" + batch.join(",") + (KEY ? "&api_key=" + KEY : "");
        let xml = "";
        try { const r = await fetch(url, UA); xml = await r.text(); }
        catch (e) {
            // A partial refresh would silently shrink the corpus — refuse.
            console.error(`\n🛑 REFRESH FAILED on batch ${i / 100 + 1}: ${String(e).slice(0, 90)}`);
            console.error("   The corpus was NOT modified.");
            process.exit(2);
        }
        for (const art of xml.split("<PubmedArticle>").slice(1)) {
            const pmid = (art.match(/<PMID[^>]*>(\d+)<\/PMID>/) || [])[1];
            if (!pmid) continue;
            const years = new Set();
            const py = (art.match(/<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>/) || [])[1];
            if (py) years.add(py);
            const md = ((art.match(/<MedlineDate>([\s\S]*?)<\/MedlineDate>/) || [])[1] || "").match(/(19|20)\d{2}/g) || [];
            for (const y of md) years.add(y);
            const ad = (art.match(/<ArticleDate[^>]*>[\s\S]*?<Year>(\d{4})<\/Year>/) || [])[1];
            if (ad) years.add(ad);
            fresh[pmid] = {
                title: strip((art.match(/<ArticleTitle[^>]*>([\s\S]*?)<\/ArticleTitle>/) || [])[1] || ""),
                journal: strip((art.match(/<Journal>[\s\S]*?<Title>([\s\S]*?)<\/Title>/) || [])[1] || ""),
                journal_abbrev: strip((art.match(/<ISOAbbreviation>([\s\S]*?)<\/ISOAbbreviation>/) || [])[1] || ""),
                years: [...years].sort(),
                abstract: [...art.matchAll(/<AbstractText([^>]*)>([\s\S]*?)<\/AbstractText>/g)].map((m) => {
                    const lab = (m[1].match(/Label="([^"]+)"/) || [])[1];
                    return lab ? `${lab}: ${strip(m[2])}` : strip(m[2]);
                }).join(" "),
            };
        }
        await sleep(KEY ? 120 : 400);
    }
    const ordered = {};
    for (const k of Object.keys(fresh).sort((a, b) => Number(a) - Number(b))) ordered[k] = fresh[k];
    writeFileSync(CORPUS, JSON.stringify({
        _comment: "PubMed records (title/journal/years/abstract via efetch) for every PMID cited anywhere on the site. Committed so the popover gate is a pure function of the repo. Refresh deliberately with audit_ref_popovers.mjs --refresh.",
        _records: Object.keys(ordered).length,
        records: ordered,
    }, null, 1));
    console.log(`corpus written — ${Object.keys(ordered).length} record(s); commit the diff`);
    corpus = ordered;
}

// Coverage is part of the contract.
const uncovered = [...wanted].filter((id) => !corpus[id]).sort();
if (uncovered.length) {
    console.error(`\n🛑 REF-POPOVER GATE FAILED — ${uncovered.length} cited PMID(s) missing from ${CORPUS.replace(ROOT + "/", "")}:`);
    for (const id of uncovered.slice(0, 10)) console.error(`   ${id}`);
    console.error("   Run: node scripts/audit_ref_popovers.mjs --refresh   and commit the diff.");
    process.exit(1);
}

// ---- audit every surface with the ONE canonical rulebook -------------
let blocking = 0, advisory = 0;
const advisoryRows = [];
for (const s of surfaces) {
    // meta/abstracts keyed by pmid AND by this surface's ref ids
    const meta = { ...corpus };
    const abstracts = {};
    for (const [pmid, rec] of Object.entries(corpus)) abstracts[pmid] = rec.abstract || "";
    for (const [rid, pmid] of Object.entries(s.keymap)) {
        if (corpus[pmid]) { meta[rid] = corpus[pmid]; abstracts[rid] = corpus[pmid].abstract || ""; }
    }
    const r = pf.auditPopoverSurface(s.html, { curated: s.curated, meta, abstracts });
    for (const p of r.problems) { blocking++; console.log(`  ✗ ${s.name} [${p.code}] ${p.msg}`); }
    for (const a of r.advisories) { advisory++; advisoryRows.push(`${s.name} ${a.key}`); }
}

console.log(`ref-popover gate: ${surfaces.length} surface(s) (${postsScanned} post(s)); `
    + `${advisory} citation(s) awaiting a curated summary (advisory, for the clinician)`);
if (blocking) {
    console.log(`\n🛑 REF-POPOVER GATE FAILED — ${blocking} popover problem(s): broken structure, unwired summaries, dumps, or metadata that contradicts PubMed.`);
    process.exit(1);
}
console.log("ref-popover gate: CLEAN — every popover structured, sourced, and faithful to its PubMed record");
