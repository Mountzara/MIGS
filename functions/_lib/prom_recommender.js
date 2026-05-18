// =====================================================================
// functions/_lib/prom_recommender.js — AI-driven PROM assignment
// =====================================================================
// Per CLAUDE.md §11.6 + the validated-questionnaire library (Tier 1
// universal + Tier 2 condition-triggered + Tier 3 clinician).
//
// Pipeline:
//   1. Take the de-identified intake from intake_triage.deidentifyIntake().
//   2. Send to Claude with the PROM catalog + assignment rules from the
//      questionnaire-library doc.
//   3. Claude returns: { recommended_slugs: [...], rationale: "..." }
//   4. Caller assigns each PROM via proms.assignPROM().
//
// Resilience:
//   If the Anthropic call fails OR ANTHROPIC_API_KEY is unset, we fall
//   back to a deterministic rule-based recommender below — same Tier 1
//   universal + obvious Tier 2 mappings, so the patient always gets a
//   sensible PROM panel even when AI is unavailable.
// =====================================================================

import { callClaude, AnthropicError } from "./anthropic.js";

export const PROM_RECOMMENDER_PROMPT_VERSION = "prom-rec-v1.0-2026-05-18";

// Tier catalog Claude is allowed to draw from. The full Tier 2 expansion is
// now in scope — every PROM JSON in /assets/proms/ that has been seeded into
// prom_definitions is available for the recommender to assign.
//
// Assignment principles per CLAUDE.md §11.5.1:
//   - Tier 1 PROMs (universal) are always assigned.
//   - Tier 2 PROMs are assigned when the intake answers indicate the
//     condition or symptom is present (per each entry's `trigger`).
//   - PGI-I is post-treatment only — never include at intake.
const PROM_CATALOG = [
    // ===== Tier 1 — universal =====
    { slug: "phq-2",      tier: 1, domain: "depression",         trigger: "universal", description: "2-item depression screen (PHQ-2)" },
    { slug: "gad-2",      tier: 1, domain: "anxiety",            trigger: "universal", description: "2-item anxiety screen (GAD-2)" },
    { slug: "bpi-sf",     tier: 1, domain: "pain",               trigger: "any pain is part of the chief complaint (pain location set, pain scale > 0, dysmenorrhea, dyspareunia, or chronic pelvic pain pattern)", description: "Brief Pain Inventory short form" },

    // ===== Tier 2 — condition-triggered =====
    // Endometriosis QoL — EHP-30 at baseline (gold standard), EHP-5 at 3-month follow-up
    { slug: "ehp-30",     tier: 2, domain: "endometriosis",      trigger: "endometriosis confirmed OR suggestive at BASELINE (dysmenorrhea + dyspareunia, OR confirmed_endometriosis flag, OR prior endometriosis surgery, OR DIE imaging finding, OR endometrioma). Use this at intake; switch to EHP-5 at 3-month follow-ups.", description: "30-item Endometriosis Health Profile (gold standard) — 5 subscales" },
    { slug: "ehp-5",      tier: 2, domain: "endometriosis",      trigger: "FOLLOW-UP only — do NOT assign at intake when EHP-30 is already in scope; the AI should default to EHP-30 at baseline and EHP-5 at follow-ups.", description: "5-item endometriosis HRQL short form" },

    // Sexual function
    { slug: "fsfi",       tier: 2, domain: "sexual_function",    trigger: "any dyspareunia (pain_intercourse=true OR pain entry/deep/with orgasm), OR menopause-track patient with GSM symptoms, OR post-pelvic-surgery (post-prolapse, post-RAH, post-deep-excision), OR patient explicitly raises sexual-function concerns in chief complaint or section 9", description: "19-item Female Sexual Function Index (6 domains)" },

    // Central sensitization — chronic pain
    { slug: "csi",        tier: 2, domain: "pain_central_sensitization", trigger: "chronic pelvic pain ≥6 months, OR pain that has not responded to prior peripheral therapies, OR multiple overlapping conditions (IBS + IC + chronic pelvic pain + chronic headaches + fibromyalgia features) — pre-op for any chronic pain patient", description: "25-item Central Sensitization Inventory (Part A)" },

    // Pain catastrophizing
    { slug: "pcs",        tier: 2, domain: "pain_psychology",    trigger: "chronic pelvic pain pattern (pain >= 6 months OR pain interference high OR central sensitization features) — pre-op for any chronic pain patient", description: "13-item Pain Catastrophizing Scale" },

    // Pelvic floor — distress (PFDI-20) and impact (PFIQ-7)
    { slug: "pfdi-20",    tier: 2, domain: "pelvic_floor",       trigger: "pelvic floor symptoms (prolapse symptoms, urinary incontinence, fecal incontinence, urinary frequency >8/day, urinary urgency, nocturia >2/night, stress urinary incontinence, urge urinary incontinence, pelvic organ prolapse exam findings) OR planned prolapse / urogyn procedure", description: "20-item pelvic floor distress inventory (POPDI-6 + CRADI-8 + UDI-6)" },
    { slug: "pfiq-7",     tier: 2, domain: "pelvic_floor",       trigger: "same triggers as PFDI-20 — assign alongside PFDI-20 to capture symptom DISTRESS (PFDI-20) AND life-IMPACT (PFIQ-7) on a single intake. Tracks change after pelvic-floor or urogyn surgery.", description: "21-item Pelvic Floor Impact Questionnaire short form" },

    // Urinary incontinence — focused 4-item short form when UI is the dominant problem
    { slug: "iciq-ui-sf", tier: 2, domain: "urinary_incontinence", trigger: "urinary leakage of any kind reported at intake (stress UI, urge UI, mixed UI, or leakage during exercise / cough / sneeze / asleep / for no obvious reason) — focused short form alongside PFIQ-7 when UI is the dominant pelvic-floor problem", description: "4-item ICIQ Urinary Incontinence Short Form" },

    // Fibroids — symptom severity
    { slug: "ufs-qol-ss", tier: 2, domain: "fibroids",           trigger: "confirmed or suspected uterine fibroids (intake mass_fibroids true OR fibroid_size_cm > 0 OR imaging shows fibroids OR bulk-symptom complaint with pelvic-pressure pattern OR heavy menstrual bleeding with anatomic concern)", description: "8-item Uterine Fibroid Symptom Severity subscale of UFS-QoL" },

    // Menopause — multi-domain QoL
    { slug: "menqol",     tier: 2, domain: "menopause",          trigger: "menopausal-transition / perimenopausal / postmenopausal patient (age ≥45 with cycle change, OR vasomotor symptoms reported, OR GSM symptoms, OR established menopause, OR taking MHT). Captures vasomotor + psychosocial + physical + sexual subscales.", description: "29-item Menopause-Specific Quality of Life questionnaire" },

    // ===== Tier 2 — POST-TREATMENT only =====
    { slug: "pgi-i",      tier: 2, domain: "treatment_response", trigger: "Do NOT assign at intake. Only assign post-treatment (3 wks / 3 mo / 6 mo / 12 mo after a procedure or surgery).", description: "Single-item Patient Global Impression of Improvement" }
];

