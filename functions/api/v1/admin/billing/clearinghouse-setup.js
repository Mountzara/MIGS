// =====================================================================
// /api/v1/admin/billing/clearinghouse-setup — the setup wizard's API
// =====================================================================
// GET  → the entire wizard state in one call: profile, step readiness,
//        vendor scores, enrollment matrix, credential test status. The UI
//        is a renderer; it holds no logic of its own.
//
// POST { action } →
//   save_profile        practice identity (TIN encrypted on the way in)
//   run_selection       score the vendors against the interview answers
//   select_vendor       commit to one
//   build_packet        generate application values + payer EDI checklist
//   update_enrollment   set a payer row's status / reference / note
//   save_credentials    store vendor credentials, encrypted
//   test_connection     call the vendor for real and record the result
//   submit_test_claim   run one claim through in test mode
//   go_live             flip to production, gated on every prerequisite
//   reset_step          reopen a completed step
//
// SECRETS. Clearinghouse credentials and the TIN are encrypted at rest
// with the PHI envelope scheme (_lib/phi.js). They are never returned to
// the browser — the API returns which fields are set, and their last four
// where a suffix is useful, and nothing more. The one exception is
// build_packet with reveal_tin=true, which decrypts the TIN for the
// duration of one response so the operator can paste it into the vendor's
// application. That is the entire reason the field is stored at all.
//
// ENV FALLBACK. Credentials already set as Cloudflare env secrets keep
// working and take precedence — see _lib/clearinghouse.js. The wizard's
// stored credentials are the path for someone with no terminal, which is
// the whole point of a wizard.
// =====================================================================

import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../../_lib/admin_api.js";
import { logAudit } from "../../../../_lib/audit.js";
import { newId } from "../../../../_lib/db.js";
import {
    sealJson, openJson, CRED_AAD,
    resolveVendorCredentials, withStoredCredentials, storeVendorCredentials,
} from "../../../../_lib/clearinghouse_credentials.js";
import {
    STEPS, PROFILE_FIELDS, PROFILE_GROUPS, INTERVIEW, VENDOR_FACTS,
    validateProfile, scoreVendors, pairingAdvice, buildApplicationPacket,
    buildEnrollmentMatrix, enrollmentSummary, readiness,
    routingPlan, validateVendorSet,
} from "../../../../_lib/clearinghouse_onboarding.js";
import { PAYERS } from "../../../../_lib/payer_directory.js";
import { clearinghouseVendor, providerConfig, isConfigured } from "../../../../_lib/clearinghouse.js";

const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------

async function loadProfile(env) {
    const row = await env.DB.prepare(
        `SELECT * FROM clearinghouse_profile WHERE id = 'default' LIMIT 1`
    ).first();
    return row || {};
}

async function loadOnboarding(env) {
    const row = await env.DB.prepare(
        `SELECT * FROM clearinghouse_onboarding WHERE id = 'default' LIMIT 1`
    ).first();
    return row || { id: "default", current_step: "profile" };
}

/**
 * The clearinghouses this practice uses. Multiple is the normal case, not
 * an advanced one — Availity for free Blues eligibility alongside a
 * full-service clearinghouse for government claims is the standard shape
 * for an IL/CA practice.
 */
async function loadVendors(env, { includeRemoved = false } = {}) {
    const r = await env.DB.prepare(
        `SELECT vendor, role, is_primary, added_at, removed_at, note
           FROM clearinghouse_vendors
          ${includeRemoved ? "" : "WHERE removed_at IS NULL"}
          ORDER BY is_primary DESC, added_at ASC`
    ).all();
    return (r?.results || []).map((v) => ({ ...v, is_primary: v.is_primary === 1 }));
}

/**
 * Exactly one active vendor must be primary — it catches every payer that
 * has no explicit route. Prefers an explicit choice, then a claims-capable
 * vendor, and never leaves Availity holding the default when something
 * else can submit claims, because Availity cannot carry government payers.
 */
async function ensurePrimary(env, preferred) {
    const active = await loadVendors(env);
    if (!active.length) return null;

    const claimsCapable = active.filter((v) => (v.role || "both") !== "eligibility");
    const pool = claimsCapable.length ? claimsCapable : active;

    let pick = preferred && pool.find((v) => v.vendor === preferred);
    if (!pick) pick = pool.find((v) => v.is_primary);
    if (!pick) pick = pool.find((v) => v.vendor !== "availity") || pool[0];

    await env.DB.prepare(`UPDATE clearinghouse_vendors SET is_primary=0`).run();
    await env.DB.prepare(`UPDATE clearinghouse_vendors SET is_primary=1 WHERE vendor=?`)
        .bind(pick.vendor).run();
    return pick.vendor;
}

