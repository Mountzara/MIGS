#!/usr/bin/env node
// =====================================================================
// verify_citations.mjs — does every inline citation open the right paper?
// =====================================================================
// The twelve patient guides carry 557 inline citations, each rendered as
// a tooltip claiming an author, a title, a journal, a year and a PMID.
// A patient is invited to check the source. If a PMID resolves to a
// different paper than the tooltip claims, the citation is worse than
// none: it looks like rigour and is not.
//
// This checks every one against PubMed's own record:
//   1. does the PMID exist at all?
//   2. does the claimed FIRST AUTHOR match the record?
//   3. does the claimed TITLE match the record?
//   4. does the claimed YEAR match?
//
// Relevance to the surrounding claim is not decidable here and is
// reported separately for human review.
//
//   node scripts/verify_citations.mjs                  # all guides
//   node scripts/verify_citations.mjs endometriosis    # one guide
// =====================================================================
import { readdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";

const ROOT = dirname(new URL(import.meta.url).pathname).replace(/\/scripts$/, "");
const only = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : null;

const norm = (s) => String(s || "").toLowerCase()
    .replace(/&[a-z]+;/g, " ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

// Pull (pmid, claimed) pairs out of the REFERENCE LIST — <li id="ref-N">
// carries the full claim (label, what-it-shows, PMID link, abstract) and
// is what a patient actually clicks. Tooltips repeat the same reference
// many times over; auditing the list checks each source once.
function extract(html) {
    const out = [];
    for (const m of html.matchAll(/<li id="ref-\d+">([\s\S]*?)<\/li>/g)) {
        const block = m[1];
        const pm = block.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d{5,9})/);
        if (!pm) continue;
        const labelM = block.match(/<div class="ref-label">\s*<strong>([\s\S]*?)<\/strong>/);
        const label = (labelM ? labelM[1] : "")
            .replace(/<[^>]+>/g, "").replace(/&middot;|·/g, " ").replace(/\s+/g, " ").trim();
        // The publication year is the LAST year in the label. Taking the
        // first read "AAGL 2021 classification" — part of a title — as the
        // year and flagged a correct 2025 citation as wrong.
        const years = label.match(/\b(19|20)\d{2}\b/g);
        const yearM = years ? [years[years.length - 1]] : null;
        // "Author et al., Title, Journal Year" — but society guidelines have
        // no author ("Diagnosis of Endometriosis, Obstet Gynecol 2026"), so
        // an author is only claimed when the first field looks like one.
        const parts = label.split(",").map((x) => x.trim());
        const looksLikeAuthor = /(et al\.?$|^[A-Z][a-z]+$|^[A-Z][a-z]+ [A-Z]{1,3}$)/.test(parts[0] || "")
            && !/^\?+$/.test((parts[0] || "").trim());
        const author = looksLikeAuthor ? parts[0] : "";
        const title = (looksLikeAuthor ? parts.slice(1) : parts).join(", ").replace(/^\?+[,\s]*/, "")
            .replace(/\b(19|20)\d{2}\b\s*$/, "").trim();
        const whatM = block.match(/<div class="ref-what">([\s\S]*?)<\/div>/);
        out.push({
            pmid: pm[1], author, title,
            year: yearM ? yearM[0] : null,
            claim_context: (whatM ? whatM[1] : "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
        });
    }
    return out;
}

const guides = readdirSync(join(ROOT, "education"))
    .filter((d) => d !== "_template" && existsSync(join(ROOT, "education", d, "index.html")))
    .filter((d) => !only || d === only);

const all = [];
for (const g of guides) {
    const html = readFileSync(join(ROOT, "education", g, "index.html"), "utf8");
    for (const c of extract(html)) all.push({ guide: g, ...c });
}
const pmids = [...new Set(all.map((c) => c.pmid))];
console.log(`${guides.length} guide(s), ${all.length} inline citations, ${pmids.length} unique PMIDs`);

// PubMed esummary, batched.
async function summaries(ids) {
    const out = {};
    for (let i = 0; i < ids.length; i += 180) {
        const batch = ids.slice(i, i + 180);
        const url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=" + batch.join(",");
        const r = await fetch(url, { headers: { "user-agent": "mountzara-citation-audit" } });
        if (!r.ok) { console.error(`  PubMed returned ${r.status} for a batch of ${batch.length}`); continue; }
        const j = await r.json();
        for (const id of batch) {
            const rec = j.result && j.result[id];
            if (rec && !rec.error) {
                out[id] = {
                    title: rec.title || "",
                    year: (rec.pubdate || "").match(/\b(19|20)\d{2}\b/)?.[0] || null,
                    first: (rec.authors && rec.authors[0] && rec.authors[0].name) || "",
                    journal: rec.source || "",
                };
            } else out[id] = null;
        }
        await new Promise((r2) => setTimeout(r2, 400));   // be polite to NCBI
    }
    return out;
}

const rec = await summaries(pmids);

const problems = [];
for (const c of all) {
    const r = rec[c.pmid];
    if (!r) { problems.push({ ...c, kind: "pmid_not_found", real: null }); continue; }
    const claimedAuthor = norm(c.author).replace(/ et al$/, "").split(" ")[0];
    const realAuthor = norm(r.first).split(" ")[0];
    const authorOk = !claimedAuthor || !realAuthor || claimedAuthor === realAuthor
        || norm(c.author).includes(realAuthor) || norm(r.first).includes(claimedAuthor);
    // Titles are truncated with an ellipsis in the tooltip, so compare the
    // claimed prefix against the real title.
    const claimedTitle = norm(c.title.replace(/\.\.\.$/, ""));
    const realTitle = norm(r.title);
    const stem = claimedTitle.slice(0, Math.min(40, claimedTitle.length));
    // Short titles ("Endometrial Hyperplasia") cannot satisfy a
    // three-long-words rule, so compare the whole normalised string too.
    const titleOk = !stem || realTitle.includes(stem) || claimedTitle === realTitle
        || realTitle.startsWith(claimedTitle) || claimedTitle.startsWith(realTitle)
        || claimedTitle.split(" ").filter((w) => w.length > 4 && realTitle.includes(w)).length >= 3;
    const yearOk = !c.year || !r.year || Math.abs(Number(c.year) - Number(r.year)) <= 1;
    if (!authorOk || !titleOk || !yearOk) {
        problems.push({ ...c, kind: !titleOk ? "title_mismatch" : (!authorOk ? "author_mismatch" : "year_mismatch"), real: r });
    }
}

// RELEVANCE. A citation can resolve perfectly and still be the wrong
// paper for the claim. This cannot be decided mechanically, but a paper
// sharing NO subject term with its guide is worth a human look, so those
// are listed separately rather than mixed in with resolution failures.
const TOPIC_TERMS = {
    "endometriosis": ["endometrio", "pelvic pain", "dysmenorrh", "laparoscop", "excision", "adenomyo", "infertil", "gnrh", "dienogest"],
    "fibroids": ["fibroid", "leiomyom", "myoma", "myomectom", "uterine artery", "emboliz", "hysterectom", "bleeding", "ulipristal", "relugolix"],
    "adenomyosis": ["adenomyo", "junctional zone", "uterine", "bleeding", "dysmenorrh", "mri", "ultrasound"],
    "abnormal-uterine-bleeding": ["bleeding", "menorrhag", "endometri", "hyperplasi", "polyp", "tranexam", "levonorgestrel", "ablation", "hysteroscop", "anemia", "palm"],
    "dysmenorrhea": ["dysmenorrh", "menstrual pain", "period pain", "nsaid", "endometrio", "acupunctur", "heat", "tens"],
    "chronic-pelvic-pain": ["pelvic pain", "chronic pain", "central sensiti", "bladder", "myofascial", "irritable bowel", "vulvodyn", "endometrio", "neuropath"],
    "ovarian-masses": ["ovarian", "adnexal", "cyst", "iota", "ca-125", "ca125", "malignan", "torsion", "teratom", "ultrasound"],
    "pcos": ["polycystic", "pcos", "hyperandrogen", "insulin", "metformin", "ovulat", "rotterdam", "letrozole", "androgen"],
    "menopause": ["menopaus", "vasomotor", "hot flush", "hot flash", "hormone therapy", "estrogen", "osteoporo", "genitourinary", "climacter"],
    "contraception": ["contracept", "intrauterine", "iud", "implant", "sterilizat", "levonorgestrel", "oral contracep", "condom", "emergency contracep", "pregnan", "vasectom", "tubal"],
    "pregnancy-loss": ["miscarriage", "pregnancy loss", "abortion", "mifepristone", "misoprostol", "ectopic", "recurrent", "gestation", "cesarean scar"],
    "postoperative-recovery": ["postoperat", "recovery", "eras", "enhanced recovery", "analgesi", "opioid", "surg", "laparoscop", "hysterectom", "venous thromboemb", "nausea"],
};
const irrelevant = [];
for (const c of all) {
    const r = rec[c.pmid];
    if (!r) continue;
    const terms = TOPIC_TERMS[c.guide] || [];
    if (!terms.length) continue;
    const hay = norm(r.title + " " + c.title + " " + (c.claim_context || ""));
    if (!terms.some((t) => hay.includes(t))) {
        irrelevant.push({ guide: c.guide, pmid: c.pmid, title: r.title, context: c.claim_context });
    }
}

console.log(`\n${problems.length} citation(s) that do not match the PubMed record:\n`);
for (const p of problems.slice(0, 40)) {
    console.log(`  [${p.kind}] ${p.guide} · PMID ${p.pmid}`);
    console.log(`      page says: ${p.author} — ${p.title.slice(0, 78)} (${p.year || "?"})`);
    console.log(`      pubmed says: ${p.real ? `${p.real.first} — ${p.real.title.slice(0, 78)} (${p.real.year}) ${p.real.journal}` : "NO SUCH RECORD"}`);
}
console.log(`\n${irrelevant.length} citation(s) sharing no subject term with their guide (human review):\n`);
for (const x of irrelevant.slice(0, 25)) {
    console.log(`  ${x.guide} · PMID ${x.pmid}`);
    console.log(`      ${x.title.slice(0, 96)}`);
    if (x.context) console.log(`      cited for: ${x.context.slice(0, 96)}`);
}
writeFileSync("/tmp/citation_audit.json", JSON.stringify({ total: all.length, unique: pmids.length, problems, irrelevant }, null, 1));
console.log(`\nfull report: /tmp/citation_audit.json`);
process.exit(problems.length ? 1 : 0);
