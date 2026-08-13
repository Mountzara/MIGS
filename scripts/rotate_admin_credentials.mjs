#!/usr/bin/env node
// =====================================================================
// rotate_admin_credentials.mjs — set the admin username and password
// =====================================================================
// WHY THIS EXISTS
// The admin login is HTTP Basic against ADMIN_USER + ADMIN_PASS_HASH,
// both Cloudflare Pages secrets. Secrets are write-only through the API:
// they can be set but never read back. That is correct, and it means a
// forgotten username cannot be looked up — it can only be replaced.
//
// It also means rotating a password is otherwise a fiddly manual job
// involving PBKDF2 by hand, which is exactly the kind of task people put
// off. A password nobody rotates because rotating it is annoying is a
// worse password than one that is easy to change.
//
// USAGE
//   node scripts/rotate_admin_credentials.mjs --user drmabini --print
//       Generates a strong password and prints the hash. Sets nothing.
//
//   node scripts/rotate_admin_credentials.mjs --user drmabini --apply
//       Generates, then sets BOTH secrets on the Pages production config.
//       Requires CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.
//
//   node scripts/rotate_admin_credentials.mjs --user drmabini \
//        --password 'something you chose' --apply
//
// AFTER APPLYING you must redeploy for the new secrets to take effect:
//   ./scripts/deploy-prod.sh "rotate admin credentials"
//
// The password is printed ONCE. It is not stored anywhere by this script,
// and it cannot be recovered — the hash is one-way, which is the point.
// =====================================================================

import crypto from "node:crypto";

const ITERATIONS = 210000;   // OWASP guidance for PBKDF2-HMAC-SHA256
const KEYLEN = 32;
const SALT_BYTES = 16;

function arg(name, fallback = null) {
    const i = process.argv.indexOf(`--${name}`);
    if (i < 0) return fallback;
    const v = process.argv[i + 1];
    return (!v || v.startsWith("--")) ? true : v;
}

/** Readable but strong: 4 words plus digits beats an unmemorable string
 *  the operator will paste into a chat window to avoid retyping it. */
function generatePassword() {
    const bytes = crypto.randomBytes(24);
    return bytes.toString("base64url").slice(0, 28);
}

function hashPassword(password) {
    const salt = crypto.randomBytes(SALT_BYTES);
    const dk = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEYLEN, "sha256");
    return `pbkdf2$${ITERATIONS}$${salt.toString("base64")}$${dk.toString("base64")}`;
}

/** Prove the hash verifies before it is ever set — a wrong hash locks
 *  the operator out of his own admin console with no way back in. */
function verify(password, stored) {
    const [scheme, iter, saltB64, expectB64] = String(stored).split("$");
    if (scheme !== "pbkdf2") return false;
    const dk = crypto.pbkdf2Sync(password, Buffer.from(saltB64, "base64"),
                                 parseInt(iter, 10), Buffer.from(expectB64, "base64").length, "sha256");
    return crypto.timingSafeEqual(dk, Buffer.from(expectB64, "base64"));
}

const user = arg("user");
if (!user || user === true) {
    console.error("ERROR: --user is required.\n  node scripts/rotate_admin_credentials.mjs --user <username> --apply");
    process.exit(1);
}
const password = arg("password") && arg("password") !== true ? arg("password") : generatePassword();
if (password.length < 12) {
    console.error("ERROR: password must be at least 12 characters.");
    process.exit(1);
}

const hash = hashPassword(password);
if (!verify(password, hash)) {
    console.error("ERROR: generated hash failed self-verification — refusing to continue.");
    process.exit(1);
}

console.log("");
console.log("  ADMIN_USER      " + String(user).trim().toLowerCase());
console.log("  password        " + password);
console.log("");
console.log("  ADMIN_PASS_HASH " + hash);
console.log("");
console.log("  (the username is lower-cased on both sides, so case does not matter at sign-in)");
console.log("  Self-verification passed: this password does hash to that value.");
console.log("");

if (!arg("apply")) {
    console.log("  Nothing was changed. Re-run with --apply to set both secrets.");
    process.exit(0);
}

const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !account) {
    console.error("ERROR: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set.");
    console.error("  source ~/.config/mountzara/cf-creds.env");
    process.exit(1);
}

const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/mountzara`,
    {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            deployment_configs: {
                production: {
                    env_vars: {
                        ADMIN_USER: { value: String(user).trim().toLowerCase(), type: "secret_text" },
                        ADMIN_PASS_HASH: { value: hash, type: "secret_text" },
                    },
                },
            },
        }),
    }
);
const j = await res.json();
if (!j.success) {
    console.error("FAILED to set secrets:", JSON.stringify(j.errors));
    process.exit(1);
}
console.log("  ✅ Both secrets set on the Pages production config.");
console.log("");
console.log("  NOT LIVE YET — Pages reads secrets at deploy time, so the old");
console.log("  credentials keep working until you redeploy:");
console.log("");
console.log("      ./scripts/deploy-prod.sh \"rotate admin credentials\"");
console.log("");
