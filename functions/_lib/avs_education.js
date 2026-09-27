// =====================================================================
// avs_education.js — the reading that belongs to THIS visit
// =====================================================================
// An after-visit summary that says "we discussed fibroids" and stops
// there sends the patient to a search engine, which is where the worst
// information about her condition lives. The AVS should carry the
// practice's own material on exactly what was discussed.
//
// HOW MATERIAL IS CHOSEN — and what this deliberately does NOT do:
//
//   * Selection is by CODE, not by prose. The visit's ICD-10 codes and
//     the ordered studies map to topic tags; tags select from the
//     practice's published library. Nothing is chosen by asking a model
//     what the note "seems to be about".
//   * Nothing is authored here. The patient receives Dr. Mabini's own
//     primers — which are ACOG/peer-review anchored per §0.8.1 — never
//     generated explanations. The standing rule holds: clinical content
//     comes from the practice's curated library, never from a model's
//     general knowledge.
//   * An unmatched visit attaches NOTHING. A generic pamphlet stapled to
//     a specific visit teaches the patient that the attachments are
//     noise, and then the one that mattered gets ignored too.
//
// ICD10_TOPICS is intentionally small and specific to this practice's
// scope (complex benign gynecology). Prefix matching handles the
// subcodes: N80.03 matches the N80 rule.
// =====================================================================

export const ICD10_TOPICS = [
    { prefix: "N80",    topics: ["endometriosis", "pelvic-pain"] },
    { prefix: "N92",    topics: ["aub", "bleeding", "menstrual"] },
    { prefix: "N93",    topics: ["aub", "bleeding"] },
    { prefix: "N94.4",  topics: ["dysmenorrhea", "period-pain"] },
    { prefix: "N94.5",  topics: ["dysmenorrhea", "period-pain"] },
    { prefix: "N94.6",  topics: ["dysmenorrhea", "period-pain"] },
    { prefix: "N94",    topics: ["pelvic-pain"] },
    { prefix: "D25",    topics: ["fibroids", "leiomyoma"] },
    { prefix: "N85.0",  topics: ["aub", "bleeding"] },
    { prefix: "N85.1",  topics: ["aub", "bleeding"] },
    { prefix: "N85.2",  topics: ["adenomyosis"] },
    { prefix: "N85.3",  topics: ["adenomyosis"] },
    { prefix: "N83",    topics: ["ovarian", "adnexal"] },
    { prefix: "E28.2",  topics: ["pcos", "endocrine"] },
    { prefix: "E28",    topics: ["endocrine"] },
    { prefix: "N95",    topics: ["menopause", "vasomotor"] },
    { prefix: "O03",    topics: ["pregnancy-loss", "miscarriage"] },
    { prefix: "N97",    topics: ["infertility"] },
    { prefix: "Z30",    topics: ["contraception", "family-planning"] },
    { prefix: "Z98.89", topics: ["postop", "recovery"] },
];

// A visit that ordered something implies reading of its own.
export const CONTEXT_TOPICS = {
    postop: ["postop", "recovery"],
    preop: ["postop", "recovery"],
    imaging_pelvic: ["imaging"],
};

export function topicsForVisit({ icd10 = [], visit_type = "", ordered = [] } = {}) {
    const out = new Set();
    for (const raw of Array.isArray(icd10) ? icd10 : []) {
        const code = String(raw || "").trim().toUpperCase();
        if (!code) continue;
        for (const rule of ICD10_TOPICS) {
            if (code.startsWith(rule.prefix)) rule.topics.forEach((t) => out.add(t));
        }
    }
    const vt = String(visit_type || "").toLowerCase();
    if (vt.includes("post") && vt.includes("op")) CONTEXT_TOPICS.postop.forEach((t) => out.add(t));
    if (vt.includes("pre") && vt.includes("op")) CONTEXT_TOPICS.preop.forEach((t) => out.add(t));
    for (const o of Array.isArray(ordered) ? ordered : []) {
        const s = String(o || "").toLowerCase();
        if (s.includes("ultrasound") || s.includes("mri") || s.includes("imaging")) out.add("imaging");
    }
    return Array.from(out);
}

/** Score published materials against the visit's topics. Ties break on tag count. */
export function rankMaterials(materials, topics) {
    const want = new Set((topics || []).map((t) => String(t).toLowerCase()));
    if (want.size === 0) return [];
    return (Array.isArray(materials) ? materials : [])
        .map((m) => {
            let tags = [];
            try { tags = JSON.parse(m.topic_tags_json || "[]"); } catch { tags = []; }
            const norm = tags.map((t) => String(t).trim().toLowerCase());
            const hits = norm.filter((t) => want.has(t));
            return { ...m, _hits: hits.length, _matched: hits };
        })
        .filter((m) => m._hits > 0)
        .sort((a, b) => b._hits - a._hits || String(a.title).localeCompare(String(b.title)));
}

// Three is the cap on purpose. A reading list longer than the summary is
// a reading list nobody opens.
export const MAX_ATTACHED = 3;

export function selectForVisit(materials, visit) {
    const topics = topicsForVisit(visit);
    const ranked = rankMaterials(materials, topics);
    return {
        topics,
        materials: ranked.slice(0, MAX_ATTACHED).map((m) => ({
            id: m.id, slug: m.slug, title: m.title, summary: m.summary,
            matched_on: m._matched,
        })),
        considered: ranked.length,
    };
}

/**
 * Why this material is in her summary, in her words. Shown under each
 * item so an attachment never looks arbitrary.
 */
export function reasonLine(matched, visitDate) {
    const nice = {
        "endometriosis": "endometriosis", "pelvic-pain": "pelvic pain", "aub": "your bleeding",
        "bleeding": "your bleeding", "menstrual": "your periods", "dysmenorrhea": "period pain",
        "period-pain": "period pain", "fibroids": "fibroids", "leiomyoma": "fibroids",
        "adenomyosis": "adenomyosis", "ovarian": "ovarian cysts", "adnexal": "ovarian cysts",
        "pcos": "PCOS", "endocrine": "hormones", "menopause": "menopause",
        "vasomotor": "hot flushes", "pregnancy-loss": "pregnancy loss", "miscarriage": "pregnancy loss",
        "contraception": "contraception", "family-planning": "family planning",
        "postop": "your recovery", "recovery": "your recovery", "imaging": "your scan",
        "infertility": "fertility",
    };
    const words = (matched || []).map((m) => nice[m] || m);
    const uniq = Array.from(new Set(words)).slice(0, 2);
    if (uniq.length === 0) return "";
    return `Because you and Dr. Mabini talked about ${uniq.join(" and ")}${visitDate ? " at this visit" : ""}.`;
}

export default { ICD10_TOPICS, topicsForVisit, rankMaterials, selectForVisit, reasonLine, MAX_ATTACHED };
