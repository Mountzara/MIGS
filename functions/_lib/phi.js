// =====================================================================
// functions/_lib/phi.js — PHI envelope encryption helpers
// =====================================================================
// Per CLAUDE.md §11 Tier 2 + Tier 7. PHI bodies (encounter notes, message
// bodies, uploaded documents) stored in R2 (mountzara-phi) are wrapped
// with a per-record AES-GCM 256 envelope DEK. The DEK is itself wrapped
// with the master key from env.PHI_MASTER_KEY (32 random bytes, base64).
//
// Why envelope encryption on top of R2's default at-rest encryption?
//   * Defense-in-depth: a Cloudflare-side incident that exposes R2 plaintext
//     to a third party still leaves PHI bodies AES-GCM encrypted under
//     a key the operator controls.
//   * Per-record DEKs let us rotate the master key without re-encrypting
//     gigabytes of PHI — only the small wrapped DEKs need re-wrapping.
//   * Key rotation is annual per §11 Tier 7.
//
// Threat model:
//   * Adversary obtains R2 object contents only → ciphertext is opaque.
//   * Adversary obtains D1 row only (wrapped DEK) → still needs master key.
//   * Adversary obtains master key only → needs ciphertext too (R2 access).
//   * Adversary obtains all three → game over (this is HIPAA-acceptable;
//     the master key is an operator secret, not in the application code).
// =====================================================================

const MASTER_KEY_BYTES = 32;
const DEK_BYTES = 32;
const IV_BYTES = 12;          // AES-GCM IV size
const AAD_PREFIX = "mountzara-phi/v1/";

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

function randomBytes(n) {
    const out = new Uint8Array(n);
    crypto.getRandomValues(out);
    return out;
}

/**
 * Import the master key from env.PHI_MASTER_KEY.
 * The master key MUST be a base64-encoded 32-byte random value, set via:
 *   echo -n "$(openssl rand -base64 32)" | wrangler pages secret put PHI_MASTER_KEY --project-name=mountzara
 */
async function importMasterKey(env) {
    if (!env.PHI_MASTER_KEY) {
        throw new Error("PHI_MASTER_KEY env secret not configured");
    }
    const raw = base64ToBytes(env.PHI_MASTER_KEY);
    if (raw.length !== MASTER_KEY_BYTES) {
        throw new Error(`PHI_MASTER_KEY must decode to ${MASTER_KEY_BYTES} bytes; got ${raw.length}`);
    }
    return crypto.subtle.importKey(
        "raw", raw,
        { name: "AES-GCM" },
        false,
        ["encrypt", "decrypt"]
    );
}

/**
 * Encrypt a PHI body. Returns:
 *   {
 *     ciphertext: Uint8Array,        // store this in R2
 *     wrapped_dek: string (base64),  // store this in D1 envelope_dek_wrapped
 *     iv_data: string (base64),      // IV used for body encryption (lives in object metadata)
 *     iv_dek: string (base64),       // IV used to wrap the DEK
 *   }
 *
 * @param {object} env
 * @param {Uint8Array|ArrayBuffer|string} plaintext
 * @param {string} aad — additional authenticated data (e.g. patient_id + record_type)
 */
export async function encryptPhi(env, plaintext, aad) {
    const masterKey = await importMasterKey(env);

    // 1. Generate a fresh per-record DEK.
    const dekBytes = randomBytes(DEK_BYTES);
    const dek = await crypto.subtle.importKey(
        "raw", dekBytes,
        { name: "AES-GCM" },
        true,                     // extractable so we can wrap it
        ["encrypt"]
    );

    // 2. Encrypt the plaintext with the DEK.
    const iv_data = randomBytes(IV_BYTES);
    const plaintextBytes = (typeof plaintext === "string")
        ? new TextEncoder().encode(plaintext)
        : (plaintext instanceof Uint8Array ? plaintext : new Uint8Array(plaintext));
    const aadBytes = new TextEncoder().encode(AAD_PREFIX + (aad || ""));
    const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv_data, additionalData: aadBytes },
        dek,
        plaintextBytes
    );

    // 3. Wrap the DEK with the master key.
    const iv_dek = randomBytes(IV_BYTES);
    const wrapped = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv_dek, additionalData: new TextEncoder().encode(AAD_PREFIX + "dek") },
        masterKey,
        dekBytes
    );

    return {
        ciphertext: new Uint8Array(ciphertext),
        wrapped_dek: bytesToBase64(new Uint8Array(wrapped)),
        iv_data: bytesToBase64(iv_data),
        iv_dek: bytesToBase64(iv_dek),
    };
}

/**
 * Decrypt a PHI body. Reverses encryptPhi().
 *
 * @param {object} env
 * @param {Uint8Array|ArrayBuffer} ciphertext
 * @param {string} wrapped_dek - base64
 * @param {string} iv_data - base64
 * @param {string} iv_dek - base64
 * @param {string} aad - additional authenticated data (must match encrypt-side)
 * @returns {Promise<Uint8Array>}
 */