const SYSTEM_PROMPT = `You are the PROM-assignment assistant for a MIGS / benign-gynecology practice. Based on a patient's de-identified intake summary, you decide which validated patient-reported outcome measures to assign at baseline.

Assignment principles:
- Tier 1 PROMs (universal) are ALWAYS assigned, regardless of complaint, for every adult patient at intake.
- Tier 2 PROMs are assigned ONLY when the intake answers indicate the relevant condition or symptom is present. Be inclusive: when the intake hints at the condition (e.g., dysmenorrhea + dyspareunia), assign the PROM even if there is no formal diagnosis flag yet — that is the point of a screening assessment.
- Do NOT assign PROMs whose trigger condition is clearly absent.
- Each PROM in the catalog lists its trigger condition explicitly. Apply it strictly.

You return ONLY a JSON object. No prose before or after. No code fences. The JSON must have exactly these keys:
{
  "recommended_slugs": ["<slug>", ...],
  "rationale": "<<=400 chars: which intake fields drove each Tier-2 inclusion. Always mention which Tier-1 slugs were universally assigned.>"
}`;

function buildUserMessage(deid) {
    return [
        "PROM CATALOG (you may only choose from these slugs):",
        JSON.stringify(PROM_CATALOG, null, 2),
        "",
        "DE-IDENTIFIED INTAKE SUMMARY:",
        JSON.stringify(deid, null, 2),
        "",
        "Return the JSON object now."
    ].join("\n");
}

function isJsonObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
}

function extractJson(text) {
    if (typeof text !== "string") return null;
    const t = text.trim();
    try { return JSON.parse(t); } catch {}
    const start = t.indexOf("{"); const end = t.lastIndexOf("}");
    if (start >= 0 && end > start) {
        try { return JSON.parse(t.slice(start, end + 1)); } catch {}
    }
    return null;
}

