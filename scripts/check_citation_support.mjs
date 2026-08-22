#!/usr/bin/env node
// =====================================================================
// check_citation_support.mjs — does the cited paper support the SENTENCE?
// =====================================================================
// The structural gate proves a citation resolves. It cannot catch the
// failure that actually misleads a patient: a real paper, correctly
// linked, sitting behind a sentence it does not support. That one needs
// the claim and the evidence compared — which is possible here, because
// every reference block on these pages already carries the paper's
// VERBATIM ABSTRACT.
//
// For each inline marker it takes the sentence the marker sits at the end
// of, and the abstract of the reference it points to, and asks two
// questions a reader would ask:
//
//   1. SUBJECT — do the claim's clinical terms appear in the paper?
//      A sentence about morcellation cited to a paper that never mentions
//      it is the failure mode, whatever the title says.
//   2. NUMBERS — if the sentence asserts a figure ("40-60%", "1 in 1000",
//      ">4 cm"), does that figure appear in the abstract? An invented
//      number attached to a real paper is the most dangerous form of
//      this, because the citation makes it look checked.
//
// Findings are ADVISORY by default: a claim can be supported by a paper
// that phrases it differently, and blocking on that would train everyone
// to skip the gate. --strict makes it fail, for use before publishing.
// =====================================================================
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";

const ROOT = dirname(new URL(import.meta.url).pathname).replace(/\/scripts$/, "");
const STRICT = process.argv.includes("--strict");
const VERBOSE = process.argv.includes("--verbose");

const strip = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();
const norm = (s) => strip(s).toLowerCase();

// Words that carry clinical meaning; everything else is scaffolding.
const STOP = new Set(("the a an and or of in for with to is are was were be been being on at by from that this these those " +
    "as it its their there here which who whom what when where why how not no yes can could may might will would should " +
    "you your we our they them he she his her more most less least than then also both each other some any all very " +
    "often usually typically generally commonly rarely sometimes about into over under between during after before " +
    "first second third one two three four five percent cases patients women study studies review evidence data " +
    "treatment treatments option options approach approaches result results outcome outcomes risk risks").split(" "));

function contentTerms(text) {
    return new Set(norm(text).split(/[^a-z0-9-]+/)
        .filter((w) => w.length > 4 && !STOP.has(w))
        .map((w) => w.replace(/(ing|ed|es|s)$/, "")));   // crude stem
}

// Figures a sentence asserts: percentages, ratios, sizes, counts.
function figures(text) {
    const t = strip(text);
    const out = new Set();
    for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*%/g)) out.add(m[1]);
    for (const m of t.matchAll(/\b1\s*(?:in|per)\s*(\d[\d,]*)/gi)) out.add(m[1].replace(/,/g, ""));
    for (const m of t.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:cm|mm|mg|kg|weeks?|months?|years?|days?|hours?)\b/gi)) out.add(m[1]);
    for (const m of t.matchAll(/\b(\d+)\s*[–—-]\s*(\d+)\s*%/g)) { out.add(m[1]); out.add(m[2]); }
    return out;
}

const findings = [];
let checked = 0;

function auditPage(path, html) {
    // reference id -> { title, abstract }
    const refs = new Map();
    for (const m of html.matchAll(/<li id="(ref-\d+)">([\s\S]*?)<\/li>/g)) {
        const body = m[2];
        const label = (body.match(/<div class="ref-label">\s*<strong>([\s\S]*?)<\/strong>/) || [])[1] || "";
        const what = (body.match(/<div class="ref-what">([\s\S]*?)<\/div>/) || [])[1] || "";
        const abs = (body.match(/<div class="abstract-body">([\s\S]*?)<\/div>/) || [])[1] || "";
        refs.set(m[1], { label: strip(label), what: strip(what), abstract: strip(abs) });
    }

    for (const m of html.matchAll(/<sup class="mz-ref" data-r="(ref-\d+)"[\s\S]*?<\/sup>/g)) {
        const refId = m[1];
        const ref = refs.get(refId);
        if (!ref) continue;
        // The claim is the sentence ending where the marker sits.
        const before = strip(html.slice(Math.max(0, m.index - 700), m.index));
        const sentence = (before.match(/([^.!?]{25,400})$/) || [, before.slice(-260)])[1].trim();
        if (sentence.length < 25) continue;
        checked++;

        const evidence = `${ref.label} ${ref.what} ${ref.abstract}`;
        const evTerms = contentTerms(evidence);
        const clTerms = [...contentTerms(sentence)];
        const shared = clTerms.filter((t) => evTerms.has(t));
        const coverage = clTerms.length ? shared.length / clTerms.length : 1;

        const claimFigs = [...figures(sentence)];
        const evFigs = figures(evidence);
        const unbacked = claimFigs.filter((f) => !evFigs.has(f));

        const hasAbstract = ref.abstract.length > 120;
        if (hasAbstract && clTerms.length >= 4 && shared.length === 0) {
            findings.push({ kind: "no_shared_subject", path, refId, sentence, ref: ref.label,
                            detail: "the paper's abstract shares no clinical term with this sentence" });
        } else if (hasAbstract && unbacked.length && claimFigs.length) {
            findings.push({ kind: "figure_not_in_abstract", path, refId, sentence, ref: ref.label,
                            detail: `the sentence asserts ${unbacked.map((f) => `"${f}"`).join(", ")} and the abstract does not contain ${unbacked.length > 1 ? "those figures" : "that figure"}` });
        } else if (VERBOSE) {
            console.log(`  ok  ${path} ${refId} coverage=${coverage.toFixed(2)} — ${sentence.slice(0, 60)}`);
        }
    }
}

const walk = (dir) => {
    for (const e of readdirSync(dir)) {
        if (["node_modules", ".git", "cite_audit", "docs"].includes(e)) continue;
        const p = join(dir, e);
        let sub = null;
        try { sub = readdirSync(p); } catch {}
        if (sub) { walk(p); continue; }
        if (!e.endsWith(".html") || p.includes("_template")) continue;
        if (p.includes("/portal/education/")) continue;      // mirror of the public copy
        const html = readFileSync(p, "utf8");
        if (html.includes('class="mz-ref"')) auditPage(p.replace(ROOT + "/", ""), html);
    }
};
walk(ROOT);

console.log(`citation support: ${checked} claim/evidence pairs compared, ${findings.length} needing a human look\n`);
for (const f of findings) {
    console.log(`  [${f.kind}] ${f.path} ${f.refId}`);
    console.log(`      claim: ${f.sentence.slice(0, 150)}`);
    console.log(`      cited: ${f.ref.slice(0, 90)}`);
    console.log(`      why:   ${f.detail}\n`);
}
process.exit(STRICT && findings.length ? 1 : 0);
