// =====================================================================
// functions/_lib/patient_briefing.js
// =====================================================================
// Phase 14 Round B — pre-visit briefing engine.
//
// Composes a comprehensive-but-efficient pre-visit briefing object from
// everything we have on a patient:
//   • Profile (incl. Phase 14 humanization: nickname, photo_url, care_goals)
//   • Intake responses (most-recent submitted)
//   • Recent encounters (last 5 by visit_date)
//   • PROM trends (Tier-1 scores: PHQ-2, GAD-2, BPI-SF, EHP-5)
//   • Existing Phase 9 AI snapshot (problem list, timeline, action items)
//   • Personal notes (Phase 14 Round A — pinned first)
//   • Today's / upcoming appointment context
//
// Returns a single structured JSON object the briefing UI can render
// directly OR pass to an LLM for narrative expansion. No PHI leaves the
// Worker — every field comes from D1 + R2 with the same admin auth gate
// as /admin/cases/<id>.
//
// Per CLAUDE.md §12.2 BAA gating: this module does NOT call the Anthropic
// API. The structured object is the deliverable; the existing
// /api/v1/admin/snapshots endpoint already provides the LLM-narrated
// clinical narrative and gets injected here as the `snapshot_summary`
// section.
// =====================================================================

import { getPhiObject } from "./phi.js";
import { buildMedicationWatch } from "./drug_ae_engine.js";

const RECENT_ENCOUNTER_LIMIT = 5;
const RECENT_PROM_WINDOW_MS = 1000 * 60 * 60 * 24 * 365;   // 12 months
const APPT_CONTEXT_WINDOW_MS = 1000 * 60 * 60 * 24 * 90;   // ±90 days


function safeJson(s) {
    if (!s || typeof s !== "string") return null;
    try { return JSON.parse(s); } catch { return null; }
}

function ageFromDob(dob) {
    if (!dob) return null;
    const d = new Date(dob);
    if (Number.isNaN(d.getTime())) return null;
    const now = new Date();
    let age = now.getUTCFullYear() - d.getUTCFullYear();
    const mo = now.getUTCMonth() - d.getUTCMonth();
    if (mo < 0 || (mo === 0 && now.getUTCDate() < d.getUTCDate())) age -= 1;
    return age;
}


// ---------------------------------------------------------------------
// Per-patient data assemblers
// ---------------------------------------------------------------------

async function loadPatientHeader(env, patientId) {
    const row = await env.DB.prepare(`
        SELECT id, email, phone, first_name, last_name, preferred_name,
               nickname, dob, pronouns, preferred_language, timezone,
               status, photo_r2_key, photo_uploaded_at,
               care_goals_json, care_goals_updated_at,
               created_at
        FROM patients
        WHERE id = ?
    `).bind(patientId).first();
    if (!row) return null;
    const care_goals = safeJson(row.care_goals_json);
    return {
        id: row.id,
        first_name: row.first_name,
        last_name: row.last_name,
        preferred_name: row.preferred_name || null,
        nickname: row.nickname || null,
        display_name: row.nickname || row.preferred_name || row.first_name || "",
        full_name: `${row.first_name || ""} ${row.last_name || ""}`.trim(),
        pronouns: row.pronouns || null,
        preferred_language: row.preferred_language || "en",
        age: ageFromDob(row.dob),
        dob: row.dob,
        photo_url: row.photo_r2_key ? `/api/v1/admin/patients/${row.id}/photo` : null,
        photo_uploaded_at: row.photo_uploaded_at || null,
        care_goals,
        care_goals_updated_at: row.care_goals_updated_at || null,
        member_since: row.created_at || null,
    };
}


async function loadLatestIntake(env, patientId) {
    const intake = await env.DB.prepare(`
        SELECT id, status, submitted_at, updated_at, completion_pct
        FROM intake_responses
        WHERE patient_id = ?
        ORDER BY (submitted_at IS NOT NULL) DESC, COALESCE(submitted_at, updated_at) DESC
        LIMIT 1
    `).bind(patientId).first();
    if (!intake) return null;
    return {
        id: intake.id,
        status: intake.status,
        submitted_at: intake.submitted_at,
        completion_pct: intake.completion_pct,
    };
}


