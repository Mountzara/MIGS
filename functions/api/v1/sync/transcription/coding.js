// =====================================================================
// POST /api/v1/sync/transcription/coding — Transcription app -> website
// =====================================================================
// Per CLAUDE.md §11 Tier 5 + Phase 8 Round A. The MountZaraMedicalTranscription
// macOS app calls this endpoint with the CodingAnalysis output produced by
// CodingService.analyzeForCoding() — E/M code suggestion, ICD-10 + CPT lines,
// modifiers, wRVU, compliance flags, upcoding opportunities, documentation
// suggestions, and the 1995/1997 CMS documentation audit.
//
// We persist:
//   * One billing_claims row (status='pending_review' by default).
//   * N billing_claim_lines (one per CPT/HCPCS line, plus the E/M line).
//   * M billing_claim_diagnoses (one per ICD-10).
//   * Every compliance_flag, upcoding_opportunity, doc_suggestion.
//   * One billing_audit_log row recording the claim creation event.
//
// Idempotency rule: (patient_id, source_session_id) is unique. If a claim
// already exists for the same transcription session AND status is still
// 'pending_review', the new payload REPLACES the existing one (clinician
// hadn't started reviewing yet, so re-running the AI is non-destructive).
// If the existing claim is already past pending_review (edited / approved /
// submitted / etc.), we return 409 — the clinician's review-in-progress
// state is sacrosanct.
//
// Body (JSON) — matches the Swift CodingAnalysis serialization:
//   {
//     patient_id:                    required (resolved via /sync/patients/lookup)
//     source_session_id:             required (transcription_session_id)
//     encounter_id:                  optional (FK if already synced)
//     appointment_id:                optional
//     visit_date:                    required (YYYY-MM-DD)
//     visit_type:                    optional (matches §11.7.1 catalog)
//     payer_id:                      optional (FK billing_payers.id)
//
//     em: {
//       code:                "99214",
//       mdm_level:           "moderate",
//       wRVU:                1.50,
//       confidence:          0.86,
//       ai_rationale:        "...",
//       supporting_evidence: [string, string, ...],
//       alternatives_considered: [{ code, reason_not_chosen, wrvu }, ...]
//     },
//
//     diagnoses: [
//       {
//         icd10_code: "N80.9",
//         description: "Endometriosis, unspecified",
//         confidence: 0.92,
//         ai_rationale: "...",
//         supporting_evidence: [..],
//         sequence_number: 1
//       }, ...
//     ],
//
//     procedures: [
//       {
//         code_type: "cpt" | "hcpcs",
//         code: "58662",
//         description: "Laparoscopy, surgical; with fulguration or excision of lesions",
//         modifier_1: "LT",
//         modifier_2: null, modifier_3: null, modifier_4: null,
//         modifier_rationale: "Laterality — left adnexal endo lesion",
//         units: 1, minutes: null,
//         place_of_service: "22",
//         diagnosis_pointers: "1,2",
//         confidence: 0.81,
//         wrvu: 17.31,
//         ai_rationale: "...",
//         supporting_evidence: [..],
//         alternatives_considered: [..],
//         charge_cents: 182550,
//         expected_cents: 137250
//       }, ...
//     ],
//
//     compliance: {
//       status: "compliant" | "warnings" | "errors",
//       medico_legal_score: 87,
//       em_documentation_audit: { ...1995/1997 CMS object... },
//       flags: [
//         { severity, kind, title, description, referenced_code, suggested_fix }, ...
//       ]
//     },
//
//     upcoding_opportunities: [
//       { current_code, potential_code, wrvu_delta, revenue_delta_cents,
//         required_documentation, confidence, rationale }, ...
//     ],
//
//     documentation_suggestions: [
//       { priority, section, issue, suggestion, original_text, revised_text,
//         revenue_impact }, ...
//     ],
//
//     totals: {
//       total_wrvu: 18.81,
//       total_charge_cents: 198650,
//       expected_collection_cents: 152340
//     },
//
//     ai_meta: {
//       model: "claude-opus-4-6",
//       prompt_version: "coding-v3.2",
//       compliance_metrics: { field_completeness: 0.97, ... }
//     }
//   }
//
// Response (201): { ok: true, claim_id, replaced_prior_pending: bool }
// Response (409): { error: "claim_already_in_review", existing_claim_id, status }
// Auth: Bearer TRANSCRIPTION_SYNC_TOKEN.
// =====================================================================

