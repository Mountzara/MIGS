// deidentify.js — HIPAA Safe Harbor scrubber for the website's AI paths.
//
// WHY THIS EXISTS (2026-08-12). The placeholder trick used in
// billing_appeal.js is the NARROW fix: it protects one letter by never
// sending identity. The GENERAL fix is the regulation's own mechanism —
// 45 CFR §164.514(b)(2) Safe Harbor: strip the 18 identifiers and the data
// is no longer PHI, so no BAA is required to process it.
//
// That distinction is what unlocks capability. Today the appeal drafter sees
// only CPT/ICD codes, so it argues generically. With Safe-Harbor text it can
// read the actual indication, the operative findings, and the failed
// conservative therapy — which is what actually wins a medical-necessity
// appeal. Same for prior auth, ADR responses, and documentation improvement.
//
// FAIL-CLOSED BY CONSTRUCTION. `scrubForAI()` returns { ok, text, findings }.
// If ANY high-risk pattern survives, ok === false and the caller MUST NOT
// send. Silence is never treated as success. Callers gate on `ok`, never on
// truthiness of `text`.
//
// ⚠️ This is the website mirror of the Mac app's battle-tested
// DeidentificationService (930 lines, pinned by DeidentificationRegressionTests
// — six historical bugs live there as named tests). When a rule changes in one,
// change BOTH. The Swift file is the senior implementation; this is the
// JS port of its Safe-Harbor surface.