async function loadIntakeTriage(env, intakeId) {
    if (!intakeId) return null;
    const t = await env.DB.prepare(`
        SELECT id, ai_visit_type, ai_duration_min, ai_urgency,
               ai_in_person_required, ai_preferred_time_of_day, ai_rationale,
               ai_secondary_concerns_json,
               clinician_override_visit_type, clinician_override_duration_min,
               clinician_override_reason, clinician_reviewed_at,
               final_visit_type, final_duration_min, appointment_id, created_at
        FROM appointment_triage
        WHERE intake_id = ?
        ORDER BY created_at DESC
        LIMIT 1
    `).bind(intakeId).first();
    if (!t) return null;
    return {
        id: t.id,
        visit_type: t.final_visit_type || t.clinician_override_visit_type || t.ai_visit_type,
        ai_visit_type: t.ai_visit_type,
        clinician_override_visit_type: t.clinician_override_visit_type || null,
        clinician_override_reason: t.clinician_override_reason || null,
        clinician_reviewed_at: t.clinician_reviewed_at || null,
        estimated_duration_min: t.final_duration_min || t.clinician_override_duration_min || t.ai_duration_min || null,
        urgency: t.ai_urgency || null,
        in_person_required: !!t.ai_in_person_required,
        preferred_time_of_day: t.ai_preferred_time_of_day || null,
        rationale: t.ai_rationale || null,
        secondary_concerns: safeJson(t.ai_secondary_concerns_json) || [],
        appointment_id: t.appointment_id || null,
    };
}


// ---------------------------------------------------------------------
// Intake-section helpers — phase 14 round B+
// Loads sections 4, 7, 8, 10, 12, 13, 14 (sourced per §11.6) for the
// latest intake and reshapes them into briefing-friendly structures.
// ---------------------------------------------------------------------

async function loadIntakeSectionData(env, intakeId) {
    if (!intakeId) return {};
    const { results } = await env.DB.prepare(`
        SELECT section_number, section_key, data_json, last_updated_at
        FROM intake_section_data
        WHERE intake_id = ? AND section_number IN (4, 7, 8, 10, 12, 13, 14)
    `).bind(intakeId).all();
    const out = {};
    for (const r of (results || [])) {
        out[r.section_number] = {
            key: r.section_key,
            data: safeJson(r.data_json) || {},
            last_updated_at: r.last_updated_at,
        };
    }
    return out;
}


function _shapeObstetric(s8) {
    if (!s8) return null;
    const total = Number(s8.total_pregnancies) || 0;
    const vaginal = Number(s8.vaginal_births) || 0;
    const csection = Number(s8.csections) || 0;
    const miscarriage = Number(s8.miscarriages) || 0;
    const ectopic = Number(s8.ectopic_pregnancies) || 0;
    // Para = term + preterm + ab/miscarriage + living (TPAL). Wizard captures
    // raw counts only; we surface G + a simplified Para summary.
    const para_living = vaginal + csection - (miscarriage + ectopic);
    return {
        gravida: total,
        para_simple: `${Math.max(0, vaginal + csection)} delivery(ies), ${miscarriage} miscarriage(s), ${ectopic} ectopic`,
        para_living: Math.max(0, para_living),
        vaginal_births: vaginal,
        csections: csection,
        miscarriages: miscarriage,
        ectopic_pregnancies: ectopic,
        wants_future_pregnancy: s8.future_pregnancy === "yes" || !!s8.want_pregnancy,
        ttc_now: !!s8.ttc_now,
        infertility_flag: !!s8.infertility_dx,
        fertility_tx: !!s8.fertility_treatment,
    };
}


// Maps section 7 boolean flags + per-procedure year + free-text findings.
function _shapePastSurgeries(s7) {
    if (!s7) return null;
    const PROCS = [
        ["diagnostic_laparoscopy",  "Diagnostic laparoscopy"],
        ["endo_excision",           "Endometriosis excision"],
        ["endo_ablation",           "Endometriosis ablation"],
        ["myomectomy",              "Myomectomy"],
        ["ovarian_cystectomy",      "Ovarian cystectomy"],
        ["hysteroscopy",            "Hysteroscopy"],
        ["polypectomy",             "Polypectomy"],
        ["dc",                      "D&C"],
        ["endometrial_ablation",    "Endometrial ablation"],
        ["tubal_ligation",          "Tubal ligation"],
    ];
    const past = [];
    for (const [key, label] of PROCS) {
        if (s7[key] === true || s7[`gyn_${key}`] === true) {
            const year = s7[`${key}_year`] || s7[`gyn_${key}_year`] || null;
            past.push({ label, year });
        }
    }
    const other = String(s7.other_surgery || "").trim();
    if (other) past.push({ label: `Other: ${other}`, year: s7.other_surgery_year || null });
    const findings = String(s7.findings_text || s7.other_findings || "").trim();
    return { count: past.length, items: past, findings_text: findings || null };
}


