// =====================================================================
// POST /api/v1/sync/clinical-ai/cases — MountZaraClinicalAI -> website
// =====================================================================
// Per CLAUDE.md §11 Tier 5. The Clinical AI batch pipeline calls this
// endpoint at the end of each per-case analysis run. Inputs are the
// generated AAGL / FMIGS / gold-standard report (already pre-rendered
// as PDF + HTML by the app) plus a structured JSON summary of the
// analysis.
//
// Idempotent on (patient_id, app_session_id).
//
// Body:
//   {
//     patient_id:        required
//     app_session_id:    required — pipeline batch id from the app
//     visit_date:        required YYYY-MM-DD
//     case_kind:         'aagl_report' | 'fmigs_report' | 'gold_standard_report' | 'clinical_ai_analysis'
//     analysis_json:     required — the structured JSON (KB references,
//                         claims, ai metadata). Stored as a document
//                         body in mountzara-phi (envelope-encrypted —
//                         it contains PHI inferences and direct quotes).
//     report_html_base64:  optional — rendered report HTML
//     report_pdf_base64:   optional — rendered report PDF
//     ai_model:           optional
//     ai_prompt_version:  optional
//     kb_manifest:        optional — §0.8 manifest (kb_entries_retrieved etc)
//   }
//
// Response (201): { ok, document_ids: [...] }
// =====================================================================

import { syncRoute, syncJson, syncError } from "../../../../_lib/sync_auth.js";
import { logAudit } from "../../../../_lib/audit.js";
import { newId } from "../../../../_lib/db.js";
import { putPhiObject } from "../../../../_lib/phi.js";

const APP = "clinical_ai";
const MAX_JSON_BYTES = 2 * 1024 * 1024;     // 2 MB structured analysis cap
const MAX_HTML_BYTES = 5 * 1024 * 1024;     // 5 MB rendered report
const MAX_PDF_BYTES  = 25 * 1024 * 1024;    // 25 MB rendered PDF
const ALLOWED_KINDS = new Set(["aagl_report", "fmigs_report", "gold_standard_report", "clinical_ai_analysis"]);

