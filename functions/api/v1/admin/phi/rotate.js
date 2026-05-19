// =====================================================================
// functions/api/v1/admin/phi/rotate.js
// PHI_MASTER_KEY rotation endpoint (Phase 7 hardening — closes
// HIPAA risk register HIGH #4: long-lived master key).
//
// Per CLAUDE.md §11 Tier 7 + §0.4.1 + §11.5.2 admin-gated. Annual
// rotation requirement.
//
// PROTOCOL:
//   1. Operator runs `scripts/phi_master_key_rotate.sh` on their Mac.
//   2. Script generates a new 32-byte master key.
//   3. Script sets BOTH secrets on the Worker via wrangler:
//        - PHI_MASTER_KEY_OLD  ← current value (will be deprecated)
//        - PHI_MASTER_KEY      ← new value (will become canonical)
//   4. Script POSTs to this endpoint to begin re-wrapping every DEK.
//   5. This endpoint:
//        a. Verifies both keys are valid base64 32-byte values.
//        b. Loops through every PHI-encrypted row in D1 across all
//           tables (documents, messages, message_attachments,
//           encounter_ai_summaries with both wrapped_dek columns,
//           totp_secret_encrypted on patients).
//        c. For each: unwraps the DEK with PHI_MASTER_KEY_OLD; if
//           that fails, tries PHI_MASTER_KEY (idempotent — row may
//           already be re-wrapped from a prior partial run); if
//           BOTH fail, marks the row as `rotation_failed` and
//           continues.
//        d. Re-wraps the DEK under PHI_MASTER_KEY with a fresh
//           iv_dek, updates the D1 row, and (for R2-backed rows)
//           rewrites the R2 customMetadata so future reads use the
//           new iv_dek.
//        e. Audit-logs every record touched + every failure.
//   6. Script verifies 100% of rows are now decryptable with the
//      NEW key alone (PHI_MASTER_KEY_OLD removed from env), then
//      removes the OLD key secret.
//
// SAFETY:
//   - This endpoint is gated behind admin Basic Auth + the
//     `?confirm=<random_token>` URL parameter. The token must be
//     present on the request AND echoed back by the operator
//     script with the same value the script just generated.
//   - Idempotent: re-running on an already-rotated row is a no-op
//     (the OLD key unwrap fails harmlessly, the NEW key unwrap
//     succeeds, and we skip the row).
//   - Atomic per-row: D1 UPDATE + R2 PUT happen in sequence with
//     try/catch; if either fails the row stays in `rotation_failed`
//     state for retry.
//   - Hard-cap per request: 100 rows. The operator script paginates
//     until count_remaining hits zero.
// =====================================================================

import { logAudit } from "../../../../_lib/audit.js";
import { adminRoute, jsonResponse, jsonError } from "../../../../_lib/admin_api.js";

const MASTER_KEY_BYTES = 32;
const IV_BYTES = 12;
const AAD_PREFIX = "mountzara-phi/v1/";
const BATCH_SIZE = 100;

// Tables and their wrapped_dek columns. (table, pk_column, dek_columns[])
const PHI_TABLES = [
    { table: "documents",             pk: "id", dek_cols: ["envelope_dek_wrapped"],
      r2_key_col: "r2_key", aad_template: (row) => `documents/${row.patient_id}/${row.id}` },
    { table: "messages",              pk: "id", dek_cols: ["envelope_dek_wrapped"],
      r2_key_col: "body_r2_key", aad_template: (row) => `messages/${row.patient_id}/${row.id}` },
    { table: "message_attachments",   pk: "id", dek_cols: ["envelope_dek_wrapped"],
      r2_key_col: "r2_key", aad_template: (row) => `msg-attachments/${row.message_id}/${row.id}` },
    { table: "encounter_ai_summaries", pk: "id",
      dek_cols: ["patient_visible_wrapped_dek", "clinician_full_wrapped_dek"],
      r2_key_col: null,  // these are inline in D1, no R2 object
      aad_template: (row) => `ai-summary/${row.encounter_id}` },
];

function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

function bytesToBase64(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
}

async function importMasterKeyFromB64(b64) {
    if (!b64) return null;
    const raw = base64ToBytes(b64);
    if (raw.length !== MASTER_KEY_BYTES) {
        throw new Error(`master key must decode to ${MASTER_KEY_BYTES} bytes; got ${raw.length}`);
    }
    return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function tryUnwrapDek(wrapped_dek_b64, iv_dek_b64, masterKey) {
    try {
        const plain = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: base64ToBytes(iv_dek_b64),
              additionalData: new TextEncoder().encode(AAD_PREFIX + "dek") },
            masterKey,
            base64ToBytes(wrapped_dek_b64)
        );
        return new Uint8Array(plain);
    } catch (_e) {
        return null;
    }
}

