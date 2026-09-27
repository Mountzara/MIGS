#!/usr/bin/env node
// =====================================================================
// cite_verify_pubmed.mjs — check every figure against PubMed's OWN
// abstract, not the copy pasted into the page.
// =====================================================================
// verify_citations.mjs already proves each PMID resolves to the paper the
// tooltip names — author, title, year — using esummary. esummary does not
// return an abstract, which is why that script says relevance "is not
// decidable here".
//
// It is decidable, with efetch. This pulls the real abstract for every
// cited PMID and asks two things the page cannot answer about itself:
//
//   1. SUPPORT — does the sentence's figure appear in the paper's actual
//      abstract? Checking against the abstract stored in the HTML only
//      proves the page agrees with itself.
//   2. DRIFT — does the abstract shown to the patient still match the one
//      PubMed serves? A stored abstract that has been trimmed, reworded
//      or attached to the wrong record is a citation that looks checked
//      and is not, and no amount of internal consistency reveals it.
//
// Rounding is tolerated: a page saying "about 84%" where the paper reports
// 83.8% is supported. Exact digit matching flags that, and findings
// nobody believes are findings nobody reads.
//
// DETERMINISM. Verification never touches the network. The abstracts live
// in scripts/pubmed_corpus.json, committed, so the audit is a pure
// function of the repo: the same tree gives the same findings on every
// machine and every run. That matters more than freshness here — a check
// that reaches out mid-run can fail a batch, verify fewer claims, and
// report a SHORTER list, which reads exactly like progress.
//
// So a missing PMID is an ERROR, not a silently smaller result set. If a
// citation is added without its abstract, the audit fails and says so.
//
// Fetching is a separate, deliberate act: --refresh pulls from PubMed,
// rewrites the corpus, and prints what changed, so new evidence lands as
// a reviewable diff instead of drifting in under a passing gate. NCBI
// allows 3 requests/second unencumbered; set NCBI_API_KEY to go faster.
//
//   node scripts/cite_verify_pubmed.mjs            # offline, deterministic
//   node scripts/cite_verify_pubmed.mjs --refresh  # re-fetch the corpus
//   --json                                         # machine-readable
// =====================================================================
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const ROOT = dirname(new URL(import.meta.url).pathname).replace(/\/scripts$/, "");
const CORPUS = join(ROOT, "scripts", "pubmed_corpus.json");
const JSON_OUT = process.argv.includes("--json");
const REFRESH = process.argv.includes("--refresh");
const KEY = process.env.NCBI_API_KEY || "";

const strip = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();
const norm = (s) => strip(s).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function figures(text) {
    const t = strip(text), out = new Set();
    for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*%/g)) out.add(m[1] + "%");
    for (const m of t.matchAll(/\b1\s*(?:in|per)\s*(\d[\d,]*)/gi)) out.add("1 in " + m[1]);
    for (const m of t.matchAll(/\b(\d+(?:\.\d+)?)\s*(cm|mm|mg|kg|weeks?|months?|years?|days?|hours?)\b/gi))
        out.add(m[1] + " " + m[2]);
    return out;
}
const allNumbers = (t) => [...strip(t).matchAll(/\d+(?:\.\d+)?/g)].map((m) => parseFloat(m[0]));
function supported(fig, nums) {
    const v = parseFloat(fig);
    if (!isFinite(v)) return false;
    return nums.some((n) => n === v || Math.abs(n - v) <= 0.5 || Math.round(n) === Math.round(v));
}
function severity(claim) {
    const c = norm(claim);
    if (/\bmg\b|\bdose|dosing|daily|every \d|times? (a|per) day\b/.test(c)) return ["dosing", 3];
    if (/risk|complicat|mortality|death|bleed|infect|recur/.test(c)) return ["risk", 3];
    if (/prevalen|affect|common|experience|women with/.test(c)) return ["prevalence", 2];
    return ["background", 1];
}

// ---- gather every reference and its PMID ----------------------------
const base = join(ROOT, "education");
const pages = readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
    .map((d) => ({ topic: d.name, path: join(base, d.name, "index.html") }));

