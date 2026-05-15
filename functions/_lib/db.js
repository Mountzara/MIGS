// =====================================================================
// functions/_lib/db.js — small D1 query conveniences
// =====================================================================
// Thin wrappers over env.DB.prepare(...) to keep call sites concise and
// to centralize the "throw if DB not bound" guard. The real query work
// always happens at the call site so the read shape is visible.
// =====================================================================

export function requireDb(env) {
    if (!env || !env.DB) {
        throw new Error("D1 database not bound — wrangler.toml [[d1_databases]] binding missing or deploy didn't carry it");
    }
    return env.DB;
}

/**
 * Fetch one row by id from a table. Returns null if not found.
 * Always uses a parameterized query (no string interpolation).
 */
export async function getById(env, table, id, columns = "*") {
    const db = requireDb(env);
    // Whitelist table names — never interpolate untrusted table names.
    if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new Error(`invalid table name: ${table}`);
    if (columns !== "*" && !/^[a-z_][a-z0-9_, ]*$/.test(columns)) {
        throw new Error(`invalid columns spec: ${columns}`);
    }
    const sql = `SELECT ${columns} FROM ${table} WHERE id = ? LIMIT 1`;
    return db.prepare(sql).bind(id).first();
}

/**
 * Generate a UUIDv4. Available on Workers runtime via crypto.randomUUID.
 */
export function newId() {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const hex = Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const now = () => Date.now();