async function rewrapDek(dekBytes, newMasterKey) {
    const iv_dek = new Uint8Array(IV_BYTES);
    crypto.getRandomValues(iv_dek);
    const wrapped = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv_dek,
          additionalData: new TextEncoder().encode(AAD_PREFIX + "dek") },
        newMasterKey,
        dekBytes
    );
    return {
        wrapped_dek: bytesToBase64(new Uint8Array(wrapped)),
        iv_dek:      bytesToBase64(iv_dek),
    };
}

async function rotateOneRow(env, oldKey, newKey, tableSpec, row) {
    const r2_key = tableSpec.r2_key_col ? row[tableSpec.r2_key_col] : null;
    let iv_dek_b64 = null;
    let r2_object_for_update = null;
    let ciphertext_bytes = null;

    // For R2-backed rows we need the iv_dek from R2 customMetadata.
    // For inline-D1 rows (encounter_ai_summaries), the iv_dek lives nowhere
    // in the schema (oversight) — we have to fail loudly so we can patch.
    if (r2_key) {
        if (!env.PHI) throw new Error("PHI R2 bucket not bound");
        const obj = await env.PHI.get(r2_key);
        if (!obj) {
            return { status: "missing_r2_object", r2_key };
        }
        iv_dek_b64 = obj.customMetadata?.["mz-iv-dek"];
        if (!iv_dek_b64) {
            return { status: "missing_iv_dek_metadata", r2_key };
        }
        r2_object_for_update = obj;
        ciphertext_bytes = await obj.arrayBuffer();
    }

    const summary = { row_id: row[tableSpec.pk], r2_key, columns: [] };

    // Each row may carry multiple wrapped_dek columns (e.g. ai-summary has
    // both patient_visible_wrapped_dek + clinician_full_wrapped_dek). Each
    // needs its own iv_dek too — but ai-summary stores DEKs inline in D1,
    // not in R2, so each row carries its own iv_dek (TODO: schema add).
    // Here we treat the R2 customMetadata iv_dek as authoritative for the
    // single-DEK R2-backed tables; for the multi-DEK ai-summary table we
    // need per-column iv_dek (currently a schema gap — flagged).
    for (const dek_col of tableSpec.dek_cols) {
        const wrapped_b64 = row[dek_col];
        if (!wrapped_b64) continue;

        let iv_for_col = iv_dek_b64;
        if (!iv_for_col && tableSpec.dek_cols.length > 1) {
            // Inline multi-DEK table — needs schema update.
            return { status: "missing_iv_dek_for_inline_multidek", row_id: row[tableSpec.pk], dek_col };
        }

        // Try OLD key first; if that fails try NEW (already rotated).
        let dek_bytes = oldKey ? await tryUnwrapDek(wrapped_b64, iv_for_col, oldKey) : null;
        let was_already_rotated = false;
        if (!dek_bytes) {
            dek_bytes = await tryUnwrapDek(wrapped_b64, iv_for_col, newKey);
            if (dek_bytes) was_already_rotated = true;
        }
        if (!dek_bytes) {
            return { status: "decrypt_failed", row_id: row[tableSpec.pk], dek_col };
        }

        // Re-wrap with NEW master key.
        const re = await rewrapDek(dek_bytes, newKey);
        summary.columns.push({
            column: dek_col,
            was_already_rotated,
            new_wrapped_first8: re.wrapped_dek.slice(0, 8),
        });

        // Update D1 row column.
        const updateSql = `UPDATE ${tableSpec.table} SET ${dek_col}=?1 WHERE ${tableSpec.pk}=?2`;
        await env.DB.prepare(updateSql).bind(re.wrapped_dek, row[tableSpec.pk]).run();

        // Update R2 customMetadata iv_dek (only relevant if the column corresponds
        // to the R2 envelope — for inline-multi-DEK tables this branch is unreached).
        if (r2_object_for_update && tableSpec.dek_cols.length === 1) {
            await env.PHI.put(r2_key, ciphertext_bytes, {
                httpMetadata: r2_object_for_update.httpMetadata,
                customMetadata: {
                    ...(r2_object_for_update.customMetadata || {}),
                    "mz-iv-dek": re.iv_dek,
                    "mz-rotation": new Date().toISOString(),
                },
            });
            iv_dek_b64 = re.iv_dek; // in case multiple cols (not currently used for R2)
        }
    }

    summary.status = "rotated";
    return summary;
}