const wanted = new Set();
const pageData = [];
for (const p of pages) {
    let html; try { html = readFileSync(p.path, "utf8"); } catch { continue; }
    const refs = new Map();
    for (const m of html.matchAll(/<li id="(ref-\d+)">([\s\S]*?)<\/li>/g)) {
        const body = m[2];
        const pmid = (body.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d{5,9})/) || [])[1] || null;
        const label = (body.match(/<div class="ref-label">\s*<strong>([\s\S]*?)<\/strong>/) || [])[1] || "";
        const abs = (body.match(/<div class="abstract-body">([\s\S]*?)<\/div>/) || [])[1] || "";
        refs.set(m[1], { pmid, label: strip(label), stored: strip(abs) });
        if (pmid) wanted.add(pmid);
    }
    pageData.push({ ...p, html, refs });
}

// ---- fetch the real abstracts ---------------------------------------
let cache = {};
if (existsSync(CORPUS)) {
    try { cache = (JSON.parse(readFileSync(CORPUS, "utf8")).records) || {}; } catch {}
}

if (REFRESH) {
    const before = JSON.stringify(cache);
    const ids = [...wanted].sort();
    process.stderr.write(`  refreshing ${ids.length} abstract(s) from PubMed…\n`);
    for (let i = 0; i < ids.length; i += 100) {
        const batch = ids.slice(i, i + 100);
        const url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&retmode=xml&rettype=abstract"
                  + "&id=" + batch.join(",") + (KEY ? "&api_key=" + KEY : "");
        let xml = "";
        try { const r = await fetch(url); xml = await r.text(); }
        catch (e) {
            // A partial refresh would silently shrink the corpus, so refuse
            // to write one. The committed corpus stays authoritative.
            console.error(`\n🛑 REFRESH FAILED on batch ${i / 100 + 1}: ${String(e).slice(0, 90)}`);
            console.error("   The corpus was NOT modified — a half-fetched corpus would quietly");
            console.error("   drop citations from the audit and look like fewer findings.");
            process.exit(2);
        }
        for (const art of xml.split("<PubmedArticle>").slice(1)) {
            const pmid = (art.match(/<PMID[^>]*>(\d+)<\/PMID>/) || [])[1];
            if (!pmid) continue;
            const title = strip((art.match(/<ArticleTitle[^>]*>([\s\S]*?)<\/ArticleTitle>/) || [])[1] || "");
            const parts = [...art.matchAll(/<AbstractText([^>]*)>([\s\S]*?)<\/AbstractText>/g)].map((m) => {
                const lab = (m[1].match(/Label="([^"]+)"/) || [])[1];
                const body = strip(m[2]);
                return lab ? `${lab}: ${body}` : body;
            });
            cache[pmid] = { title, abstract: parts.join(" ") };
        }
        await sleep(KEY ? 120 : 400);
    }
    const ordered = {};
    for (const k of Object.keys(cache).sort((a, b) => Number(a) - Number(b))) ordered[k] = cache[k];
    const doc = {
        _comment: "Abstracts as PubMed served them, fetched via efetch. Committed so the citation audit is a pure function of the repo: same input, same result, no network. Refresh deliberately with cite_verify_pubmed.mjs --refresh.",
        _fetched_via: "eutils efetch.fcgi db=pubmed rettype=abstract",
        _records: Object.keys(ordered).length,
        records: ordered,
    };
    writeFileSync(CORPUS, JSON.stringify(doc, null, 1));
    console.log(before === JSON.stringify(ordered)
        ? `corpus unchanged — ${doc._records} record(s)`
        : `corpus updated — ${doc._records} record(s); commit the diff`);
    cache = ordered;
}

// Coverage is part of the contract: a cited PMID with no abstract in the
// corpus must fail, never shrink the audit.
const uncovered = [...wanted].filter((id) => !cache[id]).sort();
if (uncovered.length && !REFRESH) {
    console.error(`\n🛑 CITATION CORPUS INCOMPLETE — ${uncovered.length} cited PMID(s) have no stored abstract:`);
    for (const id of uncovered.slice(0, 12)) console.error(`   PMID ${id}`);
    console.error("   Run: node scripts/cite_verify_pubmed.mjs --refresh   and commit the corpus.");
    process.exit(1);
}

// ---- audit -----------------------------------------------------------
const findings = [];
let checked = 0, noAbstract = 0, drift = 0;

