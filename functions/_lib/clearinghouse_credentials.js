// =====================================================================
// clearinghouse_credentials.js — encrypted credential storage + resolution
// =====================================================================
// A setup wizard that ends with "now go set an environment variable" is
// not a setup wizard. This module is what lets the wizard actually finish:
// the operator types the key the vendor issued, it is sealed with the same
// envelope encryption used for PHI, and every later call — connection
// test, test claim, real submission — picks it up automatically.
//
// PRECEDENCE: a value already present as a Cloudflare env secret ALWAYS
// wins over a stored one. Existing deployments keep behaving exactly as
// they did, and the terminal remains the authoritative path for anyone who
// wants it. The database is the fallback, not the override.
//
// WHY ENCRYPTED AT ALL, when this is not PHI: a clearinghouse credential
// can submit claims for real money under this physician's NPI. It is the
// single most abusable secret in the system, so it gets the strongest
// protection available here rather than sitting in a plaintext column.
//
// D1 columns are TEXT, so ciphertext is base64 on the way in and back to
// bytes on the way out. encryptPhi returns a Uint8Array; storing that
// directly would silently stringify to "[object Object]" and lose the
// credential — a failure that would only surface at the first real claim.
// =====================================================================

import { encryptPhi, decryptPhi } from "./phi.js";
import { VENDOR_FACTS } from "./clearinghouse_onboarding.js";

function bytesToBase64(bytes) {
    let s = "";
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
}

function base64ToBytes(b64) {
    const s = atob(String(b64 || ""));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
}

/** Seal an object into the four columns a D1 row needs. */
export async function sealJson(env, obj, aad) {
    const enc = await encryptPhi(env, JSON.stringify(obj), aad);
    return {
        ciphertext: bytesToBase64(enc.ciphertext),
        dek_wrapped: enc.wrapped_dek,
        iv_data: enc.iv_data,
        iv_dek: enc.iv_dek,
    };
}

/** Reverse sealJson. Returns null when anything is missing or malformed. */
export async function openJson(env, sealed, aad) {
    if (!sealed?.ciphertext || !sealed?.dek_wrapped) return null;
    try {
        // decryptPhi returns BYTES. Passing them to JSON.parse coerces the
        // array to "123,45,67,..." and throws — which the catch below then
        // swallowed, so a stored clearinghouse key silently never decrypted
        // and every claim fell back to "credentials not configured".
        const plain = new TextDecoder().decode(await decryptPhi(
            env, base64ToBytes(sealed.ciphertext), sealed.dek_wrapped,
            sealed.iv_data, sealed.iv_dek, aad
        ));
        return JSON.parse(plain);
    } catch (e) {
        // A credential that will not decrypt is a real incident — most
        // likely PHI_MASTER_KEY was rotated without re-sealing. Loud, but
        // not fatal: the caller falls back to env and reports "not configured"
        // rather than throwing inside a claim submission.
        console.error("clearinghouse_credentials: decrypt failed", String(e).slice(0, 200));
        return null;
    }
}

export const CRED_AAD = (vendor) => `clearinghouse_credentials:${vendor}`;

/**
 * The vendor's auth values, env first, stored second.
 * @returns {Promise<Record<string,string>>}
 */
export async function resolveVendorCredentials(env, vendor) {
    const facts = VENDOR_FACTS[vendor];
    if (!facts || !env?.DB) return {};
    const out = {};
    const needed = facts.auth_fields.filter((f) => !env[f.key]);
    for (const f of facts.auth_fields) if (env[f.key]) out[f.key] = env[f.key];
    if (!needed.length) return out;

    const row = await env.DB.prepare(
        `SELECT fields_ciphertext, fields_dek_wrapped, fields_iv_data, fields_iv_dek
           FROM clearinghouse_credentials WHERE vendor = ? LIMIT 1`
    ).bind(vendor).first().catch(() => null);
    if (!row) return out;

    const stored = await openJson(env, {
        ciphertext: row.fields_ciphertext, dek_wrapped: row.fields_dek_wrapped,
        iv_data: row.fields_iv_data, iv_dek: row.fields_iv_dek,
    }, CRED_AAD(vendor));
    if (!stored) return out;

    for (const f of needed) if (stored[f.key]) out[f.key] = stored[f.key];
    return out;
}

/**
 * An `env`-shaped object with the vendor's stored credentials merged in.
 *
 * This is the seam that lets every existing consumer — submitClaim,
 * isConfigured, checkEligibility — work with wizard-entered credentials
 * without any of them learning that a database is involved. Pass the
 * result anywhere an `env` is expected.
 */
export async function withStoredCredentials(env, vendor) {
    const creds = await resolveVendorCredentials(env, vendor);
    if (!Object.keys(creds).length) return env;
    return new Proxy(env, {
        get(target, prop) {
            if (typeof prop === "string" && prop in creds && !target[prop]) return creds[prop];
            return target[prop];
        },
        has(target, prop) {
            return prop in target || (typeof prop === "string" && prop in creds);
        },
    });
}

/** Store (merging with anything already there) and return the key names kept. */
export async function storeVendorCredentials(env, vendor, incoming, actor) {
    const facts = VENDOR_FACTS[vendor];
    if (!facts) throw new Error(`unknown vendor: ${vendor}`);
    const known = new Set(facts.auth_fields.map((f) => f.key));

    const fields = {};
    for (const [k, v] of Object.entries(incoming || {})) {
        if (!known.has(k)) continue;                       // never store an unknown key
        if (v === "" || v === null || v === undefined) continue;
        fields[k] = String(v);
    }
    if (!Object.keys(fields).length) throw new Error("no credential values supplied");

    // Merge, so saving one half of an OAuth pair does not erase the other.
    const prior = await env.DB.prepare(
        `SELECT fields_ciphertext, fields_dek_wrapped, fields_iv_data, fields_iv_dek
           FROM clearinghouse_credentials WHERE vendor = ? LIMIT 1`
    ).bind(vendor).first().catch(() => null);

    let merged = fields;
    if (prior?.fields_ciphertext) {
        const old = await openJson(env, {
            ciphertext: prior.fields_ciphertext, dek_wrapped: prior.fields_dek_wrapped,
            iv_data: prior.fields_iv_data, iv_dek: prior.fields_iv_dek,
        }, CRED_AAD(vendor));
        merged = { ...(old || {}), ...fields };
    }

    const sealed = await sealJson(env, merged, CRED_AAD(vendor));
    const now = new Date().toISOString();
    await env.DB.prepare(
        `INSERT INTO clearinghouse_credentials
           (vendor, fields_ciphertext, fields_dek_wrapped, fields_iv_data, fields_iv_dek,
            field_names_json, updated_at, updated_by)
         VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT(vendor) DO UPDATE SET
            fields_ciphertext=excluded.fields_ciphertext,
            fields_dek_wrapped=excluded.fields_dek_wrapped,
            fields_iv_data=excluded.fields_iv_data,
            fields_iv_dek=excluded.fields_iv_dek,
            field_names_json=excluded.field_names_json,
            updated_at=excluded.updated_at, updated_by=excluded.updated_by`
    ).bind(vendor, sealed.ciphertext, sealed.dek_wrapped, sealed.iv_data, sealed.iv_dek,
           JSON.stringify(Object.keys(merged)), now, actor || null).run();

    return Object.keys(fields);
}

export default {
    sealJson, openJson, CRED_AAD,
    resolveVendorCredentials, withStoredCredentials, storeVendorCredentials,
};