// §11.6 section 12 — Medical History & ERAS Perioperative Considerations.
// Surface ONLY positives so the briefing stays terse.
function _shapeMedicalHistory(s12) {
    if (!s12) return null;
    const ERAS_FLAGS = [
        ["eras_anemia",             "Anemia",                 "anemia_hgb"],
        ["eras_sleep_apnea",        "Sleep apnea",            "cpap_use"],
        ["eras_smoking",            "Active smoking",         "smoking_ppd"],
        ["eras_diabetes",           "Diabetes",               "hba1c_pct"],
        ["eras_bmi40",              "BMI > 40",               "current_weight_lbs"],
        ["eras_bleeding_disorder",  "Bleeding disorder",      null],
        ["eras_dvt_pe",             "Prior DVT / PE",         "dvt_pe_year"],
        ["eras_cardiac",            "Cardiac disease",        "cardiac_type"],
        ["eras_ckd",                "Chronic kidney disease", "creatinine"],
        ["eras_latex_allergy",      "Latex/anesthesia allergy", null],
    ];
    const eras_positives = [];
    for (const [flag, label, detailField] of ERAS_FLAGS) {
        if (s12[flag] === true) {
            eras_positives.push({
                label,
                detail: detailField ? (s12[detailField] || null) : null,
            });
        }
    }

    // Critical perioperative meds — GLP-1 anesthesia-hold protocol.
    const GLP1_FLAGS = ["glp1_ozempic", "glp1_wegovy", "glp1_mounjaro",
                        "glp1_saxenda", "glp1_other"];
    const glp1 = GLP1_FLAGS.filter((k) => s12[k] === true)
        .map((k) => ({
            drug: k.replace("glp1_", ""),
            last_dose_date: s12[`${k}_last_dose`] || s12.glp1_last_dose_date || null,
        }));

    // Anticoagulants
    const BLOOD_THINNERS = ["bt_asa", "bt_plavix", "bt_coumadin", "bt_eliquis",
                            "bt_xarelto", "bt_other"];
    const anticoagulants = BLOOD_THINNERS.filter((k) => s12[k] === true)
        .map((k) => k.replace("bt_", ""));

    // Hormone therapy
    const HT_FLAGS = ["ht_bcp", "ht_hrt", "ht_tamoxifen", "ht_lupron", "ht_progesterone"];
    const hormone_tx = HT_FLAGS.filter((k) => s12[k] === true)
        .map((k) => k.replace("ht_", ""));

    // Other medical conditions
    const MED_CONDS = [
        ["med_htn",                "HTN"],
        ["med_asthma_copd",        "Asthma / COPD"],
        ["med_thyroid",            "Thyroid disease"],
        ["med_autoimmune",         "Autoimmune"],
        ["med_migraines",          "Migraines"],
        ["med_depression_anxiety", "Depression / anxiety"],
    ];
    const conditions = MED_CONDS.filter(([k]) => s12[k] === true).map(([, l]) => l);

    // Gyn-specific conditions
    const GYN_CONDS = [
        ["gyn_endometriosis", "Confirmed endometriosis"],
        ["gyn_pcos",           "PCOS"],
        ["gyn_adenomyosis",    "Adenomyosis"],
        ["gyn_cpp",            "Chronic pelvic pain"],
        ["gyn_ic",             "Interstitial cystitis"],
        ["gyn_vulvodynia",     "Vulvodynia"],
    ];
    const gyn_conditions = GYN_CONDS.filter(([k]) => s12[k] === true).map(([, l]) => l);

    return {
        eras_positives,
        glp1_use: glp1,                 // [] if none
        anticoagulants,                 // [] if none
        hormone_tx,                     // [] if none
        other_conditions: conditions,
        gyn_conditions,
    };
}


function _shapeMedications(s13) {
    if (!s13) return null;
    const pain = String(s13.pain_meds || s13.pain_meds_text || "").trim();
    const contraceptives = String(s13.contraceptives || s13.contraceptives_text || "").trim();
    const other = String(s13.other_meds || s13.other_meds_text || "").trim();
    return {
        pain_meds: pain || null,
        contraceptives_hormones: contraceptives || null,
        other_meds: other || null,
    };
}


function _shapeAllergies(s14) {
    if (!s14) return null;
    const drug = !!s14.drug_allergies;
    const latex = !!s14.latex_allergy;
    const list = String(s14.allergy_list || s14.allergies_text || "").trim();
    return {
        has_drug_allergies: drug,
        has_latex_allergy: latex,
        list: list || null,
    };
}


function _shapeImaging(s10) {
    if (!s10) return null;
    return {
        tvus_date: s10.tvus_date || null,
        endometrial_thickness_mm: s10.endometrial_thickness_mm || null,
        fibroid_count: s10.fibroid_count || null,
        largest_fibroid_size_cm: s10.largest_fibroid_size_cm || null,
        had_pelvic_mri: !!s10.had_pelvic_mri,
        pelvic_mri_date: s10.pelvic_mri_date || null,
        had_ct_abd_pelvis: !!s10.had_ct_abd_pelvis,
        ct_date: s10.ct_date || null,
        had_sonohysterography: !!s10.had_sonohysterography,
        sis_date: s10.sis_date || null,
        had_hsg: !!s10.had_hsg,
        hsg_date: s10.hsg_date || null,
    };
}