for (const p of pageData) {
    for (const m of p.html.matchAll(/<sup class="mz-ref" data-r="(ref-\d+)"[\s\S]*?<\/sup>/g)) {
        const ref = p.refs.get(m[1]);
        if (!ref || !ref.pmid) continue;
        const real = cache[ref.pmid];
        if (!real || !real.abstract || real.abstract.length < 80) { noAbstract++; continue; }

        const before = strip(p.html.slice(Math.max(0, m.index - 700), m.index));
        const sentence = (before.match(/([^.!?]{25,400})$/) || [, before.slice(-260)])[1].trim();
        if (sentence.length < 25) continue;

        const cf = [...figures(sentence)];
        if (!cf.length) continue;
        checked++;
        const nums = allNumbers(real.abstract);
        const missing = cf.filter((f) => !supported(f, nums));
        if (!missing.length) continue;
        const [kind, sev] = severity(sentence);
        findings.push({ topic: p.topic, ref: m[1], pmid: ref.pmid, kind, sev,
                        figures: missing, claim: sentence, cited: ref.label,
                        title: real.title });
    }
    // drift: is the abstract on the page still the paper's abstract?
    for (const [id, ref] of p.refs) {
        if (!ref.pmid || !ref.stored) continue;
        const real = cache[ref.pmid];
        if (!real || !real.abstract) continue;
        // Compare on decoded text with section labels neutralised: an entity
    // (&#x27;) or a label is a formatting difference, not drift.
    const flat = (t) => norm(String(t)
        .replace(/&#x27;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&")
        .replace(/\b(IMPORTANCE|OBJECTIVE|BACKGROUND|METHODS|DESIGN|SETTING|PARTICIPANTS|INTERVENTIONS|RESULTS|CONCLUSIONS?|CONCLUSIONS AND RELEVANCE|MAIN OUTCOMES AND MEASURES|TRIAL REGISTRATION)\s*:/gi, " "));
    const a = flat(ref.stored), b = flat(real.abstract);
        if (a.length < 80 || b.length < 80) continue;
        const head = b.slice(0, 120);
        if (!a.includes(head.slice(0, 60)) && !b.includes(a.slice(0, 60))) {
            drift++;
            findings.push({ topic: p.topic, ref: id, pmid: ref.pmid, kind: "drift", sev: 3,
                            figures: [], claim: "(the abstract shown to the patient is not the one PubMed serves)",
                            cited: ref.label, title: real.title });
        }
    }
}

// Total order, spelled out. Relying on sort stability would make the
// output depend on traversal order rather than on the data.
const refNum = (r) => parseInt(String(r).replace(/\D/g, ""), 10) || 0;
findings.sort((a, b) =>
    b.sev - a.sev ||
    a.topic.localeCompare(b.topic) ||
    refNum(a.ref) - refNum(b.ref) ||
    String(a.figures).localeCompare(String(b.figures)) ||
    a.claim.localeCompare(b.claim));
if (JSON_OUT) { console.log(JSON.stringify(findings, null, 1)); process.exit(0); }

const L = { 3: "HIGH", 2: "MED", 1: "LOW" };
let topic = "";
for (const f of findings) {
    if (f.topic !== topic) { topic = f.topic; console.log(`\n── ${topic} ──`); }
    if (f.kind === "drift") {
        console.log(`  [HIGH drift] ${f.ref} PMID ${f.pmid}`);
        console.log(`     the abstract on the page is not the one PubMed serves for this record`);
        console.log(`     pubmed: ${f.title.slice(0, 88)}`);
        continue;
    }
    console.log(`  [${L[f.sev]} ${f.kind}] ${f.figures.join(", ")} not in the paper's abstract`);
    console.log(`     claim:  ${f.claim.slice(0, 106)}`);
    console.log(`     paper:  ${f.title.slice(0, 88)}  (PMID ${f.pmid})`);
}
const n = (s) => findings.filter((x) => x.sev === s && x.kind !== "drift").length;
console.log(`\nVerified ${checked} figure-bearing claim(s) against PubMed's own abstracts.`);
console.log(`${findings.length - drift} unsupported figure(s): ${n(3)} high, ${n(2)} medium, ${n(1)} low.`);
console.log(`${drift} reference(s) whose stored abstract has drifted from the PubMed record.`);
if (noAbstract) console.log(`${noAbstract} citation(s) skipped — PubMed holds no abstract for that record.`);