function isDate(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function decodeBase64(s) {
    if (typeof s !== "string" || s.length === 0) return null;
    try {
        const bin = atob(s);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    } catch { return null; }
}

async function sha256Hex(bytes) {
    const buf = await crypto.subtle.digest("SHA-256", bytes instanceof Uint8Array ? bytes : new TextEncoder().encode(bytes));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function insertDocument(env, args) {
    const { patient_id, encounter_id, kind, r2_key, mime, size_bytes, sha256, wrapped_dek, filename, description, phi_aad, now } = args;
    const id = newId();
    // phi_aad records the AAD this object was sealed with. These rows use
    // `clinical_ai/<session_id>/<part>`, which is nothing like the
    // patient-upload convention a reader would otherwise assume — see
    // schema/0037 for why guessing broke downloads.
    await env.DB.prepare(`
        INSERT INTO documents
            (id, patient_id, kind, r2_key, r2_bucket, filename, mime_type, size_bytes,
             sha256, encrypted, envelope_dek_wrapped,
             uploaded_by_role, uploaded_by_id, source_app, description, phi_aad, uploaded_at)
        VALUES (?, ?, ?, ?, 'mountzara-phi', ?, ?, ?, ?, 1, ?, 'app', 'clinical_ai_pipeline', 'clinical_ai', ?, ?, ?)
    `).bind(
        id, patient_id, kind, r2_key, filename, mime, size_bytes, sha256, wrapped_dek,
        description, phi_aad || null, now
    ).run();
    return id;
}

export async function onRequestPost(ctx) {
    return syncRoute(ctx, APP, async ({ env, request }) => {
        let body;
        try { body = await request.json(); } catch { return syncError("invalid_json_body", 400); }

        const patient_id = String(body.patient_id || "");
        const session_id = String(body.app_session_id || "");
        const visit_date = String(body.visit_date || "");
        const case_kind = String(body.case_kind || "clinical_ai_analysis");
        const analysis_json = body.analysis_json;
        const description = body.description ? String(body.description).slice(0, 500) : null;
        const ai_model = body.ai_model ? String(body.ai_model).slice(0, 64) : null;
        const ai_prompt_version = body.ai_prompt_version ? String(body.ai_prompt_version).slice(0, 64) : null;
        const kb_manifest = body.kb_manifest && typeof body.kb_manifest === "object" ? body.kb_manifest : null;

        if (!patient_id) return syncError("missing_patient_id", 400);
        if (!session_id) return syncError("missing_app_session_id", 400);
        if (!isDate(visit_date)) return syncError("invalid_visit_date", 400, { format: "YYYY-MM-DD" });
        if (!ALLOWED_KINDS.has(case_kind)) return syncError("invalid_case_kind", 400, { allowed: [...ALLOWED_KINDS] });
        if (!analysis_json || typeof analysis_json !== "object") return syncError("missing_analysis_json", 400);

        // Patient exists?
        const p = await env.DB.prepare(`SELECT id FROM patients WHERE id = ?`).bind(patient_id).first();
        if (!p) return syncError("patient_not_found", 404);

        // Idempotency by source_app + description tag — we use the session id
        // recorded into description metadata. Documents has no UNIQUE constraint
        // on a custom session id, so we do an exists-check by sha256 of
        // analysis_json (deterministic per source).
        const analysisBytes = new TextEncoder().encode(JSON.stringify(analysis_json));
        if (analysisBytes.length > MAX_JSON_BYTES) return syncError("analysis_json_too_large", 413);
        const analysisSha = await sha256Hex(analysisBytes);
        const existing = await env.DB.prepare(`
            SELECT id FROM documents
            WHERE patient_id = ? AND source_app = 'clinical_ai' AND sha256 = ?
        `).bind(patient_id, analysisSha).first();
        if (existing) return syncError("duplicate_session", 409, { existing_document_id: existing.id });

        const now = Date.now();
        const document_ids = [];

        // 1. Analysis JSON as encrypted document.
        const analysisKey = `clinical_ai/${patient_id}/${session_id}/analysis.json.bin`;
        let analysisPut;
        try {
            analysisPut = await putPhiObject(env, analysisKey,
                JSON.stringify(analysis_json),
                `clinical_ai/${session_id}/analysis`);
        } catch (e) { return syncError("phi_encrypt_analysis_failed", 500, { detail: String(e && e.message || e) }); }
        document_ids.push(await insertDocument(env, {
            patient_id, kind: case_kind,
            r2_key: analysisKey, mime: "application/json",
            size_bytes: analysisBytes.length, sha256: analysisSha,
            wrapped_dek: analysisPut.wrapped_dek,
            filename: `${case_kind}-${session_id}.json`,
            description: description || `${case_kind} from MountZaraClinicalAI session ${session_id}`,
            phi_aad: `clinical_ai/${session_id}/analysis`,
            now,
        }));

        // 2. Optional rendered HTML.
        if (body.report_html_base64) {
            const html = decodeBase64(body.report_html_base64);
            if (!html) return syncError("invalid_report_html_base64", 400);
            if (html.length > MAX_HTML_BYTES) return syncError("report_html_too_large", 413);
            const htmlKey = `clinical_ai/${patient_id}/${session_id}/report.html.bin`;
            const htmlSha = await sha256Hex(html);
            let put;
            try {
                put = await putPhiObject(env, htmlKey, html, `clinical_ai/${session_id}/html`);
            } catch (e) { return syncError("phi_encrypt_html_failed", 500); }
            document_ids.push(await insertDocument(env, {
                patient_id, kind: case_kind,
                r2_key: htmlKey, mime: "text/html",
                size_bytes: html.length, sha256: htmlSha,
                wrapped_dek: put.wrapped_dek,
                filename: `${case_kind}-${session_id}.html`,
                description: `Rendered HTML for ${case_kind}`,
                phi_aad: `clinical_ai/${session_id}/html`,
                now,
            }));
        }

        // 3. Optional rendered PDF.
        if (body.report_pdf_base64) {
            const pdf = decodeBase64(body.report_pdf_base64);
            if (!pdf) return syncError("invalid_report_pdf_base64", 400);
            if (pdf.length > MAX_PDF_BYTES) return syncError("report_pdf_too_large", 413);
            const pdfKey = `clinical_ai/${patient_id}/${session_id}/report.pdf.bin`;
            const pdfSha = await sha256Hex(pdf);
            let put;
            try {
                put = await putPhiObject(env, pdfKey, pdf, `clinical_ai/${session_id}/pdf`);
            } catch (e) { return syncError("phi_encrypt_pdf_failed", 500); }
            document_ids.push(await insertDocument(env, {
                patient_id, kind: case_kind,
                r2_key: pdfKey, mime: "application/pdf",
                size_bytes: pdf.length, sha256: pdfSha,
                wrapped_dek: put.wrapped_dek,
                filename: `${case_kind}-${session_id}.pdf`,
                description: `Rendered PDF for ${case_kind}`,
                phi_aad: `clinical_ai/${session_id}/pdf`,
                now,
            }));
        }

        await logAudit(env, {
            user_id: null, user_role: "app",
            action: "phi_write",
            record_type: "document",
            record_id: document_ids[0],
            ip: request.headers.get("CF-Connecting-IP") || "",
            user_agent: request.headers.get("User-Agent") || "",
            success: true,
            details: {
                app: APP, op: "clinical_ai_sync",
                patient_id, app_session_id: session_id, case_kind,
                document_count: document_ids.length,
                analysis_bytes: analysisBytes.length,
                ai_model, ai_prompt_version,
                has_kb_manifest: !!kb_manifest,
                kb_entries_count: kb_manifest && Array.isArray(kb_manifest.kb_entries_retrieved) ? kb_manifest.kb_entries_retrieved.length : 0,
                visit_date,
            },
        });

        // Phase 9.5 — record encounter event so the case-view "what's new"
        // panel surfaces a freshly synced Clinical AI analysis. Best-effort.
        try {
            const { recordEncounterEvent } = await import("../../../../_lib/encounters.js");
            await recordEncounterEvent(env, {
                patient_id,
                event_type: "clinical_ai_synced",
                event_summary: `New ${case_kind.replace(/_/g, " ")} from MountZaraClinicalAI (visit ${visit_date})`,
                severity: "info",
                ref_kind: "document",
                ref_id: document_ids[0],
                details: { case_kind, app_session_id: session_id, visit_date, document_count: document_ids.length }
            });
        } catch {}

        return syncJson({ ok: true, document_ids, primary_document_id: document_ids[0] }, { status: 201 });
    });
}