async function loadUploadedDocuments(env, patientId) {
    // Returns metadata only — no decryption. Briefing UI offers a deep-link
    // per doc; full body decryption happens on click.
    try {
        const { results } = await env.DB.prepare(`
            SELECT id, kind, original_filename, content_type, size_bytes,
                   uploaded_at, source
            FROM documents
            WHERE patient_id = ?
            ORDER BY uploaded_at DESC
            LIMIT 30
        `).bind(patientId).all();
        return results || [];
    } catch (e) {
        // Table may not exist if Phase 1 Round 3 hasn't been applied in this env.
        return [];
    }
}


async function loadRecentEncounters(env, patientId) {
    const { results } = await env.DB.prepare(`
        SELECT id, visit_date, visit_type_actual, chief_complaint,
               omt_codes_json, cpt_codes_json, icd10_codes_json
        FROM encounters
        WHERE patient_id = ?
        ORDER BY visit_date DESC
        LIMIT ?
    `).bind(patientId, RECENT_ENCOUNTER_LIMIT).all();
    return (results || []).map((e) => ({
        id: e.id,
        visit_date: e.visit_date,
        visit_type: e.visit_type_actual,
        chief_complaint: e.chief_complaint || null,
        omt_codes: safeJson(e.omt_codes_json) || [],
        cpt_codes: safeJson(e.cpt_codes_json) || [],
        icd10_codes: safeJson(e.icd10_codes_json) || [],
    }));
}


async function loadPROMTrends(env, patientId) {
    // Pull every response in the last 12 months, group by prom_slug,
    // surface latest + previous + direction.
    //
    // prom_responses.submitted_at is a TEXT timestamp (ISO 8601 from
    // SQLite's datetime('now')). Compute a string cutoff to compare.
    const cutoffMs = Date.now() - RECENT_PROM_WINDOW_MS;
    const cutoffISO = new Date(cutoffMs).toISOString()
        .replace("T", " ").replace(/\..*/, "");   // → "YYYY-MM-DD HH:MM:SS"
    const { results } = await env.DB.prepare(`
        SELECT pr.id AS response_id, pr.assignment_id, pr.prom_slug,
               pr.computed_scores, pr.threshold_flags, pr.submitted_at,
               pa.period_label, pa.assigned_by_kind,
               pd.short_name, pd.title, pd.tier, pd.domain
        FROM prom_responses pr
        JOIN prom_assignments pa ON pa.id = pr.assignment_id
        LEFT JOIN prom_definitions pd ON pd.slug = pr.prom_slug
        WHERE pr.patient_id = ? AND pr.submitted_at >= ?
        ORDER BY pr.prom_slug, pr.submitted_at DESC
    `).bind(patientId, cutoffISO).all();
    const rows = results || [];

    // Group by prom_slug
    const groups = new Map();
    for (const r of rows) {
        if (!groups.has(r.prom_slug)) groups.set(r.prom_slug, []);
        // Hydrate computed_scores JSON now so the comparison below is simple.
        const scores = safeJson(r.computed_scores) || {};
        groups.get(r.prom_slug).push({
            ...r,
            total_score: Number.isFinite(scores.total) ? scores.total : null,
            interpretation: scores.interpretation || null,
            subscales: scores.subscales || null,
            flags: safeJson(r.threshold_flags) || [],
        });
    }

    const trends = [];
    for (const [slug, list] of groups.entries()) {
        const latest = list[0];
        const previous = list[1] || null;
        const delta = (latest && previous && Number.isFinite(latest.total_score) && Number.isFinite(previous.total_score))
            ? latest.total_score - previous.total_score
            : null;
        trends.push({
            slug,
            short_name: latest.short_name || slug.toUpperCase(),
            title: latest.title || slug,
            tier: latest.tier,
            domain: latest.domain,
            latest_score: latest.total_score,
            latest_interpretation: latest.interpretation,
            latest_subscales: latest.subscales,
            latest_flags: latest.flags,
            latest_submitted_at: latest.submitted_at,
            latest_period: latest.period_label,
            previous_score: previous ? previous.total_score : null,
            previous_submitted_at: previous ? previous.submitted_at : null,
            delta,
            direction: delta == null ? null : (delta < 0 ? "improved" : delta > 0 ? "worsened" : "stable"),
            total_completions: list.length,
        });
    }
    // Tier 1 (universal) first, then most-recent first.
    trends.sort((a, b) => {
        if ((a.tier || 9) !== (b.tier || 9)) return (a.tier || 9) - (b.tier || 9);
        const at = a.latest_submitted_at || "";
        const bt = b.latest_submitted_at || "";
        return bt.localeCompare(at);
    });
    return trends;
}


