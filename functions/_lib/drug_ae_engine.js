// =====================================================================
// functions/_lib/drug_ae_engine.js
// =====================================================================
// Phase 15 — Medication AE / SE detection.
//
// Given a patient's current medication list (raw text strings from intake
// Section 13) and a tokenized symptom set extracted from their briefing
// (chief complaint, active problems, PROM-flagged symptoms, ROS positives,
// GI / GU positives), this module:
//
//   1. For each med, fetch the openFDA drug label (cache-first, 30-day TTL).
//   2. Cross-match the label's adverse_reactions[] / warnings_and_precautions[]
//      / side_effects[] / drug_interactions[] text against the patient's
//      symptom token set using a deterministic substring + word-boundary
//      keyword matcher with confidence scoring.
//   3. Return a structured medication_watch[] array — one entry per drug,
//      each carrying matched AE strings, the patient symptoms that matched,
//      a confidence label, and the openFDA set_id + fetch timestamp so every
//      claim is traceable per §3.6.
//
// Per CLAUDE.md §3.6 / §3.7:
//   - openFDA is a validated API for drug labels — fetched in this session.
//   - No claim originates from training memory. If openFDA returns zero
//     hits for a med name, we cache `not_found=1` and surface a soft
//     "drug name not recognized by openFDA — please verify spelling" hint
//     on the briefing rather than guess.
//   - Every emitted match carries the source set_id + fetched_at so the
//     clinician can re-query openFDA at the same id for the same evidence.
// =====================================================================

const OPENFDA_LABEL_URL = "https://api.fda.gov/drug/label.json";
const TTL_MS = 30 * 24 * 60 * 60 * 1000;       // 30-day cache TTL
const SUBREQUEST_BUDGET = 8;                    // soft cap per briefing (CF Workers free = 50)
const FETCH_TIMEOUT_MS = 8000;


// --------------------------------------------------------------------- //
// String normalization
// --------------------------------------------------------------------- //