import { syncRoute, syncJson, syncError } from "../../../../_lib/sync_auth.js";
import { logAudit } from "../../../../_lib/audit.js";
import { newId } from "../../../../_lib/db.js";

const APP = "transcription";

// Hard caps to keep one claim from blowing up the row size.
const MAX_LINES         = 64;
const MAX_DIAGNOSES     = 12;   // 837P HI segment maximum
const MAX_FLAGS         = 64;
const MAX_UPCODING      = 32;
const MAX_DOC_SUGG      = 32;
const MAX_STR_SHORT     = 256;
const MAX_STR_MED       = 1024;
const MAX_STR_LONG      = 8 * 1024;
const MAX_JSON_PER_FIELD = 16 * 1024;

function isDate(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function s(v, max = MAX_STR_MED) {
    if (v == null) return null;
    const str = String(v);
    return str.length > max ? str.slice(0, max) : str;
}
function num(v, def = null) {
    if (v == null) return def;
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
}
function int(v, def = null) {
    if (v == null) return def;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : def;
}
function jsonField(v, max = MAX_JSON_PER_FIELD) {
    if (v == null) return null;
    try {
        const out = JSON.stringify(v);
        return out.length > max ? null : out;
    } catch { return null; }
}

export async function onRequestPost(ctx) {
    return syncRoute(ctx, APP, async ({ env, request }) => {
        let body;
        try { body = await request.json(); } catch { return syncError("invalid_json_body", 400); }

        const patient_id        = s(body.patient_id, 64);
        const source_session_id = s(body.source_session_id, 128);
        const encounter_id      = s(body.encounter_id, 64);
        const appointment_id    = s(body.appointment_id, 64);
        const visit_date        = s(body.visit_date, 10);
        const visit_type        = s(body.visit_type, 64);
        const payer_id          = s(body.payer_id, 64);

        if (!patient_id)        return syncError("missing_patient_id", 400);
        if (!source_session_id) return syncError("missing_source_session_id", 400);
        if (!isDate(visit_date)) return syncError("invalid_visit_date", 400, { format: "YYYY-MM-DD" });

        // Confirm patient exists.
        const patient = await env.DB.prepare(`SELECT id FROM patients WHERE id = ?`).bind(patient_id).first();
        if (!patient) return syncError("patient_not_found", 404);

        // Confirm payer if provided.
        if (payer_id) {
            const payer = await env.DB.prepare(`SELECT id FROM billing_payers WHERE id = ?`).bind(payer_id).first();
            if (!payer) return syncError("payer_not_found", 404, { payer_id });
        }

        // Idempotency: replace pending_review, otherwise 409.
        const existing = await env.DB.prepare(`
            SELECT id, status FROM billing_claims
            WHERE patient_id = ? AND source_session_id = ?
            ORDER BY created_at DESC
            LIMIT 1
        `).bind(patient_id, source_session_id).first();

        let replaced_prior_pending = false;
        if (existing) {
            if (existing.status !== "pending_review") {
                return syncError("claim_already_in_review", 409, {
                    existing_claim_id: existing.id,
                    status: existing.status,
                });
            }
            // Soft-delete child rows + the existing claim, then re-insert.
            // (No ON DELETE CASCADE on D1; do it explicitly.)
            await env.DB.batch([
                env.DB.prepare(`DELETE FROM billing_documentation_suggestions WHERE claim_id = ?`).bind(existing.id),
                env.DB.prepare(`DELETE FROM billing_upcoding_opportunities    WHERE claim_id = ?`).bind(existing.id),
                env.DB.prepare(`DELETE FROM billing_compliance_flags          WHERE claim_id = ?`).bind(existing.id),
                env.DB.prepare(`DELETE FROM billing_claim_diagnoses           WHERE claim_id = ?`).bind(existing.id),
                env.DB.prepare(`DELETE FROM billing_claim_lines               WHERE claim_id = ?`).bind(existing.id),
                env.DB.prepare(`DELETE FROM billing_claims                    WHERE id = ?`).bind(existing.id),
            ]);
            replaced_prior_pending = true;
        }

        // ---- E/M ----
        const em = body.em || {};
        const em_code        = s(em.code, 16);
        const em_mdm_level   = s(em.mdm_level, 32);
        const em_wrvu        = num(em.wRVU ?? em.wrvu);
        const em_confidence  = num(em.confidence);

        // ---- Totals ----
        const totals = body.totals || {};
        const total_wrvu               = num(totals.total_wrvu, 0);
        const total_charge_cents       = int(totals.total_charge_cents, 0);
        // The app sends the code and the wRVU but not always a dollar
        // figure, which left real claims sitting at $0 and every billing
        // KPI understating the practice. If it did not send one, price the
        // E/M code from the practice's OWN service catalog. Never invented:
        // absent a catalog entry it stays 0, which is visibly missing
        // rather than quietly wrong.
        let expected_collection_cents = int(totals.expected_collection_cents, 0);
        let expected_from_catalog = false;
        if (!expected_collection_cents) {
            // The catalog is keyed by the practice's own visit types
            // (`visit_type_key` — 'aub_evaluation', 'postop_early', …), NOT
            // by CPT, so the E/M code alone cannot price a visit. Match the
            // visit type the app sent. Absent a match the figure stays 0,
            // which reads as missing rather than as a wrong number — a
            // silently invented price on a real claim is worse than none.
            const vt = s(body.visit_type || body.visit_type_actual, 64);
            try {
                const alias = await import("../../../../_lib/visit_type_alias.js");
                const cat = await env.DB.prepare(
                    `SELECT visit_type_key, default_unit_price_cents FROM billing_service_catalog
                      WHERE is_active = 1 AND visit_type_key IS NOT NULL`).all();
                const rows = cat?.results || [];
                const keys = rows.map((r) => r.visit_type_key);
                // The app speaks in labels ("Problem Visit"); the catalog is
                // keyed by slug. Try the label, then its alias, then the E/M
                // code as a coarse floor — and record WHICH, so a fallback
                // price is never mistaken for the app's own figure.
                let hit = alias.toCatalogKey(vt, keys);
                if (!hit.key) hit = alias.fromEmCode(em_code, keys);
                if (hit.key) {
                    const row = rows.find((r) => r.visit_type_key === hit.key);
                    if (row && row.default_unit_price_cents > 0) {
                        expected_collection_cents = Number(row.default_unit_price_cents);
                        expected_from_catalog = hit.via;
                    }
                }
            } catch { /* leave it at 0 */ }
        }

        // ---- Compliance ----
        const compliance = body.compliance || {};
        const compliance_status        = s(compliance.status, 16);
        const medico_legal_score       = int(compliance.medico_legal_score);
        const em_documentation_audit_json = jsonField(compliance.em_documentation_audit);

        // ---- AI meta ----
        const ai_meta = body.ai_meta || {};
        const ai_model              = s(ai_meta.model, 64);
        const ai_prompt_version     = s(ai_meta.prompt_version, 64);
        const ai_compliance_metrics_json = jsonField(ai_meta.compliance_metrics);

        const claim_id = newId();
        const now = Date.now();

        // Insert the claim row first.
        await env.DB.prepare(`
            INSERT INTO billing_claims
                (id, patient_id, encounter_id, appointment_id, payer_id,
                 source_app, source_session_id, visit_date, visit_type,
                 em_code, em_mdm_level, em_wrvu, em_confidence,
                 total_wrvu, total_charge_cents, expected_collection_cents,
                 compliance_status, medico_legal_score, em_documentation_audit_json,
                 ai_model, ai_prompt_version, ai_compliance_metrics_json,
                 status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?,
                    ?, ?, ?, ?,
                    ?, ?, ?, ?,
                    ?, ?, ?,
                    ?, ?, ?,
                    ?, ?, ?,
                    'pending_review', ?, ?)
        `).bind(
            claim_id, patient_id, encounter_id, appointment_id, payer_id,
            APP, source_session_id, visit_date, visit_type,
            em_code, em_mdm_level, em_wrvu, em_confidence,
            total_wrvu, total_charge_cents, expected_collection_cents,
            compliance_status, medico_legal_score, em_documentation_audit_json,
            ai_model, ai_prompt_version, ai_compliance_metrics_json,
            now, now,
        ).run();

        // ---- Claim lines ----
        // First line is always the E/M (if provided).
        const lines = Array.isArray(body.procedures) ? body.procedures.slice(0, MAX_LINES) : [];
        const lineInserts = [];
        let lineNumber = 1;

        if (em_code) {
            lineInserts.push(env.DB.prepare(`
                INSERT INTO billing_claim_lines
                    (id, claim_id, line_number, code_type, code, code_description,
                     modifier_1, modifier_2, modifier_3, modifier_4, modifier_rationale,
                     units, minutes, place_of_service, diagnosis_pointers,
                     charge_cents, expected_cents, wrvu, confidence,
                     ai_rationale, supporting_evidence_json, alternatives_considered_json,
                     created_at)
                VALUES (?, ?, ?, 'em', ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
                newId(), claim_id, lineNumber++, em_code, s(em.description, MAX_STR_MED),
                s(em.modifier_1, 8), s(em.modifier_2, 8), s(em.modifier_3, 8), s(em.modifier_4, 8),
                s(em.modifier_rationale, MAX_STR_LONG),
                int(em.minutes), s(em.place_of_service, 4), s(em.diagnosis_pointers, 64),
                int(em.charge_cents), int(em.expected_cents), em_wrvu, em_confidence,
                s(em.ai_rationale, MAX_STR_LONG),
                jsonField(em.supporting_evidence),
                jsonField(em.alternatives_considered),
                now,
            ));
        }

        for (const ln of lines) {
            const code = s(ln.code, 16);
            if (!code) continue;
            lineInserts.push(env.DB.prepare(`
                INSERT INTO billing_claim_lines
                    (id, claim_id, line_number, code_type, code, code_description,
                     modifier_1, modifier_2, modifier_3, modifier_4, modifier_rationale,
                     units, minutes, place_of_service, diagnosis_pointers,
                     charge_cents, expected_cents, wrvu, confidence,
                     ai_rationale, supporting_evidence_json, alternatives_considered_json,
                     created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
                newId(), claim_id, lineNumber++,
                s(ln.code_type, 8) || "cpt", code, s(ln.description, MAX_STR_MED),
                s(ln.modifier_1, 8), s(ln.modifier_2, 8), s(ln.modifier_3, 8), s(ln.modifier_4, 8),
                s(ln.modifier_rationale, MAX_STR_LONG),
                int(ln.units, 1), int(ln.minutes),
                s(ln.place_of_service, 4), s(ln.diagnosis_pointers, 64),
                int(ln.charge_cents), int(ln.expected_cents), num(ln.wrvu), num(ln.confidence),
                s(ln.ai_rationale, MAX_STR_LONG),
                jsonField(ln.supporting_evidence),
                jsonField(ln.alternatives_considered),
                now,
            ));
        }

        // ---- Diagnoses ----
        const diagnoses = Array.isArray(body.diagnoses) ? body.diagnoses.slice(0, MAX_DIAGNOSES) : [];
        const dxInserts = [];
        let droppedDx = 0;
        diagnoses.forEach((dx, idx) => {
            // Three field spellings the app has plausibly used across
            // versions. A diagnosis dropped over a field name is a claim
            // every payer rejects.
            const icd10 = s(dx.icd10_code || dx.code || dx.icd10, 12);
            if (!icd10) { droppedDx++; return; }
            dxInserts.push(env.DB.prepare(`
                INSERT INTO billing_claim_diagnoses
                    (id, claim_id, diagnosis_index, icd10_code, icd10_description,
                     confidence, ai_rationale, supporting_evidence_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
                newId(), claim_id, int(dx.sequence_number, idx + 1),
                icd10, s(dx.description || dx.icd10_description, MAX_STR_MED),
                num(dx.confidence),
                s(dx.ai_rationale, MAX_STR_LONG),
                jsonField(dx.supporting_evidence),
                now,
            ));
        });

        // ---- Compliance flags ----
        const flags = Array.isArray(compliance.flags) ? compliance.flags.slice(0, MAX_FLAGS) : [];
        const flagInserts = flags.map((f) => env.DB.prepare(`
            INSERT INTO billing_compliance_flags
                (id, claim_id, severity, flag_kind, title, description,
                 referenced_code, suggested_fix, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
            newId(), claim_id,
            s(f.severity, 16) || "info",
            s(f.kind || f.flag_kind, 64) || "general",
            s(f.title, MAX_STR_SHORT) || "Compliance note",
            s(f.description, MAX_STR_LONG),
            s(f.referenced_code, 16),
            s(f.suggested_fix, MAX_STR_LONG),
            now,
        ));

        // ---- Upcoding opportunities ----
        const upcoding = Array.isArray(body.upcoding_opportunities) ? body.upcoding_opportunities.slice(0, MAX_UPCODING) : [];
        const upInserts = upcoding.map((u) => env.DB.prepare(`
            INSERT INTO billing_upcoding_opportunities
                (id, claim_id, current_code, potential_code, wrvu_delta,
                 revenue_delta_cents, required_documentation, confidence,
                 rationale, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
            newId(), claim_id,
            s(u.current_code, 16) || "",
            s(u.potential_code, 16) || "",
            num(u.wrvu_delta, 0),
            int(u.revenue_delta_cents),
            s(u.required_documentation, MAX_STR_LONG) || "",
            num(u.confidence),
            s(u.rationale, MAX_STR_LONG),
            now,
        ));

        // ---- Documentation suggestions ----
        const docSugg = Array.isArray(body.documentation_suggestions) ? body.documentation_suggestions.slice(0, MAX_DOC_SUGG) : [];
        const docInserts = docSugg.map((d) => env.DB.prepare(`
            INSERT INTO billing_documentation_suggestions
                (id, claim_id, priority, section, issue, suggestion,
                 original_text, revised_text, revenue_impact, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
            newId(), claim_id,
            s(d.priority, 8) || "medium",
            s(d.section, 8),
            s(d.issue, MAX_STR_LONG) || "",
            s(d.suggestion, MAX_STR_LONG) || "",
            s(d.original_text, MAX_STR_LONG),
            s(d.revised_text, MAX_STR_LONG),
            s(d.revenue_impact, MAX_STR_SHORT),
            now,
        ));

        // Batch the child inserts together for atomicity.
        const allChildInserts = [...lineInserts, ...dxInserts, ...flagInserts, ...upInserts, ...docInserts];
        if (allChildInserts.length > 0) {
            await env.DB.batch(allChildInserts);
        }

        // ---- Audit ----
        const audit_id = newId();
        await env.DB.prepare(`
            INSERT INTO billing_audit_log (id, claim_id, ts, actor_id, actor_role, action, details_json, ip, user_agent)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
            audit_id, claim_id, now,
            "transcription_app", "app",
            replaced_prior_pending ? "claim_replaced_pending" : "claim_created",
            JSON.stringify({
                source_session_id,
                em_code,
                lines: lineInserts.length,
                diagnoses: dxInserts.length,
                flags: flagInserts.length,
                upcoding_opportunities: upInserts.length,
                doc_suggestions: docInserts.length,
                replaced_prior_pending,
            }),
            request.headers.get("CF-Connecting-IP") || "",
            (request.headers.get("User-Agent") || "").slice(0, 256),
        ).run();

        // HIPAA audit_log row (general audit table, separate from billing_audit_log).
        await logAudit(env, {
            user_id: null, user_role: "app",
            action: "phi_write",
            record_type: "billing_claim",
            record_id: claim_id,
            ip: request.headers.get("CF-Connecting-IP") || "",
            user_agent: request.headers.get("User-Agent") || "",
            success: true,
            details: {
                app: APP,
                op: "transcription_coding_sync",
                patient_id,
                source_session_id,
                em_code,
                total_wrvu,
                total_charge_cents,
                compliance_status,
                medico_legal_score,
                replaced_prior_pending,
            },
        });

        return syncJson({
            ok: true,
            claim_id,
            replaced_prior_pending,
            lines_inserted: lineInserts.length,
            diagnoses_inserted: dxInserts.length,
            expected_collection_cents,
            // 'exact' | 'alias' | 'em_code' | false. These are the practice's
            // CASH prices: sound while every patient is self-pay, and to be
            // superseded by a contracted rate the moment a payer contract
            // exists. Never presented as a payer expectation.
            expected_priced_from: expected_from_catalog || null,
            expected_price_basis: expected_from_catalog ? "practice_cash_catalog" : null,
            pricing_note: expected_collection_cents ? undefined
                : "No expected collection: send totals.expected_collection_cents, or a visit_type matching the practice service catalog.",
            // Never let a drop be silent: a claim whose diagnoses were all
            // discarded still returned ok:true and looked synced. The app
            // must be able to SEE that its payload lost something.
            diagnoses_dropped: droppedDx,
            warning: droppedDx > 0
                ? `${droppedDx} diagnosis row(s) carried no recognizable code field (icd10_code/code/icd10) and were NOT stored`
                : undefined,
            flags_inserted: flagInserts.length,
            upcoding_inserted: upInserts.length,
            doc_suggestions_inserted: docInserts.length,
        }, { status: 201 });
    });
}