async function loadCredentials(env, vendor) {
    if (!vendor) return null;
    const row = await env.DB.prepare(
        `SELECT vendor, field_names_json, last_test_at, last_test_ok, last_test_detail, updated_at
           FROM clearinghouse_credentials WHERE vendor = ? LIMIT 1`
    ).bind(vendor).first();
    if (!row) return null;
    let names = [];
    try { names = JSON.parse(row.field_names_json || "[]"); } catch { /* keep [] */ }
    return { ...row, field_names: names, last_test_ok: row.last_test_ok === 1 };
}

async function loadEnrollment(env, vendor) {
    if (!vendor) return [];
    const r = await env.DB.prepare(
        `SELECT * FROM clearinghouse_payer_enrollment WHERE vendor = ? ORDER BY
            CASE payer_kind WHEN 'medicare' THEN 0 WHEN 'medicaid' THEN 1 ELSE 2 END,
            payer_name ASC`
    ).bind(vendor).all();
    return r?.results || [];
}

async function loadLastTestClaim(env, vendor) {
    // Scoped by vendor: an accepted test claim through one clearinghouse
    // says nothing about another, and treating it as global would let
    // go-live open on an untested connection.
    const row = await env.DB.prepare(
        `SELECT ok, detail, at FROM clearinghouse_events
          WHERE action = 'test_claim' AND step = ?
          ORDER BY at DESC LIMIT 1`
    ).bind(`testclaim:${vendor}`).first();
    if (!row) return null;
    return { ok: row.ok === 1, detail: row.detail, at: row.at };
}