async function loadCurrentSnapshot(env, patientId) {
    // Returns the most-recent is_current=1 snapshot's clinical_overview +
    // problem list + action items. We do NOT re-decrypt the full snapshot
    // body here — the briefing widget can deep-link to /admin/snapshots/<id>
    // for the full document.
    const snapshot = await env.DB.prepare(`
        SELECT id, version_number, is_current,
               clinical_overview, chief_complaint, cc_history,
               narrative_patient_story, dominant_category,
               patient_goals_json, surgical_history_json, ai_recommendations_json,
               generated_at, change_notes
        FROM patient_snapshots
        WHERE patient_id = ? AND is_current = 1
        ORDER BY version_number DESC
        LIMIT 1
    `).bind(patientId).first();
    if (!snapshot) return null;

    const [pR, aR] = await Promise.all([
        env.DB.prepare(`
            SELECT problem, status, last_visit_plan, seq
            FROM snapshot_problem_list
            WHERE snapshot_id = ?
            ORDER BY seq ASC
            LIMIT 12
        `).bind(snapshot.id).all(),
        env.DB.prepare(`
            SELECT description, due_date, priority, rationale, is_accepted, seq
            FROM snapshot_action_items
            WHERE snapshot_id = ?
            ORDER BY seq ASC
            LIMIT 8
        `).bind(snapshot.id).all(),
    ]);

    const problems = pR.results || [];
    const actions = aR.results || [];

    return {
        id: snapshot.id,
        version_number: snapshot.version_number,
        executive_summary: snapshot.clinical_overview || null,
        narrative_summary: snapshot.narrative_patient_story || null,
        chief_complaint: snapshot.chief_complaint || null,
        cc_history: snapshot.cc_history || null,
        dominant_category: snapshot.dominant_category || null,
        patient_goals: safeJson(snapshot.patient_goals_json) || [],
        surgical_history: safeJson(snapshot.surgical_history_json) || [],
        ai_recommendations: safeJson(snapshot.ai_recommendations_json) || [],
        problem_count: problems.length,
        action_item_count: actions.length,
        generated_at: snapshot.generated_at,
        problems_preview: problems.map((p) => ({
            label: p.problem,
            status: p.status,
            last_visit_plan: p.last_visit_plan,
            seq: p.seq,
        })),
        action_items_preview: actions.map((a) => ({
            label: a.description,
            due_date: a.due_date,
            priority: a.priority,
            rationale: a.rationale,
            is_accepted: !!a.is_accepted,
            seq: a.seq,
        })),
    };
}


async function loadPersonalNotes(env, patientId) {
    const { results } = await env.DB.prepare(`
        SELECT id, category, summary, body_r2_key, body_wrapped_dek,
               is_pinned, body_size_bytes, created_at, updated_at
        FROM patient_personal_notes
        WHERE patient_id = ?
        ORDER BY is_pinned DESC, updated_at DESC
        LIMIT 20
    `).bind(patientId).all();
    const rows = results || [];
    const out = [];
    for (const r of rows) {
        let body = "";
        try {
            const aad = `patient-personal-note/${patientId}/${r.id}`;
            const bytes = await getPhiObject(env, r.body_r2_key, r.body_wrapped_dek, aad);
            if (bytes) body = new TextDecoder().decode(bytes);
        } catch (e) {
            body = `[decrypt failed: ${(e.message || e).toString().slice(0, 60)}]`;
        }
        out.push({
            id: r.id,
            category: r.category,
            summary: r.summary || "",
            body,
            is_pinned: !!r.is_pinned,
            created_at: r.created_at,
            updated_at: r.updated_at,
        });
    }
    return out;
}


async function loadAppointmentContext(env, patientId, focusAppointmentId) {
    const now = Date.now();
    const lookbackCutoff = now - APPT_CONTEXT_WINDOW_MS;
    const lookaheadCutoff = now + APPT_CONTEXT_WINDOW_MS;

    // Focused appointment (if caller specified one)
    let focused = null;
    if (focusAppointmentId) {
        const a = await env.DB.prepare(`
            SELECT id, visit_type, starts_at, ends_at, duration_min, modality,
                   status, chief_complaint_summary, doxy_room_url, triage_id
            FROM appointments
            WHERE id = ? AND patient_id = ?
        `).bind(focusAppointmentId, patientId).first();
        if (a) focused = a;
    }

    // Last 3 completed
    const last = await env.DB.prepare(`
        SELECT id, visit_type, starts_at, ends_at, modality, status, chief_complaint_summary
        FROM appointments
        WHERE patient_id = ? AND status = 'completed' AND starts_at >= ?
        ORDER BY starts_at DESC
        LIMIT 3
    `).bind(patientId, lookbackCutoff).all();

    // Next 3 scheduled
    const next = await env.DB.prepare(`
        SELECT id, visit_type, starts_at, ends_at, modality, status, chief_complaint_summary, doxy_room_url
        FROM appointments
        WHERE patient_id = ? AND status = 'scheduled' AND starts_at >= ? AND starts_at <= ?
        ORDER BY starts_at ASC
        LIMIT 3
    `).bind(patientId, now, lookaheadCutoff).all();

    return {
        focused,
        recent_completed: last.results || [],
        upcoming_scheduled: next.results || [],
    };
}


