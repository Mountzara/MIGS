// =====================================================================
// functions/_lib/totp.js — TOTP (RFC 6238) for admin MFA.
// Pure-JS, uses WebCrypto (works on Cloudflare Workers — no Node).
//
// Default parameters match Google Authenticator / Authy / 1Password:
//   - 6-digit code
//   - 30-second window
//   - HMAC-SHA-1 (RFC 6238 default)
//   - 1-step skew tolerance on either side (±30 s clock drift accepted)
//
// Per CLAUDE.md §11 Tier 7 — admin MFA closes the open-pending task
// for second-factor auth on /admin/*.
// =====================================================================

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(input) {
    const cleaned = input.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase();
    let bits = "";
    for (const ch of cleaned) {
        const v = BASE32_ALPHABET.indexOf(ch);
        if (v < 0) throw new Error("invalid base32 character: " + ch);
        bits += v.toString(2).padStart(5, "0");
    }
    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) {
        bytes.push(parseInt(bits.slice(i, i + 8), 2));
    }
    return new Uint8Array(bytes);
}

export function base32Encode(bytes) {
    let bits = "";
    for (const b of bytes) bits += b.toString(2).padStart(8, "0");
    let out = "";
    for (let i = 0; i < bits.length; i += 5) {
        const chunk = bits.slice(i, i + 5).padEnd(5, "0");
        out += BASE32_ALPHABET[parseInt(chunk, 2)];
    }
    // RFC 4648 padding (so QR-code apps that expect padded base32 don't choke)
    while (out.length % 8 !== 0) out += "=";
    return out;
}

function intToBuffer(n) {
    const buf = new ArrayBuffer(8);
    const view = new DataView(buf);
    view.setUint32(0, Math.floor(n / 0x100000000));
    view.setUint32(4, n & 0xffffffff);
    return buf;
}

async function hotp(secretBytes, counter) {
    const key = await crypto.subtle.importKey(
        "raw", secretBytes,
        { name: "HMAC", hash: "SHA-1" },
        false, ["sign"]
    );
    const hmac = new Uint8Array(await crypto.subtle.sign("HMAC", key, intToBuffer(counter)));
    const offset = hmac[hmac.length - 1] & 0x0f;
    const bin = ((hmac[offset] & 0x7f) << 24)
              | ((hmac[offset + 1] & 0xff) << 16)
              | ((hmac[offset + 2] & 0xff) << 8)
              | (hmac[offset + 3] & 0xff);
    return (bin % 1_000_000).toString().padStart(6, "0");
}

/**
 * Verify a 6-digit TOTP code against a base32 secret.
 * Accepts ±1 30-second window (so a code submitted right at a 30s rollover
 * still verifies). Constant-time comparison.
 */
export async function verifyTotp(secretBase32, code, { now = Date.now(), step = 30, skew = 1 } = {}) {
    if (!secretBase32 || typeof code !== "string") return false;
    const cleanedCode = code.replace(/\s+/g, "");
    if (!/^\d{6}$/.test(cleanedCode)) return false;
    let secretBytes;
    try { secretBytes = base32Decode(secretBase32); }
    catch { return false; }
    const t = Math.floor(now / 1000 / step);
    for (let s = -skew; s <= skew; s++) {
        const expected = await hotp(secretBytes, t + s);
        let mismatch = 0;
        for (let i = 0; i < 6; i++) mismatch |= expected.charCodeAt(i) ^ cleanedCode.charCodeAt(i);
        if (mismatch === 0) return true;
    }
    return false;
}

/**
 * Generate a new random base32 secret suitable for provisioning. 20 bytes →
 * 32 base32 characters, matching the Google Authenticator default.
 */
export function generateSecret() {
    const bytes = new Uint8Array(20);
    crypto.getRandomValues(bytes);
    return base32Encode(bytes).replace(/=+$/, "");
}

/**
 * Build an otpauth:// URI for provisioning. The TOTP app (Google Authenticator,
 * 1Password, Authy, etc.) accepts this URI directly or via a QR code that
 * encodes it.
 *
 *   otpauth://totp/<issuer>:<account>?secret=<base32>&issuer=<issuer>
 */
export function provisioningUri({ issuer, account, secretBase32 }) {
    const enc = encodeURIComponent;
    return `otpauth://totp/${enc(issuer)}:${enc(account)}?secret=${secretBase32}&issuer=${enc(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