const DOSE_SUFFIX_RE = /\s+\d+(\.\d+)?\s*(mg|mcg|g|ml|iu|units?|tablets?)\b.*$/i;
const PUNCT_RE = /[(){}\[\]"'`,.;:!?]/g;

/**
 * Normalize a patient-typed med name for stable cache lookup.
 *   "Ozempic 0.5mg/wk SC"   → "ozempic"
 *   "Tylenol Extra Strength" → "tylenol extra strength"
 *   "Synthroid (levothyroxine) 75 mcg" → "synthroid levothyroxine"
 */
export function normalizeDrugName(raw) {
    if (!raw || typeof raw !== "string") return "";
    return raw
        .replace(DOSE_SUFFIX_RE, "")
        .replace(PUNCT_RE, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

/**
 * Best-effort split of a free-text "Current medications" string into
 * individual drug names. Patients enter these as comma/newline-separated
 * lists, sometimes with parenthetical notes.
 */
export function splitMedList(text) {
    if (!text || typeof text !== "string") return [];
    return text
        .split(/[\n,;]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 1)
        .slice(0, 25);          // sanity cap
}


// --------------------------------------------------------------------- //
// openFDA label fetch (cache-first)
// --------------------------------------------------------------------- //

async function _ensureCacheTable(env) {
    // Defensive: D1 migration may not be applied in some envs (e.g. local
    // wrangler dev). Don't blow up briefing rendering if the table is
    // missing — just skip the cache and fetch directly.
    try {
        await env.DB.prepare(
            "SELECT 1 FROM drug_label_cache LIMIT 1"
        ).first();
        return true;
    } catch {
        return false;
    }
}


/**
 * Fetch a drug label from openFDA with cache.
 *
 * @param {object} env
 * @param {string} rawName — patient-typed med name
 * @returns {Promise<{drug_key, set_id, label, not_found, fetched_at, log}>}
 */
export async function fetchDrugLabel(env, rawName) {
    const drug_key = normalizeDrugName(rawName);
    const log = {
        drug_key, raw: rawName,
        cache: "miss",
        url: null, status: null, duration_ms: null, error: null,
    };
    if (!drug_key) {
        log.cache = "skip_empty";
        return { drug_key: "", label: null, not_found: true, log };
    }

    const hasCache = await _ensureCacheTable(env);

    // 1. Check cache
    if (hasCache) {
        const row = await env.DB.prepare(
            "SELECT * FROM drug_label_cache WHERE drug_key = ?"
        ).bind(drug_key).first();
        const fresh = row && (Date.now() - (row.fetched_at || 0) < TTL_MS);
        if (fresh) {
            log.cache = "hit";
            let label = null;
            try { label = row.label_json ? JSON.parse(row.label_json) : null; } catch {}
            return {
                drug_key,
                set_id: row.set_id || null,
                canonical_brand_name: row.canonical_brand_name || null,
                canonical_generic_name: row.canonical_generic_name || null,
                matched_on: row.matched_on || null,
                label,
                not_found: !!row.not_found,
                fetched_at: row.fetched_at,
                log,
            };
        }
    }

    // 2. Cache miss — query openFDA.
    // Search precedence: brand_name → generic_name → substance_name.
    const tryFields = [
        { field: "openfda.brand_name", label: "brand_name" },
        { field: "openfda.generic_name", label: "generic_name" },
        { field: "openfda.substance_name", label: "substance_name" },
    ];
    let result = null;
    for (const t of tryFields) {
        const url = `${OPENFDA_LABEL_URL}?search=${encodeURIComponent(`${t.field}:"${drug_key}"`)}&limit=1`;
        log.url = url;
        const t0 = Date.now();
        try {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
            const resp = await fetch(url, {
                signal: ctrl.signal,
                headers: { "User-Agent": "MountZara-AE-Engine/1.0 (briefing pipeline)" },
            });
            clearTimeout(timer);
            log.status = resp.status;
            log.duration_ms = Date.now() - t0;
            if (resp.status === 200) {
                const body = await resp.json();
                const r0 = body && Array.isArray(body.results) && body.results[0];
                if (r0) {
                    const of = (r0.openfda || {});
                    result = {
                        label: r0,
                        set_id: r0.set_id || r0.id || (of.spl_id && of.spl_id[0]) || null,
                        canonical_brand_name: (of.brand_name || [])[0] || null,
                        canonical_generic_name: (of.generic_name || [])[0] || null,
                        matched_on: t.label,
                    };
                    break;
                }
            } else if (resp.status === 404) {
                // openFDA returns 404 with "no matches found" body for empty results.
                continue;
            } else {
                log.error = `HTTP ${resp.status}`;
                break;       // hard error — stop trying alt fields
            }
        } catch (e) {
            log.duration_ms = Date.now() - t0;
            log.error = String(e.message || e).slice(0, 200);
            // Network / timeout — bail to avoid burning budget
            break;
        }
    }

    const fetched_at = Date.now();
    const not_found = !result;
    const out = {
        drug_key,
        set_id: result?.set_id || null,
        canonical_brand_name: result?.canonical_brand_name || null,
        canonical_generic_name: result?.canonical_generic_name || null,
        matched_on: result?.matched_on || (not_found ? "no_match" : null),
        label: result?.label || null,
        not_found,
        fetched_at,
        log,
    };

    // 3. Persist into cache (best-effort).
    if (hasCache) {
        try {
            await env.DB.prepare(`
                INSERT INTO drug_label_cache
                    (drug_key, canonical_brand_name, canonical_generic_name,
                     set_id, matched_on, label_json, fetched_at, ttl_days,
                     last_http_status, last_duration_ms, not_found)
                VALUES (?, ?, ?, ?, ?, ?, ?, 30, ?, ?, ?)
                ON CONFLICT(drug_key) DO UPDATE SET
                    canonical_brand_name = excluded.canonical_brand_name,
                    canonical_generic_name = excluded.canonical_generic_name,
                    set_id = excluded.set_id,
                    matched_on = excluded.matched_on,
                    label_json = excluded.label_json,
                    fetched_at = excluded.fetched_at,
                    last_http_status = excluded.last_http_status,
                    last_duration_ms = excluded.last_duration_ms,
                    not_found = excluded.not_found
            `).bind(
                drug_key,
                out.canonical_brand_name, out.canonical_generic_name,
                out.set_id, out.matched_on,
                out.label ? JSON.stringify(out.label) : null,
                fetched_at,
                log.status || null, log.duration_ms || null,
                not_found ? 1 : 0,
            ).run();
        } catch (e) {
            // Don't block briefing render on cache write failure.
            out.log.cache = `write_failed:${e.message || e}`;
        }
    }
    return out;
}


// --------------------------------------------------------------------- //
// Patient symptom tokenization
// --------------------------------------------------------------------- //

// Common stopwords / parts-of-speech we never want to match against AE text.
const STOPWORDS = new Set([
    "the", "a", "an", "and", "or", "for", "of", "to", "in", "on", "at",
    "is", "was", "were", "has", "had", "have", "with", "without", "by",
    "from", "as", "be", "been", "being", "this", "that", "these", "those",
    "than", "then", "so", "if", "but", "not", "no", "yes", "any", "all",
    "some", "her", "his", "their", "your", "my", "our", "i", "we", "you",
    "she", "he", "it", "they", "them", "me", "us",
    "patient", "patients", "pt", "history", "year", "years", "month",
    "months", "day", "days", "week", "weeks", "post", "pre", "during",
    "after", "before", "since", "currently", "previously",
]);

const MIN_TOKEN_LEN = 4;

/**
 * Tokenize a free-text string into clinical symptom candidates.
 * Lowercase, strip punctuation, drop stopwords + numbers + tokens < 4 chars.
 */
export function tokenizeSymptomText(s) {
    if (!s || typeof s !== "string") return [];
    return s
        .toLowerCase()
        .replace(/[(){}\[\]"'`,.;:!?\/\\<>=]/g, " ")
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) =>
            t.length >= MIN_TOKEN_LEN &&
            !STOPWORDS.has(t) &&
            !/^\d+$/.test(t)
        );
}


/**
 * Collect every symptom signal we have on a briefing object into a single
 * token set + provenance map: token → which fields surfaced it.
 *
 * @param {object} briefing — output of buildPatientBriefing()
 * @returns {{tokens: Set<string>, provenance: Map<string, string[]>}}
 */
export function collectPatientSymptoms(briefing) {
    const provenance = new Map();
    const addTokens = (text, source) => {
        for (const tok of tokenizeSymptomText(text)) {
            if (!provenance.has(tok)) provenance.set(tok, []);
            const list = provenance.get(tok);
            if (!list.includes(source)) list.push(source);
        }
    };

    // 1. Focused appointment chief complaint summary
    if (briefing.appointment_focus?.chief_complaint_summary) {
        addTokens(briefing.appointment_focus.chief_complaint_summary,
                  "appointment_chief_complaint");
    }
    // 2. Triage rationale + secondary concerns
    if (briefing.triage?.rationale) {
        addTokens(briefing.triage.rationale, "triage_rationale");
    }
    for (const c of (briefing.triage?.secondary_concerns || [])) {
        addTokens(c, "triage_secondary_concern");
    }
    // 3. Snapshot — chief_complaint + cc_history + problem list labels
    if (briefing.snapshot_summary) {
        const s = briefing.snapshot_summary;
        if (s.chief_complaint) addTokens(s.chief_complaint, "snapshot_chief_complaint");
        if (s.cc_history)      addTokens(s.cc_history,      "snapshot_cc_history");
        for (const p of (s.problems_preview || [])) {
            addTokens(p.label || "", "snapshot_problem");
        }
    }
    // 4. PROM flagged labels
    for (const p of (briefing.prom_trends || [])) {
        for (const f of (p.latest_flags || [])) {
            if (typeof f === "string") addTokens(f, "prom_flag");
        }
        if (p.latest_interpretation) addTokens(p.latest_interpretation, "prom_interpretation");
    }
    // 5. Encounter chief complaints
    for (const e of (briefing.recent_encounters || []).slice(0, 3)) {
        if (e.chief_complaint) addTokens(e.chief_complaint, "encounter_cc");
    }
    // 6. The lede itself — captures G/P + ERAS + watch_for context
    if (briefing.executive_lede) {
        addTokens(briefing.executive_lede, "executive_lede");
    }

    return {
        tokens: new Set(provenance.keys()),
        provenance,
    };
}


// --------------------------------------------------------------------- //
// AE text harvesting from a label
// --------------------------------------------------------------------- //

const LABEL_AE_FIELDS = [
    // Field name on openFDA label JSON → category we'll display.
    ["adverse_reactions",            "adverse_reactions"],
    ["warnings",                     "warning"],
    ["warnings_and_precautions",     "warning"],
    ["precautions",                  "warning"],
    ["boxed_warning",                "boxed_warning"],
    ["contraindications",            "contraindication"],
    ["drug_interactions",            "interaction"],
    ["nervous_system_reactions_table", "adverse_reactions"],
];

function _flattenLabelStrings(value) {
    // openFDA fields are usually arrays of long paragraph strings.
    if (Array.isArray(value)) return value.filter(Boolean).map(String);
    if (typeof value === "string") return [value];
    return [];
}


/**
 * Pull every AE / warning / contraindication / interaction string out of an
 * openFDA label, with category tags.
 * @returns {Array<{category: string, text: string}>}
 */
export function extractAEStringsFromLabel(label) {
    if (!label || typeof label !== "object") return [];
    const out = [];
    for (const [field, category] of LABEL_AE_FIELDS) {
        for (const s of _flattenLabelStrings(label[field])) {
            // Split long paragraphs on sentence-ish boundaries so individual
            // matches surface cleanly in the briefing UI.
            const chunks = s.split(/(?<=[.;])\s+(?=[A-Z])/);
            for (const c of chunks) {
                const clean = c.trim();
                if (clean.length >= 6 && clean.length <= 800) {
                    out.push({ category, text: clean });
                }
            }
        }
    }
    return out;
}


// --------------------------------------------------------------------- //
// Cross-match
// --------------------------------------------------------------------- //

/**
 * Score a token's specificity. Longer + rarer tokens get higher confidence.
 */
function _tokenSpecificity(token) {
    if (token.length >= 10) return "high";
    if (token.length >= 7)  return "moderate";
    return "low";
}

/**
 * Match a single AE string against a token set, returning the matched tokens.
 */
function _findMatches(aeText, tokenSet) {
    const lower = aeText.toLowerCase();
    const matched = [];
    for (const tok of tokenSet) {
        // Word-boundary match — avoid "pain" matching "painstaking" etc.
        const re = new RegExp(`\\b${tok}\\b`, "i");
        if (re.test(lower)) matched.push(tok);
    }
    return matched;
}


/**
 * For one med + the patient's token set, return matching AE entries with
 * source provenance baked in.
 */
function _matchOneMed(medInfo, label, symptomSet) {
    const aes = extractAEStringsFromLabel(label);
    const matches = [];
    for (const ae of aes) {
        const tokens = _findMatches(ae.text, symptomSet.tokens);
        if (!tokens.length) continue;
        const sources = new Set();
        for (const t of tokens) {
            for (const src of (symptomSet.provenance.get(t) || [])) sources.add(src);
        }
        // Confidence: max of token specificities, bumped to high if the AE
        // string is short + specific (< 80 chars) AND we matched ≥ 2 tokens.
        let confidence = "low";
        for (const t of tokens) {
            const c = _tokenSpecificity(t);
            if (c === "high")     confidence = "high";
            else if (c === "moderate" && confidence === "low") confidence = "moderate";
        }
        if (tokens.length >= 2 && ae.text.length < 80) confidence = "high";

        matches.push({
            category: ae.category,
            ae_text: ae.text,
            matched_tokens: tokens,
            patient_sources: Array.from(sources),
            confidence,
        });
    }
    // Sort high-confidence first, then by category severity, then by AE text length asc.
    const CONF_RANK = { high: 3, moderate: 2, low: 1 };
    const CAT_RANK = {
        boxed_warning: 4, contraindication: 3,
        warning: 2, interaction: 1, adverse_reactions: 0,
    };
    matches.sort((a, b) => {
        const dc = (CONF_RANK[b.confidence] || 0) - (CONF_RANK[a.confidence] || 0);
        if (dc !== 0) return dc;
        const dcat = (CAT_RANK[b.category] || 0) - (CAT_RANK[a.category] || 0);
        if (dcat !== 0) return dcat;
        return a.ae_text.length - b.ae_text.length;
    });
    return matches.slice(0, 6);     // cap per-drug list so the briefing stays scannable
}


// --------------------------------------------------------------------- //
// Public — build the medication_watch[] section of a briefing
// --------------------------------------------------------------------- //

/**
 * @param {object} env
 * @param {object} briefing — output of buildPatientBriefing()
 * @returns {Promise<{
 *   watch: Array<{drug, set_id, fetched_at, matched_on, matches[], not_found, log_short}>,
 *   manifest: {openfda_calls[], generated_at}
 * }>}
 */
export async function buildMedicationWatch(env, briefing) {
    const meds = briefing?.current_medications;
    const watch = [];
    const openfda_calls = [];

    // Assemble the candidate drug list from intake Section 13 fields.
    const candidates = [];
    if (meds) {
        for (const field of ["pain_meds", "contraceptives_hormones", "other_meds"]) {
            const drugs = splitMedList(meds[field]);
            for (const d of drugs) {
                if (!candidates.includes(d)) candidates.push(d);
            }
        }
    }
    if (!candidates.length) {
        return { watch: [], manifest: { openfda_calls: [], generated_at: Date.now() } };
    }

    // Tokenize patient symptoms once.
    const symptomSet = collectPatientSymptoms(briefing);

    // Cap so a runaway med list can't bust the Worker subrequest budget.
    const considered = candidates.slice(0, SUBREQUEST_BUDGET);

    for (const raw of considered) {
        const labelResult = await fetchDrugLabel(env, raw);
        openfda_calls.push({
            raw,
            drug_key: labelResult.drug_key,
            url: labelResult.log.url,
            status: labelResult.log.status,
            cache: labelResult.log.cache,
            duration_ms: labelResult.log.duration_ms,
            fetched_at: labelResult.fetched_at,
            error: labelResult.log.error || null,
        });
        if (labelResult.not_found) {
            watch.push({
                drug: labelResult.drug_key || raw,
                raw_input: raw,
                not_found: true,
                matched_on: "no_match",
                set_id: null,
                fetched_at: labelResult.fetched_at,
                matches: [],
                advisory: "openFDA returned no match — verify drug name spelling, or this may be a supplement / non-prescription product not in the FDA SPL database.",
            });
            continue;
        }
        const matches = _matchOneMed(raw, labelResult.label, symptomSet);
        watch.push({
            drug: labelResult.canonical_brand_name
                  || labelResult.canonical_generic_name
                  || labelResult.drug_key,
            raw_input: raw,
            not_found: false,
            matched_on: labelResult.matched_on,
            set_id: labelResult.set_id,
            fetched_at: labelResult.fetched_at,
            matches,
            high_confidence_count: matches.filter((m) => m.confidence === "high").length,
        });
    }

    return {
        watch,
        manifest: {
            openfda_calls,
            generated_at: Date.now(),
            considered_count: considered.length,
            skipped_for_budget: Math.max(0, candidates.length - considered.length),
        },
    };
}