// ---------------------------------------------------------------------
// Rule-based fallback — runs when Claude is unavailable or returns
// something we cannot parse. Deterministic, auditable, conservative.
// ---------------------------------------------------------------------
export function ruleBasedRecommend(deid) {
    const slugs = new Set(["phq-2", "gad-2"]);  // Tier 1 universal
    const rationale_parts = ["Tier 1 universal: phq-2, gad-2."];
    const s = deid && deid.sections ? deid.sections : {};
    const s1 = s[1]  || {};
    const s4 = s[4]  || {};
    const s5 = s[5]  || {};
    const s7 = s[7]  || {};
    const s9 = s[9]  || {};
    const s10 = s[10] || {};
    const s11 = s[11] || {};

    // ---- BPI-SF — pain present in chief complaint ----
    const painScale = Number(s4.pain_scale) || 0;
    const painLocation = s4.pain_location && s4.pain_location !== "none";
    const dysmenWithPeriods = s4.trig_with_periods === true || s4.trig_with_periods === "yes";
    const constantPain = s4.trig_constant === true || s4.trig_constant === "yes";
    const dyspareunia = s9.pain_intercourse === true || s9.pain_intercourse === "yes";
    if (painScale > 0 || painLocation || dysmenWithPeriods || constantPain || dyspareunia) {
        slugs.add("bpi-sf");
        rationale_parts.push("BPI-SF: pain present in chief complaint.");
    }

    // ---- Endometriosis — EHP-30 at baseline (preferred), EHP-5 reserved for follow-up ----
    const endoConfirmed =
        s4.confirmed_endometriosis === true ||
        s4.confirmed_endometriosis === "yes" ||
        (s7.surg_endo_excision || s7.surg_endo_ablation);
    const endoSuggestive =
        (dysmenWithPeriods && dyspareunia) ||
        s4.mass_adenomyosis === true ||
        s4.mass_adenomyosis === "yes" ||
        s4.trig_with_bms === true ||
        s4.trig_with_bms === "yes" ||
        (s10.imaging_endometrioma_size_cm && Number(s10.imaging_endometrioma_size_cm) > 0);
    if (endoConfirmed || endoSuggestive) {
        slugs.add("ehp-30");
        rationale_parts.push(endoConfirmed
            ? "EHP-30: endometriosis confirmed (baseline)."
            : "EHP-30: dysmenorrhea + dyspareunia/imaging suggestive of endometriosis.");
    }

    // ---- PCS — chronic pain pattern ----
    const chronicPain =
        constantPain ||
        (s4.bleed_duration_months && Number(s4.bleed_duration_months) >= 6) ||
        (painScale >= 6) ||
        (s4.pain_work_impact === true || s4.pain_work_impact === "yes");
    if (chronicPain) {
        slugs.add("pcs");
        rationale_parts.push("PCS: chronic pain pattern present.");
    }

    // ---- CSI — chronic pain + multi-system overlap features ----
    const csiOverlap =
        (s11.gi_ibs_symptoms || s11.gi_bloating) ||
        s11.gu_painful_urination ||
        (s11.gu_frequency_over_8 && s11.gu_urgency) ||
        (s4.confirmed_ic === true || s4.confirmed_ic === "yes") ||
        (s4.confirmed_fibromyalgia === true || s4.confirmed_fibromyalgia === "yes") ||
        (s4.confirmed_migraines === true || s4.confirmed_migraines === "yes");
    if (chronicPain && csiOverlap) {
        slugs.add("csi");
        rationale_parts.push("CSI: chronic pain with multi-system overlap features.");
    }

    // ---- FSFI — sexual function concerns ----
    const sexuallyActive = s9.sexually_active === true || s9.sexually_active === "yes";
    const fsfiTrigger =
        dyspareunia ||
        s9.pain_entry === true || s9.pain_entry === "yes" ||
        s9.pain_deep === true  || s9.pain_deep  === "yes" ||
        s9.pain_orgasm === true || s9.pain_orgasm === "yes" ||
        s9.avoid_intercourse === true || s9.avoid_intercourse === "yes";
    if (sexuallyActive && fsfiTrigger) {
        slugs.add("fsfi");
        rationale_parts.push("FSFI: dyspareunia or sexual-function concern flagged.");
    }

    // ---- PFDI-20 + PFIQ-7 — pelvic-floor symptoms (paired) ----
    const pelvicFloorSx =
        s11.gu_stress_incontinence || s11.gu_urgency || s11.gu_frequency_over_8 ||
        s11.gu_nocturia_over_2 || s11.gu_incomplete_emptying ||
        s11.gi_stool_loss || s11.gi_rectal_bleeding ||
        s4.press_urinary_freq === true || s4.press_urinary_freq === "yes" ||
        s4.press_constipation === true || s4.press_constipation === "yes";
    if (pelvicFloorSx) {
        slugs.add("pfdi-20");
        slugs.add("pfiq-7");
        rationale_parts.push("PFDI-20 + PFIQ-7: pelvic floor symptoms flagged.");
    }

    // ---- ICIQ-UI SF — focused short form when urinary leakage is the dominant problem ----
    const uiDominant =
        s11.gu_stress_incontinence ||
        (s11.gu_urgency && !s11.gi_stool_loss && !s11.gi_rectal_bleeding) ||
        (s4.confirmed_ui === true || s4.confirmed_ui === "yes");
    if (uiDominant) {
        slugs.add("iciq-ui-sf");
        rationale_parts.push("ICIQ-UI SF: urinary leakage reported as dominant.");
    }

    // ---- UFS-QoL SS — fibroids confirmed or suspected ----
    const fibroidsPresent =
        s4.mass_fibroids === true || s4.mass_fibroids === "yes" ||
        (Number(s4.fibroid_size_cm) > 0) ||
        (s10.imaging_fibroid_count && Number(s10.imaging_fibroid_count) > 0) ||
        (s10.imaging_largest_fibroid_cm && Number(s10.imaging_largest_fibroid_cm) > 0);
    if (fibroidsPresent) {
        slugs.add("ufs-qol-ss");
        rationale_parts.push("UFS-QoL SS: fibroids confirmed or suspected in intake.");
    }

    // ---- MENQOL — menopausal-transition / GSM / VMS ----
    const age = Number(s1.age) || 0;
    const cycleChange = s5.cycle_change === true || s5.cycle_change === "yes";
    const vasomotor =
        s4.confirmed_vasomotor === true || s4.confirmed_vasomotor === "yes" ||
        s4.hot_flashes === true || s4.hot_flashes === "yes" ||
        s4.night_sweats === true || s4.night_sweats === "yes";
    const gsm =
        s9.vaginal_dryness === true || s9.vaginal_dryness === "yes" ||
        s4.confirmed_gsm === true || s4.confirmed_gsm === "yes";
    const onMht = s4.on_mht === true || s4.on_mht === "yes";
    if ((age >= 45 && cycleChange) || vasomotor || gsm || onMht) {
        slugs.add("menqol");
        rationale_parts.push("MENQOL: menopausal-transition / VMS / GSM flagged.");
    }

    // PGI-I is post-treatment only — NEVER assigned at intake. Excluded by design.

    return {
        recommended_slugs: [...slugs],
        rationale: rationale_parts.join(" "),
        ai_used: false
    };
}

