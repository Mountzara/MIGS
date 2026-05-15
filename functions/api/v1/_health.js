// =====================================================================
// functions/api/v1/_health.js — Phase 0 binding smoke-test endpoint
// =====================================================================
// GET /api/v1/_health — returns 200 + a JSON manifest of which bindings
// resolved successfully. Used during Phase 0 verification and as a
// permanent infrastructure heartbeat (the admin dashboard pings this on
// load so any regression — missing R2 binding, missing D1, missing
// secret — is surfaced immediately rather than discovered when a real
// route 500s in production).
//
// Auth: gated by Basic auth via the same admin/_middleware.js pattern.
// We re-verify the Authorization header inline (admin/_middleware.js
// covers /admin/* only, not /api/v1/*). PHI-free.
// =====================================================================

import { verifyPbkdf2 } from "../../admin/_middleware.js";
import { logAudit } from "../../_lib/audit.js";

function unauthorized() {
    return new Response(JSON.stringify({ error: "authentication_required" }), {
        status: 401,
        headers: {
            "WWW-Authenticate": 'Basic realm="Mount Zara Admin", charset="UTF-8"',
            "content-type": "application/json",
            "cache-control": "no-store",
        },
    });
}

async function isAdminRequest(request, env) {
    const auth = request.headers.get("Authorization") || "";
    if (!auth.startsWith("Basic ")) return false;
    if (!env.ADMIN_PASS_HASH) return false;
    let decoded;
    try {
        decoded = atob(auth.slice(6));
    } catch {
        return false;
    }
    const sep = decoded.indexOf(":");
    if (sep < 0) return false;
    const user = decoded.slice(0, sep).trim().toLowerCase();
    const pass = decoded.slice(sep + 1);
    const expected = (env.ADMIN_USER || "admin").trim().toLowerCase();
    if (user !== expected) return false;
    try {
        return await verifyPbkdf2(pass, env.ADMIN_PASS_HASH);
    } catch {
        return false;
    }
}

export async function onRequestGet(ctx) {
    const { request, env } = ctx;
    if (!(await isAdminRequest(request, env))) return unauthorized();

    const report = {
        ts: new Date().toISOString(),
        bindings: {},
        checks: {},
    };

    // 1. D1
    try {
        if (!env.DB) {
            report.bindings.DB = "missing";
        } else {
            const row = await env.DB.prepare(
                "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'"
            ).first();
            report.bindings.DB = { ok: true, table_count: row?.n ?? 0 };
            const auditCount = await env.DB.prepare(
                "SELECT COUNT(*) AS n FROM audit_log"
            ).first();
            report.checks.audit_log_rows = auditCount?.n ?? 0;
            const baaCount = await env.DB.prepare(
                "SELECT COUNT(*) AS n FROM baa_ledger"
            ).first();
            report.checks.baa_ledger_rows = baaCount?.n ?? 0;
        }
    } catch (e) {
        report.bindings.DB = { ok: false, error: String(e?.message || e) };
    }

    // 2. KV — sessions
    try {
        if (!env.MZ_SESSIONS) {
            report.bindings.MZ_SESSIONS = "missing";
        } else {
            const probe = "_health_probe_" + Math.random().toString(36).slice(2, 10);
            await env.MZ_SESSIONS.put(probe, "ok", { expirationTtl: 60 });
            const v = await env.MZ_SESSIONS.get(probe);
            await env.MZ_SESSIONS.delete(probe);
            report.bindings.MZ_SESSIONS = { ok: v === "ok" };
        }
    } catch (e) {
        report.bindings.MZ_SESSIONS = { ok: false, error: String(e?.message || e) };
    }

    // 3. KV — magic links
    try {
        if (!env.MZ_MAGIC_LINKS) {
            report.bindings.MZ_MAGIC_LINKS = "missing";
        } else {
            const probe = "_health_probe_" + Math.random().toString(36).slice(2, 10);
            await env.MZ_MAGIC_LINKS.put(probe, "ok", { expirationTtl: 60 });
            const v = await env.MZ_MAGIC_LINKS.get(probe);
            await env.MZ_MAGIC_LINKS.delete(probe);
            report.bindings.MZ_MAGIC_LINKS = { ok: v === "ok" };
        }
    } catch (e) {
        report.bindings.MZ_MAGIC_LINKS = { ok: false, error: String(e?.message || e) };
    }

    // 4. R2 PHI bucket (write + read + delete a small probe object)
    try {
        if (!env.PHI) {
            report.bindings.PHI = "missing";
        } else {
            const probeKey = "_health_probe/" + crypto.randomUUID();
            await env.PHI.put(probeKey, "ok", {
                httpMetadata: { contentType: "text/plain" },
            });
            const got = await env.PHI.get(probeKey);
            const body = got ? await got.text() : null;
            await env.PHI.delete(probeKey);
            report.bindings.PHI = { ok: body === "ok" };
        }
    } catch (e) {
        report.bindings.PHI = { ok: false, error: String(e?.message || e) };
    }

    // 5. R2 MEDIA + CONTENT (verify they still exist — §9.8.2 protection)
    report.bindings.MEDIA = env.MEDIA ? "bound" : "missing";
    report.bindings.CONTENT = env.CONTENT ? "bound" : "missing";

    // 6. PHI master key + envelope encryption round-trip
    try {
        if (!env.PHI_MASTER_KEY) {
            report.checks.phi_encryption_roundtrip = { ok: false, error: "PHI_MASTER_KEY secret missing" };
        } else {
            // Dynamic import so this file stays small if PHI lib evolves.
            const { encryptPhi, decryptPhi } = await import("../../_lib/phi.js");
            const sample = "phi-roundtrip-" + crypto.randomUUID();
            const enc = await encryptPhi(env, sample, "healthcheck");
            const dec = await decryptPhi(
                env,
                enc.ciphertext,
                enc.wrapped_dek,
                enc.iv_data,
                enc.iv_dek,
                "healthcheck"
            );
            const decoded = new TextDecoder().decode(dec);
            report.checks.phi_encryption_roundtrip = { ok: decoded === sample };
        }
    } catch (e) {
        report.checks.phi_encryption_roundtrip = { ok: false, error: String(e?.message || e) };
    }

    // 7. Audit log write (probe row, action="phi_read" record_type="healthcheck")
    try {
        await logAudit(env, {
            user_id: null,
            user_role: "staff",
            action: "phi_read",
            record_type: "healthcheck",
            record_id: "_health_probe_" + Date.now(),
            ip: request.headers.get("CF-Connecting-IP") || "",
            user_agent: request.headers.get("User-Agent") || "",
            success: true,
            details: { source: "/api/v1/_health" },
        });
        report.checks.audit_write = { ok: true };
    } catch (e) {
        report.checks.audit_write = { ok: false, error: String(e?.message || e) };
    }

    const ok =
        report.bindings.DB?.ok &&
        report.bindings.MZ_SESSIONS?.ok &&
        report.bindings.MZ_MAGIC_LINKS?.ok &&
        report.bindings.PHI?.ok &&
        report.bindings.MEDIA === "bound" &&
        report.bindings.CONTENT === "bound" &&
        report.checks.phi_encryption_roundtrip?.ok &&
        report.checks.audit_write?.ok;

    return new Response(JSON.stringify({ ok, ...report }, null, 2), {
        status: ok ? 200 : 503,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}