async function event(env, admin, { step, action, detail, ok }) {
    try {
        await env.DB.prepare(
            `INSERT INTO clearinghouse_events (id, at, actor, step, action, detail, ok)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(newId(), nowIso(), admin?.user || null, step || null, action,
               detail ? String(detail).slice(0, 800) : null,
               ok === undefined ? null : (ok ? 1 : 0)).run();
    } catch (e) {
        // An audit write must never take down the action it is auditing,
        // but a silent loss is exactly the failure mode this codebase has
        // been bitten by, so it is loud in the log.
        console.error("clearinghouse-setup: event write failed", String(e));
    }
}

// ---------------------------------------------------------------------
// Connection test — a real call, not a shape check
// ---------------------------------------------------------------------
// isConfigured() only asks "is a value present". That is not a test. This
// makes an actual authenticated request and reports what the vendor said,
// because "my key is saved" and "my key works" are different facts and
// only the second one is worth a checkmark.

async function testConnection(env, vendor, creds) {
    const cfg = providerConfig(env, vendor);
    if (!cfg) return { ok: false, detail: `unknown vendor: ${vendor}` };
    if (vendor === "mock") return { ok: true, detail: "Mock provider — no network call made." };

    const facts = VENDOR_FACTS[vendor];
    const missing = (facts?.auth_fields || []).filter((f) => !creds[f.key]).map((f) => f.label);
    if (missing.length) return { ok: false, detail: `missing credential${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}` };

    try {
        if (cfg.auth === "oauth2") {
            // A token grant IS the credential test for OAuth vendors.
            const res = await fetch(cfg.baseUrl + cfg.tokenPath, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    grant_type: "client_credentials",
                    client_id: creds[cfg.idEnv], client_secret: creds[cfg.secretEnv],
                }),
            });
            if (res.ok) {
                const j = await res.json().catch(() => ({}));
                return { ok: Boolean(j.access_token), detail: j.access_token ? "OAuth token granted." : "Vendor returned 200 with no access_token." };
            }
            const body = (await res.text().catch(() => "")).slice(0, 240);
            return { ok: false, detail: `token endpoint returned ${res.status}${body ? ` — ${body}` : ""}` };
        }

        // Key/bearer vendors: probe an authenticated read endpoint. A 401
        // or 403 is a real answer (bad key). A 404 or 405 means the key was
        // accepted and only the path was wrong, which still proves auth.
        const base = cfg.baseUrl;
        if (!base) return { ok: false, detail: "This vendor has no REST base URL configured — it is SFTP batch. Test by uploading a batch file instead." };
        const probe = base + (cfg.statusPath || cfg.submitPath || "/");
        const headers = {};
        if (cfg.auth === "key") headers.Authorization = `Key ${creds[cfg.keyEnv]}`;
        if (cfg.auth === "bearer") headers.Authorization = `Bearer ${creds[cfg.keyEnv]}`;
        if (cfg.auth === "basic") headers.Authorization = "Basic " + btoa(`${creds[cfg.userEnv]}:${creds[cfg.passEnv]}`);

        const res = await fetch(probe, { method: "GET", headers });
        if (res.status === 401 || res.status === 403) {
            return { ok: false, detail: `vendor rejected the credential (HTTP ${res.status})` };
        }
        if (res.status >= 500) {
            return { ok: false, detail: `vendor returned HTTP ${res.status} — their side, not yours. Retry.` };
        }
        return { ok: true, detail: `credential accepted (HTTP ${res.status} from ${probe})` };
    } catch (e) {
        return { ok: false, detail: `network error: ${String(e).slice(0, 200)}` };
    }
}

// ---------------------------------------------------------------------
// GET — the whole wizard state
// ---------------------------------------------------------------------

/**
 * Has migration 0032 been applied? A missing table must produce an
 * actionable message, not a 500 with a SQL string in it. The operator
 * cannot act on "no such table: clearinghouse_profile"; he can act on
 * "run this migration".
 */
async function schemaReady(env) {
    try {
        const row = await env.DB.prepare(
            `SELECT COUNT(*) AS n FROM sqlite_master
              WHERE type='table' AND name IN
              ('clearinghouse_profile','clearinghouse_onboarding',
               'clearinghouse_credentials','clearinghouse_payer_enrollment',
               'clearinghouse_events')`
        ).first();
        return Number(row?.n || 0) === 5;
    } catch {
        return false;
    }
}

async function getState(env) {
    const profile = await loadProfile(env);
    const onboarding = await loadOnboarding(env);
    const liveMode = env.CLEARINGHOUSE_LIVE === "1";

    let answers = null;
    try { answers = JSON.parse(onboarding.selection_answers_json || "null"); } catch { /* null */ }
    const scores = answers ? scoreVendors(answers) : null;
    const pairing = answers && scores ? pairingAdvice(answers, scores) : null;

    // Every selected clearinghouse gets its own bundle: its own packet,
    // its own credentials, its own payer enrollment, its own test claim.
    // Sharing any of those between vendors would be wrong — an approved
    // Medicare EDI agreement with one clearinghouse means nothing to another.
    const vendorRows = await loadVendors(env);
    const vendors = [];
    for (const v of vendorRows) {
        const credentials = await loadCredentials(env, v.vendor);
        const enrollment = await loadEnrollment(env, v.vendor);
        const lastTestClaim = await loadLastTestClaim(env, v.vendor);
        const callEnv = await withStoredCredentials(env, v.vendor);
        vendors.push({
            ...v,
            label: VENDOR_FACTS[v.vendor]?.label || v.vendor,
            facts: VENDOR_FACTS[v.vendor] || null,
            credential_spec: VENDOR_FACTS[v.vendor]?.auth_fields || [],
            credentials, enrollment, lastTestClaim,
            enrollment_summary: enrollmentSummary(enrollment),
            packet: buildApplicationPacket(profile, v.vendor, { tin: null }),
            credentials_present: isConfigured(callEnv, v.vendor),
            credentials_source: (VENDOR_FACTS[v.vendor]?.auth_fields || []).some((f) => env[f.key])
                ? "env"
                : (credentials ? "wizard" : "none"),
        });
    }

    const rd = readiness({ profile, onboarding, vendors, liveMode, answers: answers || {} });

    // Never ship the encrypted columns to the browser.
    const safeProfile = { ...profile };
    for (const k of ["tin_ciphertext", "tin_dek_wrapped", "tin_iv_data", "tin_iv_dek"]) delete safeProfile[k];

    const recent = await env.DB.prepare(
        `SELECT at, actor, step, action, detail, ok FROM clearinghouse_events
          ORDER BY at DESC LIMIT 25`
    ).all();

    return {
        ok: true,
        steps: STEPS,
        profile_fields: PROFILE_FIELDS,
        profile_groups: PROFILE_GROUPS,
        interview: INTERVIEW,
        profile: safeProfile,
        onboarding: {
            current_step: onboarding.current_step,
            notes: onboarding.notes || "",
            packet_done_at: onboarding.packet_done_at,
            answers,
        },
        scores, pairing,
        vendors,
        all_vendors: Object.entries(VENDOR_FACTS).map(([k, f]) => ({
            vendor: k, label: f.label, verified: f.verified, signup_url: f.signup_url,
        })),
        live_mode: liveMode,
        active_vendor_env: clearinghouseVendor(env),
        readiness: rd,
        events: recent?.results || [],
    };
}

// ---------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------

export async function onRequest(ctx) {
    return adminRoute(ctx, async ({ env, request, admin }) => {
        if (!env.DB) return jsonError("D1 not bound", 500);

        if (!(await schemaReady(env))) {
            return jsonResponse({
                ok: false,
                schema_missing: true,
                message: "The setup wizard's tables have not been created yet.",
                migration: "schema/0032_clearinghouse_onboarding.sql",
                command: "npx wrangler d1 execute mountzara-clinical --remote --file=schema/0032_clearinghouse_onboarding.sql",
            }, { status: 503 });
        }

        if (request.method === "GET") return jsonResponse(await getState(env));
        if (request.method !== "POST") return jsonError("method_not_allowed", 405);

        const body = await readJsonBody(request);
        const action = String(body?.action || "");

        // ---- save_profile --------------------------------------------
        if (action === "save_profile") {
            const p = body.profile || {};
            const cols = PROFILE_FIELDS.map((f) => f.key).filter((k) => k !== "tin");
            const values = cols.map((k) => (p[k] === undefined ? null : String(p[k]).trim() || null));

            // TIN is encrypted separately; only the last four are stored plainly.
            let tinCols = [];
            let tinVals = [];
            if (p.tin && String(p.tin).replace(/\D/g, "").length === 9) {
                const digits = String(p.tin).replace(/\D/g, "");
                const sealed = await sealJson(env, { tin: digits }, "clearinghouse_profile:tin");
                tinCols = ["tin_ciphertext", "tin_dek_wrapped", "tin_iv_data", "tin_iv_dek", "tin_last4"];
                tinVals = [sealed.ciphertext, sealed.dek_wrapped, sealed.iv_data, sealed.iv_dek, digits.slice(-4)];
            }

            const allCols = [...cols, ...tinCols, "updated_at", "updated_by"];
            const allVals = [...values, ...tinVals, nowIso(), admin.user || null];
            const setClause = allCols.map((c) => `${c}=excluded.${c}`).join(", ");

            await env.DB.prepare(
                `INSERT INTO clearinghouse_profile (id, ${allCols.join(", ")})
                 VALUES ('default', ${allCols.map(() => "?").join(", ")})
                 ON CONFLICT(id) DO UPDATE SET ${setClause}`
            ).bind(...allVals).run();

            const merged = await loadProfile(env);
            const v = validateProfile({ ...merged, tin: p.tin });
            if (v.ok) {
                await env.DB.prepare(
                    `INSERT INTO clearinghouse_onboarding (id, profile_done_at, current_step, updated_at)
                     VALUES ('default', ?, 'selection', ?)
                     ON CONFLICT(id) DO UPDATE SET profile_done_at=excluded.profile_done_at, updated_at=excluded.updated_at`
                ).bind(nowIso(), nowIso()).run();
            }
            await event(env, admin, { step: "profile", action: "save_profile",
                detail: v.ok ? "complete" : `${v.missing.length} missing, ${v.invalid.length} invalid`, ok: v.ok });
            await logAudit(env, { user_id: admin.user, user_role: admin.role, action: "admin_override",
                record_type: "clearinghouse_profile", success: true,
                details: { step: "profile", complete: v.ok } });
            return jsonResponse({ ok: true, validation: v, state: await getState(env) });
        }

        // ---- run_selection -------------------------------------------
        if (action === "run_selection") {
            const answers = body.answers || {};
            const scores = scoreVendors(answers);
            const pairing = pairingAdvice(answers, scores);
            await env.DB.prepare(
                `INSERT INTO clearinghouse_onboarding (id, selection_answers_json, selection_scores_json, states_json, payer_mix_json, updated_at)
                 VALUES ('default', ?, ?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET
                    selection_answers_json=excluded.selection_answers_json,
                    selection_scores_json=excluded.selection_scores_json,
                    states_json=excluded.states_json,
                    updated_at=excluded.updated_at`
            ).bind(JSON.stringify(answers), JSON.stringify(scores),
                   JSON.stringify(answers.states || []), null, nowIso()).run();
            await event(env, admin, { step: "selection", action: "run_selection",
                detail: `top: ${scores[0]?.vendor} (${scores[0]?.score})`, ok: true });
            return jsonResponse({ ok: true, scores, pairing });
        }

        // ---- select_vendors (multi) ----------------------------------
        // The operator picks a SET. Adding one later, or dropping one, uses
        // the same code path — there is no "initial choice" that is harder
        // to change than a later one.
        if (action === "select_vendors" || action === "select_vendor") {
            const list = action === "select_vendor"
                ? [String(body.vendor || "")]
                : (Array.isArray(body.vendors) ? body.vendors : []);
            const want = list.map((v) => (typeof v === "string" ? { vendor: v } : v))
                             .filter((v) => VENDOR_FACTS[v.vendor]);
            if (!want.length) return jsonError("select at least one clearinghouse", 400);

            const existing = await loadVendors(env, { includeRemoved: true });
            const byVendor = new Map(existing.map((v) => [v.vendor, v]));
            const wantKeys = new Set(want.map((v) => v.vendor));

            // Soft-delete anything deselected. History and credentials stay.
            for (const e of existing) {
                if (!wantKeys.has(e.vendor) && !e.removed_at) {
                    await env.DB.prepare(
                        `UPDATE clearinghouse_vendors SET removed_at=? WHERE vendor=?`
                    ).bind(nowIso(), e.vendor).run();
                    await event(env, admin, { step: "selection", action: "remove_vendor", detail: e.vendor, ok: true });
                }
            }

            // Add or reactivate.
            for (const w of want) {
                const prior = byVendor.get(w.vendor);
                const role = ["claims", "eligibility", "both"].includes(w.role) ? w.role
                    : (prior?.role || (w.vendor === "availity" ? "eligibility" : "both"));
                if (prior) {
                    await env.DB.prepare(
                        `UPDATE clearinghouse_vendors SET removed_at=NULL, role=? WHERE vendor=?`
                    ).bind(role, w.vendor).run();
                } else {
                    await env.DB.prepare(
                        `INSERT INTO clearinghouse_vendors (vendor, role, is_primary, added_at)
                         VALUES (?,?,0,?)`
                    ).bind(w.vendor, role, nowIso()).run();
                    await event(env, admin, { step: "selection", action: "add_vendor", detail: `${w.vendor} (${role})`, ok: true });
                }
            }

            await ensurePrimary(env, body.primary || null);

            const active = await loadVendors(env);
            const onb = await loadOnboarding(env);
            let onbAnswers = {};
            try { onbAnswers = JSON.parse(onb.selection_answers_json || "{}"); } catch { /* keep {} */ }
            const vset = validateVendorSet(active, onbAnswers);

            const primary = active.find((v) => v.is_primary);
            await env.DB.prepare(
                `INSERT INTO clearinghouse_onboarding (id, selected_vendor, selection_done_at, current_step, updated_at)
                 VALUES ('default', ?, ?, 'packet', ?)
                 ON CONFLICT(id) DO UPDATE SET
                    selected_vendor=excluded.selected_vendor,
                    selection_done_at=excluded.selection_done_at,
                    current_step='packet', updated_at=excluded.updated_at`
            ).bind(primary?.vendor || active[0]?.vendor || null, nowIso(), nowIso()).run();

            return jsonResponse({ ok: true, vendor_set: vset, state: await getState(env) });
        }

        // ---- set_role / set_primary ----------------------------------
        if (action === "set_role") {
            const vendor = String(body.vendor || "");
            const role = String(body.role || "");
            if (!VENDOR_FACTS[vendor]) return jsonError(`unknown vendor: ${vendor}`, 400);
            if (!["claims", "eligibility", "both"].includes(role)) return jsonError(`bad role: ${role}`, 400);
            await env.DB.prepare(`UPDATE clearinghouse_vendors SET role=? WHERE vendor=?`).bind(role, vendor).run();
            await ensurePrimary(env, null);
            await event(env, admin, { step: "selection", action: "set_role", detail: `${vendor} → ${role}`, ok: true });
            return jsonResponse({ ok: true, state: await getState(env) });
        }

        if (action === "set_primary") {
            const vendor = String(body.vendor || "");
            if (!VENDOR_FACTS[vendor]) return jsonError(`unknown vendor: ${vendor}`, 400);
            await ensurePrimary(env, vendor);
            await event(env, admin, { step: "selection", action: "set_primary", detail: vendor, ok: true });
            return jsonResponse({ ok: true, state: await getState(env) });
        }

        // ---- remove_vendor -------------------------------------------
        // Soft delete. Enrollment history and credentials survive, so
        // coming back to a clearinghouse does not mean starting over.
        if (action === "remove_vendor") {
            const vendor = String(body.vendor || "");
            await env.DB.prepare(
                `UPDATE clearinghouse_vendors SET removed_at=?, is_primary=0 WHERE vendor=?`
            ).bind(nowIso(), vendor).run();
            await ensurePrimary(env, null);
            await event(env, admin, { step: "selection", action: "remove_vendor", detail: vendor, ok: true });
            return jsonResponse({ ok: true, state: await getState(env) });
        }

        // ---- apply_routing -------------------------------------------
        // Push the recommended payer-kind → vendor mapping onto
        // billing_payers, which is what submitClaim already reads. Without
        // this the wizard would recommend a routing it never applied.
        if (action === "apply_routing") {
            const active = await loadVendors(env);
            const plan = routingPlan(active);
            const map = body.routing && typeof body.routing === "object" ? body.routing : plan.routing;
            let updated = 0;
            for (const kind of ["commercial", "medicare", "medicaid"]) {
                const vendor = map[kind];
                if (!vendor) continue;
                const res = await env.DB.prepare(
                    `UPDATE billing_payers SET clearinghouse_vendor=? WHERE payer_kind=?`
                ).bind(vendor, kind).run().catch(() => null);
                updated += res?.meta?.changes || 0;
            }
            await event(env, admin, { step: "packet", action: "apply_routing",
                detail: JSON.stringify(map), ok: true });
            return jsonResponse({ ok: true, applied: map, payers_updated: updated, state: await getState(env) });
        }

        // ---- build_packet (per vendor) --------------------------------
        if (action === "build_packet") {
            const active = await loadVendors(env);
            if (!active.length) return jsonError("choose at least one clearinghouse first", 400);
            // Build for one vendor, or for all of them at once — each keeps
            // its own checklist, because an approved EDI agreement with one
            // clearinghouse means nothing to another.
            const targets = body.vendor
                ? active.filter((v) => v.vendor === body.vendor)
                : active;
            if (!targets.length) return jsonError(`${body.vendor} is not one of your clearinghouses`, 400);

            const profile = await loadProfile(env);
            const onb = await loadOnboarding(env);

            let tin = null;
            if (body.reveal_tin && profile.tin_ciphertext) {
                const opened = await openJson(env, {
                    ciphertext: profile.tin_ciphertext, dek_wrapped: profile.tin_dek_wrapped,
                    iv_data: profile.tin_iv_data, iv_dek: profile.tin_iv_dek,
                }, "clearinghouse_profile:tin");
                tin = opened?.tin || null;
                await event(env, admin, { step: "packet", action: "reveal_tin", detail: "tax ID displayed", ok: true });
            }

            const states = (() => { try { return JSON.parse(onb.states_json || "[]"); } catch { return []; } })();
            const relevant = PAYERS.filter((p) =>
                !states.length || p.states.some((st) => states.includes(st) || st === "US"));

            const packets = {};
            for (const v of targets) {
                packets[v.vendor] = buildApplicationPacket(profile, v.vendor, { tin });

                // An eligibility-only vendor gets no claim-enrollment checklist.
                if ((v.role || "both") === "eligibility") continue;

                const existing = await loadEnrollment(env, v.vendor);
                const rows = buildEnrollmentMatrix(v.vendor, relevant, existing);
                for (const r of rows) {
                    if (r.id) continue;                   // already persisted
                    await env.DB.prepare(
                        `INSERT INTO clearinghouse_payer_enrollment
                           (id, vendor, payer_id, payer_name, payer_kind, edi_required, era_required,
                            eft_required, form_name, form_url, status, expected_days, note, updated_at)
                         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                         ON CONFLICT(vendor, payer_name) DO NOTHING`
                    ).bind(newId(), v.vendor, r.payer_id, r.payer_name, r.payer_kind,
                           r.edi_required, r.era_required, r.eft_required, r.form_name,
                           r.form_url, r.status, r.expected_days, r.note, nowIso()).run();
                }
            }

            await env.DB.prepare(
                `UPDATE clearinghouse_onboarding SET packet_done_at=?, updated_at=? WHERE id='default'`
            ).bind(nowIso(), nowIso()).run();
            await event(env, admin, { step: "packet", action: "build_packet",
                detail: targets.map((v) => v.vendor).join(", "), ok: true });

            return jsonResponse({ ok: true, packets, state: await getState(env) });
        }

        // ---- update_enrollment ---------------------------------------
        if (action === "update_enrollment") {
            const id = String(body.id || "");
            if (!id) return jsonError("id required", 400);
            const allowed = ["not_started", "in_progress", "submitted", "approved", "rejected", "not_required"];
            const status = String(body.status || "");
            if (status && !allowed.includes(status)) return jsonError(`bad status: ${status}`, 400);

            const sets = [], vals = [];
            if (status) {
                sets.push("status=?"); vals.push(status);
                if (status === "submitted") { sets.push("submitted_at=?"); vals.push(nowIso()); }
                if (status === "approved")  { sets.push("approved_at=?");  vals.push(nowIso()); }
            }
            for (const [k, col] of [["reference_number", "reference_number"], ["note", "note"], ["form_url", "form_url"]]) {
                if (body[k] !== undefined) { sets.push(`${col}=?`); vals.push(String(body[k]).slice(0, 800) || null); }
            }
            if (body.expected_days !== undefined) {
                sets.push("expected_days=?"); vals.push(Number(body.expected_days) || null);
            }
            if (!sets.length) return jsonError("nothing to update", 400);
            sets.push("updated_at=?"); vals.push(nowIso());
            vals.push(id);

            await env.DB.prepare(
                `UPDATE clearinghouse_payer_enrollment SET ${sets.join(", ")} WHERE id=?`
            ).bind(...vals).run();
            await event(env, admin, { step: "packet", action: "update_enrollment",
                detail: `${id} → ${status || "edited"}`, ok: true });
            return jsonResponse({ ok: true, state: await getState(env) });
        }

        // ---- save_credentials ----------------------------------------
        if (action === "save_credentials") {
            const vendor = String(body.vendor || "");
            if (!VENDOR_FACTS[vendor]) return jsonError("which clearinghouse? pass a vendor", 400);

            let kept;
            try {
                kept = await storeVendorCredentials(env, vendor, body.fields, admin.user);
            } catch (e) {
                return jsonError(String(e.message || e), 400);
            }

            await event(env, admin, { step: "credentials", action: "save_credentials",
                detail: `${vendor}: ${kept.join(", ")}`, ok: true });
            await logAudit(env, { user_id: admin.user, user_role: admin.role, action: "admin_override",
                record_type: "clearinghouse_credentials", success: true,
                details: { vendor, fields: kept } });
            return jsonResponse({ ok: true, state: await getState(env) });
        }

        // ---- test_connection -----------------------------------------
        if (action === "test_connection") {
            const vendor = String(body.vendor || "");
            if (!VENDOR_FACTS[vendor]) return jsonError("which clearinghouse? pass a vendor", 400);

            const creds = await resolveVendorCredentials(env, vendor);
            const result = await testConnection(env, vendor, creds);

            await env.DB.prepare(
                `INSERT INTO clearinghouse_credentials (vendor, last_test_at, last_test_ok, last_test_detail, updated_at)
                 VALUES (?,?,?,?,?)
                 ON CONFLICT(vendor) DO UPDATE SET
                    last_test_at=excluded.last_test_at, last_test_ok=excluded.last_test_ok,
                    last_test_detail=excluded.last_test_detail, updated_at=excluded.updated_at`
            ).bind(vendor, nowIso(), result.ok ? 1 : 0, result.detail.slice(0, 500), nowIso()).run();

            if (result.ok) {
                // Only stamp the step complete when EVERY selected
                // clearinghouse has passed — one working key out of two is
                // not a finished step.
                const active = await loadVendors(env);
                const all = [];
                for (const v of active) all.push(await loadCredentials(env, v.vendor));
                if (active.length && all.every((c) => c && c.last_test_ok)) {
                    await env.DB.prepare(
                        `UPDATE clearinghouse_onboarding SET credentials_done_at=?, current_step='testclaim', updated_at=? WHERE id='default'`
                    ).bind(nowIso(), nowIso()).run();
                }
            }
            await event(env, admin, { step: "credentials", action: "test_connection",
                detail: result.detail, ok: result.ok });
            return jsonResponse({ ok: true, result, state: await getState(env) });
        }

        // ---- submit_test_claim ---------------------------------------
        if (action === "submit_test_claim") {
            const vendor = String(body.vendor || "");
            if (!VENDOR_FACTS[vendor]) return jsonError("which clearinghouse? pass a vendor", 400);

            // Deliberately routed through the same submitClaim path a real
            // claim uses, in test mode. A test that exercises a different
            // code path proves nothing about the one that matters.
            const { submitClaim } = await import("../../../../_lib/clearinghouse.js");
            // Stored credentials are merged in so the wizard's own entries
            // work here exactly as an env secret would.
            const callEnv = await withStoredCredentials(env, vendor);
            let result;
            try {
                result = await submitClaim(callEnv, {
                    edi: body.edi || null,
                    claim: body.claim_id ? { id: body.claim_id } : null,
                    payer: body.payer || null,
                    vendor,
                });
            } catch (e) {
                result = { ok: false, error: String(e).slice(0, 300) };
            }
            const ok = Boolean(result?.ok);
            const detail = ok
                ? `accepted — ${result.status || "acknowledged"}${result.clearinghouseClaimId ? ` (${result.clearinghouseClaimId})` : ""}`
                : (result?.error || result?.acknowledgment || "rejected — see the 277CA");

            if (ok) {
                await env.DB.prepare(
                    `UPDATE clearinghouse_onboarding SET testclaim_done_at=?, updated_at=? WHERE id='default'`
                ).bind(nowIso(), nowIso()).run();
            }
            // Scoped by vendor: loadLastTestClaim reads this back per
            // clearinghouse, so a pass on one cannot vouch for another.
            await event(env, admin, { step: `testclaim:${vendor}`, action: "test_claim", detail, ok });
            return jsonResponse({ ok: true, result, detail, state: await getState(env) });
        }

        // ---- go_live -------------------------------------------------
        if (action === "go_live") {
            const state = await getState(env);
            if (!state.readiness.can_go_live) {
                return jsonError("not ready for production", 409, {
                    blockers: state.readiness.steps.find((s) => s.key === "golive")?.blockers || [],
                });
            }
            // The actual switch is a Cloudflare env secret, deliberately.
            // A production/test flag that any authenticated session could
            // flip through an API is exactly the sort of thing that sends a
            // real claim by accident. So this records readiness and returns
            // the one command that arms it.
            await env.DB.prepare(
                `UPDATE clearinghouse_onboarding SET golive_done_at=?, current_step='golive', updated_at=? WHERE id='default'`
            ).bind(nowIso(), nowIso()).run();
            await event(env, admin, { step: "golive", action: "golive_ready",
                detail: "all prerequisites met", ok: true });
            const active = await loadVendors(env);
            const primary = active.find((v) => v.is_primary) || active[0];
            return jsonResponse({
                ok: true,
                armed: env.CLEARINGHOUSE_LIVE === "1",
                instruction: {
                    why: "The production switch is a deployment secret, not an API field, so no browser session can send a real claim by accident.",
                    env_var: "CLEARINGHOUSE_LIVE",
                    value: "1",
                    also: `CLEARINGHOUSE_VENDOR=${primary?.vendor || ""}`,
                    note: active.length > 1
                        ? `CLEARINGHOUSE_VENDOR is only the fallback for payers with no explicit route. Your other clearinghouse${active.length > 2 ? "s" : ""} (${active.filter((v) => !v.is_primary).map((v) => v.vendor).join(", ")}) are reached through per-payer routing on billing_payers, which step 3 already applied.`
                        : null,
                },
                state: await getState(env),
            });
        }

        // ---- reset_step ----------------------------------------------
        if (action === "reset_step") {
            const step = String(body.step || "");
            const col = {
                profile: "profile_done_at", selection: "selection_done_at",
                packet: "packet_done_at", credentials: "credentials_done_at",
                testclaim: "testclaim_done_at", golive: "golive_done_at",
            }[step];
            if (!col) return jsonError(`unknown step: ${step}`, 400);
            await env.DB.prepare(
                `UPDATE clearinghouse_onboarding SET ${col}=NULL, current_step=?, updated_at=? WHERE id='default'`
            ).bind(step, nowIso()).run();
            await event(env, admin, { step, action: "reset_step", detail: step, ok: true });
            return jsonResponse({ ok: true, state: await getState(env) });
        }

        // ---- save_notes ----------------------------------------------
        if (action === "save_notes") {
            await env.DB.prepare(
                `INSERT INTO clearinghouse_onboarding (id, notes, updated_at) VALUES ('default', ?, ?)
                 ON CONFLICT(id) DO UPDATE SET notes=excluded.notes, updated_at=excluded.updated_at`
            ).bind(String(body.notes || "").slice(0, 8000), nowIso()).run();
            return jsonResponse({ ok: true });
        }

        return jsonError(
            "unknown_action — expected save_profile | run_selection | select_vendors | set_role | " +
            "set_primary | remove_vendor | apply_routing | build_packet | update_enrollment | " +
            "save_credentials | test_connection | submit_test_claim | go_live | reset_step | save_notes",
            400
        );
    });
}