// ---------------------------------------------------------------------
// Heuristic narrative composition (no LLM, no PHI leaves the Worker)
// ---------------------------------------------------------------------

function composeExecutiveLede(header, snapshot, triage, prom_trends, personal_notes, focused_appt,
                              obstetric_history, medical_history) {
    const parts = [];
    const greet = header.nickname
        ? `${header.nickname} (${header.full_name})`
        : (header.preferred_name || header.first_name || "Patient");
    let lede = `${greet}${header.age ? `, ${header.age}` : ""}${header.pronouns ? ` (${header.pronouns})` : ""}`;

    // G/P fragment if obstetric data is available — e.g. "G2P1011"-style
    // simplified: G<total>, <para_living> living.
    if (obstetric_history && (obstetric_history.gravida || obstetric_history.para_living)) {
        const gp = `G${obstetric_history.gravida || 0}P${obstetric_history.para_living || 0}`;
        lede += `, ${gp}`;
    }

    if (focused_appt) {
        const dt = new Date(focused_appt.starts_at);
        const date = dt.toLocaleString("en-US", {
            weekday: "short", month: "short", day: "numeric",
            hour: "numeric", minute: "2-digit",
        });
        lede += ` — ${focused_appt.modality === "telehealth" ? "telehealth" : "in-person"} ${focused_appt.visit_type} at ${date}`;
    }
    parts.push(lede + ".");

    if (focused_appt && focused_appt.chief_complaint_summary) {
        parts.push(`Today's chief complaint: ${focused_appt.chief_complaint_summary}.`);
    } else if (triage && triage.rationale) {
        parts.push(`Triage rationale: ${triage.rationale}.`);
    }

    // Surface ERAS / perioperative red flags loudly — they're the items
    // that change clinical management. GLP-1 last-dose, anticoagulants,
    // anemia, prior DVT/PE all qualify.
    if (medical_history) {
        const flags = [];
        if (medical_history.glp1_use?.length) {
            const drugs = medical_history.glp1_use.map((g) =>
                g.last_dose_date ? `${g.drug} (last ${g.last_dose_date})` : g.drug
            ).join(", ");
            flags.push(`GLP-1 use: ${drugs} — anesthesia-hold protocol applies if surgery soon`);
        }
        if (medical_history.anticoagulants?.length) {
            flags.push(`On anticoagulant(s): ${medical_history.anticoagulants.join(", ")}`);
        }
        const erasPositives = (medical_history.eras_positives || [])
            .filter((p) => /anemia|sleep apnea|bmi|dvt|cardiac|ckd/i.test(p.label));
        if (erasPositives.length) {
            flags.push(`ERAS positives: ${erasPositives.map((p) => p.label).join(", ")}`);
        }
        if (flags.length) parts.push(flags.join("; ") + ".");
    }

    if (snapshot && snapshot.executive_summary) {
        parts.push(snapshot.executive_summary);
    } else if (snapshot && snapshot.problem_count) {
        parts.push(`${snapshot.problem_count} active problem${snapshot.problem_count === 1 ? "" : "s"} on the most-recent snapshot.`);
    }

    const concerningProms = prom_trends.filter(
        (p) => p.direction === "worsened" && p.tier === 1
    ).slice(0, 2);
    if (concerningProms.length) {
        const lines = concerningProms.map(
            (p) => `${p.short_name} ${p.previous_score}→${p.latest_score}`
        );
        parts.push(`PROM trend to watch: ${lines.join(", ")}.`);
    }

    const pinnedPersonal = personal_notes.find((n) => n.is_pinned && n.category === "personal");
    if (pinnedPersonal && pinnedPersonal.summary) {
        parts.push(`Personal touchpoint: ${pinnedPersonal.summary}.`);
    }

    return parts.join(" ");
}


