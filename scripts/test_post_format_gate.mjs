#!/usr/bin/env node
// =====================================================================
// test_post_format_gate.mjs — HARD DEPLOY GATE for the canonical-format
// pipeline (auto-heal + audit + approve-block).
// =====================================================================
// Runs hermetically from committed fixtures built out of the REAL live
// corpus (stale = trimmed blog-2026-W25 as shipped by the regressed
// pipeline; reference = trimmed canonical blog-2026-W21). Exit 2 on any
// failure — deploy-prod.sh treats that as a blocking defect.
//
// What is proven on every deploy:
//   LIB   heal converts stale→canonical losslessly (modal ids + PMIDs)
//   LIB   heal REFUSES garbage / non-paper-card / lossy inputs
//   ROUTE stale POST is auto-healed at ingest → canonical + approvable
//   ROUTE unhealable POST lands warned and /approve refuses it (422)
//   ROUTE force:true override still works and is recorded
//   ROUTE canonical re-render heals a published stale post (same id)
//   ROUTE stale can never clobber a published canonical post (409)
// =====================================================================
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { auditPostFormat, auditPublishable, auditNumericFidelity, auditAbstractCompleteness, auditPopoverSummaries, healPaperCardPost, healDeepDiveModals, healPost, healPopoverSummaries, healAbstractCompleteness } from "../functions/_lib/post_format.js";
import { onRequest } from "../functions/api/posts/[[path]].js";

const HERE = dirname(fileURLToPath(import.meta.url));
const stalePost = JSON.parse(readFileSync(join(HERE, "fixtures/stale_paper_card_post.json"), "utf8"));
const refPost = JSON.parse(readFileSync(join(HERE, "fixtures/canonical_reference_post.json"), "utf8"));