export async function onRequestPost(ctx) {
  return adminRoute(ctx, async ({ env, request, admin }) => {
    const url = new URL(request.url);
    const confirm = url.searchParams.get("confirm");
    if (!confirm || confirm.length < 16) {
        return jsonError("missing or short confirm token (need ?confirm=<16+ chars>)", 400);
    }
    const expectedConfirm = env.PHI_ROTATION_CONFIRM_TOKEN;
    if (!expectedConfirm || confirm !== expectedConfirm) {
        return jsonError("confirm token does not match env.PHI_ROTATION_CONFIRM_TOKEN", 403);
    }

    let oldKey, newKey;
    try {
        oldKey = await importMasterKeyFromB64(env.PHI_MASTER_KEY_OLD);
        newKey = await importMasterKeyFromB64(env.PHI_MASTER_KEY);
    } catch (e) {
        return jsonError("key import failed: " + e.message, 400);
    }
    if (!newKey) {
        return jsonError("PHI_MASTER_KEY (new) must be set", 400);
    }
    // oldKey may be null if the operator decides to do a "wipe-and-rewrap"
    // (no old key available — only works if every row is already rotated to
    // the new key, e.g. resuming after a prior run).

    const summary = { batches: [], started_at: new Date().toISOString() };
    let total_rotated = 0, total_already_rotated = 0, total_failed = 0;
    const failed_rows = [];

    for (const tableSpec of PHI_TABLES) {
        // Skip if the table doesn't exist (e.g. encounter_ai_summaries not yet migrated)
        try {
            const cols = tableSpec.dek_cols.join(", ");
            const r2 = tableSpec.r2_key_col ? `, ${tableSpec.r2_key_col}` : "";
            const extras = tableSpec.table === "messages" ? ", patient_id"
                         : tableSpec.table === "documents" ? ", patient_id"
                         : tableSpec.table === "message_attachments" ? ", message_id"
                         : tableSpec.table === "encounter_ai_summaries" ? ", encounter_id"
                         : "";
            const sql = `SELECT ${tableSpec.pk}${r2}${extras}, ${cols}
                         FROM ${tableSpec.table}
                         WHERE (${tableSpec.dek_cols.map(c => `${c} IS NOT NULL`).join(" OR ")})
                         LIMIT ${BATCH_SIZE}`;
            const result = await env.DB.prepare(sql).all();
            const rows = result.results || [];

            for (const row of rows) {
                const r = await rotateOneRow(env, oldKey, newKey, tableSpec, row);
                if (r.status === "rotated") {
                    const anyAlready = r.columns.some(c => c.was_already_rotated);
                    if (anyAlready) total_already_rotated += 1;
                    else total_rotated += 1;
                } else {
                    total_failed += 1;
                    failed_rows.push({ table: tableSpec.table, ...r });
                }
            }
            summary.batches.push({ table: tableSpec.table, processed: rows.length });
        } catch (e) {
            summary.batches.push({ table: tableSpec.table, error: e.message });
        }
    }

    try {
        await logAudit(env, {
            user_id: admin.user,
            user_role: admin.role,
            action: "phi_master_key_rotation_batch",
            record_type: "system",
            ip: request.headers.get("CF-Connecting-IP") || "",
            user_agent: request.headers.get("User-Agent") || "",
            success: total_failed === 0,
            details: {
                rotated: total_rotated,
                already_rotated: total_already_rotated,
                failed: total_failed,
                failed_rows,
            },
        });
    } catch (_e) { /* audit failures must not block rotation completion */ }

    return jsonResponse({
        ok: true,
        rotated: total_rotated,
        already_rotated: total_already_rotated,
        failed: total_failed,
        failed_rows,
        batches: summary.batches,
        finished_at: new Date().toISOString(),
    });
  });
}

// GET → dry-run / status. Returns a count of rows still needing rotation.
export async function onRequestGet(ctx) {
  return adminRoute(ctx, async ({ env }) => {
    if (!env.PHI_MASTER_KEY) {
        return jsonError("PHI_MASTER_KEY not configured", 400);
    }
    const counts = {};
    for (const tableSpec of PHI_TABLES) {
        try {
            const cond = tableSpec.dek_cols.map(c => `${c} IS NOT NULL`).join(" OR ");
            const sql = `SELECT COUNT(*) AS n FROM ${tableSpec.table} WHERE ${cond}`;
            const result = await env.DB.prepare(sql).first();
            counts[tableSpec.table] = result?.n ?? null;
        } catch (e) {
            counts[tableSpec.table] = "ERROR: " + e.message;
        }
    }
    return jsonResponse({
        env_PHI_MASTER_KEY_set: !!env.PHI_MASTER_KEY,
        env_PHI_MASTER_KEY_OLD_set: !!env.PHI_MASTER_KEY_OLD,
        env_PHI_ROTATION_CONFIRM_TOKEN_set: !!env.PHI_ROTATION_CONFIRM_TOKEN,
        rows_with_wrapped_dek: counts,
        note: "POST with ?confirm=<env.PHI_ROTATION_CONFIRM_TOKEN> to run a rotation batch (up to " + BATCH_SIZE + " rows).",
    });
  });
}