const RULES = [
    // 1 Names handled separately (needs the roster) — see scrubKnownNames.
    // 2 Geographic subdivisions smaller than a state
    { key: "zip", re: /\b\d{5}(?:-\d{4})?\b/g, sub: "[ZIP]", risk: "high" },
    { key: "street", re: /\b\d{1,6}\s+(?:[A-Z][a-z]+\s){1,3}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Suite|Ste|Place|Pl)\b\.?/g, sub: "[ADDRESS]", risk: "high" },
    // 3 Dates — Safe Harbor keeps YEAR only
    { key: "date_numeric", re: /\b(0?[1-9]|1[0-2])[\/\-](0?[1-9]|[12]\d|3[01])[\/\-](\d{2}|\d{4})\b/g, sub: "[DATE]", risk: "high" },
    { key: "date_iso", re: /\b(19|20)\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/g, sub: "[DATE]", risk: "high" },
    { key: "date_written", re: /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+(19|20)\d{2}\b/gi, sub: "[DATE]", risk: "high" },
    // 4 Telephone / 5 Fax
    { key: "phone", re: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, sub: "[PHONE]", risk: "high" },
    // 6 Email
    { key: "email", re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, sub: "[EMAIL]", risk: "high" },
    // 7 SSN
    { key: "ssn", re: /\b\d{3}-\d{2}-\d{4}\b/g, sub: "[SSN]", risk: "high" },
    // 8 MRN / 9 health-plan beneficiary / 10 account numbers
    { key: "mrn", re: /\b(?:MRN|MR#|MR\s?No\.?|Medical\s?Record\s?(?:#|No\.?|Number))\s*[:#]?\s*[A-Z0-9-]{4,}/gi, sub: "[MRN]", risk: "high" },
    { key: "member_id", re: /\b(?:Member|Subscriber|Policy|Group|Beneficiary)\s?(?:ID|#|No\.?|Number)\s*[:#]?\s*[A-Z0-9-]{5,}/gi, sub: "[MEMBER_ID]", risk: "high" },
    { key: "account", re: /\b(?:Account|Acct)\s?(?:#|No\.?|Number)\s*[:#]?\s*[A-Z0-9-]{4,}/gi, sub: "[ACCOUNT]", risk: "high" },
    // 11 Certificate/license
    { key: "license", re: /\b(?:License|Lic\.?)\s?(?:#|No\.?|Number)\s*[:#]?\s*[A-Z0-9-]{4,}/gi, sub: "[LICENSE]", risk: "medium" },
    // 12 Vehicle / 13 device identifiers
    { key: "vin", re: /\b[A-HJ-NPR-Z0-9]{17}\b/g, sub: "[VIN]", risk: "medium" },
    // 14 URLs / 15 IPs
    { key: "url", re: /\bhttps?:\/\/[^\s)]+/g, sub: "[URL]", risk: "low" },
    { key: "ip", re: /\b\d{1,3}(?:\.\d{1,3}){3}\b/g, sub: "[IP]", risk: "medium" },
    // 18 Any other uniquely identifying number: NPI (10 digits) is the provider's,
    // not the patient's, but it identifies the practice — strip for AI paths.
    { key: "npi", re: /\b(?:NPI)\s*[:#]?\s*\d{10}\b/gi, sub: "[NPI]", risk: "medium" },
];

// 17 Ages over 89 must be aggregated (the same 90+ rule the ABOG exam screen uses).
const AGE_RE = /\b(1[0-9]{2}|9[0-9])\s*(?:y\/?o|years?\s*old|yo)\b/gi;

/**
 * INDEXED DATE TOKENS — the fix for a real tension in payer correspondence.
 *
 * Safe Harbor requires stripping every date element except year. But the most
 * important thing to extract from an ADR or denial letter IS a date: the
 * response deadline. Blanket-replacing every date with "[DATE]" destroys the
 * model's ability to say WHICH date is the deadline.
 *
 * So: give each distinct date a stable index — [DATE_1], [DATE_2] … — and keep
 * the mapping LOCALLY. The model performs the semantic task ("the response is
 * due on DATE_3") on tokens alone; we resolve DATE_3 to the real date inside
 * BAA-covered infrastructure. Identity-free, and the deadline survives.
 *
 * Same principle as the appeal-letter placeholders, generalized: send the
 * STRUCTURE, keep the VALUES.
 */
const DATE_PATTERNS = [
    /\b(0?[1-9]|1[0-2])[\/\-](0?[1-9]|[12]\d|3[01])[\/\-](\d{2}|\d{4})\b/g,
    /\b(19|20)\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/g,
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+(19|20)\d{2}\b/gi,
];

export function tokenizeDates(text) {
    let out = String(text || "");
    const map = {};          // token -> original string
    let n = 0;
    const seen = new Map();  // original -> token (same date reused keeps one token)
    for (const re of DATE_PATTERNS) {
        out = out.replace(re, (match) => {
            const key = match.trim();
            if (seen.has(key)) return seen.get(key);
            n += 1;
            const token = `[DATE_${n}]`;
            seen.set(key, token);
            map[token] = key;
            return token;
        });
    }
    return { text: out, map };
}

/** Resolve a model-returned token (e.g. "DATE_3" or "[DATE_3]") to the real date. */
export function resolveDateToken(token, map) {
    if (!token) return null;
    const t = String(token).trim();
    const key = t.startsWith("[") ? t : `[${t}]`;
    return map[key] || null;
}

/** Replace names we KNOW (patient roster) — the one identifier regex can't find. */
export function scrubKnownNames(text, names = []) {
    let out = String(text || "");
    for (const raw of names) {
        const n = String(raw || "").trim();
        if (n.length < 3) continue;                    // never redact 1-2 char tokens
        const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        out = out.replace(new RegExp(`\\b${esc}\\b`, "gi"), "[NAME]");
    }
    return out;
}

/**
 * Safe-Harbor scrub. FAIL-CLOSED: check `ok` before sending anywhere.
 * @param {string} text
 * @param {object} opts
 * @param {string[]} opts.knownNames  patient/subscriber names to redact explicitly
 * @returns {{ok: boolean, text: string, findings: object[], residual: object[]}}
 */
export function scrubForAI(text, { knownNames = [] } = {}) {
    let out = scrubKnownNames(text, knownNames);
    const findings = [];
    for (const rule of RULES) {
        const hits = out.match(rule.re);
        if (hits && hits.length) findings.push({ key: rule.key, count: hits.length, risk: rule.risk });
        out = out.replace(rule.re, rule.sub);
    }
    out = out.replace(AGE_RE, "90 or older");

    // VERIFY the scrub rather than trusting it — re-scan for high-risk shapes.
    const residual = [];
    for (const rule of RULES) {
        if (rule.risk !== "high") continue;
        const left = out.match(rule.re);
        if (left && left.length) residual.push({ key: rule.key, count: left.length, sample: String(left[0]).slice(0, 12) });
    }
    return { ok: residual.length === 0, text: out, findings, residual };
}

/**
 * The gate every website AI path must call before sending clinical text.
 * Throws instead of returning dirty text — a caller cannot ignore it by
 * forgetting to check a boolean.
 */
export function requireDeidentified(text, opts) {
    const r = scrubForAI(text, opts);
    if (!r.ok) {
        const keys = r.residual.map((x) => x.key).join(", ");
        throw new Error(`PHI de-identification failed (residual: ${keys}) — refusing to send to an AI processor.`);
    }
    return r.text;
}

/**
 * The combined gate for document text: tokenize dates (so deadlines stay
 * reasoning-visible), then Safe-Harbor scrub everything else, then VERIFY.
 * Returns the token map so the caller can resolve dates locally afterwards.
 * Throws on residual PHI — callers cannot forget to check.
 */
export function prepareDocumentForAI(text, { knownNames = [] } = {}) {
    const { text: tokenized, map } = tokenizeDates(text);
    const r = scrubForAI(tokenized, { knownNames });
    if (!r.ok) {
        const keys = r.residual.map((x) => x.key).join(", ");
        throw new Error(`PHI de-identification failed (residual: ${keys}) — refusing to send to an AI processor.`);
    }
    return { text: r.text, dateMap: map, findings: r.findings };
}

export default { scrubForAI, requireDeidentified, scrubKnownNames, tokenizeDates, resolveDateToken, prepareDocumentForAI };
