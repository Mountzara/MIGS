#!/usr/bin/env node
// =====================================================================
// scripts/fix_popover_metadata.mjs — rebuild popover title/meta from
// PubMed, uniformly, on every surface; repair dump findings.
// =====================================================================
// Owner findings (2026-09-01): popover metadata was wrong or missing in
// several per-surface styles — education popovers carried the whole
// citation line as their "title" and only "PMID N" as their meta; W20-era
// post popovers carried AUTHOR LISTS where the journal belongs; 51 post
// findings were verbatim pastes of the abstract. Root cause: each surface
// had its own generation rules. This script applies ONE rule set, and the
// rules it repairs against are the canonical ones in
// functions/_lib/post_format.js (auditPopoverSurface) with facts from the
// committed corpus scripts/popover_meta_corpus.json.
//
// What it changes (popover spans ONLY — an assertion refuses anything else):
//   * title  := the paper's PubMed title (factual, from the corpus)
//   * meta   := education: "«journal» «year» · PMID «pmid»"
//               posts:     "«journal» · «year»"
//     (year = the meta's existing year when PubMed also carries it, else
//      the paper's latest PubMed year — deterministic either way)
//   * finding: a dump (labelled opening or verbatim abstract paste) is
//     replaced from the surface's own grounded pool
//     (groundedSummarySources); with no grounded source it is REMOVED —
//     a paste is not a summary, and the citation joins the clinician's
//     advisory list. NOTHING is ever authored.
//
//   node scripts/fix_popover_metadata.mjs            # dry run
//   node scripts/fix_popover_metadata.mjs --apply
// =====================================================================
import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import pf from "../functions/_lib/post_format.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const APPLY = process.argv.includes("--apply");
const BASE = "https://mountzara.com";
const UA = "mz-operator-tools/1.0 (fix_popover_metadata)";
const ADMIN_USER = "chris.mabini@gmail.com";
const ADMIN_PASS = process.env.ADMIN_PASS_ENV || "MartyBeans!2345";
const corpus = JSON.parse(readFileSync(join(ROOT, "scripts", "popover_meta_corpus.json"), "utf8")).records;

const strip = (s) => String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const decodeXml = (s) => String(s || "")
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
const escapeHtml = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const normText = (s) => decodeXml(String(s || "")).toLowerCase().replace(/[^a-z0-9]+/gi, " ").trim();

const SUP_RE = /<sup class="mz-ref"[^>]*>[\s\S]*?<\/sup>/g;
const POP_IN_SUP = /(<span class="mz-ref-pop"[^>]*>)([\s\S]*?)(<\/span>)(?=<\/sup>)/;
const stripPops = (s) => String(s).replace(/<span class="mz-ref-pop"[^>]*>[\s\S]*?<\/span>(?=<\/sup>)/g, "");

function pickYear(rec, currentMeta) {
    const years = (rec.years || []).map(String);
    for (const y of (String(currentMeta || "").match(/\b(?:19|20)\d{2}\b/g) || [])) {
        if (years.includes(y)) return y;
    }
    return years.length ? years[years.length - 1] : "";
}

// Rebuild the popovers of one surface. style: "education" | "post".
// pmidOf(sup) -> pmid; grounded: pmid -> replacement finding text.
function rebuild(html, style, pmidOf, grounded) {
    const stats = { meta: 0, title: 0, dumpReplaced: 0, dumpRemoved: 0 };
    const out = html.replace(SUP_RE, (sup) => sup.replace(POP_IN_SUP, (full, pre, inner, post) => {
        const pmid = pmidOf(sup);
        const rec = pmid && corpus[pmid];
        if (!rec) return full;
        let x = inner;
        const title = escapeHtml(decodeXml(rec.title));
        if (x.includes('class="mz-ref-pop-title"')) {
            const nx = x.replace(/(<span class="mz-ref-pop-title">)[\s\S]*?(<\/span>)/, `$1${title}$2`);
            if (nx !== x) { stats.title++; x = nx; }
        }
        const journal = decodeXml(rec.journal_abbrev || rec.journal || "");
        if (journal && x.includes('class="mz-ref-pop-meta"')) {
            const curMeta = ((x.match(/<span class="mz-ref-pop-meta">([\s\S]*?)<\/span>/) || [])[1] || "");
            const year = pickYear(rec, curMeta);
            const meta = style === "education"
                ? escapeHtml(`${journal}${year ? " " + year : ""} · PMID ${pmid}`)
                : escapeHtml(`${journal}${year ? " · " + year : ""}`);
            const nx = x.replace(/(<span class="mz-ref-pop-meta">)[\s\S]*?(<\/span>)/, `$1${meta}$2`);
            if (nx !== x) { stats.meta++; x = nx; }
        }
        // dump findings: labelled abstract opening, or verbatim abstract paste
        x = x.replace(/<span class="mz-ref-pop-finding">([^<]*)<\/span>/, (f, txt) => {
            const t = decodeXml(txt).trim();
            const nf = normText(t);
            const isRaw = /^\s*(rationale|background|objectives?|introduction|methods?|materials?|purpose|aims?|importance|context|setting|design|participants)\b\s*[:\-–]/i.test(t);
            const isPaste = !isRaw && nf.length >= 60 && rec.abstract && normText(rec.abstract).includes(nf) && nf !== normText(rec.title);
            if (!isRaw && !isPaste) return f;
            const g = grounded ? grounded(pmid) : null;
            if (g) { stats.dumpReplaced++; return `<span class="mz-ref-pop-finding">${escapeHtml(g)}</span>`; }
            stats.dumpRemoved++;
            return "";
        });
        return pre + x + post;
    }));
    if (stripPops(out) !== stripPops(html)) throw new Error("text outside popovers changed — refusing");
    return { out, stats };
}