let pass = 0, fail = 0;
const A = (cond, msg) => { if (cond) pass++; else { fail++; console.error("  ✗ FAIL:", msg); } };
const ids = (h) => [...h.matchAll(/<dialog[^>]*\bid="(dd-\d+)"/g)].map((m) => m[1]).sort().join(",");
const pmidsOf = (h) => [...new Set([...h.matchAll(/openDeepDive\('dd-(\d+)'/g)].map((m) => m[1]))].sort().join(",");

// ---------------- LIB ----------------
const healRes = healPaperCardPost(stalePost.body_html, refPost.body_html);
A(healRes.ok, "heal succeeds on the real stale fixture: " + JSON.stringify(healRes.problems));
if (healRes.ok) {
    const out = healRes.healed;
    A(!out.includes("paper-card"), "healed output has zero paper-card");
    A((out.match(/mz-cite-card/g) || []).length >= 2, "healed output has mz-cite-cards");
    A(ids(stalePost.body_html) === ids(out), "modal ids preserved exactly");
    A(pmidsOf(stalePost.body_html) === pmidsOf(out), "PMIDs preserved exactly");
    A(out.includes("openDeepDive"), "deep-dive script present");
    A(/<(div|main|article|section)\b[^>]*class="[^"]*\bmz-post-wrap\b/.test(out),
        "content wrapped in an mz-post-wrap ELEMENT (not just the CSS selector text)");
    A(out.includes("pubmed.ncbi.nlm.nih.gov/"), "PubMed links point at PubMed (not DOI)");
    // The real stale fixture carries BOTH paper-card cards AND dd-*/deepdive-
    // modal deep-dives. The card heal alone fixes the cards; the FULL heal
    // (healPost = card heal + modal heal) is what makes the whole post
    // canonical — the card heal's output still trips the modal-grammar audit.
    A(!auditPostFormat({ kind: "evidence", body_html: out }).canonical,
        "card-only heal is NOT yet canonical while dd-* modals remain (expected)");
    const full = healPost(stalePost.body_html, refPost.body_html);
    A(full.ok, "combined healPost succeeds on the real stale fixture: " + JSON.stringify(full.problems));
    A(full.ok && auditPostFormat({ kind: "evidence", body_html: full.healed }).canonical,
        "combined healPost output passes the audit (cards + modals)");
    A(full.ok && ids(stalePost.body_html) === ids(full.healed), "healPost preserves modal ids");
    A(full.ok && !/class="dd-(?:section|body|h3)\b/.test(full.healed), "healPost leaves no dd-* modal grammar");
}
// ---------------- NUMERIC FIDELITY (effect estimate ↔ embedded abstract) ----------------
{
    const mk = (findings, abstract) => ({
        kind: "evidence",
        body_html:
            `<dialog id="dd-99999999"><div class="mz-jc-abstract-body"><p>${abstract}</p></div>` +
            `<section class="mz-jc-section" id="dd-99999999-findings"><h3>Key findings</h3>${findings}</section></dialog>`,
    });
    // literal match passes
    A(auditNumericFidelity(mk("<p>OR 1.34 (95% CI 1.14–1.57)</p>", "the adjusted OR was 1.34 (95% CI 1.14-1.57).")).ok,
        "numeric fidelity: literal effect estimate present in abstract passes");
    // faithful 2-decimal rounding of a 3-decimal abstract value passes
    A(auditNumericFidelity(mk("<p>OR 1.89 (1.27–2.80)</p>", "OR 1.885, 95% CI 1.267-2.803.")).ok,
        "numeric fidelity: 2-decimal rounding of a 3-decimal abstract value passes (1.885→1.89)");
    // a fabricated / untraceable effect estimate FAILS
    const bad = auditNumericFidelity(mk("<p>AFC OR 0.55 (0.40–0.70)</p>", "female age OR 0.909; AFC OR 0.916 (0.89-0.94)."));
    A(!bad.ok && bad.problems.some((p) => p.includes("0.55")),
        "numeric fidelity: an untraceable effect estimate (0.55 not in abstract) FAILS");
    // a modal with no embedded abstract is skipped, not failed
    A(auditNumericFidelity({ kind: "evidence", body_html: `<dialog id="dd-1"><section id="dd-1-findings"><h3>x</h3><p>OR 9.99</p></section></dialog>` }).ok,
        "numeric fidelity: modal without an embedded abstract is skipped (not failed)");
    // non-clinical kinds are exempt
    A(auditNumericFidelity({ kind: "claim_proposal", body_html: "OR 9.99" }).ok, "numeric fidelity: non-clinical kind exempt");
}
// ---------------- ABSTRACT COMPLETENESS (verbatim abstract not truncated) ----------------
{
    const modal = (label) =>
        `<dialog id="dd-42116313"><div class="mz-jc-abstract-body"><h5 class="mz-jc-abstract-label">${label}</h5><p>text</p></div></dialog>`;
    A(auditAbstractCompleteness({ kind: "evidence", body_html: modal("Abstract") }).ok,
        "abstract completeness: a generic 'Abstract' label passes");
    A(auditAbstractCompleteness({ kind: "evidence", body_html: modal("Background") }).ok,
        "abstract completeness: an opening label (Background) passes");
    const trunc = auditAbstractCompleteness({ kind: "evidence", body_html: modal("Interventions") });
    A(!trunc.ok && trunc.problems.some((p) => p.includes("42116313")),
        "abstract completeness: a mid-structure first label (Interventions) FAILS as truncated");
    A(!auditAbstractCompleteness({ kind: "evidence", body_html: modal("Results") }).ok,
        "abstract completeness: a 'Results'-first structured abstract FAILS as truncated");
    A(auditAbstractCompleteness({ kind: "claim_proposal", body_html: modal("Results") }).ok,
        "abstract completeness: non-clinical kind exempt");
}
// ---------------- POPOVER SUMMARIES (adequate, not raw abstract dumps) ----------------
{
    const pop = (finding) =>
        `<sup class="mz-ref"><a>1</a><span class="mz-ref-pop" id="ref-pop-42216742" role="tooltip"><span class="mz-ref-pop-title">T</span><span class="mz-ref-pop-meta">J · 2026</span><span class="mz-ref-pop-finding">${finding}</span></span></sup>`;
    const good = "Survival study comparing abdominal vs laparoscopic radical hysterectomy for cervical cancer: 5-year survival favored open (83.5% vs 75.0%).";
    A(auditPopoverSummaries({ kind: "evidence", body_html: pop(good) }).ok,
        "popover summary: an adequate plain-language finding passes");
    const raw = auditPopoverSummaries({ kind: "evidence", body_html: pop("INTRODUCTION: Cervical cancer ranks among the top ten globally. Its five-year survival rate is 67.9%.") });
    A(!raw.ok && raw.problems.some((p) => p.includes("42216742")),
        "popover summary: a raw abstract dump (starts 'INTRODUCTION:') FAILS");
    A(!auditPopoverSummaries({ kind: "evidence", body_html: pop("RATIONALE: ART combines egg and sperm outside the body.") }).ok,
        "popover summary: a 'RATIONALE:'-prefixed dump FAILS");
    A(!auditPopoverSummaries({ kind: "evidence", body_html: pop("Reduces pain.") }).ok,
        "popover summary: an effectively-empty finding (<25c) FAILS");
    A(auditPopoverSummaries({ kind: "evidence", body_html: pop("Leiomyosarcoma of uterus in pregnancy: A case report.") }).ok,
        "popover summary: a concise 53c foundational-citation descriptor (W21 standard) PASSES");
    A(auditPopoverSummaries({ kind: "claim_proposal", body_html: pop("BACKGROUND: x") }).ok,
        "popover summary: non-clinical kind exempt");
}
// ---------------- AUTHORITATIVE PUBLISH GATE (ingest/approve enforcement) ----------------
{
    // A structurally-canonical body must still be BLOCKED from publish when it
    // fails any content-fidelity criterion — this is what protects scheduled
    // auto-posts at the /api/posts ingest + /approve choke points.
    const rawPop = `<article class="mz-cite-card" id="mz-cite-1"><h3 class="mz-cite-title">t</h3></article>` +
        `<div class="mz-post-narrative">x</div><div class="mz-five-pick">x</div><div class="mz-topic-group">x</div><div class="mz-references-list">x</div>` +
        `<sup class="mz-ref"><a>1</a><span class="mz-ref-pop" id="ref-pop-42216742"><span class="mz-ref-pop-title">T</span><span class="mz-ref-pop-meta">J</span><span class="mz-ref-pop-finding">INTRODUCTION: Cervical cancer ranks among the top ten globally worldwide today.</span></span></sup>` +
        `<dialog id="dd-42216742"><div class="mz-jc-abstract-body"><h5 class="mz-jc-abstract-label">Abstract</h5><p>text 0.909</p></div></dialog>`;
    const r = auditPublishable({ kind: "evidence", body_html: rawPop });
    A(!r.publishable && r.problems.some((p) => p.includes("42216742")),
        "publish gate: structural-canonical body with a raw-dump popover is NOT publishable");
    A(!auditPublishable({ kind: "evidence", body_html: `<dialog id="dd-9"><div class="mz-jc-abstract-body"><h5 class="mz-jc-abstract-label">Results</h5><p>x</p></div></dialog>` }).publishable,
        "publish gate: a truncated verbatim abstract is NOT publishable");
    A(!auditPublishable({ kind: "evidence", body_html: `<dialog id="dd-9"><div class="mz-jc-abstract-body"><h5 class="mz-jc-abstract-label">Abstract</h5><p>OR 0.909 here</p></div><section class="mz-jc-section" id="dd-9-findings"><h3>Key findings</h3><p>AFC OR 0.55 (0.40-0.70)</p></section></dialog>` }).publishable,
        "publish gate: a fabricated effect estimate is NOT publishable");
    A(auditPublishable({ kind: "evidence", body_html: refPost.body_html }).publishable,
        "publish gate: the canonical reference fixture IS publishable");
}
// ---------------- CONTENT-FIDELITY AUTO-REPAIR (ingest heals to publishable) ----------------
{
    // popover repair: a raw-dump finding is replaced by the paper's bottom-line
    const rawPop =
        `<sup class="mz-ref"><a>1</a><span class="mz-ref-pop" id="ref-pop-42216742"><span class="mz-ref-pop-title">T</span><span class="mz-ref-pop-meta">J</span><span class="mz-ref-pop-finding">INTRODUCTION: Cervical cancer ranks among the top ten globally worldwide today.</span></span></sup>` +
        `<dialog id="dd-42216742"><section class="mz-jc-section" id="dd-42216742-bottom"><h3>Bottom line</h3><p>Survival study comparing abdominal vs laparoscopic radical hysterectomy for cervical cancer: 5-year survival favored open (83.5% vs 75.0%).</p></section><div class="mz-jc-abstract-body"><h5 class="mz-jc-abstract-label">Abstract</h5><p>x 0.909</p></div></dialog>`;
    const ph = healPopoverSummaries(rawPop);
    A(ph.changed === 1, "heal: popover raw-dump replaced from the modal Bottom-line");
    A(auditPopoverSummaries({ kind: "evidence", body_html: ph.healed }).ok, "heal: popover output passes the popover audit");
    A(!/mz-ref-pop-finding">INTRODUCTION:/.test(ph.healed), "heal: no raw-dump finding remains");

    // abstract completion: injected fake PubMed fetcher returns the full abstract
    const truncated = `<dialog id="dd-42116313"><div class="mz-jc-abstract-body"><h5 class="mz-jc-abstract-label">Interventions</h5><p>The patient was treated with surgery and chemotherapy.</p></div></dialog>`;
    const fakeFetch = async (pmid) => [
        { label: "RATIONALE", text: "Leiomyosarcoma diagnosis in pregnancy is challenging." },
        { label: "INTERVENTIONS", text: "The patient was treated with surgery and chemotherapy." },
        { label: "LESSONS", text: "Timely diagnosis avoids misdiagnosis." },
    ];
    const ah = await healAbstractCompleteness(truncated, fakeFetch);
    A(ah.changed === 1 && ah.fetched === 1, "heal: truncated abstract fetched + completed");
    A(auditAbstractCompleteness({ kind: "evidence", body_html: ah.healed }).ok, "heal: completed abstract passes the completeness audit");
    A(/Rationale:/.test(ah.healed) && /Leiomyosarcoma/.test(ah.healed), "heal: dropped opening section restored");

    // lossless guard: a fetch that does NOT cover the embedded text is rejected
    const badFetch = async () => [{ label: "BACKGROUND", text: "Totally unrelated content about something else." }];
    const ah2 = await healAbstractCompleteness(truncated, badFetch);
    A(ah2.changed === 0 && ah2.problems.some((p) => p.includes("covers only")), "heal: non-lossless abstract fetch is refused");

    // a genuinely fabricated number is NOT auto-fixed (stays for the gate)
    const fab = `<dialog id="dd-9"><div class="mz-jc-abstract-body"><h5 class="mz-jc-abstract-label">Abstract</h5><p>OR 0.909 here</p></div><section class="mz-jc-section" id="dd-9-findings"><h3>Key findings</h3><p>AFC OR 0.55 (0.40-0.70)</p></section></dialog>`;
    const noFetch = async () => [];
    const ah3 = await healAbstractCompleteness(fab, noFetch);
    A(!auditPublishable({ kind: "evidence", body_html: ah3.healed }).publishable, "heal: a fabricated number survives heal and remains NOT publishable");
}
// modal-only heal on a canonical-cards + dd-modals body
{
    const modalOnly = healDeepDiveModals(stalePost.body_html);
    A(modalOnly.ok, "healDeepDiveModals succeeds on the fixture's dd-* modals: " + JSON.stringify(modalOnly.problems));
    A(modalOnly.ok && !/class="dd-(?:section|body|h3)\b/.test(modalOnly.healed), "modal heal removes dd-* grammar");
    A(modalOnly.ok && ids(stalePost.body_html) === ids(modalOnly.healed), "modal heal preserves modal ids");
}
A(!healPaperCardPost("<div>hello</div>", refPost.body_html).ok, "heal refuses non-paper-card input");
A(!healPaperCardPost('<article class="paper-card">broken', "no style here").ok, "heal refuses a non-canonical reference");
// adversarial: truncated card grammar must not pass lossless checks silently
const mangled = stalePost.body_html.replace(/openDeepDive\('dd-\d+'\)/, "openDeepDive('dd-000')");
const mg = healPaperCardPost(mangled, refPost.body_html);
A(!mg.ok || pmidsOf(mangled) === pmidsOf(mg.healed || ""), "mangled input either refused or still lossless");
A(auditPostFormat({ kind: "claim_proposal", body_html: "" }).canonical, "claim_proposal exempt");

// ---------------- ROUTES ----------------
function mockEnv(seed = {}) {
    const store = new Map(Object.entries(seed));
    return {
        PIPELINE_TOKEN: "tok", ADMIN_USER: "admin", ADMIN_PASS_HASH: null, ADMIN_EMAILS: "a@b.c",
        CONTENT: {
            async get(k) { const v = store.get(k); return v == null ? null : { text: async () => v }; },
            async put(k, v) { store.set(k, typeof v === "string" ? v : String(v)); },
            async list({ prefix }) { return { objects: [...store.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }; },
            async delete(k) { store.delete(k); },
            _store: store,
        },
        DB: { prepare: () => ({ all: async () => ({ results: [] }), bind() { return this; }, first: async () => null, run: async () => ({}) }) },
    };
}
const ADMIN_H = { "Cf-Access-Authenticated-User-Email": "a@b.c", "Cf-Access-Jwt-Assertion": "x" };
async function call(env, method, path, body, headers = {}) {
    const req = new Request("https://x.test/api/posts" + path, {
        method, headers: { "content-type": "application/json", ...headers },
        body: body ? JSON.stringify(body) : undefined,
    });
    const res = await onRequest({ request: req, env, params: { path: path ? path.replace(/^\//, "").split("/").filter(Boolean) : [] } });
    let j = null; try { j = await res.json(); } catch {}
    return { status: res.status, j };
}

const env = mockEnv({ "posts/blog-2026-W21.json": JSON.stringify(refPost) });

// stale POST → auto-healed at ingest, canonical, approvable
const r1 = await call(env, "POST", "", { id: "w99", kind: "evidence", body_html: stalePost.body_html, title: "t" }, { "X-Pipeline-Token": "tok" });
A(r1.status === 201 && r1.j.auto_healed === true && r1.j.format_canonical === true,
    "stale POST auto-healed → canonical: " + JSON.stringify({ s: r1.status, healed: r1.j && r1.j.auto_healed, canon: r1.j && r1.j.format_canonical }));
const stored = JSON.parse(env.CONTENT._store.get("posts/w99.json"));
A(!stored.body_html.includes("paper-card") && stored.format_auto_healed_at, "stored post is canonical + stamped auto-healed");
const a1 = await call(env, "POST", "/w99/approve", null, ADMIN_H);
A(a1.status === 200, "auto-healed post approves cleanly: " + a1.status);

// unhealable garbage → lands warned, approve refuses, force works
const r2 = await call(env, "POST", "", { id: "bad1", kind: "evidence", body_html: '<article class="paper-card">no grammar at all', title: "t" }, { "X-Pipeline-Token": "tok" });
A(r2.status === 201 && r2.j.format_canonical === false && (r2.j.heal_problems || []).length > 0,
    "unhealable body lands with heal_problems: " + JSON.stringify({ s: r2.status, c: r2.j && r2.j.format_canonical }));
const a2 = await call(env, "POST", "/bad1/approve", null, ADMIN_H);
A(a2.status === 422, "unhealable post approve REFUSED 422: " + a2.status);
const a3 = await call(env, "POST", "/bad1/approve", { force: true }, ADMIN_H);
A(a3.status === 200, "force override still available: " + a3.status);

// published-stale + stale re-POST → auto-heal makes it canonical → format-heal path replaces it
const envH = mockEnv({
    "posts/blog-2026-W21.json": JSON.stringify(refPost),
    "posts/wpub.json": JSON.stringify({ id: "wpub", kind: "evidence", status: "published", published_at: "2026-06-01T00:00:00Z", title: "t", body_html: stalePost.body_html }),
});
const r3 = await call(envH, "POST", "", { id: "wpub", kind: "evidence", body_html: stalePost.body_html, title: "t2" }, { "X-Pipeline-Token": "tok" });
A(r3.status === 201 && r3.j.format_healed === true && r3.j.format_canonical === true,
    "stale re-POST of published stale id → auto-heal + format-heal replaces it: " + JSON.stringify({ s: r3.status, fh: r3.j && r3.j.format_healed }));
const healedPub = JSON.parse(envH.CONTENT._store.get("posts/wpub.json"));
A(healedPub.status === "published" && !healedPub.body_html.includes("paper-card"), "published id stays published, now canonical");

// stale (unhealable) may never clobber a published canonical post
const envC = mockEnv({
    "posts/blog-2026-W21.json": JSON.stringify(refPost),
    "posts/wc.json": JSON.stringify({ id: "wc", kind: "evidence", status: "published", published_at: "2026-06-01T00:00:00Z", title: "t", body_html: refPost.body_html }),
});
const r4 = await call(envC, "POST", "", { id: "wc", kind: "evidence", body_html: '<article class="paper-card">junk', title: "x" }, { "X-Pipeline-Token": "tok" });
A(r4.status === 409, "unhealable stale over published canonical → 409: " + r4.status);

// ---------------- ADVERSARIAL-REVIEW REGRESSIONS (2026-07-02) ----------------
// #1 lossless: a grammar variance the extractors mishandle must REFUSE the
// heal (content-preservation chunks), never silently drop visible text.
const variant = stalePost.body_html.replace('<h3 class="title">', '<h3 class="titleX">');
const vres = healPaperCardPost(variant, refPost.body_html);
A(!vres.ok && vres.problems.some((p) => p.includes("visible text missing")),
    "grammar variance (title class changed) REFUSES the heal: " + JSON.stringify(vres.problems.slice(0, 1)));
// lens-principle is carried (not dropped) by the converter
if (healRes.ok) A(healRes.healed.includes("structure governs function") || !stalePost.body_html.includes("lens-principle"),
    "lens-principle text carried into the healed card");

// #3 publish bypass: a NON-CANONICAL body with status:"published" can NEVER
// self-publish (that's the /approve-gate guarantee). A canonical body may
// (the admin composer's "Publish immediately"), but non-canonical stays draft.
const envS = mockEnv({ "posts/blog-2026-W21.json": JSON.stringify(refPost) });
const r5 = await call(envS, "POST", "", { id: "sneak", kind: "evidence", status: "published", body_html: '<article class="paper-card">no grammar', title: "t" }, { "X-Pipeline-Token": "tok" });
const sneak = JSON.parse(envS.CONTENT._store.get("posts/sneak.json"));
A(r5.status === 201 && sneak.status === "draft" && sneak.format_audit.canonical === false,
    "non-canonical status:published is forced to draft: " + sneak.status);
// canonical body may publish-immediately
const r5b = await call(envS, "POST", "", { id: "okpub", kind: "evidence", status: "published", body_html: refPost.body_html, title: "t" }, { "X-Pipeline-Token": "tok" });
const okpub = JSON.parse(envS.CONTENT._store.get("posts/okpub.json"));
A(okpub.status === "published", "canonical status:published is honored: " + okpub.status);

// #2 curation: formatHeal preserves clinician-revised fields
const envM = mockEnv({
    "posts/blog-2026-W21.json": JSON.stringify(refPost),
    "posts/wm.json": JSON.stringify({
        id: "wm", kind: "evidence", status: "published", published_at: "2026-06-01T00:00:00Z",
        created_at: "2026-05-30T00:00:00Z", title: "Clinician title", summary: "Clinician summary",
        verdict: "clinician-verdict", linkedin_draft: "clinician-li", topics_covered: ["endometriosis"],
        body_html: stalePost.body_html,
    }),
});
const r6 = await call(envM, "POST", "", { id: "wm", kind: "evidence", body_html: stalePost.body_html, title: "pipeline title", summary: "This week's research digest covers 2", verdict: "auto", linkedin_draft: "auto-li" }, { "X-Pipeline-Token": "tok" });
const wm = JSON.parse(envM.CONTENT._store.get("posts/wm.json"));
A(r6.status === 201 && r6.j.format_healed === true, "stale re-POST of published id heals: " + JSON.stringify({ s: r6.status, fh: r6.j && r6.j.format_healed }));
A(wm.title === "Clinician title" && wm.verdict === "clinician-verdict" && wm.linkedin_draft === "clinician-li" && wm.summary === "Clinician summary",
    "format heal preserves clinician-curated fields: " + JSON.stringify({ t: wm.title, v: wm.verdict }));
A(!wm.body_html.includes("paper-card"), "format heal still replaced the body with canonical");

// #4 created_at: draft re-POST preserves first-ingest time
const envD = mockEnv({
    "posts/blog-2026-W21.json": JSON.stringify(refPost),
    "posts/wd.json": JSON.stringify({ id: "wd", kind: "evidence", status: "draft", created_at: "2026-06-20T00:00:00Z", title: "t", body_html: refPost.body_html }),
});
await call(envD, "POST", "", { id: "wd", kind: "evidence", body_html: refPost.body_html, title: "t2" }, { "X-Pipeline-Token": "tok" });
const wd = JSON.parse(envD.CONTENT._store.get("posts/wd.json"));
A(wd.created_at === "2026-06-20T00:00:00Z", "draft re-POST preserves created_at: " + wd.created_at);

console.log(`\npost-format gate: ${pass} passed, ${fail} failed`);
process.exit(fail ? 2 : 0);