function composeSuggestedQuestions(snapshot, triage, prom_trends, care_goals, focused_appt) {
    const out = [];

    // From the snapshot's open action items
    if (snapshot && snapshot.action_items_preview) {
        for (const a of snapshot.action_items_preview.slice(0, 3)) {
            // Action items don't have a status column; we surface anything
            // accepted by the clinician that isn't trivially resolved.
            if (a.is_accepted) {
                out.push(`Follow up on: ${a.label}`);
            }
        }
    }

    // From PROM deteriorations
    for (const p of prom_trends) {
        if (p.direction === "worsened" && p.tier === 1) {
            out.push(`Probe the ${p.short_name} jump (${p.previous_score}→${p.latest_score}) — what changed since last visit?`);
        }
    }

    // From the triage rationale
    if (triage && triage.secondary_concerns && triage.secondary_concerns.length) {
        out.push(`Cover triage's secondary concern(s): ${triage.secondary_concerns.slice(0, 3).join(", ")}.`);
    }

    // From care goals
    if (care_goals && Array.isArray(care_goals.goals) && care_goals.goals.length) {
        out.push(`Where are we vs. their stated goal: "${care_goals.goals[0]}"?`);
    }

    return out.slice(0, 6);
}


function composeWatchFor(prom_trends, snapshot, care_goals, medical_history) {
    const items = [];

    // Worsening PROMs
    for (const p of prom_trends) {
        if (p.direction === "worsened" && p.delta != null && p.delta >= 3) {
            items.push({
                kind: "prom_worsened",
                label: `${p.short_name} ${p.previous_score}→${p.latest_score} (Δ +${p.delta})`,
                severity: p.tier === 1 ? "high" : "moderate",
            });
        }
    }
    // Snapshot problems flagged as active (snapshot schema doesn't have a
    // severity column — we use status === 'active' as the surface signal).
    if (snapshot && snapshot.problems_preview) {
        for (const pr of snapshot.problems_preview) {
            if (String(pr.status || "").toLowerCase() === "active") {
                items.push({
                    kind: "active_problem",
                    label: pr.label,
                    severity: "active",
                });
            }
        }
    }
    // Care-goal explicit avoidances
    if (care_goals && Array.isArray(care_goals.avoid) && care_goals.avoid.length) {
        for (const a of care_goals.avoid) {
            items.push({ kind: "patient_avoid", label: a, severity: "preference" });
        }
    }
    // Phase 14 Round B+ — perioperative red flags from intake Section 12.
    if (medical_history) {
        if (medical_history.glp1_use?.length) {
            for (const g of medical_history.glp1_use) {
                items.push({
                    kind: "perioperative_glp1",
                    label: `GLP-1 use: ${g.drug}${g.last_dose_date ? ` — last dose ${g.last_dose_date}` : ""} (ASA hold: 1 wk daily, 2 wk weekly)`,
                    severity: "high",
                });
            }
        }
        if (medical_history.anticoagulants?.length) {
            items.push({
                kind: "perioperative_anticoag",
                label: `Anticoagulant: ${medical_history.anticoagulants.join(", ")} — pre-op hold timing required`,
                severity: "high",
            });
        }
        for (const p of (medical_history.eras_positives || [])) {
            if (/anemia|dvt|cardiac|ckd|bleeding/i.test(p.label)) {
                items.push({
                    kind: "eras_flag",
                    label: p.detail ? `${p.label} (${p.detail})` : p.label,
                    severity: "moderate",
                });
            }
        }
    }
    return items.slice(0, 12);
}


// ---------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------

/**
 * Build a full pre-visit briefing for a single patient.
 * @param {object} env — CF Pages env (DB, PHI bindings)
 * @param {string} patientId
 * @param {object} [opts]
 * @param {string} [opts.appointment_id] — focus the briefing on a specific appointment
 * @returns {Promise<object|null>}
 */