const fmt = (s) => `meta ${s.meta}, title ${s.title}, dump→grounded ${s.dumpReplaced}, dump removed ${s.dumpRemoved}`;

// ---- education pages (local files) -----------------------------------
for (const base of ["education", "portal/education"]) {
    const dir = join(ROOT, base);
    if (!existsSync(dir)) continue;
    for (const d of readdirSync(dir, { withFileTypes: true })) {
        if (!d.isDirectory() || d.name.startsWith("_")) continue;
        const p = join(dir, d.name, "index.html");
        if (!existsSync(p)) continue;
        const html = readFileSync(p, "utf8");
        const refPmid = {};
        for (const m of html.matchAll(/<li id="(ref-\d+)">([\s\S]*?)<\/li>/g)) {
            const pm = (m[2].match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d{5,9})/) || [])[1];
            if (pm) refPmid[m[1]] = pm;
        }
        const pmidOf = (sup) => {
            const rid = (sup.match(/data-r="(ref-\d+)"/) || [])[1];
            return (rid && refPmid[rid]) || (sup.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d{5,9})/) || [])[1] || null;
        };
        const { out, stats } = rebuild(html, "education", pmidOf, null);
        if (out === html) continue;
        console.log(`  ${base}/${d.name}: ${fmt(stats)}`);
        if (APPLY) writeFileSync(p, out);
    }
}

// ---- published posts (API) -------------------------------------------
async function getJson(path) {
    const r = await fetch(BASE + path, { headers: { "User-Agent": UA } });
    if (!r.ok) throw new Error(`HTTP ${r.status} on ${path}`);
    return r.json();
}
const ids = [];
for (const kind of ["evidence", "blog"]) {
    for (const p of (await getJson(`/api/posts?kind=${kind}&status=published`)).posts || []) {
        if (!ids.includes(p.id)) ids.push(p.id);
    }
}
for (const pid of ids) {
    const doc = await getJson(`/api/posts/${encodeURIComponent(pid)}`);
    const post = doc.post || doc;
    const key = "body_html" in post ? "body_html" : "body";
    const body = post[key] || "";
    const src = pf.groundedSummarySources(body);
    const pmidOf = (sup) => (sup.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d{5,9})/) || sup.match(/id="ref-pop-(\d{5,9})"/) || sup.match(/#mz-ref-(\d{5,9})/) || [])[1] || null;
    const { out, stats } = rebuild(body, "post", pmidOf, (pmid) => src[pmid] || null);
    if (out === body) continue;
    console.log(`  post ${pid}: ${fmt(stats)}`);
    if (APPLY) {
        const r = await fetch(`${BASE}/api/posts/${encodeURIComponent(pid)}`, {
            method: "PUT",
            headers: {
                "User-Agent": UA,
                "Content-Type": "application/json",
                "Authorization": "Basic " + Buffer.from(`${ADMIN_USER}:${ADMIN_PASS}`).toString("base64"),
            },
            body: JSON.stringify({ [key]: out }),
        });
        if (!r.ok) throw new Error(`PUT ${pid} failed: HTTP ${r.status} ${(await r.text()).slice(0, 120)}`);
        console.log("    PUT ok");
    }
}
console.log(APPLY ? "applied" : "dry run — pass --apply");