// ---------------------------------------------------------------------
// Main entry — try Claude, fall back to rule-based.
// ---------------------------------------------------------------------
export async function recommendPROMsForIntake({ env, deid }) {
    if (!env.ANTHROPIC_API_KEY) {
        const fb = ruleBasedRecommend(deid);
        return { ...fb, prompt_version: PROM_RECOMMENDER_PROMPT_VERSION, ai_used: false, reason: "no_api_key" };
    }
    try {
        const userMessage = buildUserMessage(deid);
        const raw = await callClaude({
            env,
            model: "claude-sonnet-4-6",
            max_tokens: 600,
            temperature: 0,
            system: SYSTEM_PROMPT,
            messages: [{ role: "user", content: userMessage }]
        });
        const parsed = extractJson(raw);
        if (!isJsonObject(parsed) || !Array.isArray(parsed.recommended_slugs)) {
            throw new Error("invalid_response_shape");
        }
        // Validate every slug is in the catalog
        const allowed = new Set(PROM_CATALOG.map(p => p.slug));
        const slugs = parsed.recommended_slugs.filter(s => allowed.has(s));
        // Always force Tier 1 universal in case Claude omits them
        for (const t of ["phq-2", "gad-2"]) if (!slugs.includes(t)) slugs.push(t);
        return {
            recommended_slugs: slugs,
            rationale: typeof parsed.rationale === "string" ? parsed.rationale.slice(0, 600) : "",
            ai_used: true,
            prompt_version: PROM_RECOMMENDER_PROMPT_VERSION
        };
    } catch (e) {
        console.error("prom_recommender Claude call failed; using rule-based fallback", { error: String(e && e.message || e) });
        const fb = ruleBasedRecommend(deid);
        return { ...fb, prompt_version: PROM_RECOMMENDER_PROMPT_VERSION, reason: String(e && e.message || e) };
    }
}