export async function buildPatientBriefing(env, patientId, opts = {}) {
    const header = await loadPatientHeader(env, patientId);
    if (!header) return null;

    // Phase 15 — med AE check is expensive (one openFDA fetch per drug).
    // Default ON for the single-patient endpoint, OFF for batch day-window
    // briefings (caller passes include_med_watch=false).
    const includeMedWatch = opts.include_med_watch !== false;

    const [intake, encounters, prom_trends, snapshot, personal_notes, appts, documents] =
        await Promise.all([
            loadLatestIntake(env, patientId),
            loadRecentEncounters(env, patientId),
            loadPROMTrends(env, patientId),
            loadCurrentSnapshot(env, patientId),
            loadPersonalNotes(env, patientId),
            loadAppointmentContext(env, patientId, opts.appointment_id || null),
            loadUploadedDocuments(env, patientId),
        ]);
    // Triage is reverse-linked: appointment_triage.intake_id → intake_responses.id
    const triage = intake ? await loadIntakeTriage(env, intake.id) : null;

    // Phase 14 Round B+ — load + reshape intake sections 4/7/8/10/12/13/14
    // into briefing-friendly structures. Sections the patient hasn't yet
    // filled return null so the UI can show "(not yet captured)".
    const sectionData = intake ? await loadIntakeSectionData(env, intake.id) : {};
    const obstetric_history   = _shapeObstetric(sectionData[8]?.data);
    const past_surgeries      = _shapePastSurgeries(sectionData[7]?.data);
    const medical_history     = _shapeMedicalHistory(sectionData[12]?.data);
    const current_medications = _shapeMedications(sectionData[13]?.data);
    const allergies           = _shapeAllergies(sectionData[14]?.data);
    const imaging_summary     = _shapeImaging(sectionData[10]?.data);

    const focused = appts.focused || null;

    const out = {
        patient: header,
        appointment_focus: focused,
        appointments_context: {
            recent_completed: appts.recent_completed,
            upcoming_scheduled: appts.upcoming_scheduled,
        },
        executive_lede: composeExecutiveLede(
            header, snapshot, triage, prom_trends, personal_notes, focused,
            obstetric_history, medical_history
        ),
        intake_summary: intake,
        triage,
        snapshot_summary: snapshot,
        recent_encounters: encounters,
        prom_trends,
        personal_touchpoints: personal_notes.filter((n) => n.is_pinned || n.category === "personal"),
        all_personal_notes: personal_notes,
        care_goals: header.care_goals,
        // New Phase 14 Round B+ intake-sourced sections
        obstetric_history,
        past_surgeries,
        medical_history,
        current_medications,
        allergies,
        imaging_summary,
        uploaded_documents: documents,
        watch_for: composeWatchFor(prom_trends, snapshot, header.care_goals, medical_history),
        suggested_questions: composeSuggestedQuestions(snapshot, triage, prom_trends, header.care_goals, focused),
        generated_at: Date.now(),
    };

    // Phase 15 — medication AE / SE watch via openFDA (§3.6).
    // Runs last because it needs the rest of the briefing to tokenize
    // patient symptoms. Failure NEVER fails the briefing.
    if (includeMedWatch) {
        try {
            const aeReport = await buildMedicationWatch(env, out);
            out.medication_watch = aeReport.watch;
            out.medication_watch_manifest = aeReport.manifest;
            // Surface high-confidence matches into the executive lede when
            // any drug has at least one high-confidence symptom match.
            const hot = (aeReport.watch || []).filter((w) => w.high_confidence_count > 0);
            if (hot.length) {
                const labels = hot.map((w) =>
                    `${w.drug} (${w.matches[0].matched_tokens[0]})`
                ).slice(0, 3).join(", ");
                out.executive_lede +=
                    ` Med-AE candidate match: ${labels}.`;
            }
        } catch (e) {
            out.medication_watch = [];
            out.medication_watch_manifest = {
                error: String(e.message || e).slice(0, 200),
                generated_at: Date.now(),
            };
        }
    }

    return out;
}


/**
 * Build briefings for every patient with an appointment in the given window.
 *
 * @param {object} env
 * @param {object} opts
 * @param {number} opts.starts_at_min  — ms epoch (inclusive)
 * @param {number} opts.starts_at_max  — ms epoch (exclusive)
 * @param {string} [opts.clinician_id]
 * @returns {Promise<Array<object>>}
 */
export async function buildScheduleBriefings(env, opts) {
    const binds = [];
    let q = `
        SELECT a.id AS appointment_id, a.patient_id, a.visit_type, a.starts_at,
               a.ends_at, a.duration_min, a.modality, a.status,
               a.chief_complaint_summary, a.doxy_room_url
        FROM appointments a
        WHERE a.starts_at >= ? AND a.starts_at < ?
          AND a.status IN ('scheduled', 'completed')
    `;
    binds.push(opts.starts_at_min, opts.starts_at_max);
    if (opts.clinician_id) {
        q += ` AND a.clinician_id = ?`;
        binds.push(opts.clinician_id);
    }
    q += ` ORDER BY a.starts_at ASC`;

    const { results } = await env.DB.prepare(q).bind(...binds).all();
    const appts = results || [];

    // Dedupe: if the same patient appears in two appointments within the window
    // (e.g. half-day morning + afternoon), we build one briefing focused on
    // the EARLIEST appointment but list both in the schedule sidebar.
    const seen = new Set();
    const briefings = [];
    for (const a of appts) {
        if (seen.has(a.patient_id)) continue;
        seen.add(a.patient_id);
        const briefing = await buildPatientBriefing(env, a.patient_id, {
            appointment_id: a.appointment_id,
            // Day-window briefings skip the med watch by default — too many
            // openFDA calls per render. The single-patient endpoint runs it.
            include_med_watch: opts.include_med_watch === true,
        });
        if (briefing) briefings.push(briefing);
    }

    return {
        window: { starts_at_min: opts.starts_at_min, starts_at_max: opts.starts_at_max },
        appointments: appts,            // raw appointment list for the schedule rail
        briefings,                       // per-unique-patient briefings, in schedule order
        generated_at: Date.now(),
    };
}
