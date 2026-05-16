// =====================================================================
// GET /api/v1/sync/patients/lookup — resolve a patient_id from app side
// =====================================================================
// Per CLAUDE.md §11 Tier 5 — apps NEVER create patients. They look the
// patient up by email + dob (or mrn + dob) and use the returned id on
// every subsequent push. The website is the canonical patient registry.
//
// Auth: any valid app Bearer token (TRANSCRIPTION_SYNC_TOKEN OR
//        CLINICAL_AI_SYNC_TOKEN OR SURGICAL_WORKFLOW_SYNC_TOKEN OR
//        IOS_SYNC_TOKEN). The "?app=" parameter selects which env secret
//        the Bearer is matched against.
//
// Query:
//   app:        'transcription' | 'clinical_ai' | 'surgical_workflow' | 'ios'
//   mrn:        optional — match patients.mrn exactly
//   email:      optional — match patients.email exactly (normalized lowercase)
//   dob:        optional but RECOMMENDED — second factor against the above
//
// Match logic:
//   - If both mrn AND dob given: match exactly on both. Strongest match.
//   - Else if email AND dob given: match both. Strong match.
//   - Else: error (we require two-factor lookup to prevent app-side
//     bugs from binding sync data to the wrong patient).
//
// Response (200):  { patient_id, display_name, mrn }   — only enough
//                  for the app to confirm. NO PHI beyond name + mrn.
// Response (404):  { error: "no_match" }
// Response (409):  { error: "ambiguous_match", candidates: N }
// =====================================================================

import { syncRoute, syncJson, syncError } from "../../../../_lib/sync_auth.js";
import { logAudit } from "../../../../_lib/audit.js";

const VALID_APPS = new Set(["transcription", "clinical_ai", "surgical_workflow", "ios"]);

function isDate(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function isEmail(s) { return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }

export async function onRequestGet(ctx) {
    const url = new URL(ctx.request.url);
    const app = (url.searchParams.get("app") || "").toLowerCase();
    if (!VALID_APPS.has(app)) {
        return syncError("invalid_app", 400, { allowed: [...VALID_APPS] });
    }

    return syncRoute(ctx, app, async ({ env, request }) => {
        const mrn = (url.searchParams.get("mrn") || "").trim();
        const email = (url.searchParams.get("email") || "").trim().toLowerCase();
        const dob = (url.searchParams.get("dob") || "").trim();

        if (!dob || !isDate(dob)) {
            return syncError("missing_or_invalid_dob", 400, { format: "YYYY-MM-DD" });
        }
        if (!mrn && !email) {
            return syncError("missing_identifier", 400, { detail: "supply mrn or email along with dob" });
        }
        if (email && !isEmail(email)) {
            return syncError("invalid_email", 400);
        }

        let row;
        if (mrn) {
            row = await env.DB.prepare(`
                SELECT id, first_name, last_name, preferred_name, mrn, dob, status
                FROM patients WHERE mrn = ? AND dob = ?
            `).bind(mrn, dob).first();
        }
        if (!row && email) {
            row = await env.DB.prepare(`
                SELECT id, first_name, last_name, preferred_name, mrn, dob, status
                FROM patients WHERE email = ? AND dob = ?
            `).bind(email, dob).first();
        }

        if (!row) {
            await logAudit(env, {
                user_id: null, user_role: "app",
                action: "phi_read",
                record_type: "patient_lookup",
                ip: request.headers.get("CF-Connecting-IP") || "",
                user_agent: request.headers.get("User-Agent") || "",
                success: false,
                details: { app, lookup: mrn ? "mrn+dob" : "email+dob", matched: false },
            });
            return syncError("no_match", 404);
        }

        await logAudit(env, {
            user_id: null, user_role: "app",
            action: "phi_read",
            record_type: "patient_lookup",
            record_id: row.id,
            ip: request.headers.get("CF-Connecting-IP") || "",
            user_agent: request.headers.get("User-Agent") || "",
            success: true,
            details: { app, lookup: mrn ? "mrn+dob" : "email+dob", matched: true },
        });

        return syncJson({
            patient_id: row.id,
            display_name: [row.preferred_name || row.first_name, row.last_name].filter(Boolean).join(" "),
            mrn: row.mrn || null,
            status: row.status,
        });
    });
}