export async function decryptPhi(env, ciphertext, wrapped_dek, iv_data, iv_dek, aad) {
    const masterKey = await importMasterKey(env);

    // 1. Unwrap the DEK.
    const dekBytes = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: base64ToBytes(iv_dek), additionalData: new TextEncoder().encode(AAD_PREFIX + "dek") },
        masterKey,
        base64ToBytes(wrapped_dek)
    );
    const dek = await crypto.subtle.importKey(
        "raw", new Uint8Array(dekBytes),
        { name: "AES-GCM" },
        false,
        ["decrypt"]
    );

    // 2. Decrypt the body.
    const aadBytes = new TextEncoder().encode(AAD_PREFIX + (aad || ""));
    const ctBytes = (ciphertext instanceof Uint8Array) ? ciphertext : new Uint8Array(ciphertext);
    const pt = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: base64ToBytes(iv_data), additionalData: aadBytes },
        dek,
        ctBytes
    );
    return new Uint8Array(pt);
}

/**
 * decryptPhi returns BYTES. Every caller that wants a string or JSON must
 * decode first, and three of them did not — they passed the Uint8Array
 * straight to JSON.parse, which coerces it to "123,45,67,..." and throws
 * "Unexpected non-whitespace character after JSON at position 3".
 *
 * Two of those swallowed the error in a catch and logged a warning, so the
 * symptom was silent: clearinghouse credentials that never decrypted, and
 * invoice line items that always came back empty. Nothing looked broken.
 *
 * These two helpers exist so the decode is not something a caller has to
 * remember. Prefer them over decryptPhi wherever the payload is text.
 */
export async function decryptPhiText(env, ciphertext, wrapped_dek, iv_data, iv_dek, aad) {
    const bytes = await decryptPhi(env, ciphertext, wrapped_dek, iv_data, iv_dek, aad);
    return new TextDecoder().decode(bytes);
}

export async function decryptPhiJson(env, ciphertext, wrapped_dek, iv_data, iv_dek, aad) {
    return JSON.parse(await decryptPhiText(env, ciphertext, wrapped_dek, iv_data, iv_dek, aad));
}

/**
 * High-level helper: store an encrypted PHI body in mountzara-phi R2 bucket
 * and return the metadata to persist on the D1 row.
 *
 * @param {object} env
 * @param {string} r2_key - object key (caller chooses scheme — typically
 *                          `${kind}/${patient_id}/${record_id}.bin`)
 * @param {Uint8Array|string} plaintext
 * @param {string} aad
 * @returns {Promise<{r2_key, wrapped_dek, iv_data, iv_dek, size_bytes}>}
 */
export async function putPhiObject(env, r2_key, plaintext, aad) {
    if (!env.PHI) throw new Error("PHI R2 bucket not bound (expected env.PHI = mountzara-phi)");
    const { ciphertext, wrapped_dek, iv_data, iv_dek } = await encryptPhi(env, plaintext, aad);
    // Stash IVs in R2 object custom metadata so the application code that
    // reads the object back can decrypt without an extra D1 round-trip.
    // D1 also carries them on the documents/encounters row for redundancy.
    await env.PHI.put(r2_key, ciphertext, {
        httpMetadata: { contentType: "application/octet-stream" },
        customMetadata: {
            "mz-iv-data": iv_data,
            "mz-iv-dek": iv_dek,
            "mz-aad": aad || "",
            "mz-cipher": "AES-GCM-256",
            "mz-envelope-version": "v1",
        },
    });
    return { r2_key, wrapped_dek, iv_data, iv_dek, size_bytes: ciphertext.length };
}

/**
 * High-level helper: fetch + decrypt an encrypted PHI body from
 * mountzara-phi. The wrapped_dek MUST come from the corresponding D1 row;
 * we do NOT trust R2 customMetadata alone for wrapped_dek (defense-in-depth).
 *
 * @returns {Promise<Uint8Array|null>}
 */
export async function getPhiObject(env, r2_key, wrapped_dek, expected_aad) {
    if (!env.PHI) throw new Error("PHI R2 bucket not bound");
    const obj = await env.PHI.get(r2_key);
    if (!obj) return null;
    const iv_data = obj.customMetadata?.["mz-iv-data"];
    const iv_dek = obj.customMetadata?.["mz-iv-dek"];
    if (!iv_data || !iv_dek) {
        throw new Error(`PHI object ${r2_key} missing required customMetadata IVs`);
    }
    const aad_on_object = obj.customMetadata?.["mz-aad"] || "";
    // AAD MUST match what the caller expected, otherwise reject.
    if (expected_aad !== undefined && expected_aad !== null && aad_on_object !== expected_aad) {
        throw new Error(`PHI AAD mismatch for ${r2_key}`);
    }
    const ciphertext = new Uint8Array(await obj.arrayBuffer());
    return decryptPhi(env, ciphertext, wrapped_dek, iv_data, iv_dek, aad_on_object);
}
