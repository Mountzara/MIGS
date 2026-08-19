#!/usr/bin/env node
// Deploy gate: education attached to an after-visit summary. Wrong material
// on a specific visit teaches the patient the attachments are noise.
import e from "../functions/_lib/avs_education.js";

let pass = 0, fail = 0;
const t = (n, c) => { if (c) pass++; else { fail++; console.error("FAIL:", n); } };

const LIB = [
  { id: "1", slug: "fibroids", title: "Uterine fibroids — what to know", topic_tags_json: '["fibroids","leiomyoma","uae"]' },
  { id: "2", slug: "endo", title: "Endometriosis 101", topic_tags_json: '["endometriosis","pelvic-pain","surgery"]' },
  { id: "3", slug: "aub", title: "Abnormal uterine bleeding", topic_tags_json: '["aub","menstrual","bleeding"]' },
  { id: "4", slug: "postop", title: "Postoperative recovery", topic_tags_json: '["postop","recovery","eras"]' },
  { id: "5", slug: "meno", title: "Menopause", topic_tags_json: '["menopause","mht","vasomotor"]' },
  { id: "6", slug: "orient", title: "Welcome to the portal", topic_tags_json: '["orientation"]' },
];

// --- codes select topics -------------------------------------------
t("fibroid code maps to fibroids", e.topicsForVisit({ icd10: ["D25.9"] }).includes("fibroids"));
t("endometriosis subcode matches by prefix", e.topicsForVisit({ icd10: ["N80.03"] }).includes("endometriosis"));
t("heavy bleeding maps to aub", e.topicsForVisit({ icd10: ["N92.0"] }).includes("aub"));
t("adenomyosis distinguished from other N85", e.topicsForVisit({ icd10: ["N85.2"] }).includes("adenomyosis"));
t("PCOS code maps", e.topicsForVisit({ icd10: ["E28.2"] }).includes("pcos"));
t("menopause code maps", e.topicsForVisit({ icd10: ["N95.1"] }).includes("menopause"));
t("contraception encounter maps", e.topicsForVisit({ icd10: ["Z30.9"] }).includes("contraception"));
t("lowercase code still matches", e.topicsForVisit({ icd10: ["d25.9"] }).includes("fibroids"));
t("unknown code yields nothing", e.topicsForVisit({ icd10: ["Z99.999"] }).length === 0);
t("no codes yields nothing", e.topicsForVisit({}).length === 0);
t("postop visit type adds recovery", e.topicsForVisit({ icd10: [], visit_type: "post_op_followup" }).includes("postop"));
t("ordered ultrasound adds imaging", e.topicsForVisit({ icd10: [], ordered: ["Pelvic ultrasound"] }).includes("imaging"));

// --- selection ------------------------------------------------------
const sel = e.selectForVisit(LIB, { icd10: ["D25.9", "N92.0"] });
t("fibroid+AUB visit attaches both relevant primers", sel.materials.length === 2);
t("attached titles are the right ones",
  sel.materials.map(m => m.slug).sort().join(",") === "aub,fibroids");
t("irrelevant orientation primer is never attached",
  !sel.materials.some(m => m.slug === "orient"));
t("selection reports what it matched on", sel.materials[0].matched_on.length > 0);

// THE important negative: an unmatched visit attaches NOTHING rather than
// stapling a generic pamphlet to a specific visit.
t("unmatched visit attaches nothing", e.selectForVisit(LIB, { icd10: ["Z99.999"] }).materials.length === 0);
t("visit with no codes attaches nothing", e.selectForVisit(LIB, {}).materials.length === 0);
t("empty library is safe", e.selectForVisit([], { icd10: ["D25.9"] }).materials.length === 0);
t("null library is safe", e.selectForVisit(null, { icd10: ["D25.9"] }).materials.length === 0);

// --- ranking + cap ---------------------------------------------------
const many = e.selectForVisit(LIB, { icd10: ["D25.9", "N92.0", "N80.0", "N95.1"], visit_type: "post_op_followup" });
t("never attaches more than three", many.materials.length <= e.MAX_ATTACHED);
t("cap is three", e.MAX_ATTACHED === 3);
t("reports how many were considered", many.considered >= many.materials.length);
const ranked = e.rankMaterials(LIB, ["fibroids", "leiomyoma"]);
t("more tag hits ranks first", ranked[0].slug === "fibroids");
t("materials with no matching tag are excluded", ranked.every(m => m._hits > 0));

// --- the reason shown to the patient ---------------------------------
t("reason names the topic in plain words", /fibroids/.test(e.reasonLine(["fibroids"], "2026-08-19")));
t("reason translates jargon tags", /your bleeding/.test(e.reasonLine(["aub"], "2026-08-19")));
t("reason never exposes a raw tag slug", !/pelvic-pain/.test(e.reasonLine(["pelvic-pain"], "2026-08-19")));
t("reason with no match is empty", e.reasonLine([], "2026-08-19") === "");
// Count topics after "talked about", not " and " globally — the sentence
// already contains "you and Dr. Mabini".
{
  const line = e.reasonLine(["fibroids","aub","menopause","pcos"], "x");
  const after = line.split("talked about ")[1] || "";
  t("reason caps at two topics", (after.match(/ and /g) || []).length <= 1);
  t("reason drops the extra topics", !/menopause|PCOS/.test(after));
}

console.log(`avs education: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
