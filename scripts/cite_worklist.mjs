#!/usr/bin/env node
// =====================================================================
// cite_worklist.mjs — turn the citation-support findings into something
// a clinician can actually work through.
// =====================================================================
// check_citation_support.mjs is right that these need attention, but it
// prints 122 undifferentiated lines, and a list that long gets skipped —
// which is the same as not having it.
//
// A MECHANICAL FIX WAS TRIED AND REJECTED. Re-pointing each flagged
// figure at another reference on the same page whose abstract contains
// that figure looks verifiable and is not: digits are everywhere in an
// abstract (sample sizes, confidence intervals, years). Of the three
// re-points that rule proposed, two were plainly wrong — "~10% of
// reproductive-age women have endometriosis" was matched to a Cochrane
// review of NSAIDs for dysmenorrhoea. Attaching a claim to a source that
// does not support it is worse than leaving it flagged, so the auto-fix
// was deleted rather than tuned. Choosing what supports a medical claim
// means reading both, and that is a clinician's judgement.
//
// So this ranks instead. Same findings, ordered by how much a reader
// would be misled if the claim is wrong, and grouped by page so one
// sitting clears one topic.
//
//   --json  emit machine-readable output
// =====================================================================
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";

const ROOT = dirname(new URL(import.meta.url).pathname).replace(/\/scripts$/, "");
const JSON_OUT = process.argv.includes("--json");

const strip = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();
const norm = (s) => strip(s).toLowerCase();
const STOP = new Set(("the a an and or of in for with to is are was were be been being on at by from that this these those " +
    "as it its their there here which who whom what when where why how not no yes can could may might will would should " +
    "you your we our they them he she his her more most less least than then also both each other some any all very " +
    "often usually typically generally commonly rarely sometimes about into over under between during after before " +
    "first second third one two three four five percent cases patients women study studies review evidence data " +
    "treatment treatments option options approach approaches result results outcome outcomes risk risks").split(" "));
const terms = (t) => new Set(norm(t).split(/[^a-z0-9-]+/)
    .filter((w) => w.length > 4 && !STOP.has(w)).map((w) => w.replace(/(ing|ed|es|s)$/, "")));

function figures(text) {
    const t = strip(text), out = new Set();
    for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*%/g)) out.add(m[1] + "%");
    for (const m of t.matchAll(/\b1\s*(?:in|per)\s*(\d[\d,]*)/gi)) out.add("1 in " + m[1]);
    for (const m of t.matchAll(/\b(\d+(?:\.\d+)?)\s*(cm|mm|mg|kg|weeks?|months?|years?|days?|hours?)\b/gi)) out.add(m[1] + " " + m[2]);
    return out;
}

// Every number an abstract states, whatever its unit — used to decide
// whether a claimed figure is actually absent or merely written
// differently.
function allNumbers(text) {
    return [...strip(text).matchAll(/\d+(?:\.\d+)?/g)].map((m) => parseFloat(m[0]));
}

// A page that rounds 83.8% to "about 84%" is not making an unsupported
// claim, and neither is one that writes a range as "10-30%" where the
// paper says 10 to 30. Exact digit matching calls both unsupported, which
// buries the findings that matter. A claimed figure counts as present if
// the abstract states a number that rounds to it, or sits within half a
// point of it.
function figureSupported(fig, nums) {
    const v = parseFloat(fig);
    if (!isFinite(v)) return false;
    return nums.some((n) => n === v || Math.abs(n - v) <= 0.5 || Math.round(n) === Math.round(v));
}

// A wrong number a patient acts on is worse than a wrong number they read.
function severity(claim, figs) {
    const c = norm(claim);
    if (/\bmg\b|\bdose|dosing|daily|every \d|times? (a|per) day\b/.test(c)) return ["dosing", 3];
    if (/risk|complicat|mortality|death|bleed|infect|recur/.test(c)) return ["risk", 3];
    if (/\b(1 in|\d+\s*%)/.test(c) && /prevalen|affect|common|experience|women with/.test(c)) return ["prevalence", 2];
    return ["background", 1];
}

const rows = [];
const base = join(ROOT, "education");
for (const d of readdirSync(base, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith("_")) continue;
    const path = join(base, d.name, "index.html");
    let html; try { html = readFileSync(path, "utf8"); } catch { continue; }

    const refs = new Map();
    for (const m of html.matchAll(/<li id="(ref-\d+)">([\s\S]*?)<\/li>/g)) {
        const body = m[2];
        const label = (body.match(/<div class="ref-label">\s*<strong>([\s\S]*?)<\/strong>/) || [])[1] || "";
        const abs = (body.match(/<div class="abstract-body">([\s\S]*?)<\/div>/) || [])[1] || "";
        refs.set(m[1], { label: strip(label), abstract: strip(abs), figs: figures(strip(abs)) });
    }

    for (const m of html.matchAll(/<sup class="mz-ref" data-r="(ref-\d+)"[\s\S]*?<\/sup>/g)) {
        const ref = refs.get(m[1]); if (!ref) continue;
        const before = strip(html.slice(Math.max(0, m.index - 700), m.index));
        const sentence = (before.match(/([^.!?]{25,400})$/) || [, before.slice(-260)])[1].trim();
        if (sentence.length < 25) continue;
        const cf = [...figures(sentence)];
        if (!cf.length) continue;
        const nums = allNumbers(ref.abstract);
        const missing = cf.filter((f) => !ref.figs.has(f) && !figureSupported(f, nums));
        if (!missing.length) continue;
        const [kind, sev] = severity(sentence, missing);
        rows.push({ topic: d.name, ref: m[1], kind, sev, figures: missing,
                    claim: sentence, cited: ref.label,
                    noAbstract: ref.abstract.length < 120 });
    }
}

rows.sort((a, b) => b.sev - a.sev || a.topic.localeCompare(b.topic));
if (JSON_OUT) { console.log(JSON.stringify(rows, null, 1)); process.exit(0); }

const label = { 3: "HIGH", 2: "MED", 1: "LOW" };
let topic = "";
for (const r of rows) {
    if (r.topic !== topic) { topic = r.topic; console.log(`\n── ${topic} ──`); }
    console.log(`  [${label[r.sev]} ${r.kind}] ${r.figures.join(", ")} not in the cited abstract` +
                (r.noAbstract ? "  (no abstract stored — unverifiable)" : ""));
    console.log(`     claim: ${r.claim.slice(0, 108)}`);
    console.log(`     cites: ${r.ref} — ${r.cited.slice(0, 84)}`);
}
const n = (s) => rows.filter((r) => r.sev === s).length;
console.log(`\n${rows.length} claim(s) whose figure is absent from the source they cite:` +
            `  ${n(3)} high (dosing/risk), ${n(2)} medium (prevalence), ${n(1)} low (background).`);
console.log("Each needs a clinician to confirm the figure, or re-point it to a source that states it.");
